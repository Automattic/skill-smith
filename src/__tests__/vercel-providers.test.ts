/**
 * Offline smokes for the Vercel-AI-SDK-backed providers. Each new provider
 * is imported directly from its file (not via `registry.ts`) so the test
 * does not depend on the Codex SDK being installable in the test
 * environment — see `src/providers/registry.ts:8`, which instantiates
 * `Codex` at module load.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { anthropicApiProvider } from "../providers/anthropic-api";
import { geminiApiProvider } from "../providers/gemini-api";
import { openaiApiProvider } from "../providers/openai-api";
import type { InvokeParams } from "../providers/types";

function baseParams(providerId: string): InvokeParams {
	return {
		agent: { id: "x", provider: providerId as never, model: "model-x" },
		systemPrompt: "",
		prompt: "",
		cwd: mkdtempSync(join(tmpdir(), "vercel-provider-test-")),
		role: "testing",
	};
}

function withEnv(
	key: string,
	value: string | undefined,
	fn: () => Promise<void>,
): Promise<void> {
	const prior = process.env[key];
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
	return fn().finally(() => {
		if (prior === undefined) delete process.env[key];
		else process.env[key] = prior;
	});
}

test("anthropic-api returns ANTHROPIC_API_KEY error when the env var is unset", async () => {
	await withEnv("ANTHROPIC_API_KEY", undefined, async () => {
		const result = await anthropicApiProvider.invoke(
			baseParams("anthropic-api"),
		);
		assert.equal(result.finalText, "");
		assert.equal(result.toolUseCount, 0);
		assert.equal(result.error, "ANTHROPIC_API_KEY is not set");
	});
});

test("openai-api returns OPENAI_API_KEY error when the env var is unset", async () => {
	await withEnv("OPENAI_API_KEY", undefined, async () => {
		const result = await openaiApiProvider.invoke(baseParams("openai-api"));
		assert.equal(result.finalText, "");
		assert.equal(result.toolUseCount, 0);
		assert.equal(result.error, "OPENAI_API_KEY is not set");
	});
});

test("gemini-api returns GOOGLE_GENERATIVE_AI_API_KEY error when the env var is unset", async () => {
	await withEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined, async () => {
		const result = await geminiApiProvider.invoke(baseParams("gemini-api"));
		assert.equal(result.finalText, "");
		assert.equal(result.toolUseCount, 0);
		assert.equal(result.error, "GOOGLE_GENERATIVE_AI_API_KEY is not set");
	});
});
