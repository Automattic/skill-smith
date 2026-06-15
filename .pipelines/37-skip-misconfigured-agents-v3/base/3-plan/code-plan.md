# Code Plan: Skip misconfigured agents across all phases of a run

This is an ordered, dependency-aware breakdown of the implementation. Tasks are
dispatched one at a time to fresh code-writers doing TDD, sharing ONE working tree
sequentially. Each task is independently implementable and committable; later tasks
depend only on earlier ones.

## Conventions for every task

- **TDD.** Write the failing test(s) named in *Acceptance* first, then the minimal
  code to pass them. Run `npm run test`, `npm run typecheck`, and `npm run lint`
  before committing.
- **No internal-process vocabulary** in any shipped code, comment, test name, or doc
  (no phase/spec/plan/acceptance-criteria/task-id tags; no "R3.2"-style references).
  Name things in plain domain terms ("skipped", "runnable", "misconfigured").
- **Comment sparingly** — only the non-obvious. Never touch comments on code that did
  not change.
- **Minimal change** — additive fields/parameters only; do not alter existing internal
  signatures beyond appending an optional/new parameter; no gratuitous refactors.
- **Commit** at the end of each task with the format: imperative mood, sentence case,
  no trailing period, agent name in parentheses — e.g.
  `Add runnability classifier (code-writer)`.

## Naming decisions fixed for this plan (so tasks stay consistent)

These names are chosen here so sequential code-writers agree. They carry no
internal-process vocabulary.

- New module: **`src/runnability.ts`** exporting `classifyRunnability`, `decide`, and
  the types `SkippedAgent`, `AgentRole`, `Consequence`, `RunnabilityResult`.
- Skipped-agent shape: `SkippedAgent = { id: string; roles: AgentRole[]; reason: string }`.
- Domain role union: `AgentRole = "test" | "judge" | "improver"` — **distinct** from the
  provider `Role = "testing" | "judge"` in `src/providers/types.ts`. Do NOT reuse the
  provider type.
- Consequence union: `Consequence = "EXCLUDE_LANE" | "STOP_RUN" | "HALT_AFTER_ITERATION"`.
- The classifier result also carries `runnableTestAgentIds: string[]`,
  `judgeRunnable: boolean`, `improverRunnable: boolean`.

## Test-fixture strategy (no real credentials)

Every behavior is exercised without real provider credentials by combining:

- **`mock`** agents — deterministic, always runnable (never carry `requiredEnv`).
- **`openai-api`** agents — deterministically misconfigured exactly when
  `OPENAI_API_KEY` is unset (they carry `requiredEnv: "OPENAI_API_KEY"`).

Pipeline-level tests that need an `openai-api` agent to be *skipped* delete
`OPENAI_API_KEY` for the duration of the run and restore it after, using the same
save/delete/restore pattern as `withEnv` in `vercel-providers.test.ts:53-65`. Because
detection is a pure env read and a skipped lane never invokes the provider, no model
call ever happens for the misconfigured agent.

---

## Task 1 — Add `Provider.requiredEnv?` and set it on the three credentialed providers

**Goal.** Give the runtime a static, pre-invoke descriptor of which environment
variable each provider's credential requires, as passive data on the provider literal.

**Files.**
- `src/providers/types.ts` (modify `Provider`)
- `src/providers/openai-api.ts`, `src/providers/anthropic-api.ts`,
  `src/providers/gemini-api.ts` (set the field)
- `src/__tests__/providers-required-env.test.ts` (new) — or extend
  `src/__tests__/vercel-providers.test.ts`; prefer a new small file to keep the
  credential-error smokes untouched.

**Changes.**
- In `src/providers/types.ts`, add to the `Provider` interface (currently
  `{ readonly id; invoke }` at lines 50-53) one optional readonly field:
  `readonly requiredEnv?: string;` with a one-line comment that it names the env var
  the provider's credential requires, read statically before invoke.
- `openai-api.ts`: add `requiredEnv: "OPENAI_API_KEY"` to the provider literal.
- `anthropic-api.ts`: add `requiredEnv: "ANTHROPIC_API_KEY"`.
- `gemini-api.ts`: add `requiredEnv: "GOOGLE_GENERATIVE_AI_API_KEY"`.
- Do **not** touch `claude-code.ts`, `mock.ts`, `codex.ts` — they omit the field.
- Do **not** change the existing in-`invoke` key guards; `requiredEnv` is purely
  additive and the env-var literal appearing in both the guard and the descriptor is
  expected.

**Depends on.** Nothing.

