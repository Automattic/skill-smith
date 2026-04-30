import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { run } from "../../runner";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "fixtures", "smoke-project");

test("V5: dry-run smoke run produces full reports for every (scenario, agent)", async () => {
	const baseDir = join(projectRoot, ".skillsmith");
	rmSync(baseDir, { recursive: true, force: true });

	const originalDryRun = process.env.SKILLSMITH_DRY_RUN;
	const originalLog = console.log;
	const captured: string[] = [];
	console.log = (...args: unknown[]) => {
		captured.push(args.join(" "));
	};
	process.env.SKILLSMITH_DRY_RUN = "1";
	let exitCode: number;
	try {
		exitCode = await run({ cwd: projectRoot });
	} finally {
		console.log = originalLog;
		if (originalDryRun === undefined) delete process.env.SKILLSMITH_DRY_RUN;
		else process.env.SKILLSMITH_DRY_RUN = originalDryRun;
	}

	assert.equal(exitCode, 0, "all-pass dry run should exit 0");

	const runIds = readdirSync(baseDir).filter((n) => /^\d{8}-\d{6}$/.test(n));
	assert.equal(runIds.length, 1, `exactly one runId; got ${runIds.join(", ")}`);
	const runDir = join(baseDir, runIds[0] ?? "");

	assert.ok(existsSync(join(runDir, "report.yaml")), "run report exists");
	assert.ok(existsSync(join(runDir, "run.log")), "run log exists");
	assert.ok(
		existsSync(join(runDir, "hello-scenario", "report.yaml")),
		"scenario report exists",
	);
	for (const alias of ["haiku", "sonnet"]) {
		const reviewPath = join(
			runDir,
			"hello-scenario",
			alias,
			"judge-review.yaml",
		);
		assert.ok(existsSync(reviewPath), `judge-review.yaml exists for ${alias}`);
		const review = parseYaml(readFileSync(reviewPath, "utf8")) as Record<
			string,
			unknown
		>;
		assert.ok(
			"rubrics" in review,
			`judge-review for ${alias} has rubrics: ${JSON.stringify(review)}`,
		);
		const ws = join(runDir, "hello-scenario", alias, "workspace");
		assert.ok(existsSync(ws), `workspace mkdir'd for ${alias}`);
	}

	const out = captured.join("\n");
	assert.match(out, /scenario\s*\|\s*haiku\s*\|\s*sonnet/);
	assert.match(out, /hello-scenario\s*\|\s*PASS\s*\|\s*PASS/);
	assert.match(out, /RUN RESULT: PASS/);

	rmSync(baseDir, { recursive: true, force: true });
});
