import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyValidatorVerdict } from "../improvement/validator-verdict";

// Each test feeds a raw STRING — classifyValidatorVerdict owns both the
// parse (parseAgentJson) and the shape-check, so AC2's string-level rows
// (non-JSON, fenced JSON) live in this one table. See design-doc §7.3.

// Row 3: well-formed approve → approve, no fail-open.
test("row 3: well-formed approve string → approve, not failed open", () => {
	const outcome = classifyValidatorVerdict('{"verdict": "approve"}');
	assert.equal(outcome.verdict, "approve");
	assert.deepEqual(outcome.findings, []);
	assert.equal(outcome.failedOpen, false);
});

test("row 3: approve with explicit empty findings → approve, not failed open", () => {
	const outcome = classifyValidatorVerdict(
		'{"verdict": "approve", "findings": []}',
	);
	assert.equal(outcome.verdict, "approve");
	assert.deepEqual(outcome.findings, []);
	assert.equal(outcome.failedOpen, false);
});

test("row 3: approve carrying stray findings → normalized to empty findings", () => {
	const outcome = classifyValidatorVerdict(
		'{"verdict": "approve", "findings": [{"leak_type": "single-case", "span": "x", "why": "y", "suggested_fix": "z"}]}',
	);
	assert.equal(outcome.verdict, "approve");
	assert.deepEqual(outcome.findings, []);
	assert.equal(outcome.failedOpen, false);
});

// Row 4: well-formed revise with non-empty findings → revise, no fail-open.
test("row 4: revise with findings → revise, findings preserved, not failed open", () => {
	const raw = JSON.stringify({
		verdict: "revise",
		findings: [
			{
				leak_type: "scenario-name",
				span: "renderInvoice",
				why: "names the eval scenario verbatim",
				suggested_fix: "describe the behavior generically",
			},
		],
	});
	const outcome = classifyValidatorVerdict(raw);
	assert.equal(outcome.verdict, "revise");
	assert.ok(outcome.findings.length >= 1);
	const [first] = outcome.findings;
	assert.equal(first?.leak_type, "scenario-name");
	assert.equal(first?.span, "renderInvoice");
	assert.equal(outcome.failedOpen, false);
});

// Row 4 is LENIENT: a finding missing suggested_fix must NOT fail open.
test("row 4: revise finding lacking suggested_fix still revises (lenient)", () => {
	const raw = JSON.stringify({
		verdict: "revise",
		findings: [{ leak_type: "verbatim-copy", span: "abc", why: "leak" }],
	});
	const outcome = classifyValidatorVerdict(raw);
	assert.equal(outcome.verdict, "revise");
	assert.equal(outcome.findings.length, 1);
	assert.equal(outcome.failedOpen, false);
});

// Fenced JSON is orthogonal to the row: handled inside parseAgentJson.
test("fenced approve JSON parses → row 3 approve", () => {
	const fenced = '```json\n{"verdict": "approve"}\n```';
	const outcome = classifyValidatorVerdict(fenced);
	assert.equal(outcome.verdict, "approve");
	assert.deepEqual(outcome.findings, []);
	assert.equal(outcome.failedOpen, false);
});

test("fenced revise JSON parses → row 4 revise", () => {
	const fenced = `\`\`\`json\n${JSON.stringify({
		verdict: "revise",
		findings: [
			{
				leak_type: "single-case",
				span: "only handles n=3",
				why: "hardcoded to the single eval case",
				suggested_fix: "generalize to arbitrary n",
			},
		],
	})}\n\`\`\``;
	const outcome = classifyValidatorVerdict(fenced);
	assert.equal(outcome.verdict, "revise");
	assert.equal(outcome.findings.length, 1);
	assert.equal(outcome.failedOpen, false);
});

// Row 5: revise but findings empty / absent → malformed → fail open to approve.
test("row 5: revise with empty findings → approve, failed open", () => {
	const outcome = classifyValidatorVerdict(
		'{"verdict": "revise", "findings": []}',
	);
	assert.equal(outcome.verdict, "approve");
	assert.deepEqual(outcome.findings, []);
	assert.equal(outcome.failedOpen, true);
});

test("row 5: revise with absent findings → approve, failed open", () => {
	const outcome = classifyValidatorVerdict('{"verdict": "revise"}');
	assert.equal(outcome.verdict, "approve");
	assert.deepEqual(outcome.findings, []);
	assert.equal(outcome.failedOpen, true);
});

// Row 2: parsed but verdict not in the enum → fail open to approve.
test("row 2: verdict typo 'approved' → approve, failed open", () => {
	const outcome = classifyValidatorVerdict('{"verdict": "approved"}');
	assert.equal(outcome.verdict, "approve");
	assert.deepEqual(outcome.findings, []);
	assert.equal(outcome.failedOpen, true);
});

test("row 2: missing verdict key → approve, failed open", () => {
	const outcome = classifyValidatorVerdict('{"findings": []}');
	assert.equal(outcome.verdict, "approve");
	assert.deepEqual(outcome.findings, []);
	assert.equal(outcome.failedOpen, true);
});

test("row 2: verdict of wrong type → approve, failed open", () => {
	const outcome = classifyValidatorVerdict('{"verdict": 1}');
	assert.equal(outcome.verdict, "approve");
	assert.deepEqual(outcome.findings, []);
	assert.equal(outcome.failedOpen, true);
});

// Row 1: non-JSON / unparseable → fail open to approve.
test("row 1: non-JSON string → approve, failed open", () => {
	const outcome = classifyValidatorVerdict("not json");
	assert.equal(outcome.verdict, "approve");
	assert.deepEqual(outcome.findings, []);
	assert.equal(outcome.failedOpen, true);
});
