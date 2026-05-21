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

export interface SelfImprovementPaths {
	/**
	 * Path to a custom prompt file. When set, its contents replace the
	 * built-in improver instructions, so a project can drive a more
	 * elaborate edit strategy without changing the harness.
	 */
	improverPrompt?: string;
}

/**
 * Self-improvement loop settings. `mode: "test-only"` (default) keeps
 * the one-iteration Skill Tester behaviour. `mode: "loop"` runs up to
 * `maxIterations` iterations, letting a single improver agent
 * (`agents.improver`) edit the failing skills between each one, and
 * stops early when all scenarios pass. CLI flags (`--mode`,
 * `--iterations`, `--evaluation`, `--final-pass`) override these
 * per-invocation.
 */
export interface SelfImprovementConfig {
	mode?: SelfImprovementMode;
	maxIterations?: number;
	evaluationMode?: EvaluationMode;
	finalPass?: boolean;
	paths?: SelfImprovementPaths;
}

export interface AgentsConfig {
	testing: AgentDefinition[];
	judge: AgentDefinition[];
	/**
	 * Single agent that edits the failing skills between iterations in
	 * loop mode. Optional — without it, loop mode evaluates but never
	 * edits, so it behaves like a repeated test run.
	 */
	improver?: AgentDefinition;
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

/**
 * A single (scenario, agent?) verdict a verification hook can report.
 * Omitting `agent` fails the whole scenario; naming one fails just
 * that (scenario, agent) pair. `details` is surfaced to the improver
 * so it learns *why* the artifact failed beyond what the judge saw.
 */
export interface VerificationFailure {
	scenario: string;
	agent?: string;
	details?: string;
}

/**
 * What a verification hook may return. The harness applies the result
 * on top of the judges' verdicts for the iteration:
 *
 *   - `failures` — exactly these scenarios / pairs are marked failed.
 *   - `pass` — overall verdict. Defaults to `false` when `failures` is
 *     non-empty, `true` otherwise.
 *   - `details` — a general note used when `pass` is false but no
 *     specific failures were named (the coarse "fail everything that
 *     ran this iteration" path).
 */
export interface VerificationResult {
	pass?: boolean;
	failures?: VerificationFailure[];
	details?: string;
}

/**
 * Shorthand returns a verification hook may use instead of a full
 * `VerificationResult`: `true` passes the iteration, `false` fails
 * every scenario that ran. A hook may also return nothing (handled at
 * the `VerifyHookFn` boundary), which is treated as a pass.
 */
export type VerificationReturn = VerificationResult | boolean;

export interface ImproveHookContext extends IterationCompleteHookContext {
	/** Path to the improver agent's transcript for this iteration. */
	improvementPath: string;
}

export type HookFn<Ctx> = (ctx: Ctx) => void | Promise<void>;

/**
 * A verification hook fires after the judges have graded an iteration
 * but before the improver runs. Unlike the fire-and-forget hooks, its
 * return value feeds back into the iteration verdict.
 */
export type VerifyHookFn = (
	ctx: IterationCompleteHookContext,
) => VerificationReturn | void | Promise<VerificationReturn> | Promise<void>;

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
	/**
	 * Fires after the judges have graded the iteration but before the
	 * improver runs. Its return value can mark scenarios (or specific
	 * (scenario, agent) pairs) failed even when the judge passed them —
	 * e.g. to fail an iteration whose artifacts pass review but break a
	 * real end-to-end test. Runs every iteration, in every mode.
	 */
	verifyIteration?: VerifyHookFn;
	/** Fires before the improver agent runs (loop mode only). */
	beforeImprove?: HookFn<IterationCompleteHookContext>;
	/** Fires after the improver wrote its transcript (loop mode only). */
	afterImprove?: HookFn<ImproveHookContext>;
}
