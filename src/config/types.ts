export interface SkillSmithConfig {
	agents: AgentsConfig;
	paths?: Partial<Paths>;
}

export interface AgentsConfig {
	testing: AgentConfig;
	judge: AgentConfig;
}

/**
 * Either a single full model id (string) or a record keyed by `Agent`-tool
 * alias (e.g. "haiku", "sonnet", "opus"). Each entry on the matrix axis can
 * itself be a model-id string (shorthand for `{ model: <id> }`) or a full
 * `AgentSettings` object.
 */
export type AgentConfig = string | Record<string, string | AgentSettings>;

/**
 * Per-agent settings. Only `model` is required and typed — additional keys
 * are passed through to whichever SDK or tool the harness eventually
 * dispatches to (e.g. `temperature`, `maxTokens`, `topP`, Claude-specific
 * `thinking`, OpenAI-style `reasoning_effort`). The harness does not validate
 * extras; typos pass through silently.
 */
export interface AgentSettings {
	model: string;
	[key: string]: unknown;
}

export interface Paths {
	skills: string;
	scenarios: string;
	rubrics: string;
	environment: string;
}
