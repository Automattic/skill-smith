import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classifyVerdict } from "../reports/verdict";
import { run } from "../runner";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "fixtures", "smoke-project");

test("smoke run with mock provider produces full reports for every (scenario, agent)", async () => {
	const baseDir = join(projectRoot, ".skillsmith");
	rmSync(baseDir, { recursive: true, force: true });

	const originalLog = console.log;
	const captured: string[] = [];
	console.log = (...args: unknown[]) => {
		captured.push(args.join(" "));
	};
	let exitCode: number;
	try {
		exitCode = await run({ cwd: projectRoot });
	} finally {
		console.log = originalLog;
	}

	assert.equal(exitCode, 0, "all-pass mock run should exit 0");

	const runIds = readdirSync(baseDir).filter((n) => /^\d{8}-\d{6}$/.test(n));
	assert.equal(runIds.length, 1, `exactly one runId; got ${runIds.join(", ")}`);
	const runDir = join(baseDir, runIds[0] ?? "");
	const iterationDir = join(runDir, "iteration-1");

	assert.ok(existsSync(join(runDir, "run.json")), "top-level run.json exists");
	assert.ok(
		existsSync(join(runDir, "report.json")),
		"top-level merged run report exists",
	);
	assert.ok(
		existsSync(join(iterationDir, "report.json")),
		"iteration report exists",
	);
	assert.ok(existsSync(join(iterationDir, "run.log")), "run log exists");
	assert.ok(
		existsSync(join(iterationDir, "hello-scenario", "report.json")),
		"scenario report exists",
	);
	for (const id of ["haiku", "sonnet"]) {
		const reportPath = join(iterationDir, "hello-scenario", id, "report.json");
		assert.ok(existsSync(reportPath), `report.json exists for ${id}`);
		const agentReport = JSON.parse(readFileSync(reportPath, "utf8")) as Record<
			string,
			unknown
		>;
		const review = agentReport.review as Record<string, unknown> | undefined;
		assert.equal(
			classifyVerdict(review).kind,
			"PASS",
			`agent report for ${id} should classify as a pass: ${JSON.stringify(agentReport)}`,
		);
		assert.ok(
			review !== undefined && "rubrics" in review,
			`agent report for ${id} keeps the judge's complete review (rubrics): ${JSON.stringify(agentReport)}`,
		);
		const testing = agentReport.testing as
			| { duration?: unknown; tokenUsage?: Record<string, unknown> }
			| undefined;
		assert.ok(
			testing !== undefined && typeof testing.duration === "number",
			`agent report for ${id} has testing.duration: ${JSON.stringify(agentReport)}`,
		);
		assert.equal(
			testing?.tokenUsage?.totalTokens,
			150,
			`agent report for ${id} has testing.tokenUsage.totalTokens`,
		);
		const ws = join(iterationDir, "hello-scenario", id, "workspace");
		assert.ok(existsSync(ws), `workspace mkdir'd for ${id}`);
	}

	// Metrics propagate up through the scenario and iteration reports.
	const scenarioReport = JSON.parse(
		readFileSync(join(iterationDir, "hello-scenario", "report.json"), "utf8"),
	) as { agents?: Record<string, { testing?: { duration?: unknown } }> };
	assert.equal(
		typeof scenarioReport.agents?.haiku?.testing?.duration,
		"number",
		"scenario report embeds the agent testing block",
	);
	const iterationReport = JSON.parse(
		readFileSync(join(iterationDir, "report.json"), "utf8"),
	) as {
		iteration?: number;
		scenarios?: Record<
			string,
			{ agents?: Record<string, { testing?: { duration?: unknown } }> }
		>;
	};
	assert.equal(iterationReport.iteration, 1, "iteration report carries number");
	assert.equal(
		typeof iterationReport.scenarios?.["hello-scenario"]?.agents?.haiku?.testing
			?.duration,
		"number",
		"iteration report embeds the agent testing block",
	);

	const runSummary = JSON.parse(
		readFileSync(join(runDir, "run.json"), "utf8"),
	) as {
		pass?: boolean;
		iterations?: Array<{ number?: number; directory?: string; pass?: boolean }>;
	};
	assert.equal(runSummary.pass, true, "run.json records the run pass verdict");
	assert.equal(
		runSummary.iterations?.length,
		1,
		"run.json lists one iteration",
	);
	assert.equal(runSummary.iterations?.[0]?.number, 1, "iteration number 1");
	assert.equal(runSummary.iterations?.[0]?.pass, true, "iteration passed");

	const out = captured.join("\n");
	assert.match(out, /scenario\s+agent\s+result\s+duration\s+tokens/);
	assert.match(out, /hello-scenario\s+haiku\s+PASS\s+0\.0s\s+150/);
	assert.match(out, /\bsonnet\s+PASS\s+0\.0s\s+150/);
	assert.match(out, /RUN RESULT: PASS/);

	rmSync(baseDir, { recursive: true, force: true });
});
