import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { emitSummary, prepareSummary } from "../reports/summary";

function withReport(
	scenarios: Record<string, unknown>,
	misconfigured?: Record<string, unknown>,
): {
	runDirectory: string;
} {
	const runDirectory = mkdtempSync(join(tmpdir(), "skillsmith-summary-"));
	mkdirSync(runDirectory, { recursive: true });
	const body: Record<string, unknown> = {
		runId: "20260101-000000",
		scenarios,
	};
	if (misconfigured !== undefined) body.misconfigured = misconfigured;
	writeFileSync(
		join(runDirectory, "report.json"),
		JSON.stringify(body, null, 2),
	);
	return { runDirectory };
}

const MISCONFIG_SKIP = "misconfigured: invalid-credential (HTTP 401)";

function captureStdout<T>(fn: () => T): { value: T; out: string } {
	const lines: string[] = [];
	const original = console.log;
	console.log = (...args: unknown[]) => {
		lines.push(args.join(" "));
	};
	try {
		const value = fn();
		return { value, out: lines.join("\n") };
	} finally {
		console.log = original;
	}
}

test("all-pass run exits 0 with RUN RESULT: PASS", async () => {
	const { runDirectory } = withReport({
		"counter-block": {
			scenario: "counter-block",
			agents: {
				haiku: {
					testing: {
						duration: 1200,
						tokenUsage: {
							inputTokens: 100,
							outputTokens: 50,
							totalTokens: 150,
						},
					},
					review: {
						rubrics: { r1: { pass: true } },
						acceptance: [{ item: "x", pass: true }],
					},
				},
				opus: {
					testing: { duration: 900 },
					review: {
						rubrics: { r1: { pass: true } },
						acceptance: [{ item: "x", pass: true }],
					},
				},
			},
		},
	});

	const { value, out } = captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory, runId: "x" })),
	);

	assert.equal(value, 0);
	assert.match(out, /scenario\s+agent\s+result\s+duration\s+tokens/);
	assert.match(out, /counter-block\s+haiku\s+PASS\s+1\.2s\s+150/);
	assert.match(out, /\bopus\s+PASS\s+0\.9s/);
	assert.match(out, /RUN RESULT: PASS/);
});

test("any failure → exit 1, FAIL, and a line per failing rubric/acceptance", async () => {
	const { runDirectory } = withReport({
		"counter-block": {
			scenario: "counter-block",
			agents: {
				haiku: {
					testing: { duration: 1200 },
					review: {
						rubrics: { r1: { pass: true } },
						acceptance: [{ item: "x", pass: true }],
					},
				},
				opus: {
					testing: { duration: 1100 },
					review: {
						rubrics: {
							r1: { pass: false, notes: "bad" },
							r2: { pass: false, notes: "also bad" },
						},
						acceptance: [{ item: "uses fetch", pass: false }],
					},
				},
			},
		},
	});

	const { value, out } = captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory, runId: "x" })),
	);

	assert.equal(value, 1);
	assert.match(out, /counter-block\s+haiku\s+PASS\s+1\.2s/);
	assert.match(out, /\bopus\s+FAIL\s+1\.1s/);
	assert.match(out, /RUN RESULT: FAIL/);
	assert.match(out, /opus: rubric r1/);
	assert.match(out, /opus: rubric r2/);
	assert.match(out, /opus: acceptance uses fetch/);
	assert.doesNotMatch(out, /not pass/);
});

test("multiple failing scenarios each get their own block", async () => {
	const { runDirectory } = withReport({
		"config-fetch": {
			scenario: "config-fetch",
			agents: {
				"codex-gpt55": {
					testing: { duration: 1000 },
					review: {
						rubrics: { r1: { pass: false } },
						acceptance: [{ item: "ok", pass: true }],
					},
				},
				"codex-mini": {
					testing: { duration: 1000 },
					review: {
						rubrics: { r2: { pass: false } },
						acceptance: [{ item: "ok", pass: true }],
					},
				},
			},
		},
		other: {
			scenario: "other",
			agents: {
				"codex-gpt55": {
					testing: { duration: 1000 },
					review: {
						rubrics: { r3: { pass: false } },
						acceptance: [{ item: "ok", pass: true }],
					},
				},
				"codex-mini": {
					testing: { duration: 1000 },
					review: {
						rubrics: { r3: { pass: true } },
						acceptance: [{ item: "ok", pass: true }],
					},
				},
			},
		},
	});

	const { out } = captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory, runId: "x" })),
	);

	assert.ok(
		out.includes(
			"config-fetch\n  codex-gpt55: rubric r1\n  codex-mini: rubric r2",
		),
		`failure block for config-fetch missing in:\n${out}`,
	);
	assert.ok(
		out.includes("other\n  codex-gpt55: rubric r3"),
		`failure block for other missing in:\n${out}`,
	);
});

