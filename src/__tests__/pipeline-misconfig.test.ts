import assert from "node:assert/strict";
import {
	existsSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PreconditionError } from "../config/resolve-cwd";
import { runPipeline } from "../pipeline/pipeline";
import { run } from "../runner";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");

/** Run a fixture under a captured console, returning its exit code. */
async function silentRun(projectRoot: string): Promise<number> {
	const originalLog = console.log;
	const originalErr = console.error;
	console.log = () => {};
	console.error = () => {};
	try {
		return await run({ cwd: projectRoot });
	} finally {
		console.log = originalLog;
		console.error = originalErr;
	}
}

/**
 * Run a fixture with `console` and `process.stderr.write` captured, returning
 * the exit code and every chunk the live dashboard painted to stderr. The
 * tracker writes to `process.stderr` in non-verbose runs, so this is how a test
 * observes the rendered grid/counters/failure list.
 */
async function runCapturingDashboard(
	projectRoot: string,
): Promise<{ exitCode: number; dashboard: string }> {
	const originalLog = console.log;
	const originalErr = console.error;
	const originalWrite = process.stderr.write.bind(process.stderr);
	const chunks: string[] = [];
	console.log = () => {};
	console.error = () => {};
	process.stderr.write = ((chunk: unknown): boolean => {
		chunks.push(String(chunk));
		return true;
	}) as typeof process.stderr.write;
	try {
		const exitCode = await run({ cwd: projectRoot });
		return { exitCode, dashboard: chunks.join("") };
	} finally {
		console.log = originalLog;
		console.error = originalErr;
		process.stderr.write = originalWrite;
	}
}

/** The single timestamped run directory under a fixture's `.skillsmith`. */
function soleRunDir(baseDir: string): string {
	const runIds = readdirSync(baseDir).filter((n) => /^\d{8}-\d{6}$/.test(n));
	assert.equal(runIds.length, 1, `exactly one runId; got ${runIds.join(", ")}`);
	return join(baseDir, runIds[0] ?? "");
}

// --- AC12: judge fail-fast ---------------------------------------------------

test("a misconfigured judge fails fast with a PreconditionError, no dispatch (AC12)", async () => {
	const projectRoot = join(fixtures, "judge-misconfig-project");
	const baseDir = join(projectRoot, ".skillsmith");
	rmSync(baseDir, { recursive: true, force: true });

	await assert.rejects(
		() => runPipeline({ projectRoot, runId: "20240101-000000" }),
		(err: unknown) => {
			assert.ok(
				err instanceof PreconditionError,
				`expected PreconditionError, got ${String(err)}`,
			);
			// The message names the judge id and its human-readable reason.
			assert.match(err.message, /Judge agent "bad-judge" is misconfigured/);
			assert.match(err.message, /unknown-provider/);
			return true;
		},
	);

	// Fail-fast happens before `mkdirSync(runDirectory)`, so no run directory and
	// hence no iteration directory or partial matrix were produced.
	assert.equal(
		existsSync(baseDir),
		false,
		"no run directory: the judge check precedes any directory creation",
	);

	rmSync(baseDir, { recursive: true, force: true });
});

test("run() surfaces the misconfigured-judge precondition as exit code 1", async () => {
	const projectRoot = join(fixtures, "judge-misconfig-project");
	const baseDir = join(projectRoot, ".skillsmith");
	rmSync(baseDir, { recursive: true, force: true });

	const exitCode = await silentRun(projectRoot);
	assert.equal(exitCode, 1, "a precondition failure exits 1");

	rmSync(baseDir, { recursive: true, force: true });
});

// --- AC13: improver degrade --------------------------------------------------

