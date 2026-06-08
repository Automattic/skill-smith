# Code Plan Review — APPROVED

**Target:** `3-plan/code-plan.md`
**Reviewer:** code-plan-reviewer (adversarial)
**Verdict:** APPROVED — complete, correct/feasible against the real code, spec- and
design-faithful, well-ordered for one-at-a-time TDD dispatch on a single shared tree,
and every acceptance is exercisable without real credentials. Non-blocking notes below;
none gates implementation.

---

## How I reviewed

Read the plan against the approved spec (R1–R12, AC1–AC13), the approved design doc
(§1–§13) and its 3 clarity notes, then verified **every cited file / symbol / line
against the actual worktree** and re-walked each load-bearing mechanic through the real
control flow. Files inspected: `src/providers/types.ts`, `openai-api.ts`, `registry.ts`,
`mock.ts`; `src/reports/summary.ts`, `iteration-report.ts`, `scenario-report.ts`;
`src/config/types.ts`; `src/pipeline/pipeline.ts`, `agent-loop.ts`, `select-scenarios.ts`;
`src/improvement/improver.ts`, `verify.ts`; `src/runner.ts`, `src/index.ts`;
`src/progress/tracker.ts`; `testing-project/skillsmith.config.ts`, `playwright.config.ts`,
`eval/utils/verify-e2e.ts`; and the existing tests/fixtures (`smoke.test.ts`,
`self-improvement-loop.test.ts`, `summary.test.ts`, `vercel-providers.test.ts`,
`loop-project`, `smoke-project`, `judge-skip-project`).

## Cited code is real and accurate (spot-checks, all confirmed)

- `Provider = { readonly id; invoke }` at `types.ts:50-53`; `Role = "testing" | "judge"`
  at `:16` — so the plan's insistence (Task 2) that the new `AgentRole` is **distinct**
  from provider `Role` is correct and necessary (clarity note 3).
- `openai-api.ts:8` returns the exact string `"OPENAI_API_KEY is not set"` from `invoke`,
  so the classifier's reason `` `${requiredEnv} is not set` `` (Task 2) matches the
  runtime guard verbatim — descriptor and guard agree, as Task 1 requires.
- `prepareSummary` at `summary.ts:52-77` does `allPass = rows.length > 0 &&
  rows.every(isRowPass)` then `exitCode = allPass ? 0 : 1`; `loadRows` reads only
  `parsed.scenarios` (`:90`) and defaults via `scenarios ?? {}` (`:95`). The Task 4 rule
  `skipped.length>0 ? 2 : (allPass ? 0 : 1)` and the per-cell `SKIPPED`/`FAIL` colors at
  `:231-237` are exactly as the plan describes; the once-per-run block is genuinely
  separable.
- `writeRunReport(runDirectory, runId, scenarios)` at `iteration-report.ts:153-164`
  writes `{ runId, pass, scenarios }` and returns `pass` — Task 3's 4th-param passthrough
  is a clean additive edit; the two call sites are at `pipeline.ts:182` and `:243` as
  Task 6 states.
- `RunContext` at `config/types.ts:144-150`; the literal `runCtx` at `pipeline.ts:100-106`;
  `scenarioCtx` (explicit, non-spread) at `:502-509`; `agentCtx` (explicit) at
  `agent-loop.ts:146-155`; improver `baseCtx` (explicit) at `improver.ts:91-100`; and the
  iteration contexts that **spread** `...runCtx`/`...args.runCtx` at `pipeline.ts:338-342`
  and `437-443` — Task 5's enumeration of construction sites is exactly right, including
  which inherit `skipped` for free.
- Tracker init at `pipeline.ts:108-117` reads `config.roles.test.agents.map((a) => a.id)`;
  the in-loop improver branch at `:188-208`; the final-pass sweep guard at `:215-220`
  (`finalPass && lastWasSubset && mode==="self-improvement" && !mergedPass`). All
  gateable as Task 6 specifies.
- `agentIdFilter` plumbing: `ScenarioRunArgs.agentFilter?: string[]` (`pipeline.ts:490`),
  applied at `runScenario`'s `runAgents` call (`:527-539`), filtered in `runAgents`
  (`agent-loop.ts:81-86`). The reuse Task 6 relies on is real and unchanged.
- `playwright.config.ts:23` is `config.roles.test.agents.map((agentId) => ({ name:
  agentId, … }))` over `AgentDefinition[]` — the object-as-name bug is real; Task 7's
  `name: agent.id` fix is correct. `runE2eVerification(iterationDirectory, scenarios)` at
  `verify-e2e.ts:30` has exactly one caller, `afterAllScenarios` (config `:54-57`), whose
  ctx is `IterationCompleteHookContext extends RunContext`, so `ctx.skipped` resolves
  after Task 5. The spawned command is `execFileSync("npm", ["run","test:e2e","--",
  ...e2eSpecs], …)` at `:129-133` — appending `--project <id>` args is contained.
