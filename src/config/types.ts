import type { ProviderId } from "../providers/types";

export interface SkillsmithConfig {
	agents: AgentsConfig;
	paths: Paths;
	hooks?: Hooks;
}

export interface AgentsConfig {
	testing: AgentDefinition[];
	judge: AgentDefinition[];
}

/**
 * One concrete agent in the matrix. `id` is user-chosen and stable
 * (used in directory names and reports). Extra keys (e.g. `effort`,
 * `temperature`) flow through to whichever provider the harness
 * dispatches to.
 */
export interface AgentDefinition {
	id: string;
	provider: ProviderId;
	model: string;
	[key: string]: unknown;
}

export interface Paths {
	base: string;
	skills: string;
	scenarios: string;
	rubrics: string;
}

export interface Scenario {
	name: string;
	description: string;
	skills: string[];
	prompt: string;
	acceptance: string[];
	rubrics: string[];
	[key: string]: unknown;
}

/**
 * Metadata for one iteration the pipeline has completed (or is about
 * to complete). The harness appends one entry per iteration to
 * `RunContext.iterations` as the loop advances so hooks can walk the
 * artifacts produced across the whole run.
 */
export interface IterationInfo {
	number: number;
	directory: string;
}

export interface RunContext {
	runId: string;
	config: SkillsmithConfig;
	runDirectory: string;
	iterations: IterationInfo[];
	scenarios: RunScenario[];
}

export interface RunScenario {
	dirName: string;
	scenario: Scenario;
}

export interface ScenarioContext extends RunContext {
	scenario: Scenario;
}

export interface AgentContext extends ScenarioContext {
	agent: AgentDefinition;
	agentWorkspace: string;
}

export type HookFn<Ctx> = (ctx: Ctx) => void | Promise<void>;

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