test("a misconfigured improver degrades the run to a single test/judge sweep (AC13)", async () => {
	const projectRoot = join(fixtures, "improver-misconfig-project");
	const baseDir = join(projectRoot, ".skillsmith");
	const skillPath = join(projectRoot, "skills", "wp-foo", "SKILL.md");
	rmSync(baseDir, { recursive: true, force: true });
	const pristineSkill = readFileSync(skillPath, "utf8");

	let exitCode: number;
	let skillAfterRun: string;
	try {
		exitCode = await silentRun(projectRoot);
		skillAfterRun = readFileSync(skillPath, "utf8");
	} finally {
		// The improver never runs, so the skill should be untouched; restore it
		// regardless to keep the working tree clean.
		writeFileSync(skillPath, pristineSkill);
	}

	// The sweep still runs and grades (valid matrix), but the marker-free skill
	// fails grading and the improver is skipped — so the run does not converge.
	assert.equal(exitCode, 1, "the failing sweep exits 1; the improver is skipped");

	// AC13: the improver never ran, so the success marker was never applied.
	assert.equal(
		skillAfterRun.includes("SKILLSMITH_LOOP_OK"),
		false,
		"a misconfigured improver applies no edit",
	);

	const runDir = soleRunDir(baseDir);

	// Degraded to exactly one iteration — no redundant identical sweeps even
	// though selfImprovement.maxIterations is 3.
	const iterationDirs = readdirSync(runDir).filter((n) =>
		/^iteration-\d+$/.test(n),
	);
	assert.deepEqual(
		iterationDirs.sort(),
		["iteration-1"],
		"the degraded run produces exactly one iteration",
	);

	// The matrix is valid: the healthy tester produced a graded (failing) row.
	const report = JSON.parse(
		readFileSync(join(runDir, "report.json"), "utf8"),
	) as {
		pass?: boolean;
		scenarios?: Record<string, { agents?: Record<string, unknown> }>;
	};
	assert.equal(report.pass, false);
	assert.ok(
		report.scenarios?.["wp-marker"]?.agents?.tester !== undefined,
		"the healthy tester has a row in the matrix",
	);

	// The improver appears in the persisted roster (R8 channel) as misconfigured.
	const roster = (
		JSON.parse(readFileSync(join(runDir, "report.json"), "utf8")) as {
			misconfigured?: Record<string, { reason: string; roles: string[] }>;
		}
	).misconfigured;
	assert.ok(roster?.["bad-improver"] !== undefined, "improver in the roster");
	assert.deepEqual(roster?.["bad-improver"]?.roles, ["improver"]);

	rmSync(baseDir, { recursive: true, force: true });
});

// --- AC8 / AC10: live RunContext view + multi-role union ---------------------

test("RunContext.misconfigured is a live view: pre-flight at beforeAll, runtime by afterAll (AC8, AC10)", async () => {
	const projectRoot = join(fixtures, "misconfig-hook-project");
	const baseDir = join(projectRoot, ".skillsmith");
	rmSync(baseDir, { recursive: true, force: true });

	await silentRun(projectRoot);

	const runDir = soleRunDir(baseDir);
	const before = JSON.parse(
		readFileSync(join(runDir, "misconfigured-beforeAll.json"), "utf8"),
	) as Record<string, { reason: string; roles: string[] }>;
	const after = JSON.parse(
		readFileSync(join(runDir, "misconfigured-afterAll.json"), "utf8"),
	) as Record<string, { reason: string; roles: string[] }>;

	// AC10: `bad-multi` fills both the test and improver roles and is recorded
	// once at pre-flight with both roles unioned into a single entry.
	assert.deepEqual(before["bad-multi"]?.roles.slice().sort(), [
		"improver",
		"test",
	]);
	assert.match(before["bad-multi"]?.reason ?? "", /unknown-provider/);

	// AC8: the runtime-only find is absent at beforeAll (pre-flight boundary)…
	assert.equal(
		before["mock-misconfig-testing"],
		undefined,
		"a runtime find is not present at the pre-flight boundary",
	);
	// …but present by afterAll, alongside the pre-flight entry.
	assert.deepEqual(after["mock-misconfig-testing"]?.roles, ["test"]);
	assert.equal(
		after["mock-misconfig-testing"]?.reason,
		"invalid-credential (HTTP 401)",
	);
	assert.ok(after["bad-multi"] !== undefined, "pre-flight entry persists");

	// The persisted roster (report.json) carries the full accumulated set too.
	const roster = (
		JSON.parse(readFileSync(join(runDir, "report.json"), "utf8")) as {
			misconfigured?: Record<string, unknown>;
		}
	).misconfigured;
	assert.ok(roster?.["bad-multi"] !== undefined);
	assert.ok(roster?.["mock-misconfig-testing"] !== undefined);

	rmSync(baseDir, { recursive: true, force: true });
});

// --- T11 AC11b / AC3 / AC4: end-to-end rendered summary + exit code ----------

