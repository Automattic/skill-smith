import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MisconfigLedger } from "../config/misconfig-ledger";
import type {
	AgentDefinition,
	IterationCompleteHookContext,
	SkillsmithConfig,
} from "../config/types";
import { type RunImprovementParams, runImprovement } from "../improvement/improver";
import type { IterationReport } from "../reports/iteration-report";
import { RunLog } from "../util/run-log";

// Task 10 fix (KD5/Task 3): the RunContext the improver builds for its
// `beforeImprove`/`afterImprove` hooks must carry the run's misconfigured
// roster, threaded in from the pipeline's ledger snapshot. These exercise
// `runImprovement` directly with the mock provider so the hook context is
// captured without an end-to-end pipeline run.

function mockAgent(id: string): AgentDefinition {
	return { id, provider: "mock", model: "mock-model" };
}

/**
 * Build the minimal `runImprovement` params over the mock provider, with a
 * `beforeImprove` hook that records the misconfigured view it sees. Returns
 * the params, the captured-view holder, and a cleanup for the scratch dir.
 */
function makeParams(misconfigured?: RunImprovementParams["misconfigured"]): {
	params: RunImprovementParams;
	seen: { misconfigured?: IterationCompleteHookContext["misconfigured"] };
	cleanup: () => void;
} {
	const root = mkdtempSync(join(tmpdir(), "improver-misconfig-"));
	const seen: {
		misconfigured?: IterationCompleteHookContext["misconfigured"];
	} = {};
	const config: SkillsmithConfig = {
		mode: "self-improvement",
		agents: {},
		roles: {
			test: { agents: [mockAgent("ok")] },
			judge: { agent: mockAgent("judge") },
			improver: { agent: mockAgent("improver") },
		},
		paths: {
			base: join(root, ".skillsmith"),
			skills: join(root, "skills"),
			scenarios: join(root, "scenarios"),
			rubrics: join(root, "rubrics"),
		},
		hooks: {
			beforeImprove: (ctx) => {
				seen.misconfigured = ctx.misconfigured;
			},
		},
	};
	const iterationReport: IterationReport = {
		runId: "imp",
		iteration: 1,
		pass: false,
		scenarios: {},
	};
	const params: RunImprovementParams = {
		projectRoot: root,
		runId: "imp",
		runDirectory: join(root, ".skillsmith"),
		iterations: [],
		scenarios: [],
		config,
		agent: mockAgent("improver"),
		iteration: 1,
		iterationDirectory: root,
		iterationReport,
		allScenarios: [],
		log: new RunLog(),
		misconfigured,
	};
	return { params, seen, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("the improver's RunContext.misconfigured reflects the threaded roster (KD5/Task 3)", async () => {
	const ledger = new MisconfigLedger();
	ledger.record("bad-judge", ["judge"], {
		kind: "unknown-provider",
		provider: "nope",
	});
	const { params, seen, cleanup } = makeParams(ledger.snapshot());

	try {
		await runImprovement(params);
		assert.deepEqual(seen.misconfigured, {
			"bad-judge": {
				reason: 'unknown-provider "nope"',
				roles: ["judge"],
			},
		});
	} finally {
		cleanup();
	}
});

test("the improver's RunContext.misconfigured is `{}` when no roster is threaded (AC14)", async () => {
	const { params, seen, cleanup } = makeParams();

	try {
		await runImprovement(params);
		assert.deepEqual(seen.misconfigured, {});
	} finally {
		cleanup();
	}
});