**Traces to.** Pre-invoke detection from declared provider + environment with no model
call (spec R2.2); claude-code/mock/codex not statically misconfigurable (R2.3);
additive passive-data field (design §4.1).

**Acceptance.**
- New unit test asserts: `openaiApiProvider.requiredEnv === "OPENAI_API_KEY"`,
  `anthropicApiProvider.requiredEnv === "ANTHROPIC_API_KEY"`,
  `geminiApiProvider.requiredEnv === "GOOGLE_GENERATIVE_AI_API_KEY"`. Import providers
  directly from their files (not via `registry.ts`) to avoid the Codex SDK load, as
  `vercel-providers.test.ts` does.
- Assert `claudeCodeProvider.requiredEnv === undefined` and
  `mockProvider.requiredEnv === undefined` (codex may be skipped to avoid the SDK
  import).
- Existing `vercel-providers.test.ts` credential-error smokes still pass unchanged.
- `npm run typecheck` clean; the new field is optional so all existing provider
  literals still satisfy `Provider`.

---

## Task 2 — Add the runnability classifier module (`classifyRunnability` + `decide` seam)

**Goal.** A self-contained, pure, synchronous component that decides which declared
agents are runnable given config + environment, and owns the single policy seam.

**Files.**
- `src/runnability.ts` (new)
- `src/__tests__/runnability.test.ts` (new)

**Changes.**
- Define and export the types: `AgentRole = "test" | "judge" | "improver"`;
  `SkippedAgent = { id: string; roles: AgentRole[]; reason: string }`;
  `Consequence = "EXCLUDE_LANE" | "STOP_RUN" | "HALT_AFTER_ITERATION"`;
  `RunnabilityResult = { runnableTestAgentIds: string[]; skipped: SkippedAgent[];
  judgeRunnable: boolean; improverRunnable: boolean }`.
- `classifyRunnability(config: SkillsmithConfig, env: NodeJS.ProcessEnv | Record<string,
  string | undefined>): RunnabilityResult` — pure, synchronous, no async, no model call,
  no I/O beyond reading the passed-in `env`:
  - For each distinct declared agent id across the three roles
    (`config.roles.test.agents`, `config.roles.judge.agent`,
    `config.roles.improver.agent`), look up `getProvider(agent.provider).requiredEnv`.
  - If `requiredEnv` is set and `env[requiredEnv]` is absent (`=== undefined` or empty
    string — match the providers' `!process.env.X` truthiness so the descriptor and the
    runtime guard agree), the agent is misconfigured with reason
    `` `${requiredEnv} is not set` ``.
  - Classify **once per id**: collect the set of `AgentRole`s an id fills, so an id in
    multiple roles produces exactly one `SkippedAgent` entry whose `roles` lists every
    role it fills.
  - Build `runnableTestAgentIds` from the test-role agents that are runnable;
    `judgeRunnable`/`improverRunnable` from those single roles.
  - Import only `getProvider` from `./providers/registry` and the config/provider types.
    Do NOT import any pipeline internals.
- `decide(roles: AgentRole[]): Consequence` — the **only** place policy lives. Map each
  role to its warn-policy consequence (`judge → STOP_RUN`, `improver →
  HALT_AFTER_ITERATION`, `test → EXCLUDE_LANE`) and return the **most-severe** across the
  id's roles with the ordering `STOP_RUN > HALT_AFTER_ITERATION > EXCLUDE_LANE`. The
  pipeline will switch on the returned `Consequence`, never on "which policy."
  - Add a brief comment that future "fail"/"skip" policies are localized changes inside
    `decide` (and, for "skip", the exit-code rule) — do not implement them.

**Depends on.** Task 1 (reads `requiredEnv`).

**Traces to.** Isolated classifier component, pure synchronous predicate, the single
`decide` seam, multi-role most-severe (spec R1.1, R2.1, R2.2, R6.4, R8.1, R8.2, R12.1;
design §3, §3.1, §3.2, §3.3). This same function is the R10.3 standalone runnability
predicate. Honors review note (3): `AgentRole` is distinct from provider `Role`.

**Acceptance.** `src/__tests__/runnability.test.ts`, building minimal `SkillsmithConfig`
objects in-memory (no fixtures needed; mirror the `AgentDefinition` shape) and passing an
explicit `env` record so no real env mutation is needed:
- An `openai-api` test agent with `env` lacking `OPENAI_API_KEY` → appears in `skipped`
  with reason `"OPENAI_API_KEY is not set"` and is absent from `runnableTestAgentIds`;
  with `OPENAI_API_KEY` present → runnable, empty `skipped`. Analogous for
  `anthropic-api`/`ANTHROPIC_API_KEY` and `gemini-api`/`GOOGLE_GENERATIVE_AI_API_KEY`.
