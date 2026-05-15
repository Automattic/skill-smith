import assert from "node:assert/strict";
import { test } from "node:test";
import { selectScenarios } from "../pipeline/select-scenarios";
import type { ScenarioReport } from "../reports/scenario-report";
import type { EnumeratedScenario } from "../scenarios/enumerate";

function scenario(name: string): EnumeratedScenario {
	return {
		dirName: name,
		scenario: {
			name,
			description: "",
			skills: [],
			prompt: "",
			acceptance: [],
			rubrics: [],
		},
	};
}

function pass(agentIds: string[]): ScenarioReport["agents"] {
	const out: ScenarioReport["agents"] = {};
	for (const id of agentIds) out[id] = { review: { pass: true } };
	return out;
}

function mix(passes: string[], fails: string[]): ScenarioReport["agents"] {
	const out: ScenarioReport["agents"] = {};
	for (const id of passes) out[id] = { review: { pass: true } };
	for (const id of fails)
		out[id] = {
			review: { pass: false, failures: [{ kind: "rubric", id: "r" }] },
		};
	return out;
}

const all = [scenario("counter"), scenario("toggle"), scenario("paginated")];

test("iteration 1 always runs everything", () => {
	const sel = selectScenarios(1, all, {}, "failed-pairs");
	assert.deepEqual(
		sel.scenarios.map((s) => s.scenario.name),
		["counter", "toggle", "paginated"],
	);
	assert.equal(sel.agentFilter, undefined);
});

test("mode=all keeps the full matrix even after iteration 1", () => {
	const reports: Record<string, ScenarioReport> = {
		counter: { scenario: "counter", pass: false, agents: mix([], ["haiku"]) },
		toggle: { scenario: "toggle", pass: true, agents: pass(["haiku"]) },
	};
	const sel = selectScenarios(2, all, reports, "all");
	assert.deepEqual(
		sel.scenarios.map((s) => s.scenario.name),
		["counter", "toggle", "paginated"],
	);
});

test("failed-scenarios keeps every agent of failing scenarios only", () => {
	const reports: Record<string, ScenarioReport> = {
		counter: {
			scenario: "counter",
			pass: false,
			agents: mix(["haiku"], ["opus"]),
		},
		toggle: { scenario: "toggle", pass: true, agents: pass(["haiku", "opus"]) },
		paginated: {
			scenario: "paginated",
			pass: false,
			agents: mix(["opus"], ["haiku"]),
		},
	};
	const sel = selectScenarios(2, all, reports, "failed-scenarios");
	assert.deepEqual(sel.scenarios.map((s) => s.scenario.name).sort(), [
		"counter",
		"paginated",
	]);
	assert.equal(sel.agentFilter, undefined);
});

test("failed-pairs narrows to the exact failing agents per scenario", () => {
	const reports: Record<string, ScenarioReport> = {
		counter: {
			scenario: "counter",
			pass: false,
			agents: mix(["haiku"], ["opus", "codex"]),
		},
		toggle: { scenario: "toggle", pass: true, agents: pass(["haiku", "opus"]) },
		paginated: {
			scenario: "paginated",
			pass: false,
			agents: mix(["opus"], ["haiku"]),
		},
	};
	const sel = selectScenarios(2, all, reports, "failed-pairs");
	assert.deepEqual(sel.scenarios.map((s) => s.scenario.name).sort(), [
		"counter",
		"paginated",
	]);
	assert.ok(sel.agentFilter !== undefined);
	assert.deepEqual(sel.agentFilter?.counter?.sort(), ["codex", "opus"]);
	assert.deepEqual(sel.agentFilter?.paginated?.sort(), ["haiku"]);
});

test("scenarios with enumeration errors are always re-included", () => {
	const broken: EnumeratedScenario = {
		...scenario("broken"),
		error: "scenario.yaml malformed",
	};
	const reports: Record<string, ScenarioReport | { error: string }> = {
		counter: { scenario: "counter", pass: true, agents: pass(["haiku"]) },
		broken: { error: "scenario.yaml malformed" },
	};
	const sel = selectScenarios(
		2,
		[scenario("counter"), broken],
		reports,
		"failed-scenarios",
	);
	assert.deepEqual(sel.scenarios.map((s) => s.scenario.name).sort(), [
		"broken",
	]);
});

test("missing review counts as a failure (e.g. agent crashed mid-run)", () => {
	const reports: Record<string, ScenarioReport> = {
		counter: {
			scenario: "counter",
			pass: false,
			agents: { haiku: { error: "missing agent report" } },
		},
	};
	const sel = selectScenarios(
		2,
		[scenario("counter")],
		reports,
		"failed-pairs",
	);
	assert.deepEqual(sel.agentFilter?.counter, ["haiku"]);
});
