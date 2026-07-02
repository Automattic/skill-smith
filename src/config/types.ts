import type { ProviderId } from '../providers/types';

/**
 * Top-level run mode. `test-only` runs a single iteration; `self-improvement`
 * runs up to `selfImprovement.maxIterations`, invoking the improver between
 * failing iterations.
 */
export type RunMode = 'test-only' | 'self-improvement';

/**
 * How the judge phase of the agent loop is scheduled across the
 * pipeline's scenario and agent fan-outs:
 *   - `parallel` — every pair's judge bracket may run concurrently
 *     (the default; today's behavior).
 *   - `serial` — a single run-wide lock serializes the
 *     `beforeJudgeAgent` → judge → `afterJudgeAgent` bracket so no two
 *     pairs grade at once (e.g. when each grade boots a shared,
 *     non-reentrant environment such as `wp-env start`).
 *
 * Set on the judge role via `roles.judge.concurrency`.
 */
export type JudgeConcurrency = 'serial' | 'parallel';

/**
 * How a subsequent iteration narrows what to re-evaluate based on the
 * previous iteration's report:
 *   - `failed-pairs` — only the exact (scenario, agent) pairs that failed.
 *   - `failed-scenarios` — every agent of every scenario where any agent failed.
 *   - `all` — re-run the full matrix each iteration.
 */
export type EvaluationScope = 'failed-pairs' | 'failed-scenarios' | 'all';

/**
 * Configuration for one stdio MCP server, mirroring the minimal stdio shape
 * the Claude Agent SDK accepts. Referenced by both {@link AgentDefinitionInput}
 * and {@link JudgeCapabilities} so projects can declare MCP servers for an
 * agent or for the judge.
 *
 * @example
 * { command: 'node', args: [ 'mcp-server.js' ], env: { TOKEN: 'abc' } }
 */
export interface McpServerConfig {
	/** Executable to launch for the server's stdio transport. */
	command: string;
	/** Arguments passed to {@link McpServerConfig.command}. */
	args?: string[];
	/** Environment variables set on the spawned server process. */
	env?: Record< string, string >;
}

/**
 * One agent as the user writes it in `agents`. The id comes from the map
 * key, so there is no `id` field here. The typed optional fields
 * (`tools`, `mcpServers`, `allowWrite`, `network`) give projects editor
 * completion for the common knobs, while the open index signature still
 * lets extra keys (e.g. `effort`, `temperature`) flow through to whichever
 * provider the harness dispatches to.
 */
export interface AgentDefinitionInput {
	provider: ProviderId;
	model: string;
	/** Tool names the agent is allowed to use. */
	tools?: string[];
	/** MCP servers made available to the agent, keyed by server name. */
	mcpServers?: Record< string, McpServerConfig >;
	/** Whether the agent may write to its workspace. */
	allowWrite?: boolean;
	/** Whether the agent may access the network. */
	network?: boolean;
	[ key: string ]: unknown;
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
	[ key: string ]: unknown;
}

/**
 * The user-facing `roles` block. Each role is a reference to one (or
 * more) ids in the `agents` map. Single-agent roles accept a string
 * shorthand; the testing role is always an object because it carries an
 * array.
 */
export interface RolesInput {
	test: TestRoleInput;
	judge: JudgeRoleInput;
	improver: SingleRoleInput;
}

export interface TestRoleInput {
	agents: string[];
	prompt?: string;
}

/**
 * A single-agent role as the user writes it: either a bare agent-id
 * string or an object naming the agent and an optional `prompt`. Used by
 * the improver role; the judge role has its own input shape (see
 * {@link JudgeRoleInput}).
 */
export type SingleRoleInput = string | { agent: string; prompt?: string };

/**
 * The judge role as the user writes it: either a bare agent-id string or
 * an object naming the agent plus the judge-specific knobs:
 *   - `library` — a project-relative directory of grading material
 *     supplied to every judge. Its `README.md` is inlined into the judge
 *     system prompt as the reusable environment manual, and the whole
 *     directory is copied per (scenario, agent) pair to `judge-library/`
 *     inside the judge's working directory; briefs name items by relative
 *     path (e.g. `judge-library/rubrics/<id>.md`).
 *   - `concurrency` — see {@link JudgeConcurrency}.
 */
export type JudgeRoleInput =
	| string
	| { agent: string; library?: string; concurrency?: JudgeConcurrency };

/**
 * The normalized form the harness uses internally. String shorthands are
 * lifted to object form; each id reference is resolved to a full
 * `AgentDefinition` with `id` injected. Downstream code never sees the
 * raw string/object union.
 */
