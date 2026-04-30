import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAgentConfig } from "../agent-normalize";

test("V14: object form skips unknown alias keys", () => {
	const r = normalizeAgentConfig({
		haiku: "claude-haiku-4-5-20251001",
		bogus: "x",
	});
	assert.equal(r.entries.length, 1);
	assert.equal(r.entries[0]?.alias, "haiku");
	assert.equal(r.skipped.length, 1);
	assert.match(r.skipped[0]?.reason ?? "", /unknown alias "bogus"/);
});

test("V15: string form skips model id outside alias table", () => {
	const r = normalizeAgentConfig("not-a-real-model");
	assert.equal(r.entries.length, 0);
	assert.equal(r.skipped.length, 1);
	assert.match(r.skipped[0]?.reason ?? "", /model not dispatchable/);
});

test("V16: missing model is skipped with reason", () => {
	const r = normalizeAgentConfig({ haiku: { model: "" } });
	assert.equal(r.entries.length, 0);
	assert.equal(r.skipped.length, 1);
	assert.match(r.skipped[0]?.reason ?? "", /missing model/);
});

test("V12: empty object → emptyReason set, no entries", () => {
	const r = normalizeAgentConfig({});
	assert.equal(r.entries.length, 0);
	assert.equal(r.emptyReason, "empty agent config");
});

test("string form maps full id to alias", () => {
	const r = normalizeAgentConfig("claude-opus-4-7");
	assert.equal(r.entries.length, 1);
	assert.equal(r.entries[0]?.alias, "opus");
	assert.equal(r.entries[0]?.settings.model, "claude-opus-4-7");
});

test("object form preserves non-model passthrough keys", () => {
	const r = normalizeAgentConfig({
		opus: { model: "claude-opus-4-7", effort: "xhigh" },
	});
	assert.equal(r.entries.length, 1);
	assert.equal(r.entries[0]?.alias, "opus");
	assert.equal(r.entries[0]?.settings.effort, "xhigh");
});
