import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type {
	AgentContext,
	AgentDefinition,
	IterationInfo,
	RunScenario,
	Scenario,
	SkillsmithConfig,
} from "../config/types";
import type { ProgressTracker } from "../progress";
import type { TokenUsage } from "../providers/types";
import {
	type AgentVerdict,
	collapseReview,
} from "../reports/agent-verdict";
import { tryHook } from "../util/hooks";
import type { RunLog } from "../util/run-log";
import { runJudgeAgent } from "./judge-agent";
import { runTestingAgent } from "./testing-agent";

export interface RunAgentsParams {
	scenario: Scenario;
	scenarioDirectory: string;
	config: SkillsmithConfig;
	runId: string;
	runDirectory: string;
	iterations: IterationInfo[];
	projectRoot: string;
	log: RunLog;
	tracker: ProgressTracker;
	scenarios: RunScenario[];
	/**
	 * When present, only testing agents whose ids appear in this list
	 * run for this scenario. Used by `failed-pairs` mode to re-run only
	 * the agents that failed in the previous iteration.
	 */
	agentIdFilter?: string[];
}

export interface TestingAgentResult {
	finalText: string;
	toolUseCount: number;
	filesWritten: string[];
	error?: string;
	usage?: TokenUsage;
}

/**
 * The `testing` block persisted into the per-agent `report.yaml`.
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
		runDirectory,
		iterations,
		projectRoot,
		log,
		tracker,
		scenarios,
		agentIdFilter,
	} = params;

	const filterSet =
		agentIdFilter !== undefined ? new Set(agentIdFilter) : undefined;
	const agents =
		filterSet === undefined
			? config.agents.testing
			: config.agents.testing.filter((a) => filterSet.has(a.id));

	if (filterSet !== undefined) {
		log.info(
			`agent filter active for ${scenario.name}: ${agents.map((a) => a.id).join(",") || "(none)"}`,
		);
	}

	await Promise.all(
		agents.map((agent) =>
			runAgentPair({
				agent,
				scenario,
				scenarioDirectory,
				config,
				runId,
				runDirectory,
				iterations,
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
	runDirectory: string;
	iterations: IterationInfo[];
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
		runDirectory,
		iterations,
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
		runDirectory,
		iterations,
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
	let rawReview: unknown;
	try {
		rawReview = await runJudgeAgent({
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
		rawReview = { skipped: `judge dispatch failed: ${msg}` };
		judgeError = msg;
	}
	const verdict: AgentVerdict = judgeError
		? { pass: false, error: judgeError }
		: collapseReview(rawReview);
	const verdictResult = classifyVerdictForTracker(verdict);
	tracker.phaseFinished(scenario.name, agent.id, "judge", {
		status: verdictResult.status,
		durationMs: Date.now() - judgeStart,
		detail: verdictResult.detail,
	});

	writeAgentReport(agentDirectory, testing, verdict);

	await tryHook(
		"afterJudgeAgent",
		scope,
		config.hooks?.afterJudgeAgent,
		agentCtx,
		log,
	);
}

function classifyVerdictForTracker(
	verdict: AgentVerdict,
): { status: "passed" | "failed" | "skipped"; detail?: string } {
	if ("skipped" in verdict) return { status: "skipped", detail: verdict.skipped };
	if (verdict.pass === true) return { status: "passed" };
	const failureDetail =
		verdict.failures !== undefined && verdict.failures.length > 0
			? verdict.failures.map((f) => `${f.kind} ${f.id}`).join(", ")
			: verdict.error;
	return { status: "failed", detail: failureDetail };
}

/**
 * Single writer of the per-agent `report.yaml`. Pairs the `testing`
 * block (always present) with the simplified verdict the harness
 * computed under `review`. Passing agents collapse to
 * `review: { pass: true }`; failing agents keep just the rubrics /
 * acceptance items that failed plus the judge's notes inline.
 */
function writeAgentReport(
	agentDirectory: string,
	testing: TestingBlock,
	review: AgentVerdict,
): void {
	mkdirSync(agentDirectory, { recursive: true });
	writeFileSync(
		join(agentDirectory, "report.yaml"),
		stringifyYaml({ testing, review }),
	);
}
