import assert from "node:assert/strict";
import { test } from "node:test";
import { getProvider, isProviderId } from "../providers/registry";

test("getProvider returns the matching provider", () => {
	assert.equal(getProvider("mock").id, "mock");
	assert.equal(getProvider("claude-code").id, "claude-code");
});

test("getProvider throws on unknown id", () => {
	assert.throws(
		// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
		() => getProvider("bogus" as any),
		/unknown provider: "bogus"/,
	);
});

test("isProviderId is a type guard for known ids", () => {
	assert.equal(isProviderId("mock"), true);
	assert.equal(isProviderId("claude-code"), true);
	assert.equal(isProviderId("openai-api"), true);
	assert.equal(isProviderId("codex"), true);
	assert.equal(isProviderId("bogus"), false);
});

test("openai-api and codex providers throw on invoke (not implemented)", async () => {
	await assert.rejects(
		() =>
			getProvider("openai-api").invoke({
				agent: { id: "x", provider: "openai-api", model: "m" },
				systemPrompt: "",
				prompt: "",
				cwd: "/tmp",
				role: "testing",
			}),
		/not implemented/,
	);
	await assert.rejects(
		() =>
			getProvider("codex").invoke({
				agent: { id: "x", provider: "codex", model: "m" },
				systemPrompt: "",
				prompt: "",
				cwd: "/tmp",
				role: "testing",
			}),
		/not implemented/,
	);
});
