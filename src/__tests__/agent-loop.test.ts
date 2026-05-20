import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { run } from "../runner";

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
		"report.yaml",
	);
	assert.ok(existsSync(failReportPath));
	const failReport = parseYaml(readFileSync(failReportPath, "utf8")) as {
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

	// The other agent's full pipeline still runs as normal: its judge verdict
	// collapses to `{ pass: true }`, distinct from the skipped block above.
	const okReportPath = join(iterationDir, "hello-scenario", "ok", "report.yaml");
	const okReport = parseYaml(readFileSync(okReportPath, "utf8")) as {
		review?: { pass?: unknown; skipped?: unknown };
	};
	assert.ok(
		okReport.review !== undefined &&
			!("skipped" in okReport.review) &&
			okReport.review.pass === true,
		"the passing agent gets a real judge verdict, not a skipped block",
	);

	rmSync(baseDir, { recursive: true, force: true });
});
