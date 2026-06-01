import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	classifyRuntimeError,
	describeReason,
	MISCONFIG_SKIP_PREFIX,
} from "../config/misconfig";
import type { MisconfigLedger } from "../config/misconfig-ledger";
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
	/**
	 * The run's misconfiguration ledger, supplied by the pipeline (Task 10
	 * wires the real instance). When present, any testing agent whose id is
	 * already ledgered is dropped before dispatch (true absence — no
	 * workspace, no hooks, no row), and a tester whose first call fails with a
	 * misconfiguration-class error is recorded here. When absent, the loop
	 * behaves exactly as it did before misconfiguration handling: no filtering
	 * and no runtime recording.
	 */
	ledger?: MisconfigLedger;
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
		ledger,
	} = params;

	const filterSet =
		agentIdFilter !== undefined ? new Set(agentIdFilter) : undefined;
	const selected =
		filterSet === undefined
			? config.roles.test.agents
			: config.roles.test.agents.filter((a) => filterSet.has(a.id));

	if (filterSet !== undefined) {
		log.info(
			`agent filter active for ${scenario.name}: ${selected.map((a) => a.id).join(",") || "(none)"}`,
		);
	}

	// Drop any ledgered (already-misconfigured) tester before dispatch so it
	// gets no workspace, no before/afterTestAgent hooks, no testing, and no
	// row — true absence, not a skipped cell (KD4). A missing ledger means no
	// filtering, preserving the pre-misconfiguration behaviour.
	const agents =
		ledger === undefined
			? selected
			: selected.filter((a) => !ledger.has(a.id));

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
				ledger,
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
	/**
	 * The run's misconfiguration ledger, threaded from {@link runAgents}. When
	 * present, a tester whose first call fails with a misconfiguration-class
	 * error is recorded here and written as a misconfigured sentinel cell.
	 */
	ledger?: MisconfigLedger;
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
		ledger,
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
		// The live misconfigured roster (KD5/Task 3): RunContext.misconfigured
		// reaches every hook context — including this AgentContext — so a
		// before/afterTestAgent hook on a surviving tester can read it. `{}` when
		// no ledger is supplied (no misconfiguration handling).
		misconfigured: ledger?.snapshot() ?? {},
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

	// Classify a testing error up front so the dashboard reflects the right
	// outcome. A misconfiguration-class error (missing key, HTTP 401/403/404)
	// reports the testing phase as `skipped`, not `failed`: the cell is a
	// misconfigured sentinel, not a red failure (R8/AC4) — it lands in the
	// `skipped` counter and never adds a failure row. A transient error stays
	// `failed`. With no ledger every error is transient (today's behaviour).
	const runtimeMisconfig =
		ledger !== undefined && testingResult.error !== undefined
			? classifyRuntimeError(testingResult.error)
			: undefined;
	const testingStatus =
		testingResult.error === undefined
			? "passed"
			: runtimeMisconfig !== undefined
				? "skipped"
				: "failed";
	tracker.phaseFinished(scenario.name, agent.id, "testing", {
		status: testingStatus,
		durationMs: testingDuration,
		detail:
			runtimeMisconfig !== undefined
				? describeReason(runtimeMisconfig)
				: testingResult.error,
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

		// Split misconfiguration from ordinary (transient) failure. A
		// misconfiguration-class error (missing key, HTTP 401/403/404) means the
		// agent could never have produced a verdict, so we record it in the
		// ledger (role `test`; merged if already pre-flighted in another role)
		// and write a misconfigured *sentinel* cell that pass math later
		// excludes from the denominator (KD2/KD7). A transient error keeps the
		// unchanged `testing failed: ...` row and counts as an ordinary failure
		// (AC5). With no ledger, every error is treated as transient — today's
		// behaviour. `runtimeMisconfig` was classified above to drive the testing
		// phase status; reuse it here so the sentinel and the dashboard agree.
		if (runtimeMisconfig !== undefined) {
			ledger?.record(agent.id, ["test"], runtimeMisconfig);
			const described = describeReason(runtimeMisconfig);
			log.info(`agent ${agent.id} skipped: ${described}`);
			writeAgentReport(agentDirectory, testing, {
				skipped: `${MISCONFIG_SKIP_PREFIX}${described}`,
			});
		} else {
			writeAgentReport(agentDirectory, testing, {
				skipped: `testing failed: ${testingResult.error}`,
			});
		}
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
