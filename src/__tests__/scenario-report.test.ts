import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";
import { aggregateScenarioReport } from "../reports/scenario-report";

test("aggregateScenarioReport creates the directory when missing (skipped scenario)", () => {
	const runDir = mkdtempSync(join(tmpdir(), "skillsmith-scenario-report-"));
	const scenarioDirectory = join(runDir, "never-created");

	assert.equal(
		existsSync(scenarioDirectory),
		false,
		"sanity: directory should not exist before",
	);

	aggregateScenarioReport({
		scenarioDirectory,
		scenarioName: "never-created",
		scenarioError: "scenario.yaml malformed",
	});

	const reportPath = join(scenarioDirectory, "report.yaml");
	assert.ok(existsSync(reportPath), "report.yaml should be written");

	const parsed = parseYaml(readFileSync(reportPath, "utf8")) as Record<
		string,
		unknown
	>;
	assert.equal(parsed.scenario, "never-created");
	assert.equal(parsed.error, "scenario.yaml malformed");
	assert.deepEqual(parsed.agents, {});
});
