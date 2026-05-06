import assert from "node:assert/strict";
import { test } from "node:test";
import { renderTree } from "../progress/render";
import type { AgentNode, RunTree, ScenarioNode } from "../progress/types";

function agent(id: string, phases: AgentNode["phases"]): AgentNode {
	return { id, phases };
}

function pendingAgent(id: string): AgentNode {
	return agent(id, [
		{ name: "testing", status: "pending" },
		{ name: "judge", status: "pending" },
	]);
}

function scenario(
	name: string,
	status: ScenarioNode["status"],
	agents: AgentNode[],
	error?: string,
): ScenarioNode {
	return error === undefined
		? { name, status, agents }
		: { name, status, agents, error };
}

function tree(scenarios: ScenarioNode[]): RunTree {
	return { runId: "r1", startedAt: 0, scenarios };
}

test("renders all-pending tree", () => {
	const t = tree([
		scenario("s1", "pending", [pendingAgent("sonnet"), pendingAgent("opus")]),
		scenario("s2", "pending", [pendingAgent("sonnet"), pendingAgent("opus")]),
	]);

	const expected = [
		"skillsmith run r1",
		"└─ scenarios (2)",
		"   ├─ ◯ s1",
		"   │  ├─ ◯ sonnet  testing ◯  judge ◯",
		"   │  └─ ◯ opus    testing ◯  judge ◯",
		"   └─ ◯ s2",
		"      ├─ ◯ sonnet  testing ◯  judge ◯",
		"      └─ ◯ opus    testing ◯  judge ◯",
	].join("\n");

	assert.equal(renderTree(t), expected);
});

test("renders mixed-running tree with durations", () => {
	const t = tree([
		scenario("s1", "running", [
			agent("sonnet", [
				{ name: "testing", status: "passed", durationMs: 12300 },
				{ name: "judge", status: "running" },
			]),
			agent("opus", [
				{ name: "testing", status: "running" },
				{ name: "judge", status: "pending" },
			]),
		]),
	]);

	const expected = [
		"skillsmith run r1",
		"└─ scenarios (1)",
		"   └─ ◐ s1",
		"      ├─ ◐ sonnet  testing ✓ 12.3s  judge ◐",
		"      └─ ◐ opus    testing ◐  judge ◯",
	].join("\n");

	assert.equal(renderTree(t), expected);
});

test("renders all-passed tree with sub-second formatting", () => {
	const t = tree([
		scenario("s1", "passed", [
			agent("sonnet", [
				{ name: "testing", status: "passed", durationMs: 12300 },
				{ name: "judge", status: "passed", durationMs: 800 },
			]),
		]),
	]);

	const expected = [
		"skillsmith run r1",
		"└─ scenarios (1)",
		"   └─ ✓ s1",
		"      └─ ✓ sonnet  testing ✓ 12.3s  judge ✓ 800ms",
	].join("\n");

	assert.equal(renderTree(t), expected);
});

test("renders one-failed-with-detail (truncates long detail)", () => {
	const t = tree([
		scenario("s1", "failed", [
			agent("sonnet", [
				{ name: "testing", status: "passed", durationMs: 12300 },
				{
					name: "judge",
					status: "failed",
					detail: "rubric preserves-dates not pass",
				},
			]),
		]),
	]);

	const expected = [
		"skillsmith run r1",
		"└─ scenarios (1)",
		"   └─ ✗ s1",
		"      └─ ✗ sonnet  testing ✓ 12.3s  judge ✗ (rubric preserves-dates not pass)",
	].join("\n");

	assert.equal(renderTree(t), expected);
});

test("renders skipped scenario with reason and no agent rows", () => {
	const t = tree([
		scenario(
			"s1",
			"skipped",
			[pendingAgent("sonnet"), pendingAgent("opus")],
			"rubric file missing",
		),
	]);

	const expected = [
		"skillsmith run r1",
		"└─ scenarios (1)",
		"   └─ ⊘ s1  ·  rubric file missing",
	].join("\n");

	assert.equal(renderTree(t), expected);
});

test("derives agent status from phases (failed wins, skipped requires both)", () => {
	const t = tree([
		scenario("s1", "failed", [
			// failed wins over skipped
			agent("a-failed", [
				{ name: "testing", status: "failed" },
				{ name: "judge", status: "skipped" },
			]),
			// fully skipped
			agent("a-skipped", [
				{ name: "testing", status: "skipped" },
				{ name: "judge", status: "skipped" },
			]),
			// passed + pending → running (transient between phases)
			agent("a-mixed", [
				{ name: "testing", status: "passed" },
				{ name: "judge", status: "pending" },
			]),
		]),
	]);

	const expected = [
		"skillsmith run r1",
		"└─ scenarios (1)",
		"   └─ ✗ s1",
		"      ├─ ✗ a-failed   testing ✗  judge ⊘",
		"      ├─ ⊘ a-skipped  testing ⊘  judge ⊘",
		"      └─ ◐ a-mixed    testing ✓  judge ◯",
	].join("\n");

	assert.equal(renderTree(t), expected);
});

test("color: true wraps status glyphs in ANSI escape codes", () => {
	const t = tree([
		scenario("s1", "passed", [
			agent("sonnet", [
				{ name: "testing", status: "passed", durationMs: 12300 },
				{ name: "judge", status: "passed", durationMs: 3800 },
			]),
		]),
	]);

	const colored = renderTree(t, { color: true });
	const plain = renderTree(t);

	const ESC = String.fromCharCode(27);
	assert.ok(
		colored.includes(`${ESC}[32m✓${ESC}[0m`),
		"expected green-wrapped check glyph",
	);
	assert.ok(!plain.includes(ESC), "expected no escape codes when color off");

	const ansiPattern = new RegExp(`${ESC}\\[\\d+m`, "g");
	assert.equal(colored.replace(ansiPattern, ""), plain);
});
