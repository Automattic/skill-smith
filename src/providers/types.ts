import type { AgentDefinition, McpServerConfig } from '../config/types';

export type ProviderId =
	| 'claude-code'
	| 'openai-api'
	| 'anthropic-api'
	| 'gemini-api'
	| 'codex'
	| 'mock';

/**
 * The two sub-agent roles the harness dispatches. `testing` writes to
 * the workspace and may run shell commands; the `judge` defaults to
 * read-only but its capabilities are project-configurable via
 * {@link InvokeParams.capabilities}. Providers translate this to whatever
 * native tool surface they expose.
 */
export type Role = 'testing' | 'judge';

/**
 * Project-configurable capabilities for a sub-agent invocation. Set on the
 * judge call so a project can widen (or restrict) what the judge may do
 * beyond the read-only default. Every field is optional; an omitted field
 * leaves the provider's default for that capability in place.
 */
export interface JudgeCapabilities {
	/** Tool names the agent is allowed to use. */
	tools?: string[];
	/** MCP servers made available to the agent, keyed by server name. */
	mcpServers?: Record< string, McpServerConfig >;
	/** Whether the agent may write to its workspace. */
	allowWrite?: boolean;
	/** Whether the agent may access the network. */
	network?: boolean;
}

export interface InvokeParams {
	agent: AgentDefinition;
	systemPrompt: string;
	prompt: string;
	cwd: string;
	role: Role;
	/**
	 * Capability overrides for this invocation. Set only for the judge call;
	 * left unset for the testing role, which uses the provider's defaults.
	 */
	capabilities?: JudgeCapabilities;
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
	invoke( params: InvokeParams ): Promise< InvokeResult >;
}
