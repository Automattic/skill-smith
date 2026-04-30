import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSettings } from "../sdk-passthrough";

test("V27: model passes through, extras land in unplumbed", () => {
	const r = mapSettings({
		model: "claude-opus-4-7",
		temperature: 0.5,
		maxTokens: 16000,
		thinking: { type: "enabled", budget_tokens: 8000 },
		effort: "xhigh",
	});
	assert.equal(r.model, "claude-opus-4-7");
	assert.deepEqual(r.unplumbed, {
		temperature: 0.5,
		maxTokens: 16000,
		thinking: { type: "enabled", budget_tokens: 8000 },
		effort: "xhigh",
	});
});

test("V27: model-only settings yield empty unplumbed", () => {
	const r = mapSettings({ model: "claude-haiku-4-5-20251001" });
	assert.equal(r.model, "claude-haiku-4-5-20251001");
	assert.deepEqual(r.unplumbed, {});
});