export interface NormalizedRoles {
	test: { agents: AgentDefinition[]; prompt?: string };
	/**
	 * The judge role. `concurrency` is always present after normalization,
	 * defaulting to `'parallel'` when the user omits it; the agent loop
	 * reads it to decide whether to serialize the judge bracket.
	 */
	judge: {
		agent: AgentDefinition;
		/**
		 * Project-relative path of the judge library directory, carried
		 * through from `roles.judge.library`. Present only when the project
		 * configured one; when set, the agent loop prepares the library per
		 * pair (disk copy plus prompt section) before the judge runs.
		 */
		library?: string;
		concurrency: JudgeConcurrency;
	};
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
}

/**
 * The raw shape of `skillsmith.config.ts` as the user writes it. The
 * harness validates this shape and then normalizes it into a
 * `SkillsmithConfig` (see below) for the rest of the pipeline.
 */
export interface SkillsmithConfigInput {
	mode: RunMode;
	agents: Record< string, AgentDefinitionInput >;
	roles: RolesInput;
	paths?: Partial< Paths >;
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
	agents: Record< string, AgentDefinition >;
	roles: NormalizedRoles;
	paths: Paths;
	hooks?: Hooks;
	selfImprovement?: SelfImprovementConfig;
}

/**
 * One scenario as authored on disk under `config.paths.scenarios`. A scenario
 * is described by two files: a testing brief (the task handed to the test
 * agents) and a judge brief (the criteria handed to the judge). The harness
 * loads both into this record.
 */
export interface Scenario {
	/** Display and reporting name for the scenario. */
	name: string;
	/** Skill ids the scenario exercises. */
	skills: string[];
	/** Brief handed to the test agents describing the task to perform. */
	testingBrief: string;
	/** Brief handed to the judge describing how to grade the artifact. */
	judgeBrief: string;
	[ key: string ]: unknown;
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
 * consumers. `id` identifies the selected scenario's source directory relative
 * to `config.paths.scenarios`; `scenario.name` remains the display/reporting
 * key used by reports, progress output, self-improvement, and artifact paths.
 */
export interface RunScenario {
	/**
	 * Stable scenario directory identifier, relative to `config.paths.scenarios`
	 * and normalized to use `/` separators. Nested scenarios include their parent
	 * folders, for example `blocks/counter`.
	 *
	 * @example "counter"
	 * @example "blocks/counter"
	 */
	id: string;
	/**
	 * Compatibility alias for `id`. This value must always equal `id`, including
	 * when the source directory is nested.
	 *
	 * @example "counter"
	 * @example "blocks/counter"
	 */
	dirName: string;
	/**
	 * Parsed scenario definition, loaded from the scenario's two-file
	 * representation on disk: a testing brief and a judge brief.
	 */
	scenario: Scenario;
}

export interface ScenarioContext extends RunContext {
	scenario: Scenario;
}

export interface AgentContext extends ScenarioContext {
	agent: AgentDefinition;
	/**
	 * The canonical workspace the testing agent wrote into, at
	 * `<agent-dir>/workspace`. This is the artifact of record; the
	 * diff-guard fails the pair if anything mutates it during the judge
	 * phase.
	 */
	agentWorkspace: string;
	/**
	 * The isolated copy the judge runs against, at
	 * `<agent-dir>/judge-workspace`. Exposed so the `beforeJudgeAgent` /
	 * `afterJudgeAgent` hooks can build and tear down the judge's
	 * environment from the copy rather than the canonical workspace.
	 */
	judgeWorkspace: string;
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

export type HookFn< Ctx > = ( ctx: Ctx ) => void | Promise< void >;

/**
 * `afterAllScenarios` is the one hook whose return value the harness
 * consumes — every other hook is fire-and-forget. It fires after the
 * judges have graded the scenario sweep, and its verdict folds back
 * into the iteration report (see `Hooks.afterAllScenarios`).
 */
export type AfterAllScenariosHookFn = (
	ctx: IterationCompleteHookContext
) =>
	| VerificationReturn
	| void
	| Promise< VerificationReturn >
	| Promise< void >;

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
	beforeAll?: HookFn< RunContext >;
	beforeScenario?: HookFn< ScenarioContext >;
	beforeTestAgent?: HookFn< AgentContext >;
	afterTestAgent?: HookFn< AgentContext >;
	beforeJudgeAgent?: HookFn< AgentContext >;
	afterJudgeAgent?: HookFn< AgentContext >;
	afterScenario?: HookFn< ScenarioContext >;
	afterAll?: HookFn< RunContext >;
	/** Fires once per iteration, before any scenario runs. */
	beforeIteration?: HookFn< IterationHookContext >;
	/**
	 * Fires once per iteration, at the very end — after the improver has
	 * run, so the skills it edited are already on disk.
	 */
	afterIteration?: HookFn< IterationCompleteHookContext >;
	/** Fires once per iteration, just before the scenario sweep begins. */
	beforeAllScenarios?: HookFn< IterationHookContext >;
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
	beforeImprove?: HookFn< IterationCompleteHookContext >;
	/** Fires after the improver wrote its transcript (self-improvement mode only). */
	afterImprove?: HookFn< ImproveHookContext >;
}
