export interface SkillSmithConfig {
  agents: AgentsConfig;
  paths: Paths;
  hooks?: Hooks;
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
  base: string;
  skills: string;
  scenarios: string;
  rubrics: string;
}

/**
 * Minimal shape the harness passes in for `scenario`. The harness loads
 * `scenario.yaml` for each scenario; only `name` is guaranteed at the type
 * level so hook authors can switch on it. Other fields (description, skills,
 * prompt, acceptance, rubrics, e2e) are present at runtime and accessible
 * via index lookup.
 */
export interface Scenario {
  name: string;
  [key: string]: unknown;
}

export interface RunContext {
  runId: string;
  config: SkillSmithConfig;
}

export interface ScenarioContext extends RunContext {
  scenario: Scenario;
}

export interface AgentContext extends ScenarioContext {
  agentId: string;
  agentWorkspace: string;
}

export type HookFn<Ctx> = (ctx: Ctx) => void | Promise<void>;

/**
 * Project-customization points the harness invokes in the order shown in
 * `assets/skill-tester-workflow.png`. Each hook is optional — a missing or
 * empty hook is a no-op.
 */
export interface Hooks {
  beforeAll?: HookFn<RunContext>;
  beforeScenario?: HookFn<ScenarioContext>;
  beforeTestAgent?: HookFn<AgentContext>;
  afterTestAgent?: HookFn<AgentContext>;
  beforeJudgeAgent?: HookFn<AgentContext>;
  afterJudgeAgent?: HookFn<AgentContext>;
  afterScenario?: HookFn<ScenarioContext>;
  afterAll?: HookFn<RunContext>;
}
