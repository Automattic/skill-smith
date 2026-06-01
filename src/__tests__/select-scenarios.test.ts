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

test("with no misconfigured ids the default predicate keeps today's selection (AC14)", () => {
	// AC14: omitting the predicate must reproduce byte-for-byte the legacy
	// selection. Mirror the failed-pairs fixture above and assert identical
	// output whether or not a no-op predicate is passed explicitly.
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
	const legacy = selectScenarios(2, all, reports, "failed-pairs");
	const explicit = selectScenarios(2, all, reports, "failed-pairs", () => false);
	assert.deepEqual(explicit, legacy);
	assert.deepEqual(explicit.scenarios.map((s) => s.scenario.name).sort(), [
		"counter",
		"paginated",
	]);
	assert.deepEqual(explicit.agentFilter?.counter?.sort(), ["codex", "opus"]);
	assert.deepEqual(explicit.agentFilter?.paginated?.sort(), ["haiku"]);
});

test("misconfigured failing agent is dropped from the failed-pairs filter", () => {
	const reports: Record<string, ScenarioReport> = {
		counter: {
			scenario: "counter",
			pass: false,
			agents: mix(["haiku"], ["opus", "codex"]),
		},
	};
	// `codex` was the misconfigured agent that produced the non-PASS cell.
	const sel = selectScenarios(
		2,
		[scenario("counter")],
		reports,
		"failed-pairs",
		(id) => id === "codex",
	);
	assert.deepEqual(sel.scenarios.map((s) => s.scenario.name), ["counter"]);
	// Only the genuinely-failed `opus` is re-selected; `codex` is gone.
	assert.deepEqual(sel.agentFilter?.counter, ["opus"]);
});

test("scenario whose only failing agent is misconfigured drops out entirely", () => {
	const reports: Record<string, ScenarioReport> = {
		counter: {
			scenario: "counter",
			pass: false,
			agents: mix(["haiku"], ["codex"]),
		},
		toggle: { scenario: "toggle", pass: true, agents: pass(["haiku"]) },
	};
	const sel = selectScenarios(
		2,
		[scenario("counter"), scenario("toggle")],
		reports,
		"failed-pairs",
		(id) => id === "codex",
	);
	// counter's sole failure was the misconfigured `codex`, so it must not be
	// re-selected on its account; nothing else failed either.
	assert.deepEqual(sel.scenarios.map((s) => s.scenario.name), []);
	assert.deepEqual(sel.agentFilter, {});
});

test("misconfigured agent is also dropped under failed-scenarios mode", () => {
	const reports: Record<string, ScenarioReport> = {
		counter: {
			scenario: "counter",
			pass: false,
			agents: mix(["haiku"], ["codex"]),
		},
		toggle: {
			scenario: "toggle",
			pass: false,
			agents: mix(["haiku"], ["opus"]),
		},
	};
	const sel = selectScenarios(
		2,
		[scenario("counter"), scenario("toggle")],
		reports,
		"failed-scenarios",
		(id) => id === "codex",
	);
	// counter only failed because of the misconfigured `codex` → drops out.
	// toggle failed on the well-configured `opus` → stays.
	assert.deepEqual(sel.scenarios.map((s) => s.scenario.name), ["toggle"]);
});

test("a scenario-level error stays selected even if a misconfigured agent also failed", () => {
	const broken: EnumeratedScenario = {
		...scenario("broken"),
		error: "scenario.yaml malformed",
	};
	const reports: Record<string, ScenarioReport | { error: string }> = {
		broken: { error: "scenario.yaml malformed" },
	};
	const sel = selectScenarios(
		2,
		[broken],
		reports,
		"failed-pairs",
		(id) => id === "codex",
	);
	// Scenario-level errors are always re-included regardless of the ledger.
	assert.deepEqual(sel.scenarios.map((s) => s.scenario.name), ["broken"]);
});
