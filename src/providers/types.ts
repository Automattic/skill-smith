import type { AgentDefinition } from "../config/types";

export type ProviderId = "claude-code" | "openai-api" | "codex" | "mock";

export type Tool = "Read" | "Write" | "Edit" | "Glob" | "Grep" | "Bash";

export interface InvokeParams {
	agent: AgentDefinition;
	systemPrompt: string;
	prompt: string;
	cwd: string;
	tools: readonly Tool[];
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
