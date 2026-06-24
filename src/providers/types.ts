import type { AgentDefinition } from '../config/types';

export type ProviderId =
	| 'claude-code'
	| 'openai-api'
	| 'anthropic-api'
	| 'gemini-api'
	| 'codex'
	| 'mock';

/**
 * The two sub-agent roles the harness dispatches. `testing` writes to
 * the workspace and may run shell commands; `judge` is read-only.
 * Providers translate this to whatever native tool surface they expose.
 */
export type Role = 'testing' | 'judge';

export interface InvokeParams {
	agent: AgentDefinition;
	systemPrompt: string;
	prompt: string;
	cwd: string;
	role: Role;
}

/**
 * Normalized token accounting reported by a provider. `inputTokens` is
 * the **gross** prompt size in tokens for the whole run — including the
 * portion that was a prompt-cache hit. `cachedInputTokens` is the subset
 * of `inputTokens` that was served from cache; `inputTokens -
 * cachedInputTokens` is the "new" tokens the model actually processed
 * for the first time. `totalTokens` is `inputTokens + outputTokens` so
 * the figure is directly comparable across providers regardless of
 * native cache semantics.
 */
export interface TokenUsage {
	inputTokens: number;
	cachedInputTokens: number;
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
	/** Names the env var this provider's credential needs, read before invoke. */
	readonly requiredEnv?: string;
	invoke( params: InvokeParams ): Promise< InvokeResult >;
}
