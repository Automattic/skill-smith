import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	AgentContext,
	AgentDefinition,
	IterationInfo,
	RunScenario,
	Scenario,
	SkillsmithConfig,
} from "../config/types";
import { decideRunnability } from "../policy/runnability";
import type { ProgressTracker } from "../progress";
import type { TokenUsage } from "../providers/types";
import {
	type Cell,
	classifyVerdict,
	summarizeFailures,
} from "../reports/verdict";
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
			? config.roles.test.agents
			: config.roles.test.agents.filter((a) => filterSet.has(a.id));

	if (filterSet !== undefined) {
		log.info(
			`agent filter active for ${scenario.name}: ${agents.map((a) => a.id).join(",") || "(none)"}`,
		);
	}

	// Split the active selection into agents that can run and agents whose
	// provider is misconfigured (a required credential is absent). The plan
	// partitions the full declared test set, so intersect it with `agents`
	// to keep any active `agentIdFilter` honored.
	const plan = decideRunnability(config, process.env);
	const activeIds = new Set(agents.map((a) => a.id));
	const runnable = plan.testAgents.run.filter((a) => activeIds.has(a.id));
	const excluded = plan.testAgents.excluded.filter((e) =>
		activeIds.has(e.agent.id),
	);

	// Persist a non-PASS marker for each excluded agent without invoking it
	// or firing its hooks. The marker flows through the normal scoring chain
	// and forces a non-zero exit, surfacing the misconfiguration.
	for (const { agent, reason } of excluded) {
		const agentDirectory = join(scenarioDirectory, agent.id);
		mkdirSync(agentDirectory, { recursive: true });
		writeAgentReport(agentDirectory, { duration: 0 }, { skipped: reason });
		tracker.phaseFinished(scenario.name, agent.id, "testing", {
			status: "skipped",
			detail: "misconfigured",
		});
	}

	await Promise.all(
		runnable.map((agent) =>
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

	if (testingResult.error !== undefined) {
		// Testing didn't produce evaluable output (missing API key, transport
		// error, etc.). Skip the judge entirely: an empty workspace can't pass
		// the rubrics, so running the judge would burn compute and add a
		// redundant `N rubrics failed` row to the dashboard one line below the
		// real cause. The paired before/afterJudgeAgent hooks are skipped
		// symmetrically.
		tracker.phaseFinished(scenario.name, agent.id, "judge", {
			status: "skipped",
			detail: "testing failed",
		});
		writeAgentReport(agentDirectory, testing, {
			skipped: `testing failed: ${testingResult.error}`,
		});
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
		let rawReview: unknown;
		try {
			rawReview = await runJudgeAgent({
				scenario,
				judge: config.roles.judge.agent,
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
		const cell: Cell =
			judgeError !== undefined
				? { kind: "FAIL", failures: [judgeError] }
				: classifyVerdict(rawReview);
		const verdictResult = cellToPhaseResult(cell);
		tracker.phaseFinished(scenario.name, agent.id, "judge", {
			status: verdictResult.status,
			durationMs: Date.now() - judgeStart,
			detail: verdictResult.detail,
		});

		// Persist the judge's complete review (every rubric / acceptance
		// item with its pass flag and notes) so a human or the improver
		// can read the full picture. The collapsed `verdict` above is only
		// used to drive the live dashboard.
		writeAgentReport(agentDirectory, testing, rawReview);

		await tryHook(
			"afterJudgeAgent",
			scope,
			config.hooks?.afterJudgeAgent,
			agentCtx,
			log,
		);
	}
}

function cellToPhaseResult(cell: Cell): {
	status: "passed" | "failed" | "skipped";
	detail?: string;
} {
	if (cell.kind === "SKIPPED") {
		return { status: "skipped", detail: cell.reason };
	}
	if (cell.kind === "PASS") return { status: "passed" };
	return { status: "failed", detail: summarizeFailures(cell.failures) };
}

/**
 * Single writer of the per-agent `report.json`. Pairs the `testing`
 * block (always present) with the judge's `review` verbatim — the
 * complete set of rubrics and acceptance items with their pass flags
 * and notes — so reports stay fully informative. Testing/dispatch
 * failures persist a `{ skipped }` marker in place of the review.
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