test("a whole-run all-misconfigured set renders INCONCLUSIVE with a one-time announcement and exit 1 (AC11b, AC3, AC4)", async () => {
	// `misconfig-hook-project` has two testers, both misconfigured: `bad-multi`
	// (pre-flight unknown-provider, dropped before dispatch) and
	// `mock-misconfig-testing` (runtime HTTP 401 sentinel). With no surviving
	// tester the scenario is inconclusive, so the run renders INCONCLUSIVE and
	// exits 1 — never a silent pass over the empty set.
	const projectRoot = join(fixtures, "misconfig-hook-project");
	const baseDir = join(projectRoot, ".skillsmith");
	rmSync(baseDir, { recursive: true, force: true });

	const exitCode = await silentRun(projectRoot);
	assert.equal(exitCode, 1, "an all-misconfigured run exits 1 (inconclusive)");

	const runDir = soleRunDir(baseDir);
	const summary = readFileSync(join(runDir, "summary.txt"), "utf8");

	// Distinct INCONCLUSIVE banner, not PASS and not a red FAIL.
	assert.match(summary, /RUN RESULT: INCONCLUSIVE/);
	assert.doesNotMatch(summary, /RUN RESULT: PASS/);
	assert.doesNotMatch(summary, /RUN RESULT: FAIL/);

	// The one-time SKIPPED-AGENTS announcement names both misconfigured ids with
	// their reasons, each exactly once (AC3), not once per scenario/iteration.
	assert.match(summary, /SKIPPED AGENTS \(misconfigured\):/);
	assert.match(summary, /mock-misconfig-testing.*invalid-credential \(HTTP 401\)/);
	assert.match(summary, /bad-multi.*unknown-provider/);
	const sentinelReasonLines = summary
		.split("\n")
		.filter((l) => l.includes("invalid-credential (HTTP 401)"));
	assert.equal(
		sentinelReasonLines.length,
		1,
		`the sentinel reason appears once per run:\n${summary}`,
	);

	// summary.txt is plain text (no ANSI escapes).
	assert.equal(summary.includes(String.fromCharCode(27)), false);

	rmSync(baseDir, { recursive: true, force: true });
});

// --- T12 AC6 / AC4: live dashboard true-absence + runtime skip ---------------

test("the live dashboard omits a pre-flight skip and counts a runtime skip as skip, not fail (AC6, AC4)", async () => {
	// `misconfig-hook-project` has two testers: `bad-multi` (pre-flight
	// unknown-provider) and `mock-misconfig-testing` (runtime HTTP 401). The
	// scenario `hello` is the only one, so the grid should hold exactly one
	// surviving tester's two phases — `bad-multi` occupies no slot at all.
	const projectRoot = join(fixtures, "misconfig-hook-project");
	const baseDir = join(projectRoot, ".skillsmith");
	rmSync(baseDir, { recursive: true, force: true });

	const { dashboard } = await runCapturingDashboard(projectRoot);

	// AC6 (true absence): the pre-flight-skipped tester is not a grid row, so the
	// scenario's only phases are the surviving tester's testing+judge — a total
	// of 2 phase slots, not 4. Were `bad-multi` still gridded, the total would be
	// 4 with two extra pending/skip slots.
	assert.match(
		dashboard,
		/phases\s+\S+\s+2\/2/,
		`grid totals the surviving tester's two phases only:\n${dashboard}`,
	);

	// AC4: the surviving tester is the runtime HTTP 401 sentinel, so both its
	// phases are skips — the run shows skips and zero failures, and renders no
	// red failure list.
	assert.match(dashboard, /phases.*fail 0.*skip 2/, dashboard);
	assert.doesNotMatch(
		dashboard,
		/failures \(/,
		`no red failure row for a misconfigured cell:\n${dashboard}`,
	);

	rmSync(baseDir, { recursive: true, force: true });
});

// --- AC14: clean run unchanged ----------------------------------------------

test("a clean run carries an empty roster and behaves as before (AC14)", async () => {
	const projectRoot = join(fixtures, "smoke-project");
	const baseDir = join(projectRoot, ".skillsmith");
	rmSync(baseDir, { recursive: true, force: true });

	const exitCode = await silentRun(projectRoot);
	assert.equal(exitCode, 0, "the clean mock run still passes");

	const runDir = soleRunDir(baseDir);
	const report = JSON.parse(
		readFileSync(join(runDir, "report.json"), "utf8"),
	) as { misconfigured?: Record<string, unknown> };
	assert.deepEqual(
		report.misconfigured,
		{},
		"a clean run persists an empty misconfigured roster",
	);

	rmSync(baseDir, { recursive: true, force: true });
});
