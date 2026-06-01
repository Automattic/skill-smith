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
import { aggregateScenarioReport } from "../reports/scenario-report";

/** Write `<scenarioDir>/<agent>/report.json` with the given review payload. */
function writeAgentReport(
	scenarioDir: string,
	agent: string,
	review: unknown,
): void {
	const agentDir = join(scenarioDir, agent);
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "report.json"),
		`${JSON.stringify({ review }, null, 2)}\n`,
	);
}

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

	const reportPath = join(scenarioDirectory, "report.json");
	assert.ok(existsSync(reportPath), "report.json should be written");

	const parsed = JSON.parse(readFileSync(reportPath, "utf8")) as Record<
		string,
		unknown
	>;
	assert.equal(parsed.scenario, "never-created");
	assert.equal(parsed.error, "scenario.yaml malformed");
	assert.deepEqual(parsed.agents, {});
	assert.equal(
		parsed.inconclusive,
		undefined,
		"a real scenarioError is not an inconclusive (all-misconfigured) set",
	);
});

test("a misconfigured-skip cell is excluded from pass math (one PASS survivor passes)", () => {
	const runDir = mkdtempSync(join(tmpdir(), "skillsmith-scenario-report-"));
	const scenarioDirectory = join(runDir, "scn");

	writeAgentReport(scenarioDirectory, "good", { pass: true });
	writeAgentReport(scenarioDirectory, "broke", {
		skipped: "misconfigured: ANTHROPIC_API_KEY is not set",
	});

	const report = aggregateScenarioReport({
		scenarioDirectory,
		scenarioName: "scn",
	});

	assert.equal(report.pass, true, "surviving PASS tester carries the scenario");
	assert.equal(
		report.inconclusive,
		undefined,
		"a present PASS survivor means the set is not all-misconfigured",
	);
	// The skip cell is still persisted as an agent row; it simply does not vote.
	assert.ok(report.agents.broke, "misconfigured cell stays in agents map");
});

test("a misconfigured-skip cell does not turn a surviving FAIL into a pass", () => {
	const runDir = mkdtempSync(join(tmpdir(), "skillsmith-scenario-report-"));
	const scenarioDirectory = join(runDir, "scn");

	writeAgentReport(scenarioDirectory, "good", { pass: true });
	writeAgentReport(scenarioDirectory, "bad", { pass: false });
	writeAgentReport(scenarioDirectory, "broke", {
		skipped: "misconfigured: unknown-provider \"claud-code\"",
	});

	const report = aggregateScenarioReport({
		scenarioDirectory,
		scenarioName: "scn",
	});

	assert.equal(report.pass, false, "a surviving FAIL still fails the scenario");
	assert.equal(report.inconclusive, undefined);
});

test("a scenario whose only present testers are misconfigured skips is inconclusive", () => {
	const runDir = mkdtempSync(join(tmpdir(), "skillsmith-scenario-report-"));
	const scenarioDirectory = join(runDir, "scn");

	writeAgentReport(scenarioDirectory, "alpha", {
		skipped: "misconfigured: ANTHROPIC_API_KEY is not set",
	});
	writeAgentReport(scenarioDirectory, "beta", {
		skipped: "misconfigured: invalid-credential (HTTP 401)",
	});

	const report = aggregateScenarioReport({
		scenarioDirectory,
		scenarioName: "scn",
	});

	assert.equal(report.pass, false, "all-misconfigured is not a silent pass");
	assert.deepEqual(report.inconclusive, {
		reason: "all-testers-misconfigured",
		agents: ["alpha", "beta"],
	});
});

test("an ordinary skip is not a misconfigured skip and still fails an otherwise-empty set", () => {
	const runDir = mkdtempSync(join(tmpdir(), "skillsmith-scenario-report-"));
	const scenarioDirectory = join(runDir, "scn");

	writeAgentReport(scenarioDirectory, "alpha", {
		skipped: "testing failed: timed out",
	});

	const report = aggregateScenarioReport({
		scenarioDirectory,
		scenarioName: "scn",
	});

	// An ordinary skip survives the exclusion and classifies non-PASS, so the
	// surviving set is non-empty and the scenario is a genuine FAIL, not inconclusive.
	assert.equal(report.pass, false);
	assert.equal(report.inconclusive, undefined);
});

test("a scenario with zero agent directories and no error is inconclusive", () => {
	const runDir = mkdtempSync(join(tmpdir(), "skillsmith-scenario-report-"));
	const scenarioDirectory = join(runDir, "scn");
	mkdirSync(scenarioDirectory, { recursive: true });

	const report = aggregateScenarioReport({
		scenarioDirectory,
		scenarioName: "scn",
	});

	assert.equal(report.pass, false, "empty set is not a silent pass");
	assert.deepEqual(report.inconclusive, {
		reason: "all-testers-misconfigured",
		agents: [],
	});
});

test("a clean scenario produces a byte-identical report.json (AC14)", () => {
	const runDir = mkdtempSync(join(tmpdir(), "skillsmith-scenario-report-"));
	const scenarioDirectory = join(runDir, "scn");

	writeAgentReport(scenarioDirectory, "good", { pass: true });
	writeAgentReport(scenarioDirectory, "alsogood", { pass: true });

	const report = aggregateScenarioReport({
		scenarioDirectory,
		scenarioName: "scn",
	});

	const onDisk = readFileSync(join(scenarioDirectory, "report.json"), "utf8");
	// A clean run is a no-op: the on-disk JSON is exactly the in-memory body
	// serialized the same way the function does, with no inconclusive key.
	assert.equal(report.pass, true);
	assert.equal(onDisk, `${JSON.stringify(report, null, 2)}\n`);
	assert.equal(
		Object.hasOwn(report, "inconclusive"),
		false,
		"clean report must not carry an inconclusive field",
	);
	assert.equal(
		onDisk.includes("inconclusive"),
		false,
		"clean report.json must not serialize an inconclusive field",
	);
});
