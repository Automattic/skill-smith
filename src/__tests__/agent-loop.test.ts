import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MisconfigLedger } from "../config/misconfig-ledger";
import type {
	AgentContext,
	AgentDefinition,
	HookFn,
	Scenario,
	SkillsmithConfig,
} from "../config/types";
import { runAgents } from "../pipeline/agent-loop";
import { ProgressTracker } from "../progress";
import { classifyVerdict } from "../reports/verdict";
import { run } from "../runner";
import { RunLog } from "../util/run-log";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "fixtures", "judge-skip-project");

test("judge phase is skipped when the testing agent reports an error", async () => {
	const baseDir = join(projectRoot, ".skillsmith");
	rmSync(baseDir, { recursive: true, force: true });

	const originalLog = console.log;
	console.log = () => {};
	let exitCode: number;
	try {
		exitCode = await run({ cwd: projectRoot });
	} finally {
		console.log = originalLog;
	}

	assert.equal(exitCode, 1, "any agent failing testing fails the run");

	const runIds = readdirSync(baseDir).filter((n) => /^\d{8}-\d{6}$/.test(n));
	const iterationDir = join(baseDir, runIds[0] ?? "", "iteration-1");

	// The failing agent's review is recorded as SKIPPED with the testing
	// error inlined into the reason, so summaries can show why.
	const failReportPath = join(
		iterationDir,
		"hello-scenario",
		"mock-fail-testing",
		"report.json",
	);
	assert.ok(existsSync(failReportPath));
	const failReport = JSON.parse(readFileSync(failReportPath, "utf8")) as {
		review?: { skipped?: string };
	};
	assert.match(
		failReport.review?.skipped ?? "",
		/^testing failed: mock testing failure/,
	);

	// The skipped judge wasn't run, so no `mock-output.txt`-equivalent
	// judge artefact and the workspace is empty save for the harness's
	// own directory creation.
	const failWorkspace = join(
		iterationDir,
		"hello-scenario",
		"mock-fail-testing",
		"workspace",
	);
	assert.ok(existsSync(failWorkspace));

	// The other agent's full pipeline still runs as normal: its report
	// carries the judge's complete review (every rubric/acceptance item),
	// which classifies as a pass — distinct from the skipped block above.
	const okReportPath = join(
		iterationDir,
		"hello-scenario",
		"ok",
		"report.json",
	);
	const okReport = JSON.parse(readFileSync(okReportPath, "utf8")) as {
		review?: { skipped?: unknown };
	};
	assert.ok(
		okReport.review !== undefined && !("skipped" in okReport.review),
		"the passing agent gets a real judge verdict, not a skipped block",
	);
	assert.equal(
		classifyVerdict(okReport.review).kind,
		"PASS",
		"the passing agent's complete review classifies as a pass",
	);

	rmSync(baseDir, { recursive: true, force: true });
});

// --- Task 9: tester exclusion, runtime detection, sentinel write ---
//
// These exercise `runAgents` directly with a real ledger and the mock
// provider's sentinel ids, so each branch (ledgered → true absence,
// runtime misconfiguration → sentinel, transient → unchanged FAIL row)
// is covered without an end-to-end pipeline run.

/** A bare `AgentDefinition` over the mock provider. */
function mockAgent(id: string): AgentDefinition {
	return { id, provider: "mock", model: "mock-model" };
}

/** Track which agent-scoped hooks fire, keyed by `<hook>:<agentId>`. */
function hookRecorder(): {
	fired: string[];
	hook: (name: string) => HookFn<AgentContext>;
} {
	const fired: string[] = [];
	return {
		fired,
		hook:
			(name: string) =>
			(ctx: AgentContext): void => {
				fired.push(`${name}:${ctx.agent.id}`);
			},
	};
}

/**
 * Build a self-contained test harness around `runAgents`: a config whose
 * test role is `agentIds` (judge/improver fixed to a mock), a tracker that
 * knows every id, a silent log, and a scratch scenario directory. Returns
 * everything a case needs to drive a run and read the per-agent reports.
 */