- `RunContext` is re-exported publicly via `index.ts:18`, so `testing-project`'s
  `ctx.skipped` (imported types from the package) resolves once the field is added —
  Task 7's `tsc`-clean claim holds.

## Mechanics I re-walked against the real flow

- **Judge-stop returns before any hook/report.** The classifier slots in after
  `resolveSelfImprovement` (`pipeline.ts:84`) and before the `runCtx`/`tracker`
  construction (`:100-117`); `beforeAll` fires inside `runOneIteration` (`:328-336`) and
  `afterAll` lives in the loop's `finally` (`:252-262`). A direct `return 2` from the top
  of `runPipeline` (before the `try`) means the tracker is never constructed,
  `tracker.finish()` is never reached, no `beforeAll`/`afterAll`, and no report — exactly
  AC7/R6.2. The runner maps only `PreconditionError`/`UserFacingError → 1` (`runner.ts:40-43`),
  so `return 2` (not throw) correctly avoids the unknown-provider→1 collision (R7/§9). The
  plan's explicit "do NOT throw" instruction is right and load-bearing.
- **Degenerate all-misconfigured → exit 2, no crash.** With an empty runnable set the
  tracker's per-scenario `agentIds` is `[]`; `tracker.ts:104` maps over `[]` (no columns)
  and `:286` does `total += 0` — no division, no crash. `runAgents` → `Promise.all([])`;
  `aggregateScenarioReport` finds no agent dirs → `agentsList.length === 0` → `allPass =
  false` (`scenario-report.ts:82-92`); the non-empty `skipped` array forces `2` first
  (Task 4). No special-case branch needed, confirming Task 6's "confirm by test, not by
  short-circuit." R5.5/AC5 satisfied.
- **Anti-regression (R5.4/AC12).** The skipped lane is absent from `scenarios`, so
  surviving rows can be all-PASS — but the non-empty top-level `skipped` array forces `2`
  through the single `prepareSummary` chokepoint. Threaded correctly; merely dropping a
  row cannot yield `0`.
