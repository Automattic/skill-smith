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
import type { LanguageModelV2, LanguageModelV2Usage } from "@ai-sdk/provider";
import { anthropicApiProvider } from "../providers/anthropic-api";
import { geminiApiProvider } from "../providers/gemini-api";
import { runVercel } from "../providers/lib/vercel-runner";
import { openaiApiProvider } from "../providers/openai-api";
import type { InvokeParams } from "../providers/types";

/**
 * Minimal `LanguageModelV2` stand-in for `runVercel`. Returns a single
 * text block plus the supplied usage so the test never reaches the
 * network or the `ai/test` mock (which pulls in `msw`).
 */
function fakeModel(usage: LanguageModelV2Usage): LanguageModelV2 {
	return {
		specificationVersion: "v2",
		provider: "fake",
		modelId: "fake-model",
		supportedUrls: {},
		doGenerate: async () => ({
			content: [{ type: "text", text: "ok" }],
			finishReason: "stop",
			usage,
			warnings: [],
		}),
		doStream: async () => {
			throw new Error("doStream not implemented in fake model");
		},
	};
}

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

test("runVercel maps result.totalUsage onto the normalized usage shape", async () => {
	const model = fakeModel({
		inputTokens: 200,
		cachedInputTokens: 150,
		outputTokens: 80,
		totalTokens: 280,
	});
	const result = await runVercel(baseParams("anthropic-api"), model);
	assert.equal(result.finalText, "ok");
	assert.deepEqual(result.usage, {
		inputTokens: 200,
		cachedInputTokens: 150,
		outputTokens: 80,
		totalTokens: 280,
	});
});

test("runVercel coalesces undefined token counts to 0", async () => {
	const model = fakeModel({
		inputTokens: undefined,
		outputTokens: undefined,
		totalTokens: undefined,
	});
	const result = await runVercel(baseParams("openai-api"), model);
	assert.deepEqual(result.usage, {
		inputTokens: 0,
		cachedInputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
	});
});
