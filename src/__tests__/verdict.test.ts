import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyVerdict } from "../reports/verdict";

test("all-pass rubrics + acceptance → PASS", () => {
	const cell = classifyVerdict({
		rubrics: { r1: { pass: true }, r2: { pass: true } },
		acceptance: [{ item: "x", pass: true }],
	});
	assert.equal(cell.kind, "PASS");
});

test("failing rubric + acceptance lists every failure", () => {
	const cell = classifyVerdict({
		rubrics: { r1: { pass: false }, r2: { pass: true }, r3: { pass: false } },
		acceptance: [
			{ item: "uses fetch", pass: false },
			{ item: "no console.log", pass: true },
		],
	});
	assert.equal(cell.kind, "FAIL");
	if (cell.kind !== "FAIL") return;
	assert.deepEqual(cell.failures, [
		"rubric r1",
		"rubric r3",
		"acceptance uses fetch",
	]);
});

test("skipped string → SKIPPED with reason", () => {
	const cell = classifyVerdict({ skipped: "no agents" });
	assert.equal(cell.kind, "SKIPPED");
	if (cell.kind !== "SKIPPED") return;
	assert.equal(cell.reason, "no agents");
});

test("error string → FAIL with that error as the only failure", () => {
	const cell = classifyVerdict({ error: "unparseable" });
	assert.equal(cell.kind, "FAIL");
	if (cell.kind !== "FAIL") return;
	assert.deepEqual(cell.failures, ["unparseable"]);
});

test("missing rubrics and acceptance → FAIL", () => {
	const cell = classifyVerdict({});
	assert.equal(cell.kind, "FAIL");
});

test("non-object verdict → FAIL", () => {
	assert.equal(classifyVerdict(null).kind, "FAIL");
	assert.equal(classifyVerdict("nope").kind, "FAIL");
});
