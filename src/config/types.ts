import type { ProviderId } from "../providers/types";

export interface SkillsmithConfig {
	agents: AgentsConfig;
	paths: Paths;
	hooks?: Hooks;
	selfImprovement?: SelfImprovementConfig;
}

export type SelfImprovementMode = "test-only" | "loop";

/**
 * How a subsequent iteration narrows what to re-evaluate based on the
 * previous iteration's report:
 *   - `failed-pairs` — only the exact (scenario, agent) pairs that failed.
 *   - `failed-scenarios` — every agent of every scenario where any agent failed.
 *   - `all` — re-run the full matrix each iteration.
 */
export type EvaluationMode = "failed-pairs" | "failed-scenarios" | "all";

export interface SelfImprovementAgents {
	proposer?: AgentDefinition;
	reviewer?: AgentDefinition;
	executor?: AgentDefinition;
}

export interface SelfImprovementPaths {
	/** Project-specific guidelines appended to the proposer's system prompt. */
	proposerGuidelines?: string;
	/** Project-specific guidelines appended to the executor's system prompt. */
	executorGuidelines?: string;
}

/**
 * Self-improvement loop settings. `mode: "test-only"` (default) keeps
 * the one-iteration Skill Tester behaviour. `mode: "loop"` runs up to
 * `maxIterations` iterations, applying a proposer/(reviewer)/executor
 * edit between each one, and stops early when all scenarios pass.
 * CLI flags (`--mode`, `--iterations`, `--evaluation`, `--final-pass`)
 * override these per-invocation.
 */
export interface SelfImprovementConfig {
	mode?: SelfImprovementMode;
	maxIterations?: number;
	evaluationMode?: EvaluationMode;
	finalPass?: boolean;
	agents?: SelfImprovementAgents;
	paths?: SelfImprovementPaths;
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

/**
 * Context passed to the iteration-scoped hooks. `iteration` is
 * 1-indexed; `iterationDirectory` is `${runDirectory}/iteration-N`.
 */
export interface IterationHookContext extends RunContext {
	iteration: number;
	iterationDirectory: string;
}

/**
 * Like `IterationHookContext` but at the end of an iteration —
 * `pass` is the iteration's own verdict (every scenario that ran
 * passed). The harness fires this even on the last iteration.
 */
export interface IterationCompleteHookContext extends IterationHookContext {
	pass: boolean;
}

export interface ProposalHookContext extends IterationCompleteHookContext {
	proposalPath: string;
}

export interface ReviewHookContext extends ProposalHookContext {
	reviewedProposalPath?: string;
}

export interface ExecuteHookContext extends ProposalHookContext {
	skillsDiffPath?: string;
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
	/** Fires once per iteration, before any scenario runs. */
	beforeIteration?: HookFn<IterationHookContext>;
	/** Fires once per iteration, after the iteration report is written. */
	afterIteration?: HookFn<IterationCompleteHookContext>;
	/** Fires before the proposer sub-agent runs (loop mode only). */
	beforeProposal?: HookFn<IterationCompleteHookContext>;
	/** Fires after the proposer wrote `proposal.md` (loop mode only). */
	afterProposal?: HookFn<ProposalHookContext>;
	/** Fires before the reviewer sub-agent runs (loop mode only). */
	beforeReview?: HookFn<ProposalHookContext>;
	/** Fires after the reviewer wrote `proposal.reviewed.md` (loop mode only). */
	afterReview?: HookFn<ReviewHookContext>;
	/** Fires before the executor sub-agent runs (loop mode only). */
	beforeExecute?: HookFn<ProposalHookContext>;
	/** Fires after the executor finished and `skills.diff` was captured. */
	afterExecute?: HookFn<ExecuteHookContext>;
}