function makeHarness(
	agentIds: string[],
	hooks?: SkillsmithConfig["hooks"],
): {
	scenario: Scenario;
	scenarioDirectory: string;
	config: SkillsmithConfig;
	tracker: ProgressTracker;
	log: RunLog;
	cleanup: () => void;
} {
	const root = mkdtempSync(join(tmpdir(), "agent-loop-t9-"));
	const scenarioDirectory = join(root, "scenario");
	const scenario: Scenario = {
		name: "t9-scenario",
		description: "Task 9 fixture scenario.",
		skills: [],
		prompt: "do the thing",
		acceptance: [],
		rubrics: [],
	};
	const agents = agentIds.map(mockAgent);
	const config: SkillsmithConfig = {
		mode: "test-only",
		agents: Object.fromEntries(agents.map((a) => [a.id, a])),
		roles: {
			test: { agents },
			judge: { agent: mockAgent("judge") },
			improver: { agent: mockAgent("improver") },
		},
		paths: {
			base: join(root, ".skillsmith"),
			skills: join(root, "skills"),
			scenarios: join(root, "scenarios"),
			rubrics: join(root, "rubrics"),
		},
		hooks,
	};
	const tracker = new ProgressTracker(
		{ runId: "t9", scenarios: [{ name: scenario.name, agentIds }] },
		{ interactive: false, tickMs: 0, stream: { write: () => true } as never },
	);
	return {
		scenario,
		scenarioDirectory,
		config,
		tracker,
		log: new RunLog(),
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

/** Read an agent's persisted `review` block, or `undefined` if no report. */
function readReview(
	scenarioDirectory: string,
	agentId: string,
): { skipped?: string } | undefined {
	const path = join(scenarioDirectory, agentId, "report.json");
	if (!existsSync(path)) return undefined;
	return (
		JSON.parse(readFileSync(path, "utf8")) as {
			review?: { skipped?: string };
		}
	).review;
}

test("a ledgered tester is dropped before dispatch — no workspace, no hooks, no row", async () => {
	const rec = hookRecorder();
	const h = makeHarness(["ok", "ledgered"], {
		beforeTestAgent: rec.hook("beforeTestAgent"),
		afterTestAgent: rec.hook("afterTestAgent"),
	});
	const ledger = new MisconfigLedger();
	ledger.record("ledgered", ["judge"], {
		kind: "unknown-provider",
		provider: "nope",
	});

	try {
		await runAgents({
			scenario: h.scenario,
			scenarioDirectory: h.scenarioDirectory,
			config: h.config,
			runId: "t9",
			runDirectory: h.config.paths.base,
			iterations: [],
			projectRoot: h.config.paths.base,
			log: h.log,
			tracker: h.tracker,
			scenarios: [],
			ledger,
		});

		// True absence: no workspace dir, no report, and neither agent-scoped
		// hook fired for the ledgered id (AC6, AC9).
		assert.equal(
			existsSync(join(h.scenarioDirectory, "ledgered")),
			false,
			"the ledgered agent gets no directory at all",
		);
		assert.equal(readReview(h.scenarioDirectory, "ledgered"), undefined);
		assert.ok(!rec.fired.includes("beforeTestAgent:ledgered"));
		assert.ok(!rec.fired.includes("afterTestAgent:ledgered"));

		// The surviving agent runs fully and its hooks fire.
		assert.ok(rec.fired.includes("beforeTestAgent:ok"));
		assert.ok(rec.fired.includes("afterTestAgent:ok"));
		const okReview = readReview(h.scenarioDirectory, "ok");
		assert.ok(okReview !== undefined && !("skipped" in okReview));
	} finally {
		h.cleanup();
	}
});

test("a runtime misconfiguration is recorded and written as a misconfigured sentinel", async () => {
	const h = makeHarness(["mock-misconfig-testing"]);
	const ledger = new MisconfigLedger();

	try {
		await runAgents({
			scenario: h.scenario,
			scenarioDirectory: h.scenarioDirectory,
			config: h.config,
			runId: "t9",
			runDirectory: h.config.paths.base,
			iterations: [],
			projectRoot: h.config.paths.base,
			log: h.log,
			tracker: h.tracker,
			scenarios: [],
			ledger,
		});

		// Ledgered under role `test` with the classified reason (AC7).
		assert.equal(ledger.has("mock-misconfig-testing"), true);
		const entry = ledger.all().get("mock-misconfig-testing");
		assert.deepEqual(entry?.roles, ["test"]);
		assert.deepEqual(entry?.reason, {
			kind: "invalid-credential",
			status: 401,
		});

		// The cell is the misconfigured sentinel, not a `testing failed:` row.
		const review = readReview(h.scenarioDirectory, "mock-misconfig-testing");
		assert.equal(
			review?.skipped,
			"misconfigured: invalid-credential (HTTP 401)",
		);
	} finally {
		h.cleanup();
	}
});

test("an id already ledgered (in any role) is dropped, so its runtime record never fires", async () => {
	const h = makeHarness(["mock-misconfig-testing"]);
	const ledger = new MisconfigLedger();
	// Already pre-flighted in another role with a pre-flight reason. The filter
	// drops it before dispatch, so the testing-failure branch's
	// `record(id, ["test"], ...)` never runs; the entry keeps exactly its
	// pre-flight shape (role union therefore lives at the ledger/pipeline
	// level, AC10 — not here). No row is written for the absent id.
	ledger.record("mock-misconfig-testing", ["improver"], {
		kind: "unknown-provider",
		provider: "x",
	});

	try {
		await runAgents({
			scenario: h.scenario,
			scenarioDirectory: h.scenarioDirectory,
			config: h.config,
			runId: "t9",
			runDirectory: h.config.paths.base,
			iterations: [],
			projectRoot: h.config.paths.base,
			log: h.log,
			tracker: h.tracker,
			scenarios: [],
			ledger,
		});

		const entry = ledger.all().get("mock-misconfig-testing");
		assert.deepEqual(entry?.roles, ["improver"]);
		assert.deepEqual(entry?.reason, { kind: "unknown-provider", provider: "x" });
		assert.equal(
			readReview(h.scenarioDirectory, "mock-misconfig-testing"),
			undefined,
		);
	} finally {
		h.cleanup();
	}
});

test("a transient testing error keeps the unchanged FAIL row and no ledger entry", async () => {
	const h = makeHarness(["mock-fail-testing"]);
	const ledger = new MisconfigLedger();

	try {
		await runAgents({
			scenario: h.scenario,
			scenarioDirectory: h.scenarioDirectory,
			config: h.config,
			runId: "t9",
			runDirectory: h.config.paths.base,
			iterations: [],
			projectRoot: h.config.paths.base,
			log: h.log,
			tracker: h.tracker,
			scenarios: [],
			ledger,
		});

		// Transient: no ledger entry, and the row is today's `testing failed:`
		// shape — not a misconfigured sentinel (AC5).
		assert.equal(ledger.has("mock-fail-testing"), false);
		const review = readReview(h.scenarioDirectory, "mock-fail-testing");
		assert.equal(review?.skipped, "testing failed: mock testing failure");
	} finally {
		h.cleanup();
	}
});
