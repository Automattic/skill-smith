import { GoogleGenAI } from "@google/genai";
import { Codex } from "@openai/codex-sdk";
import { createAnthropicApiProvider } from "./anthropic-api";
import { claudeCodeProvider } from "./claude-code";
import { createCodexProvider } from "./codex";
import { createGeminiProvider, type GoogleGenAICtor } from "./gemini";
import { mockProvider } from "./mock";
import { createOpenAiApiProvider } from "./openai-api";
import type { Provider, ProviderId } from "./types";

const codexProvider = createCodexProvider(Codex);
const anthropicApiProvider = createAnthropicApiProvider();
const openaiApiProvider = createOpenAiApiProvider();
const geminiProvider = createGeminiProvider(
	GoogleGenAI as unknown as GoogleGenAICtor,
);

export const PROVIDERS: Record<ProviderId, Provider> = {
	"claude-code": claudeCodeProvider,
	"anthropic-api": anthropicApiProvider,
	"openai-api": openaiApiProvider,
	codex: codexProvider,
	gemini: geminiProvider,
	mock: mockProvider,
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function getProvider(id: ProviderId): Provider {
	const provider = PROVIDERS[id];
	if (provider === undefined) {
		throw new Error(`unknown provider: "${id}"`);
	}
	return provider;
}

export function isProviderId(value: unknown): value is ProviderId {
	return typeof value === "string" && value in PROVIDERS;
}