test("SKIPPED cells render with reason", async () => {
	const { runDirectory } = withReport({
		"counter-block": {
			scenario: "counter-block",
			agents: {
				haiku: {
					testing: { duration: 800 },
					review: { skipped: "empty agent config" },
				},
			},
		},
	});

	const { value, out } = captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory, runId: "x" })),
	);

	assert.equal(value, 1);
	assert.match(out, /counter-block\s+haiku\s+SKIPPED\s+0\.8s/);
	assert.match(out, /haiku: SKIPPED empty agent config/);
});

test("long format unifies the scenario cell across agent rows", async () => {
	const { runDirectory } = withReport({
		"counter-block": {
			scenario: "counter-block",
			agents: {
				haiku: {
					testing: {
						duration: 1200,
						tokenUsage: {
							inputTokens: 100,
							outputTokens: 50,
							totalTokens: 1500,
						},
					},
					review: {
						rubrics: { r1: { pass: true } },
						acceptance: [{ item: "x", pass: true }],
					},
				},
				opus: {
					testing: {
						duration: 65000,
						tokenUsage: {
							inputTokens: 800,
							outputTokens: 400,
							totalTokens: 1200,
						},
					},
					review: {
						rubrics: { r1: { pass: true } },
						acceptance: [{ item: "x", pass: true }],
					},
				},
			},
		},
	});

	const { out } = captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory, runId: "x" })),
	);

	// The scenario name leads exactly one table row; the second agent
	// row leaves the scenario column blank.
	const scenarioRows = out
		.split("\n")
		.filter((l) => l.startsWith("counter-block"));
	assert.equal(scenarioRows.length, 1);
	assert.match(out, /\n\s+opus\s+PASS/);

	// Thousands-separated tokens and m/ss duration formatting.
	assert.match(out, /haiku\s+PASS\s+1\.2s\s+1,500/);
	assert.match(out, /opus\s+PASS\s+1m05s\s+1,200/);
});

test("writes summary.txt mirroring the console (without ANSI)", async () => {
	const { runDirectory } = withReport({
		"counter-block": {
			scenario: "counter-block",
			agents: {
				haiku: {
					testing: { duration: 800 },
					review: {
						rubrics: { r1: { pass: false } },
						acceptance: [{ item: "x", pass: true }],
					},
				},
			},
		},
	});

	captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory, runId: "x" })),
	);

	const summaryPath = join(runDirectory, "summary.txt");
	assert.ok(existsSync(summaryPath), "summary.txt should be written");
	const body = readFileSync(summaryPath, "utf8");
	assert.match(body, /counter-block\s+haiku\s+FAIL/);
	assert.match(body, /RUN RESULT: FAIL/);
	assert.match(body, /haiku: rubric r1/);
	assert.equal(
		body.includes(String.fromCharCode(27)),
		false,
		"summary.txt must not contain ANSI escapes",
	);
});

// --- Task 11: misconfigured-skip exclusion, inconclusive verdict, one-time
// announcement. The run-level report.json carries a top-level `misconfigured`
// roster (id -> { reason, roles }) and each scenario may carry an
// `inconclusive` marker. ---

test("AC1/AC4: surviving-PASS + one misconfigured tester is PASS, exit 0", async () => {
	const { runDirectory } = withReport(
		{
			"counter-block": {
				scenario: "counter-block",
				pass: true,
				agents: {
					"good-key": {
						testing: { duration: 1200 },
						review: {
							rubrics: { r1: { pass: true } },
							acceptance: [{ item: "x", pass: true }],
						},
					},
					"bad-key": {
						testing: { duration: 50 },
						review: { skipped: MISCONFIG_SKIP },
					},
				},
			},
		},
		{ "bad-key": { reason: "invalid-credential (HTTP 401)", roles: ["test"] } },
	);

	const { value, out } = captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory, runId: "x" })),
	);

	assert.equal(value, 0);
	assert.match(out, /RUN RESULT: PASS/);
	// The misconfigured cell neither flips the verdict nor appears in a red
	// FAIL block; it appears only in the one-time announcement.
	assert.doesNotMatch(out, /RUN RESULT: FAIL/);
	assert.match(out, /SKIPPED AGENTS \(misconfigured\):/);
	assert.match(out, /bad-key\s+test\s+invalid-credential \(HTTP 401\)/);
});

