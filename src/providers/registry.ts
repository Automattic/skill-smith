import { Codex } from "@openai/codex-sdk";
import { anthropicApiProvider } from "./anthropic-api";
import { claudeCodeProvider } from "./claude-code";
import { createCodexProvider } from "./codex";
import { geminiApiProvider } from "./gemini-api";
import { mockProvider } from "./mock";
import { openaiApiProvider } from "./openai-api";
import type { Provider, ProviderId } from "./types";

const codexProvider = createCodexProvider(Codex);

export const PROVIDERS: Record<ProviderId, Provider> = {
	"claude-code": claudeCodeProvider,
	"openai-api": openaiApiProvider,
	"anthropic-api": anthropicApiProvider,
	"gemini-api": geminiApiProvider,
	codex: codexProvider,
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
