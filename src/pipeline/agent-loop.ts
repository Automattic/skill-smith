import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	AgentContext,
	AgentDefinition,
	RunScenario,
	Scenario,
	SkillsmithConfig,
} from "../config/types";
import type { ProgressTracker } from "../progress";
import type { TokenUsage } from "../providers/types";
import { classifyVerdict, summarizeFailures } from "../reports/verdict";
import { tryHook } from "../util/hooks";
import type { RunLog } from "../util/run-log";
import { runJudgeAgent } from "./judge-agent";
import { runTestingAgent } from "./testing-agent";

export interface RunAgentsParams {
	scenario: Scenario;
	scenarioDirectory: string;
	config: SkillsmithConfig;
	runId: string;
	projectRoot: string;
	log: RunLog;
	tracker: ProgressTracker;
	scenarios: RunScenario[];
}

export interface TestingAgentResult {
	finalText: string;
	toolUseCount: number;
	filesWritten: string[];
	error?: string;
	usage?: TokenUsage;
}

/**
 * The `testing` block persisted into the per-agent `report.json`.
 * `duration` is wall-clock milliseconds for the testing-agent
 * invocation; `tokenUsage` is omitted when the provider reported no
 * usage (e.g. the testing agent errored before returning any).
 */
interface TestingBlock {
	duration: number;
	tokenUsage?: TokenUsage;
}

/**
 * Per-scenario agent loop. Mkdirs each `agentWorkspace`, fires the
 * four agent-scoped hooks, and dispatches testing + judge agents in
 * parallel across testing entries.
 */
export async function runAgents(params: RunAgentsParams): Promise<void> {
	const {
		scenario,
		scenarioDirectory,
		config,
		runId,
		projectRoot,
		log,
		tracker,
		scenarios,
	} = params;

	await Promise.all(
		config.agents.testing.map((agent) =>
			runAgentPair({
				agent,
				scenario,
				scenarioDirectory,
				config,
				runId,
				projectRoot,
				log,
				tracker,
				scenarios,
			}),
		),
	);
}

interface RunAgentPairParams {
	agent: AgentDefinition;
	scenario: Scenario;
	scenarioDirectory: string;
	config: SkillsmithConfig;
	runId: string;
	projectRoot: string;
	log: RunLog;
	tracker: ProgressTracker;
	scenarios: RunScenario[];
}

async function runAgentPair(params: RunAgentPairParams): Promise<void> {
	const {
		agent,
		scenario,
		scenarioDirectory,
		config,
		runId,
		projectRoot,
		log,
		tracker,
		scenarios,
	} = params;
	const agentDirectory = join(scenarioDirectory, agent.id);
	const agentWorkspace = join(agentDirectory, "workspace");

	mkdirSync(agentWorkspace, { recursive: true });

	const agentCtx: AgentContext = {
		runId,
		config,
		scenarios,
		scenario,
		agent,
		agentWorkspace,
	};

	const scope = `scenario:${scenario.name}/agent:${agent.id}`;

	await tryHook(
		"beforeTestAgent",
		scope,
		config.hooks?.beforeTestAgent,
		agentCtx,
		log,
	);

	tracker.phaseStarted(scenario.name, agent.id, "testing");
	const testingStart = Date.now();
	let testingResult: TestingAgentResult;
	try {
		testingResult = await runTestingAgent({
			scenario,
			agent,
			agentWorkspace,
			projectRoot,
			config,
			log,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		log.info(`testing-agent failed (${scope}): ${msg}`);
		testingResult = {
			finalText: "",
			toolUseCount: 0,
			filesWritten: [],
			error: msg,
		};
	}
	const testingDuration = Date.now() - testingStart;
	tracker.phaseFinished(scenario.name, agent.id, "testing", {
		status: testingResult.error === undefined ? "passed" : "failed",
		durationMs: testingDuration,
		detail: testingResult.error,
	});

	const testing: TestingBlock = { duration: testingDuration };
	if (testingResult.usage !== undefined) {
		testing.tokenUsage = testingResult.usage;
	}

	await tryHook(
		"afterTestAgent",
		scope,
		config.hooks?.afterTestAgent,
		agentCtx,
		log,
	);

	let review: unknown;
	if (testingResult.error !== undefined) {
		// Testing didn't produce evaluable output (missing API key, transport
		// error, etc.). Skip the judge entirely: an empty workspace can't pass
		// the rubrics, so running the judge would burn compute and add a
		// redundant `N rubrics failed` row to the dashboard one line below the
		// real cause. The paired before/afterJudgeAgent hooks are skipped
		// symmetrically.
		review = { skipped: `testing failed: ${testingResult.error}` };
		tracker.phaseFinished(scenario.name, agent.id, "judge", {
			status: "skipped",
			detail: "testing failed",
		});
		writeAgentReport(agentDirectory, testing, review);
	} else {
		await tryHook(
			"beforeJudgeAgent",
			scope,
			config.hooks?.beforeJudgeAgent,
			agentCtx,
			log,
		);

		tracker.phaseStarted(scenario.name, agent.id, "judge");
		const judgeStart = Date.now();
		let judgeError: string | undefined;
		try {
			review = await runJudgeAgent({
				scenario,
				judges: config.agents.judge,
				agentDirectory,
				agentWorkspace,
				projectRoot,
				config,
				log,
				testingResult,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log.info(`judge-agent failed (${scope}): ${msg}`);
			review = { skipped: `judge dispatch failed: ${msg}` };
			judgeError = msg;
		}
		const verdictResult = judgeError
			? { status: "failed" as const, detail: judgeError }
			: classifyReview(review);
		tracker.phaseFinished(scenario.name, agent.id, "judge", {
			status: verdictResult.status,
			durationMs: Date.now() - judgeStart,
			detail: verdictResult.detail,
		});

		writeAgentReport(agentDirectory, testing, review);

		await tryHook(
			"afterJudgeAgent",
			scope,
			config.hooks?.afterJudgeAgent,
			agentCtx,
			log,
		);
	}
}

function classifyReview(review: unknown): {
	status: "passed" | "failed" | "skipped";
	detail?: string;
} {
	const cell = classifyVerdict(review);
	if (cell.kind === "PASS") return { status: "passed" };
	if (cell.kind === "SKIPPED")
		return { status: "skipped", detail: cell.reason };
	return { status: "failed", detail: summarizeFailures(cell.failures) };
}

/**
 * Single writer of the per-agent `report.json`. Pairs the `testing`
 * block (always present) with whatever the judge step produced under
 * `review`.
 */
function writeAgentReport(
	agentDirectory: string,
	testing: TestingBlock,
	review: unknown,
): void {
	mkdirSync(agentDirectory, { recursive: true });
	writeFileSync(
		join(agentDirectory, "report.json"),
		`${JSON.stringify({ testing, review }, null, 2)}\n`,
	);
}