test("AC4: genuine failure + misconfigured tester → FAIL with failure in red block, misconfig only in announcement", async () => {
	const { runDirectory } = withReport(
		{
			"counter-block": {
				scenario: "counter-block",
				pass: false,
				agents: {
					opus: {
						testing: { duration: 1100 },
						review: {
							rubrics: { r1: { pass: false, notes: "bad" } },
							acceptance: [{ item: "x", pass: true }],
						},
					},
					"bad-key": {
						testing: { duration: 40 },
						review: { skipped: MISCONFIG_SKIP },
					},
				},
			},
		},
		{ "bad-key": { reason: "invalid-credential (HTTP 401)", roles: ["test"] } },
	);

	const { value, out } = captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory, runId: "x" })),
	);

	assert.equal(value, 1);
	assert.match(out, /RUN RESULT: FAIL/);
	// The genuine failure is in the red block under its scenario header.
	assert.match(out, /counter-block\n {2}opus: rubric r1/);
	// The misconfigured agent is NOT a per-scenario failure line.
	assert.doesNotMatch(out, /bad-key: SKIPPED/);
	assert.doesNotMatch(out, /bad-key: rubric/);
	// It appears exactly once in the announcement (its reason line is emitted
	// once for the whole run, not once per scenario/iteration).
	assert.match(out, /SKIPPED AGENTS \(misconfigured\):/);
	const reasonLines = out
		.split("\n")
		.filter((l) => l.includes("invalid-credential (HTTP 401)"));
	assert.equal(reasonLines.length, 1, `reason should appear once:\n${out}`);
});

test("AC11a: an all-misconfigured scenario among healthy siblings renders inconclusive; run PASS iff siblings pass", async () => {
	const { runDirectory } = withReport(
		{
			healthy: {
				scenario: "healthy",
				pass: true,
				agents: {
					"good-key": {
						testing: { duration: 1000 },
						review: {
							rubrics: { r1: { pass: true } },
							acceptance: [{ item: "x", pass: true }],
						},
					},
				},
			},
			"all-bad": {
				scenario: "all-bad",
				pass: false,
				inconclusive: {
					reason: "all-testers-misconfigured",
					agents: ["bad-key"],
				},
				agents: {
					"bad-key": {
						testing: { duration: 30 },
						review: { skipped: MISCONFIG_SKIP },
					},
				},
			},
		},
		{ "bad-key": { reason: "invalid-credential (HTTP 401)", roles: ["test"] } },
	);

	const { value, out } = captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory, runId: "x" })),
	);

	// Healthy sibling passes; the inconclusive scenario does not flip to FAIL
	// and does not block the PASS over the surviving siblings... except an
	// inconclusive scenario is non-PASS, so the run is INCONCLUSIVE overall.
	assert.equal(value, 1);
	assert.match(out, /RUN RESULT: INCONCLUSIVE/);
	assert.doesNotMatch(out, /RUN RESULT: FAIL/);
	assert.match(out, /INCONCLUSIVE SCENARIOS \(all testers misconfigured\):/);
	assert.match(out, /all-bad — bad-key/);
});

test("AC11b: whole-run all-misconfigured set → RUN RESULT: INCONCLUSIVE, exit 1, never a silent pass", async () => {
	const { runDirectory } = withReport(
		{
			"scn-a": {
				scenario: "scn-a",
				pass: false,
				inconclusive: {
					reason: "all-testers-misconfigured",
					agents: ["bad-key"],
				},
				agents: {
					"bad-key": {
						testing: { duration: 30 },
						review: { skipped: MISCONFIG_SKIP },
					},
				},
			},
			"scn-b": {
				scenario: "scn-b",
				pass: false,
				inconclusive: {
					reason: "all-testers-misconfigured",
					agents: ["bad-key"],
				},
				agents: {
					"bad-key": {
						testing: { duration: 25 },
						review: { skipped: MISCONFIG_SKIP },
					},
				},
			},
		},
		{ "bad-key": { reason: "invalid-credential (HTTP 401)", roles: ["test"] } },
	);

	const { value, out } = captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory, runId: "x" })),
	);

	assert.equal(value, 1);
	assert.match(out, /RUN RESULT: INCONCLUSIVE \(2 scenarios: all testers/);
	assert.doesNotMatch(out, /RUN RESULT: PASS/);
	assert.doesNotMatch(out, /RUN RESULT: FAIL/);
});

