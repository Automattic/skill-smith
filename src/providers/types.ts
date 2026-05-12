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

export interface InvokeResult {
	finalText: string;
	toolUseCount: number;
	error?: string;
}

export interface Provider {
	readonly id: ProviderId;
	invoke(params: InvokeParams): Promise<InvokeResult>;
}
