import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
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

	assert.ok(existsSync(join(runDir, "report.yaml")), "run report exists");
	assert.ok(existsSync(join(runDir, "run.log")), "run log exists");
	assert.ok(
		existsSync(join(runDir, "hello-scenario", "report.yaml")),
		"scenario report exists",
	);
	for (const id of ["haiku", "sonnet"]) {
		const reportPath = join(runDir, "hello-scenario", id, "report.yaml");
		assert.ok(existsSync(reportPath), `report.yaml exists for ${id}`);
		const agentReport = parseYaml(readFileSync(reportPath, "utf8")) as Record<
			string,
			unknown
		>;
		const review = agentReport.review as Record<string, unknown> | undefined;
		assert.ok(
			review !== undefined && "rubrics" in review,
			`agent report for ${id} has review.rubrics: ${JSON.stringify(agentReport)}`,
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
		const ws = join(runDir, "hello-scenario", id, "workspace");
		assert.ok(existsSync(ws), `workspace mkdir'd for ${id}`);
	}

	// Metrics propagate up through the scenario and run reports.
	const scenarioReport = parseYaml(
		readFileSync(join(runDir, "hello-scenario", "report.yaml"), "utf8"),
	) as { agents?: Record<string, { testing?: { duration?: unknown } }> };
	assert.equal(
		typeof scenarioReport.agents?.haiku?.testing?.duration,
		"number",
		"scenario report embeds the agent testing block",
	);
	const runReport = parseYaml(
		readFileSync(join(runDir, "report.yaml"), "utf8"),
	) as {
		scenarios?: Record<
			string,
			{ agents?: Record<string, { testing?: { duration?: unknown } }> }
		>;
	};
	assert.equal(
		typeof runReport.scenarios?.["hello-scenario"]?.agents?.haiku?.testing
			?.duration,
		"number",
		"run report embeds the agent testing block",
	);

	const out = captured.join("\n");
	assert.match(out, /scenario\s+agent\s+result\s+duration\s+tokens/);
	assert.match(out, /hello-scenario\s+haiku\s+PASS\s+0\.0s\s+150/);
	assert.match(out, /\bsonnet\s+PASS\s+0\.0s\s+150/);
	assert.match(out, /RUN RESULT: PASS/);

	rmSync(baseDir, { recursive: true, force: true });
});