- A `claude-code` (and a `mock`) test agent is runnable regardless of `env`.
- Two test agents, one `openai-api` (key unset) + one `mock` → exactly one skipped entry;
  `runnableTestAgentIds === ["<mock id>"]`.
- A misconfigured judge → `judgeRunnable === false` and a `skipped` entry with
  `roles` including `"judge"`.
- A misconfigured improver → `improverRunnable === false` and `roles` including
  `"improver"`.
- An id used as **both** judge and a test agent, misconfigured → exactly one `skipped`
  entry whose `roles` contains both `"judge"` and `"test"`.
- `decide(["test"]) === "EXCLUDE_LANE"`; `decide(["improver"]) === "HALT_AFTER_ITERATION"`;
  `decide(["judge"]) === "STOP_RUN"`; `decide(["judge","test"]) === "STOP_RUN"`;
  `decide(["improver","test"]) === "HALT_AFTER_ITERATION"`.
- The classifier performs no async work (function returns a plain object, not a Promise)
  and never calls a provider's `invoke`.

---

## Task 3 — Thread the `skipped` array through the run report (`writeRunReport`)

**Goal.** Make the skipped set a top-level, machine-readable sibling of `scenarios` in
`${runDirectory}/report.json`, via an additive passthrough parameter.

**Files.**
- `src/reports/iteration-report.ts` (modify `writeRunReport`)
- `src/__tests__/iteration-report-skipped.test.ts` (new) — or extend an existing report
  test; a focused new file is cleaner.

**Changes.**
- `writeRunReport(runDirectory, runId, scenarios)` (lines 153-164) gains a 4th
  parameter: `skipped: ReadonlyArray<SkippedAgent> = []` (import `SkippedAgent` from
  `../runnability`). It writes `{ runId, pass, scenarios, skipped }` (skipped as a
  top-level sibling). Keep returning `pass` unchanged. Default `[]` so existing callers
  and the iteration-level path are unaffected.
- Do **not** add `skipped` to `IterationReport` or `aggregateIterationReport` — the
  skip is a run-level (merged-report) signal only, not per-iteration.

**Depends on.** Task 2 (the `SkippedAgent` type).

**Traces to.** Top-level `skipped` array in `report.json`, distinguishable from a Cell
(spec R4.3; design §4.3, §4.4).

**Acceptance.** New unit test:
- `writeRunReport(dir, runId, {}, [{ id: "gpt", roles: ["test"], reason: "OPENAI_API_KEY
  is not set" }])` writes a `report.json` whose parsed top level has
  `skipped[0].id === "gpt"`, `skipped[0].reason` matching, and `skipped` is a sibling of
  `scenarios` (not nested in any scenario).
- Calling `writeRunReport(dir, runId, scenarios)` with **no** 4th arg writes
  `skipped: []` and still returns the same `pass` as before (assert against a scenarios
  map that is all-pass and one that is not).

---

## Task 4 — Exit code + CLI surfacing in `prepareSummary`

**Goal.** Make `prepareSummary` the sole producer of exit code `2` from a non-empty
top-level `skipped` array, and render a once-per-run, visually distinct skip block.

**Files.**
- `src/reports/summary.ts` (modify `prepareSummary`, add a skip reader + renderer)
- `src/__tests__/summary.test.ts` (extend)

