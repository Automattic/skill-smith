import type { ProviderId } from "../providers/types";

/**
 * Top-level run mode. `test-only` runs a single iteration; `self-improvement`
 * runs up to `selfImprovement.maxIterations`, invoking the improver between
 * failing iterations.
 */
export type RunMode = "test-only" | "self-improvement";

/**
 * How a subsequent iteration narrows what to re-evaluate based on the
 * previous iteration's report:
 *   - `failed-pairs` — only the exact (scenario, agent) pairs that failed.
 *   - `failed-scenarios` — every agent of every scenario where any agent failed.
 *   - `all` — re-run the full matrix each iteration.
 */
export type EvaluationScope = "failed-pairs" | "failed-scenarios" | "all";

/**
 * One agent as the user writes it in `agents`. The id comes from the map
 * key, so there is no `id` field here. Extra keys (e.g. `effort`,
 * `temperature`) flow through to whichever provider the harness dispatches
 * to.
 */
export interface AgentDefinitionInput {
	provider: ProviderId;
	model: string;
	[key: string]: unknown;
}

/**
 * One concrete agent after normalization. `id` is injected from the
 * `agents` map key (stable, user-chosen, used in directory names and
 * reports). All downstream code (pipeline, hooks, providers) reads
 * `agent.id` so it must be present internally.
 */
export interface AgentDefinition {
	id: string;
	provider: ProviderId;
	model: string;
	[key: string]: unknown;
}

/**
 * The user-facing `roles` block. Each role is a reference to one (or
 * more) ids in the `agents` map. Single-agent roles accept a string
 * shorthand; the testing role is always an object because it carries an
 * array.
 */
export interface RolesInput {
	test: TestRoleInput;
	judge: SingleRoleInput;
	improver: SingleRoleInput;
}

export interface TestRoleInput {
	agents: string[];
	prompt?: string;
}

export type SingleRoleInput = string | { agent: string; prompt?: string };

/**
 * The normalized form the harness uses internally. String shorthands are
 * lifted to object form; each id reference is resolved to a full
 * `AgentDefinition` with `id` injected. Downstream code never sees the
 * raw string/object union.
 */
export interface NormalizedRoles {
	test: { agents: AgentDefinition[]; prompt?: string };
	judge: { agent: AgentDefinition; prompt?: string };
	improver: { agent: AgentDefinition; prompt?: string };
}

/**
 * Self-improvement loop settings. Only consulted when the top-level
 * `mode` is `"self-improvement"`. `scope` controls how subsequent
 * iterations narrow re-evaluation. `finalPass: true` adds one extra full
 * sweep at the end when the last iteration only ran a subset.
 */
export interface SelfImprovementConfig {
	maxIterations?: number;
	scope?: EvaluationScope;
	finalPass?: boolean;
}

export interface Paths {
	base: string;
	skills: string;
	scenarios: string;
	rubrics: string;
}

/**
 * The raw shape of `skillsmith.config.ts` as the user writes it. The
 * harness validates this shape and then normalizes it into a
 * `SkillsmithConfig` (see below) for the rest of the pipeline.
 */
export interface SkillsmithConfigInput {
	mode: RunMode;
	agents: Record<string, AgentDefinitionInput>;
	roles: RolesInput;
	paths?: Partial<Paths>;
	hooks?: Hooks;
	selfImprovement?: SelfImprovementConfig;
}

/**
 * The resolved, normalized config the harness carries around after
 * `defineConfig`. `roles` is fully resolved to `AgentDefinition`s;
 * `agents` retains the original map keyed by id (with id injected on
 * each entry) so callers that need to look up an agent by id can.
 */
export interface SkillsmithConfig {
	mode: RunMode;
	agents: Record<string, AgentDefinition>;
	roles: NormalizedRoles;
	paths: Paths;
	hooks?: Hooks;
	selfImprovement?: SelfImprovementConfig;
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

/**
 * One scenario selected for a run and exposed to hooks and downstream
 * consumers. The scenario `name` remains the display/reporting key, while
 * `id` identifies the scenario directory relative to `paths.scenarios`.
 */
export interface RunScenario {
	/**
	 * Stable scenario directory identifier, relative to `config.paths.scenarios`
	 * and normalized to use `/` separators.
	 *
	 * @example "counter"
	 */
	id: string;
	/**
	 * Compatibility alias for `id`. This value must always equal `id`.
	 *
	 * @example "counter"
	 */
	dirName: string;
	/** Parsed scenario definition loaded from `scenario.yaml`. */
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
 * What the `afterAllScenarios` hook may return. The harness applies the
 * result on top of the judges' verdicts for the iteration:
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
 * Shorthand `afterAllScenarios` may return instead of a full
 * `VerificationResult`: `true` passes the iteration, `false` fails
 * every scenario that ran. A hook may also return nothing (handled at
 * the `AfterAllScenariosHookFn` boundary), which is treated as a pass.
 */
export type VerificationReturn = VerificationResult | boolean;

export interface ImproveHookContext extends IterationCompleteHookContext {
	/** Path to the improver agent's transcript for this iteration. */
	improvementPath: string;
}

export type HookFn<Ctx> = (ctx: Ctx) => void | Promise<void>;

/**
 * `afterAllScenarios` is the one hook whose return value the harness
 * consumes — every other hook is fire-and-forget. It fires after the
 * judges have graded the scenario sweep, and its verdict folds back
 * into the iteration report (see `Hooks.afterAllScenarios`).
 */
export type AfterAllScenariosHookFn = (
	ctx: IterationCompleteHookContext,
) => VerificationReturn | void | Promise<VerificationReturn> | Promise<void>;

/**
 * Project hooks, listed in the order they fire within a run:
 *
 * ```
 * beforeAll
 *   beforeIteration
 *     beforeAllScenarios
 *       beforeScenario · beforeTestAgent · afterTestAgent
 *       beforeJudgeAgent · afterJudgeAgent · afterScenario
 *     afterAllScenarios        <- returns the iteration verdict
 *     beforeImprove · afterImprove   (self-improvement mode, when not yet passing)
 *   afterIteration             <- fires after the improver, ending the iteration
 * afterAll
 * ```
 *
 * Every hook is fire-and-forget except `afterAllScenarios`, whose
 * return value the harness reads.
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
	/** Fires once per iteration, before any scenario runs. */
	beforeIteration?: HookFn<IterationHookContext>;
	/**
	 * Fires once per iteration, at the very end — after the improver has
	 * run, so the skills it edited are already on disk.
	 */
	afterIteration?: HookFn<IterationCompleteHookContext>;
	/** Fires once per iteration, just before the scenario sweep begins. */
	beforeAllScenarios?: HookFn<IterationHookContext>;
	/**
	 * Fires after the judges have graded the scenario sweep but before
	 * the improver runs. Its return value can mark scenarios (or specific
	 * (scenario, agent) pairs) failed even when the judge passed them —
	 * e.g. to fail an iteration whose artifacts pass review but break a
	 * real end-to-end test. This is the only hook whose return value the
	 * harness consumes. Runs every iteration, in every mode.
	 */
	afterAllScenarios?: AfterAllScenariosHookFn;
	/** Fires before the improver agent runs (self-improvement mode only). */
	beforeImprove?: HookFn<IterationCompleteHookContext>;
	/** Fires after the improver wrote its transcript (self-improvement mode only). */
	afterImprove?: HookFn<ImproveHookContext>;
}