- **Empty-`skipped` inertness (R11.1/AC13).** Task 4 defaults a missing `skipped` to `[]`
  (mirroring `loadRows`' `scenarios ?? {}`); Task 5/6 thread `skipped: []` to every
  explicit-literal context. The existing `smoke.test.ts`, `self-improvement-loop.test.ts`,
  `summary.test.ts`, and the hook-order recorder in `target-project` will catch any
  matrix/verdict/hook-order/exit-code drift — and the plan lists "set and order of hook
  firings" in its cross-cutting checks.

## Coverage — every requirement and AC has an implementing AND verifying task

| Req / AC | Task(s) | Verified by (acceptance) |
|---|---|---|
| R2.2/R2.3, AC1 | 1, 2 | `requiredEnv` assertions (T1); per-provider runnable/skipped + claude-code/mock-always-runnable (T2) |
| R1.1, R8.1/R8.2, R6.4/AC11 | 2 | `decide` table incl. multi-role most-severe; pure/sync/no-invoke assertion |
| R4.3, AC4(report) | 3 | top-level `skipped` sibling of `scenarios`; default-`[]` passthrough |
| R4.1/R4.2, R5.1–R5.5, AC4/AC5/AC12 | 4 | exit-2 rule, distinct block, precedence, empty-matrix, summary.txt mirror, unchanged no-skip path |
| R10.1/R10.5, AC9 | 5, 6 | typecheck gate (T5) + `runCtx.skipped` real value + `beforeTestAgent`-never-fired (T6) |
| R3.1–R3.4, AC2/AC3 | 6 | dead-lane: no cell, verdict == runnable-only run, no `gpt` workspace, hook never fired |
| R6.2, AC7 | 6 | judge-stop single message, no report.json, `beforeAll` marker absent |
| R6.3, AC8 | 6 | iteration-1 graded matrix exists, no iteration-2, no `improvement.md`, exit 2 |
| R7 | (preserved) | unchanged hard-abort path explicitly left alone; called out in conventions |
| R9 | (structural) | unchanged; classifier adds no uncontained throw — correctly not re-implemented |
| R10.2/R10.3/R10.4, AC10 | 7 | playwright.config fix, `projectArgs` unit cases, `ctx.skipped` derivation, documented manual e2e |
| R11.1/R11.2, AC13 | 4–6 + cross-cut | inert empty path; tracker columns from runnable set so live re-render unchanged |
| R12.1–R12.4 | all (conventions) | self-contained module, additive-only, sparse comments, no internal-process vocabulary |

No orphan requirement or AC. Every task block carries Goal / Files / Changes / Depends on
/ Traces to / Acceptance.

## Ordering & independence

`1 → 2 → 3 → 4 → 5 → 6 → 7` is correct: T2 needs T1's `requiredEnv`; T3 needs T2's
`SkippedAgent`; T4 reads the report shape T3 writes; T5 is the type plumbing T6 consumes;
T6 needs 2–5; T7 needs the real `ctx.skipped` value from 5+6. Each task is committable on
a green tree on its own — notably T5 makes `RunContext.skipped` non-optional and seeds
`skipped: []` at every explicit literal so `tsc` stays clean before T6 supplies the real
value. The dependency graph and the "single shared tree, dispatched sequentially" model
are respected.

## Fidelity (no scope creep)

- Ships **only** "warn"; "fail"/"skip" are localized future edits inside `decide` (+ the
  exit rule), explicitly not implemented (T2 comment instruction). 
- **No retroactive result-purge** — R3.4 treated as a setup-only-trivial invariant.
- Unknown provider stays a hard abort on its existing `PreconditionError → 1` path; the
  plan never turns it into a skip and reserves `2` for the credential class.
- R12.4 enforced in the deliverables: a dedicated convention forbids
  phase/spec/plan/acceptance-criteria/task-id vocabulary in shipped code, comments, tests,
  and docs; chosen names are plain domain terms (`skipped`, `runnable`, `misconfigured`,
  `AgentRole`, `Consequence`). The "Traces to" lines that *do* carry R/AC ids live only in
  the plan document, not in shipped artifacts.

## Clarity notes — all three honored explicitly

1. **Runnable allowlist applied unconditionally at `runAgents` every iteration/mode.**
   Task 6 computes the per-scenario filter as `existingFilter === undefined ?
   runnableTestAgentIds : existingFilter.filter(id => runnableSet.has(id))` — i.e. the
   allowlist applies whether or not a per-scenario `agentFilter` exists, and intersects
   when one does. This is exactly the fix the note asked for (the bare-`config.roles.test.agents`
   read at `agent-loop.ts:81-86` for iteration-1 / `all` / `failed-scenarios` is now
   never reached unfiltered).
2. **`prepareSummary` defaults a missing `skipped` to `[]`** — Task 4 states it and ties
   it to R11.1 fidelity.
3. **`AgentRole` distinct from provider `Role`** — Task 2's naming section forbids reusing
   the provider type; verified the two are genuinely different unions in the code.

## Test strategy — credential-free throughout

The fixture strategy (`mock` always-runnable + `openai-api` misconfigured iff
`OPENAI_API_KEY` unset, with save/delete/restore around each `run()` mirroring
`vercel-providers.test.ts:53-65`'s `withEnv`) is sound: detection is a pure env read and a
skipped lane never invokes the provider, so no model call ever fires. Task 2's classifier
tests pass an explicit `env` record (no process mutation at all). Pipeline tests drive
`run({ cwd })` exactly as `smoke.test.ts`/`self-improvement-loop.test.ts` already do, and
fixture configs are dynamically imported by `loadConfig` (`config/load.ts:21`) so the
env-unset state is observed at run time. Task 7 correctly gates the real wp-env/Playwright
e2e as a documented manual check and unit-tests the pure `projectArgs` derivation instead.

---

## Non-blocking notes (clarity only — do not gate implementation)

1. **Fixture name collision risk.** An existing fixture is named `judge-skip-project`
   (it exercises the unrelated "testing failed → judge skipped" branch via
   `mock-fail-testing`). Task 6 introduces `skip-judge-project`. The two names differ only
   by word order and are easy to confuse. Suggest the code-writer pick a clearly distinct
   name (e.g. `misconfigured-judge-project`) to avoid a maintainer mixing them up. Purely
   cosmetic.

2. **Task 7 acceptance phrased as "extract helper OR assert derivation."** The plan says
   "prefer extracting `projectArgs(...)`" but leaves the alternative open. Extracting the
   pure helper is the stronger, more testable path and makes the three example assertions
   concrete; recommend the code-writer take the "prefer" branch rather than the looser
   alternative. Not blocking — either satisfies R10.2/AC10's unit-checkable portion.

3. **Judge-stop output channel.** Task 6 says "use `console.error`/`console.log`
   consistent with how the runner surfaces user-facing messages." The runner uses
   `console.error` for `PreconditionError`/`UserFacingError` (`runner.ts:41`). For the
   test that captures the judge message, the code-writer should be consistent about which
   stream it writes to and capture that same stream. A one-line decision, not a design
   change.

None of the above changes a task, an ordering, or a mechanism. The plan is buildable as
written.
