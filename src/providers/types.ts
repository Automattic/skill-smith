import type { AgentDefinition } from "../config/types";

export type ProviderId =
	| "claude-code"
	| "openai-api"
	| "anthropic-api"
	| "gemini-api"
	| "codex"
	| "mock";

/**
 * The two sub-agent roles the harness dispatches. `testing` writes to
 * the workspace and may run shell commands; `judge` is read-only.
 * Providers translate this to whatever native tool surface they expose.
 */
export type Role = "testing" | "judge";

export interface InvokeParams {
	agent: AgentDefinition;
	systemPrompt: string;
	prompt: string;
	cwd: string;
	role: Role;
}

/**
 * Normalized token accounting reported by a provider. `totalTokens` is
 * always `inputTokens + outputTokens`, computed uniformly across every
 * provider so the number means the same thing everywhere. Cross-provider
 * cache- and reasoning-token accounting differs and is deliberately out
 * of scope — those breakdowns are not folded into these figures.
 */
export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export interface InvokeResult {
	finalText: string;
	toolUseCount: number;
	error?: string;
	usage?: TokenUsage;
}

export interface Provider {
	readonly id: ProviderId;
	invoke(params: InvokeParams): Promise<InvokeResult>;
}