**Changes.**
- In `prepareSummary` (lines 52-77): after computing `allPass`, read the report's
  top-level `skipped` array, **defaulting a missing/absent value to `[]`** (mirror
  `loadRows`' `scenarios ?? {}` default), and parse it defensively into
  `{ id, roles, reason }` entries (the report is JSON; validate shapes like `loadRows`
  does, ignoring malformed entries).
- Change the exit-code computation to:
  `exitCode = skipped.length > 0 ? 2 : (allPass ? 0 : 1)`.
- Append a **once-per-run** skip block to the returned `consoleLines` (and to the
  `plain` lines written to `summary.txt`), rendered **visually distinct** from a `FAIL`
  row and from the per-cell `SKIPPED` marker — its own labelled section with a distinct
  color (e.g. a header like `SKIPPED AGENTS` and one line per agent
  `<id>: <reason>` using a color other than the red used for FAIL and the yellow used
  for the per-cell SKIPPED). One block for the whole run, listing every skipped id +
  reason. Do this in both the colored and non-colored render so `summary.txt` mirrors
  the console minus ANSI.
- Leave the matrix/table rendering, `loadRows`, `isRowPass`, and the per-cell `SKIPPED`
  rendering (lines 233-237, 331-333) untouched.
- Update the function's doc comment minimally to note the third exit code; do not
  rewrite unrelated comment text.

**Depends on.** Task 2 (`SkippedAgent` shape), Task 3 (the report now carries `skipped`).

**Traces to.** Single exit-code chokepoint and the `skipped.length>0 ? 2 : (allPass ? 0
: 1)` rule; once-per-run distinct skip block; anti-regression; all-misconfigured;
precedence (spec R4.1, R4.2, R5.1–R5.5; design §7.1, §7.2). Honors review note (2):
default a missing top-level `skipped` to `[]` for unchanged-behavior fidelity.

**Acceptance.** Extend `summary.test.ts` (the existing `withReport` helper writes
`{ runId, scenarios }`; add an optional `skipped` arg to it or write a sibling helper):
- A report with an all-PASS matrix **plus** a non-empty top-level `skipped` → `exitCode
  === 2`; the output contains a distinct skip block naming the id and reason; the
  surviving rows still render as PASS.
- A report with a genuinely-failing agent **and** a non-empty `skipped` → `exitCode ===
  2` (precedence); the output shows both the FAIL row(s) and the skip block, and they are
  visually distinguishable (assert the skip line is not under a `RUN RESULT: FAIL`
  scenario block and uses the skip section header).
- A report with **no** `skipped` field at all (existing fixtures) → identical exit code
  to today (`allPass ? 0 : 1`) and **no** skip block in the output. Add an explicit
  assertion that the existing all-pass and any-fail tests are unchanged (they already
  cover this; confirm they still pass).
- A report whose matrix is empty (no scenarios) but `skipped` is non-empty → `exitCode
  === 2`, skip block present, no `RUN RESULT: PASS`.
- `summary.txt` mirrors the skip block without ANSI escapes.

---

## Task 5 — Add `RunContext.skipped` (readonly) to the config types

**Goal.** Expose the skipped set as passive data on the base run context every hook
context extends, readable from `beforeAll` onward.

**Files.**
- `src/config/types.ts` (modify `RunContext`)

**Changes.**
- Add to `RunContext` (lines 144-150) one readonly field:
  `readonly skipped: ReadonlyArray<SkippedAgent>;` importing `SkippedAgent` from
  `../runnability`. (Verify no import cycle: `runnability.ts` imports config *types* and
  `getProvider`; `config/types.ts` importing a type from `runnability.ts` is a
  type-only edge — if `tsc` flags a cycle, define `SkippedAgent` in `runnability.ts` and
  import it type-only here; types-only cycles are erased at compile time and are fine.)
- Add a one-line comment that it is the set of agents the run skipped, keyed by id, with
  the role(s) each fills and the reason — readable from the earliest run-scoped hook.
- Because it is non-optional, every place that **constructs** a `RunContext`-derived
  literal must set it. Task 6 sets the real value in the pipeline. To keep this task green
  on its own, the literal construction sites are (verified):
  - `runCtx` (`pipeline.ts:100-106`) — typed `RunContext`.
  - `scenarioCtx` (`pipeline.ts:502-509`) — explicit `ScenarioContext` literal, does NOT
    spread `runCtx`.
  - `agentCtx` (`agent-loop.ts:146-155`) — explicit `AgentContext` literal, does NOT
    spread.
  - `baseCtx` (`improver.ts:91-100`) — explicit `IterationCompleteHookContext` literal.
  - The iteration contexts (`pipeline.ts:338-342` and `437-443`, and the
    `runAfterAllScenarios`/`fireAfterIteration` contexts) **spread `...args.runCtx` /
    `...runCtx`**, so they inherit `skipped` automatically — no change needed.

  For this task, thread the value to each explicit literal: add a `skipped:
  ReadonlyArray<SkippedAgent>` field to the params that feed each site
  (`ScenarioRunArgs` → `scenarioCtx`; `RunAgentsParams`/`RunAgentPairParams` →
  `agentCtx`; `RunImprovementParams` → `baseCtx`) and set `skipped: []` at any call site
  not yet fed by the classifier. Task 6 replaces those `[]` values with
  `runnability.skipped`.

**Depends on.** Task 2 (`SkippedAgent` type).

**Traces to.** `RunContext.skipped` readonly, present from construction before
`beforeAll`, same data as the report array, no new mandatory callback (spec R10.1, R10.5,
AC9; design §4.2). Honors review note (3): typed with the new `AgentRole`, not provider
`Role`.

**Acceptance.**
- `npm run typecheck` is clean — every `RunContext` literal compiles with the new
  required field. (This is the primary gate; the field's runtime value is exercised in
  Task 6's tests.)
- Quick compile-only assertion via existing tests: the smoke/loop tests still build and
  pass (they construct the pipeline which constructs `runCtx`).
- No behavioral test here; this task is the type plumbing that Task 6 consumes.

---

## Task 6 — Wire the classifier into `runPipeline`: judge-stop, dead lane, improver-halt, report passthrough, `runCtx.skipped`

**Goal.** Run the classifier up front and act on each consequence: stop the run for a
misconfigured judge before any hook/report; exclude misconfigured test agents from the
tracker and the agent loop without mutating config; halt after the current iteration for
a misconfigured improver and suppress the final-pass sweep; put the skipped set on
`runCtx`; pass it through `writeRunReport`.

**Files.**
- `src/pipeline/pipeline.ts` (modify `runPipeline`, `runOneIteration` plumbing,
  `runScenario` if needed for `scenarioCtx.skipped`)
- `src/__tests__/skip-misconfigured.test.ts` (new — full-pipeline behavior via `run()`)
- New fixtures under `src/__tests__/fixtures/` (see below)

**Changes (all inside `runPipeline` unless noted).**
- **Run the classifier up front.** After `resolveSelfImprovement` (line 84) and before
  constructing `runCtx`/`tracker`, call
  `const runnability = classifyRunnability(config, process.env);`.
- **Judge-stop (`STOP_RUN`) before any hook/report.** If the judge id is misconfigured
  (`!runnability.judgeRunnable`, and `decide` for that id yields `STOP_RUN`), print a
  single clear message naming the judge agent id and the reason (the `skipped` entry for
  the judge id carries the reason), and `return 2;` **directly** — before constructing
  the tracker, before the iteration loop, before any hook fires, before any report is
  written. Use `console.error`/`console.log` consistent with how the runner surfaces
  user-facing messages; do NOT throw (throwing routes to the runner's
  `PreconditionError/UserFacingError → 1` path, the wrong class). Determine "is the
  judge's consequence STOP_RUN" via the seam: find the judge id's `SkippedAgent` entry
  and call `decide(entry.roles)`; STOP_RUN means stop. (Because most-severe is computed,
  a judge that is also a test agent still stops — multi-role.)
- **`runCtx.skipped`.** Set `skipped: runnability.skipped` on the `runCtx` literal
  (line 100-106) at construction, so every derived/spread context and `beforeAll` see it.
- **Dead lane (`EXCLUDE_LANE`) — apply the runnable allowlist UNCONDITIONALLY at both
  read sites, every iteration and mode** (honors review note (1)):
  - **Tracker init** (lines 108-117): build per-scenario `agentIds` from
    `runnability.runnableTestAgentIds` instead of
    `config.roles.test.agents.map((a) => a.id)`. So a misconfigured test agent never
    becomes a tracker column (keeps the live re-render math unchanged).
  - **Agent loop**: the runnable id set is a run-scoped allowlist applied at `runAgents`
    **whether or not** a per-scenario `agentFilter` exists. Thread
    `runnableTestAgentIds` down through `runOneIteration` → `runScenario` →
    `runAgents`. At the `runAgents` call site (or by combining before the call), the
    effective filter is: **intersect** the runnable allowlist with any existing
    per-scenario `agentFilter[scenario.name]`; when no per-scenario filter exists, the
    effective filter is the runnable allowlist itself. Do this by computing the
    per-scenario `agentIdFilter` passed to `runScenario`/`runAgents` as
    `existingFilter === undefined ? runnableTestAgentIds : existingFilter.filter(id =>
    runnableSet.has(id))`. **Never mutate `config`.** Reuse the existing `agentIdFilter`
    mechanism in `agent-loop.ts` unchanged.
    - Concretely: add a `runnableTestAgentIds: string[]` field to
      `RunOneIterationParams` and `ScenarioRunArgs`, pass it through both
      `runOneIteration` calls (the main loop and the final-pass sweep), and apply the
      intersection where `agentFilter: args.agentFilter?.[s.scenario.name]` is currently
      computed (`pipeline.ts:374`).
- **Improver-halt (`HALT_AFTER_ITERATION`).** Gate both improver sites on
  `runnability.improverRunnable`:
  1. The in-loop improver branch (lines 188-208): add `&& runnability.improverRunnable`
     to the condition, so no `runImprovement` call (no skill edit) is attempted when the
     improver is misconfigured.
  2. The extra final-pass sweep (lines 215-220): add `&& runnability.improverRunnable`
     to the condition, so the unchanged failing matrix is not re-run (a misconfigured
     improver made no edits; re-running would be wasted and a forbidden further
     iteration).
  - The current iteration still runs to completion normally (test agents + judge produce
    a complete matrix); the loop simply halts after it. The improver id is already in
    `runnability.skipped`, which forces exit `2` via the report.
- **Report passthrough.** Both `writeRunReport(runDirectory, runId, mergedScenarios)`
  calls (lines 182 and 243) gain the 4th arg `runnability.skipped`.
- **Degenerate all-misconfigured case.** No special branch — when
  `runnableTestAgentIds` is empty the loop runs, `runAgents` becomes `Promise.all([])`,
  scenarios aggregate to not-all-pass, and the non-empty `skipped` array forces exit `2`
  via `prepareSummary` (Task 4). Confirm by test, not by adding a short-circuit.
- **Explicit-literal contexts get the real value.** The explicit context literals Task 5
  seeded with `skipped: []` (`scenarioCtx`, `agentCtx`, improver `baseCtx`) now receive
  `runnability.skipped`. Thread it through the params feeding each: `ScenarioRunArgs` →
  `runScenario`'s `scenarioCtx`; `RunAgentsParams`/`RunAgentPairParams` → `agentCtx`
  (so `beforeTestAgent`/`afterTestAgent` see the skipped set); `RunImprovementParams` →
  `baseCtx`. The improver only constructs `baseCtx` when it runs (not when
  misconfigured), but thread it anyway so no consumer ever reads a stale `[]`. Keep this
  minimal: one new field per params object, read straight onto the literal.

**Fixtures (new, under `src/__tests__/fixtures/`).** Reuse the `mock` + `openai-api`
combination so everything runs without credentials. Suggested fixtures (mirror
`smoke-project` layout — `skillsmith.config.ts`, one scenario, one rubric, one skill):
- `skip-test-project` — test agents `["mock-ok", "gpt"]` where `mock-ok` is `mock` and
  `gpt` is `openai-api`; judge + improver are `mock`; `mode: "test-only"`; one or two
  scenarios. Used for: one misconfigured test agent among several (exit 2, runnable agent
  graded normally, skipped agent in no cell), all-misconfigured (a variant config with
  only `gpt` as the sole test agent).
- `skip-judge-project` — judge is `openai-api` (`gpt`), test agents `mock`. Used for:
  judge stops the run.
- `skip-improver-project` — `mode: "self-improvement"`; improver is `openai-api`;
  test/judge are `mock`; use the `MOCK_GATE`-style failing skill so iteration 1 fails and
  would normally trigger another iteration. Used for: improver finishes the iteration
  then halts.
- `skip-multirole-project` — one id used as **both** judge and a test agent, backed by
  `openai-api`. Used for: most-severe (run stops like the judge case).
- For exit-code precedence (skip + genuine fail): reuse `skip-test-project` with a
  scenario the `mock` judge fails (use the `MOCK_GATE` fail path or a rubric the mock
  fails) plus the `gpt` skip → expect exit `2` and both signals in the report.

  Keep the test deterministic and credential-free: delete `OPENAI_API_KEY` for the
  duration of each `run()` and restore it afterward (save/delete/restore around the
  `await run(...)`, like `withEnv`).

**Depends on.** Tasks 2, 3, 4, 5.

**Traces to.** Classifier up front; judge-stop `return 2` before any hook/report; dead
lane via the `agentIdFilter` pattern without config mutation; improver halt-after-current
+ finalPass suppression; degenerate all-misconfigured; report passthrough; `runCtx`
push; multi-role most-severe (spec R3.1–R3.4, R5.5, R6.1–R6.4, R7-adjacent, R9, R10.1,
R11.1; design §5, §6.1–§6.5, §7.1). Honors review note (1): unconditional allowlist at
`runAgents` every iteration/mode.

**Acceptance.** `src/__tests__/skip-misconfigured.test.ts` driving `run({ cwd })` with
`OPENAI_API_KEY` deleted for the run, asserting against the captured console output and
`${runDir}/report.json`:
- **One misconfigured test agent among several** (`skip-test-project`): exit `2`; the
  runnable `mock-ok` agent has cells and is graded; the `gpt` agent has **no** cell in
  any scenario report (`report.json` scenarios contain no `gpt` agent key, and no
  `workspace/.../gpt` dir was created); the verdict math equals a run configured with
  only `mock-ok`; `report.json` top-level `skipped` contains `gpt` with reason
  `"OPENAI_API_KEY is not set"`.
- **No provisioning for the skip:** add a `beforeTestAgent` hook to the fixture that
  records which agent ids it fired for (e.g. writes a file under the run dir) and assert
  it never fired for `gpt`. (Mirrors the dead-lane "no provisioning" property.)
- **All test agents misconfigured** (variant config, sole `gpt` tester): exit `2`; the
  skip is surfaced; no `RUN RESULT: PASS`; the matrix is empty/non-passing.
- **Judge stops the run** (`skip-judge-project`): exit `2`; the captured output contains a
  single clear message naming the judge id and reason; **no** `report.json` is written at
  the run root (assert the file does not exist), no graded matrix, and the run-root
  `run.log`/iteration dirs are not produced by a graded sweep. Assert `beforeAll` did not
  fire (e.g. a `beforeAll` hook in the fixture that writes a marker file — assert absent).
- **Multi-role most-severe** (`skip-multirole-project`): same outcome as the judge-stop
  case (exit `2`, run stops, single message), confirming the id-as-both-judge-and-test
  case stops the run.
- **Improver finishes the iteration, then halts** (`skip-improver-project`): the first
  iteration completes and produces a valid matrix (assert `iteration-1/report.json`
  exists and is a real graded matrix); **no** `iteration-2` directory; no improver
  transcript (`iteration-1/improvement.md` absent); the merged matrix + verdict stand;
  exit `2`; the improver id surfaced in `report.json` `skipped`.
- **Exit-code precedence** (skip + genuine fail): exit `2`; `report.json` carries both
  the surviving agent's failure in `scenarios` and the skipped agent in top-level
  `skipped`.
- All existing tests (`smoke.test.ts`, `self-improvement-loop.test.ts`,
  `summary.test.ts`, etc.) still pass — a run with no misconfigured agent is unchanged.

---

## Task 7 — `testing-project`: misconfigurable agent, e2e forwarding, and the playwright project-name fix

**Goal.** Make the worked reference consumer drive Playwright from the runnable set and
add a deterministically-misconfigurable agent, and fix the pre-existing
`playwright.config.ts` project-name bug.

**Files.**
- `testing-project/playwright.config.ts` (fix project name)
- `testing-project/eval/utils/verify-e2e.ts` (add `runnableAgentIds` param + `--project`
  forwarding)
- `testing-project/skillsmith.config.ts` (add the `openai-api` agent; `afterAllScenarios`
  reads `ctx.skipped` and forwards runnable ids)

**Changes.**
- **`playwright.config.ts` (line 23).** `config.roles.test.agents` is an array of
  `AgentDefinition` objects, so the current `.map((agentId) => ({ name: agentId, ... }))`
  sets each project `name` to the **object**, not the id string. Fix to
  `config.roles.test.agents.map((agent) => ({ name: agent.id, metadata: { agentId:
  agent.id } }))`. Keep the standalone project list as **all** configured test agents (so
  a bare `npx playwright test` still defines every project); the in-run restriction is
  purely via forwarded `--project` selectors.
- **`verify-e2e.ts`.** `runE2eVerification(iterationDirectory, scenarios)` (line 30-33)
  gains a **third parameter** `runnableAgentIds: string[]`. When building the spawned
  `playwright test` command (the `execFileSync("npm", ["run", "test:e2e", "--",
  ...e2eSpecs], ...)` at lines 129-133), append `--project <id>` per runnable agent id.
  Use the **defensive intersection**: forward only runnable ids that are also configured
  project names (so an "unknown project" error cannot arise). The configured project
  names are the test-agent ids from the imported config; intersect
  `runnableAgentIds` with those before forwarding. Pass them as additional CLI args after
  the specs (Playwright accepts repeated `--project` flags). If the intersection is
  empty, forward no `--project` flags only if there is genuinely nothing runnable — but
  in the normal path at least the configured runnable agent is present; do not special-
  case beyond the intersection.
- **`skillsmith.config.ts`.**
  - Add an `openai-api`-backed test agent (e.g. id `gpt`) to the `agents` map and to
    `roles.test.agents` alongside `haiku`. It is misconfigured exactly when
    `OPENAI_API_KEY` is unset (the real classifier predicate via `requiredEnv`).
  - Update `afterAllScenarios` (lines 54-57): it currently destructures `{ scenarios,
    iterationDirectory }`. Also read `skipped` from the ctx (`ctx.skipped`), derive the
    **runnable** test-agent ids = configured test-agent ids minus the ids in `skipped`
    whose `roles` include `"test"`, and pass them as the new third arg to
    `runE2eVerification(iterationDirectory, scenarios, runnableAgentIds)`. Keep the
    existing return shape (`failures.length > 0 ? { failures } : true`).
  - Do not change the `beforeTestAgent` scaffold hook or other config.

**Depends on.** Tasks 2, 5, 6 (the `RunContext.skipped` field and its real value must be
on the hook context before this consumer reads `ctx.skipped`). Note `verify-e2e.ts`
imports `RunScenario`/`VerificationFailure` from `skillsmith` (the built package); the
`ctx.skipped` field is available on the in-process hook context at runtime regardless of
the package's published types — but to keep `tsc` clean in `testing-project`, confirm the
`skipped` field is part of the exported `RunContext` type (it is, via `src/index.ts`
re-export of `RunContext` from `config/types.ts`).

**Traces to.** Misconfigurable agent in testing-project; `afterAllScenarios` forwards
runnable ids via `--project` to the Playwright child; fix `playwright.config.ts:23` to
`name: agent.id`; e2e harness excludes a misconfigured agent (spec R10.2, R10.4, R10.5,
AC10; design §10.1, §10.2, §10.3, §10.4).

**Acceptance.** This consumer's full e2e path requires wp-env + Playwright and a built
`skillsmith` package, so it is **not** run in the unit suite. Verify what is statically
and unit-checkable, and document the manual check:
- **Type/lint:** `npm run typecheck` and `npm run lint` are clean for the repo; the
  `testing-project` config and `verify-e2e.ts` compile (the new third param is typed
  `string[]`; `ctx.skipped` resolves against the exported `RunContext`).
- **Unit-test the runnable-id derivation and `--project` forwarding in isolation.** Add a
  small unit test for the pure pieces if `verify-e2e.ts` is factored to expose them, OR
  add a unit test asserting the derivation logic used in `afterAllScenarios` (configured
  ids minus test-skipped ids) given a sample `ctx.skipped`. Prefer extracting the
  `--project` argument assembly into a small pure helper in `verify-e2e.ts` (e.g.
  `projectArgs(runnableAgentIds, configuredProjectNames): string[]`) and unit-testing it:
  - `projectArgs(["haiku"], ["haiku","gpt"]) === ["--project", "haiku"]`.
  - `projectArgs(["haiku","gpt"], ["haiku","gpt"])` forwards both.
  - An unknown runnable id is filtered out (`projectArgs(["haiku","ghost"],
    ["haiku","gpt"]) === ["--project","haiku"]`).
- **`playwright.config.ts` project name:** add a unit-style assertion (in
  `testing-project` or as a static check) that each generated project's `name` is a
  string equal to the agent id, not an object. If a unit harness is impractical in
  `testing-project`, document the one-line manual verification:
  `node -e "import('./playwright.config.ts')..."`-style check that `projects[0].name`
  is a string.
- **Manual end-to-end (documented in the task, not automated):** with `OPENAI_API_KEY`
  unset, a `testing-project` run skips `gpt` — no Playwright project/plugin/spec for it,
  the merged report attributes no e2e failure to it, the runnable `haiku` e2e runs, and
  the run exits non-zero with `gpt` surfaced; with `OPENAI_API_KEY` set, `gpt`'s project
  is created and included. State this as the acceptance the change satisfies even though
  it is gated on wp-env.

---

## Dependency summary

```
Task 1 (Provider.requiredEnv)
   └─> Task 2 (classifier + decide seam)
          ├─> Task 3 (writeRunReport passthrough)
          │      └─> Task 4 (prepareSummary exit 2 + skip block)   [also needs Task 2 type]
          ├─> Task 5 (RunContext.skipped type)
          └─> Task 6 (pipeline wiring)   [needs 2,3,4,5]
                 └─> Task 7 (testing-project consumer)   [needs 2,5,6]
```

Strict dispatch order: **1 → 2 → 3 → 4 → 5 → 6 → 7.** Tasks 3, 4, 5 all sit on Task 2 and
could in principle interleave, but the linear order above keeps each task building cleanly
on a green tree (Task 4 reads the report shape Task 3 writes; Task 6 consumes all of
2–5).

## Cross-cutting checks (every task)

- `npm run test`, `npm run typecheck`, `npm run lint` green before commit.
- No internal-process vocabulary anywhere in shipped code/comments/tests/docs.
- A run with no misconfigured agent is byte-for-byte unchanged: same matrix, verdict,
  hook firings (set and order), CLI output, exit code. The empty-`skipped` path must be
  inert — verified by the unchanged existing tests (`smoke`, `self-improvement-loop`,
  `summary`) continuing to pass at every task.
