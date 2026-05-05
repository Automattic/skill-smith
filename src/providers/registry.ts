import { claudeCodeProvider } from "./claude-code";
import { codexProvider } from "./codex";
import { mockProvider } from "./mock";
import { openaiApiProvider } from "./openai-api";
import type { Provider, ProviderId } from "./types";

export const PROVIDERS: Record<ProviderId, Provider> = {
	"claude-code": claudeCodeProvider,
	"openai-api": openaiApiProvider,
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
