import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MISCONFIGURED_REASON_PREFIX } from "../policy/runnability";
import { classifyVerdict } from "../reports/verdict";
import { run } from "../runner";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");

const KEY = "OPENAI_API_KEY";
// The reason an openai-api agent is misconfigured, built from the shared
// prefix so the literal lives in exactly one place.
const MISSING_KEY_REASON = new RegExp(
	`^${MISCONFIGURED_REASON_PREFIX}${KEY} is not set`,
);

/** runId directories the harness writes are `YYYYMMDD-HHMMSS`. */
function runIdsUnder(baseDir: string): string[] {
	if (!existsSync(baseDir)) return [];
	return readdirSync(baseDir).filter((n) => /^\d{8}-\d{6}$/.test(n));
}

/**
 * Run a fixture project with `OPENAI_API_KEY` scrubbed so every
 * openai-api agent is genuinely misconfigured regardless of the
 * surrounding environment. Captures stdout (each console.log call's
 * joined arguments) and restores both the env var and console.log.
 */
async function runScrubbed(
	fixture: string,
): Promise<{ exitCode: number; stdout: string[]; baseDir: string }> {
	const projectRoot = join(fixtures, fixture);
	const baseDir = join(projectRoot, ".skillsmith");
	rmSync(baseDir, { recursive: true, force: true });

	const priorApiKey = process.env[KEY];
	delete process.env[KEY];

	const stdout: string[] = [];
	const originalLog = console.log;
	console.log = (...args: unknown[]) => {
		stdout.push(args.join(" "));
	};

	let exitCode: number;
	try {
		exitCode = await run({ cwd: projectRoot });
	} finally {
		console.log = originalLog;
		if (priorApiKey === undefined) {
			delete process.env[KEY];
		} else {
			process.env[KEY] = priorApiKey;
		}
	}

	return { exitCode, stdout, baseDir };
}

test("a misconfigured test agent is excluded while its runnable peer is graded", async () => {
	const { exitCode, baseDir } = await runScrubbed("misconfigured-test-agent");

	assert.equal(exitCode, 1, "an excluded test agent fails the run");

	const runId = runIdsUnder(baseDir)[0] ?? "";
	const scenarioDir = join(baseDir, runId, "iteration-1", "hello-scenario");

	// The excluded agent's report carries the misconfigured marker as a
	// skipped review, and the harness never created its workspace because
	// it was never invoked.
	const excludedDir = join(scenarioDir, "needs-openai-key");
	const excludedReport = JSON.parse(
		readFileSync(join(excludedDir, "report.json"), "utf8"),
	) as { review?: { skipped?: string } };
	assert.match(excludedReport.review?.skipped ?? "", MISSING_KEY_REASON);
	assert.ok(
		!existsSync(join(excludedDir, "workspace")),
		"the excluded agent has no workspace — it was never invoked",
	);

	// The runnable peer ran the full pipeline and its complete review
	// classifies as a pass.
	const runnableReport = JSON.parse(
		readFileSync(join(scenarioDir, "runnable", "report.json"), "utf8"),
	) as { review?: unknown };
	assert.equal(
		classifyVerdict(runnableReport.review).kind,
		"PASS",
		"the runnable agent's review classifies as a pass",
	);

	rmSync(baseDir, { recursive: true, force: true });
});

test("a run whose every test agent is misconfigured fails without a vacuous pass", async () => {
	const { exitCode, baseDir } = await runScrubbed(
		"misconfigured-all-test-agents",
	);

	assert.equal(exitCode, 1, "all test agents excluded must not pass vacuously");

	const runId = runIdsUnder(baseDir)[0] ?? "";
	const scenarioDir = join(baseDir, runId, "iteration-1", "hello-scenario");

	// Every test agent's report is the misconfigured marker.
	for (const agentId of ["needs-openai-key-a", "needs-openai-key-b"]) {
		const report = JSON.parse(
			readFileSync(join(scenarioDir, agentId, "report.json"), "utf8"),
		) as { review?: { skipped?: string } };
		assert.match(
			report.review?.skipped ?? "",
			MISSING_KEY_REASON,
			`${agentId} is marked misconfigured`,
		);
	}

	rmSync(baseDir, { recursive: true, force: true });
});

test("a misconfigured judge aborts the run before any matrix is graded", async () => {
	const { exitCode, baseDir } = await runScrubbed("misconfigured-judge");

	assert.equal(exitCode, 1, "a judge that cannot grade fails the run");

	// No graded matrix was produced: the run report.json was never
	// written, which distinguishes the judge stop from a matrix of FAILs.
	const runId = runIdsUnder(baseDir)[0] ?? "";
	assert.equal(
		existsSync(join(baseDir, runId, "report.json")),
		false,
		"no run report.json — the run aborted before grading",
	);

	rmSync(baseDir, { recursive: true, force: true });
});

test("a misconfigured improver degrades to a single test-only sweep that still passes", async () => {
	const { exitCode, stdout, baseDir } = await runScrubbed(
		"misconfigured-improver",
	);

	// (1) The degrade is surfaced — the only signal that differs between
	// the degraded and non-degraded worlds for an all-pass matrix.
	const needle = new RegExp(`${MISCONFIGURED_REASON_PREFIX}${KEY} is not set`);
	assert.ok(
		stdout.some((line) => needle.test(line)),
		"the degrade reason naming OPENAI_API_KEY is surfaced on stdout",
	);

	const runId = runIdsUnder(baseDir)[0] ?? "";
	const runDir = join(baseDir, runId);
	const iter1 = join(runDir, "iteration-1");

	// (2) No improvement step ran — `improvement.md` is the artifact the
	// improver writes when it runs.
	assert.ok(
		!existsSync(join(iter1, "improvement.md")),
		"no improvement.md — the improver never ran",
	);

	// (3) maxIterations collapsed to one despite the fixture's value of 3:
	// a single iteration-1 dir, no iteration-2, and one entry in run.json.
	assert.ok(existsSync(iter1), "iteration-1 exists");
	assert.ok(
		!existsSync(join(runDir, "iteration-2")),
		"no iteration-2 — the loop collapsed to a single sweep",
	);
	const runSummary = JSON.parse(
		readFileSync(join(runDir, "run.json"), "utf8"),
	) as { iterations?: unknown[] };
	assert.equal(
		runSummary.iterations?.length,
		1,
		"run.json records exactly one iteration",
	);

	// (4) The clean test/judge matrix governs the exit; the degrade does
	// not force a non-zero code.
	assert.equal(exitCode, 0, "an all-pass matrix exits 0 even when degraded");

	rmSync(baseDir, { recursive: true, force: true });
});
