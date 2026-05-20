import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretReviewerOutput } from "../improvement/reviewer";

const PROPOSAL = "# Proposal\n\nEdit skills/foo/SKILL.md to add X.\n";

test("ack: true keeps the original proposal verbatim", () => {
	const r = interpretReviewerOutput("ack: true\n", PROPOSAL);
	assert.equal(r.outcome, "ack");
	assert.equal(r.body, PROPOSAL);
});

test("ack accepted even with surrounding whitespace", () => {
	const r = interpretReviewerOutput("\n  ack: true  \n", PROPOSAL);
	assert.equal(r.outcome, "ack");
	assert.equal(r.body, PROPOSAL);
});

test("ack: false with revised uses the revised text", () => {
	const revised = "# Revised\n\nDo Y instead.\n";
	const raw = `ack: false\nrevised: |\n  # Revised\n\n  Do Y instead.\n`;
	const r = interpretReviewerOutput(raw, PROPOSAL);
	assert.equal(r.outcome, "revised");
	assert.equal(r.body.trim(), revised.trim());
});

test("ack: false without revised falls back to the original (malformed)", () => {
	const r = interpretReviewerOutput("ack: false\n", PROPOSAL);
	assert.equal(r.outcome, "malformed");
	assert.equal(r.body, PROPOSAL);
});

test("ack: false with empty revised falls back to the original", () => {
	const r = interpretReviewerOutput('ack: false\nrevised: ""\n', PROPOSAL);
	assert.equal(r.outcome, "malformed");
	assert.equal(r.body, PROPOSAL);
});

test("free-form text without an envelope is treated as a revision", () => {
	const freeform = "I rewrote it:\n\n# New proposal\n\nChange Z.";
	const r = interpretReviewerOutput(freeform, PROPOSAL);
	assert.equal(r.outcome, "unparsable");
	assert.equal(r.body, freeform);
});

test("a bare ACK line no longer counts as an acknowledgement", () => {
	const r = interpretReviewerOutput("ACK\n", PROPOSAL);
	assert.notEqual(r.outcome, "ack");
});