test("AC3: each misconfigured agent appears once per run, not once per (scenario, iteration)", async () => {
	const { runDirectory } = withReport(
		{
			"scn-a": {
				scenario: "scn-a",
				pass: true,
				agents: {
					"good-key": {
						testing: { duration: 100 },
						review: {
							rubrics: { r1: { pass: true } },
							acceptance: [{ item: "x", pass: true }],
						},
					},
					"bad-key": {
						testing: { duration: 30 },
						review: { skipped: MISCONFIG_SKIP },
					},
				},
			},
			"scn-b": {
				scenario: "scn-b",
				pass: true,
				agents: {
					"good-key": {
						testing: { duration: 100 },
						review: {
							rubrics: { r1: { pass: true } },
							acceptance: [{ item: "x", pass: true }],
						},
					},
					"bad-key": {
						testing: { duration: 30 },
						review: { skipped: MISCONFIG_SKIP },
					},
				},
			},
		},
		{ "bad-key": { reason: "invalid-credential (HTTP 401)", roles: ["test"] } },
	);

	const { out } = captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory, runId: "x" })),
	);

	// One announcement heading, and bad-key named once in the announcement.
	const headings = out.split("SKIPPED AGENTS (misconfigured):").length - 1;
	assert.equal(headings, 1);
	// bad-key appears in two table rows (transparency) plus once in the
	// announcement = 3; crucially the reason line is emitted exactly once.
	const reasonLines = out
		.split("\n")
		.filter((l) => l.includes("invalid-credential (HTTP 401)"));
	assert.equal(reasonLines.length, 1, `reason should appear once:\n${out}`);
});

test("AC3: announcement lists each agent's id, roles, and reason; multiple roles joined", async () => {
	const { runDirectory } = withReport(
		{
			"scn-a": {
				scenario: "scn-a",
				pass: false,
				inconclusive: {
					reason: "all-testers-misconfigured",
					agents: ["typo-prov"],
				},
				agents: {
					"typo-prov": {
						testing: { duration: 10 },
						review: { skipped: 'misconfigured: unknown-provider "claud-code"' },
					},
				},
			},
		},
		{
			"typo-prov": {
				reason: 'unknown-provider "claud-code"',
				roles: ["test", "improver"],
			},
		},
	);

	const { out } = captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory, runId: "x" })),
	);

	assert.match(
		out,
		/typo-prov\s+test, improver\s+unknown-provider "claud-code"/,
	);
});

test("AC14: a clean run carries an empty roster and no announcement/inconclusive sections", async () => {
	const { runDirectory } = withReport(
		{
			"counter-block": {
				scenario: "counter-block",
				pass: true,
				agents: {
					haiku: {
						testing: { duration: 1200 },
						review: {
							rubrics: { r1: { pass: true } },
							acceptance: [{ item: "x", pass: true }],
						},
					},
				},
			},
		},
		{},
	);

	const { value, out } = captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory, runId: "x" })),
	);

	assert.equal(value, 0);
	assert.match(out, /RUN RESULT: PASS/);
	assert.doesNotMatch(out, /SKIPPED AGENTS/);
	assert.doesNotMatch(out, /INCONCLUSIVE/);
});

test("AC14: clean-run output is byte-for-byte identical with and without an empty roster field", async () => {
	const scenarios = {
		"counter-block": {
			scenario: "counter-block",
			pass: true,
			agents: {
				haiku: {
					testing: {
						duration: 1200,
						tokenUsage: { totalTokens: 150 },
					},
					review: {
						rubrics: { r1: { pass: true } },
						acceptance: [{ item: "x", pass: true }],
					},
				},
				opus: {
					testing: { duration: 900 },
					review: {
						rubrics: { r1: { pass: true } },
						acceptance: [{ item: "x", pass: true }],
					},
				},
			},
		},
	};
	// Old-style report (no `misconfigured` field) and new-style clean report
	// (`misconfigured: {}`) must render identical summary.txt bytes.
	const legacy = withReport(scenarios);
	const clean = withReport(scenarios, {});

	captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory: legacy.runDirectory, runId: "x" })),
	);
	captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory: clean.runDirectory, runId: "x" })),
	);

	const legacyBody = readFileSync(join(legacy.runDirectory, "summary.txt"), "utf8");
	const cleanBody = readFileSync(join(clean.runDirectory, "summary.txt"), "utf8");
	assert.equal(cleanBody, legacyBody);
	assert.match(cleanBody, /RUN RESULT: PASS/);
});

test("ordinary (non-misconfig) SKIPPED still fails the row and appears in the red block", async () => {
	// Guards against over-broad exclusion: a plain skip is NOT a misconfig skip.
	const { runDirectory } = withReport(
		{
			"counter-block": {
				scenario: "counter-block",
				pass: false,
				agents: {
					haiku: {
						testing: { duration: 800 },
						review: { skipped: "testing failed: boom" },
					},
				},
			},
		},
		{},
	);

	const { value, out } = captureStdout(() =>
		emitSummary(prepareSummary({ runDirectory, runId: "x" })),
	);

	assert.equal(value, 1);
	assert.match(out, /RUN RESULT: FAIL/);
	assert.match(out, /haiku: SKIPPED testing failed: boom/);
	assert.doesNotMatch(out, /INCONCLUSIVE/);
	assert.doesNotMatch(out, /SKIPPED AGENTS/);
});
