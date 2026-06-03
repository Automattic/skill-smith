# Code review — APPROVED (iteration 1)

**Reviewer:** code-reviewer (adversarial, single-shot, whole batch)
**Range reviewed:** `git diff 226be20..HEAD` (HEAD = `1d635e7`), 8 code commits (T1–T8); T9 verification-only.
**Verdict:** Sound and complete. I would ship this diff.

---

## Build / quality gate (run by me)

- `npm run typecheck` — **clean** (tsc --noEmit, no errors).
- `npm run lint` — **exactly 3 pre-existing errors**, all `noControlCharactersInRegex` on trunk
  (`src/progress/tracker.ts:358`, `src/__tests__/progress-tracker.test.ts:141` ×2). Plus 6 pre-existing
  warnings (`docs/styles.css`, `src/__tests__/progress-render.test.ts`) — none of these files are in the
  diff, so all are baseline, not regressions.
- `npm test` — **152 tests / 150 pass / 0 fail / 2 pre-existing skips**. (The `# failures (1):` line in
  stdout is a fixture's own printed run summary, not a test-runner failure — there are zero `not ok` lines.)

The diff touches only the expected 24 files (1 new module, barrel, 2 pipeline files, 2 test files, 16
fixture files, 2 testing-project files). No scope creep.

## Central anti-regression (R3.3 / R3.4) — traced in the real code

Confirmed the full chain that forces a non-zero exit when a test agent is excluded:

1. `runAgents` (`src/pipeline/agent-loop.ts:99-117`) calls `decideRunnability`, intersects the plan with the
   already-`agentIdFilter`-narrowed set, runs only the runnable subset through the unchanged `runAgentPair`,
   and for each excluded agent writes `writeAgentReport(agentDirectory, { duration: 0 }, { skipped: reason })`
   (correct arg order: `testing` then `review`) — no invoke, no `beforeTestAgent`/scaffold hook, no workspace.
2. `aggregateScenarioReport` (`src/reports/scenario-report.ts:53-92`) reads the marker file from disk into the
   scenario's `agents` map; `classifyVerdict({ skipped: string })` → `SKIPPED` (`src/reports/verdict.ts:26-28`,
   **unchanged**); scenario `pass` becomes false.
3. `agentsAllPass` (`src/reports/iteration-report.ts:185`) and `isRowPass` (`src/reports/summary.ts:314`) both
   treat non-PASS as failing; `prepareSummary` returns `exitCode = allPass ? 0 : 1` (`summary.ts:76`).
4. **All-excluded (R3.4):** every row is a SKIPPED marker → `isRowPass` false for every row → exit 1, no
   vacuous pass. Auto-preserved with zero extra code, exactly as designed.
5. **Survival across iterations (design §7.4):** `collectFailingAgents` (`select-scenarios.ts:90`) re-adds the
   excluded agent (SKIPPED ≠ PASS) to the re-run set; `runAgents` re-excludes+re-marks it together every
   iteration; `mergeIntoRunningReport` (`iteration-report.ts:130-139`) merges agent rows (new wins, untouched
   inherit) and recomputes `pass` — the marker is never dropped. Holds for `all` / `failed-scenarios` /
   `failed-pairs`.

The `runnability-roles.test.ts` cases assert this end-to-end and are genuine.

### Discrimination of the improver-degrade case — empirically demonstrated

I temporarily neutralized T5's improver-degrade branch (`if (plan.improver.degrade && false)`) and ran only
the improver test: it **FAILED** on assertion (1) — "the degrade reason naming OPENAI_API_KEY is surfaced on
stdout". I then `git checkout`-restored `pipeline.ts` to its committed state (verified clean tree). The test
is genuinely discriminating, not vacuous. (Assertions (1) and (3) discriminate; assertion (2)/no-`improvement.md`
alone does not, which the plan explicitly acknowledges — all three are kept.)

## Role-aware behavior (R4)

- **Judge stop** (`pipeline.ts:90-95`): throws the already-imported `UserFacingError` **before the outer `try`**
  (line 157) and **before `runDirectory` is created** (line 106-107). So no `finally`/`afterAll` fires, no
  `report.json` is written, and `prepareSummary` is never reached. `run()` catches `UserFacingError`, prints,
  returns 1 (`src/runner.ts:40-42`). Observably distinct from a graded matrix (no run report.json) — the
  `misconfigured-judge` fixture asserts exactly that.
- **Improver degrade** (`pipeline.ts:96-99`): sets `selfImprovement = { ...selfImprovement, mode: "test-only" }`
  before `maxIterations` is derived (line 134-135), which collapses iterations to 1 and switches off the
  improvement guards (line 204-208). Does **not** itself force non-zero (exit derives from the matrix). Emits the
  required `console.log("improver degraded to test-only — <reason>")` carrying the `"misconfigured: <VAR> is not
  set"` text — the sole observable signal for an all-pass degraded run.
- **Test agent** follows "warn" (R3) via the marker mechanism above.
- `ResolvedSelfImprovement` carries a `mode` field (`src/config/self-improvement.ts:4`, populated from top-level
  `config.mode`), so T5's mutation is type-correct and consistent with T7's fixtures (top-level `mode` +
  `selfImprovement: { maxIterations: 3 }`). The known intentional deviation is a correct adaptation.

## The seam (R2 / R5)

- `decideRunnability` (`src/policy/runnability.ts:81-114`) is the single decision point: **no policy-name string,
  no `if (policy === …)` branching**; "fail"/"skip" are not implemented but are localized future edits to its body.
  All four call sites only **read** the plan.
- `agentRunnable` / `runnableTestAgentIds` are exported from the barrel (`src/index.ts:35`), pure/synchronous over
  raw `SkillsmithConfigInput` + env; `agentRunnable` **throws on unknown id** (`runnability.ts:52-54`) rather than
  coercing to false. The module is SDK-free: the only `../providers` and `../config` imports are `import type`.
- `runnableTestAgentIds` drives **both** the runtime exclusion (via the shared `providerRunnable` atom inside
  `decideRunnability`) and the Playwright `projects` array — they agree by construction (R5.2).

## e2e (R6) and AC5

- `testing-project/skillsmith.config.ts` adds `openai-api-nano` (`provider: openai-api`, `model: gpt-4.1-nano`)
  and appends it to `roles.test.agents`. `testing-project/playwright.config.ts` derives `projects` from
  `runnableTestAgentIds(config, process.env)`.
- **AC5 fallback assessment:** the testing-project has no `node_modules` (no Playwright, no WP/browser stack, no
  linked `skillsmith` bin), so a real `npx skillsmith counter` run is **not feasible** here — T9's documented
  deterministic fallback is the correct choice. I exercised it: against the testing-project's exact agent
  declarations, `runnableTestAgentIds` returns `["haiku"]` with no `OPENAI_API_KEY` and `["haiku",
  "openai-api-nano"]` with it (AC5.1/AC5.2 PASS). The behavioral surfaces of AC5.1 that need a live run
  (no e2e-failure attributed to nano, no plugin/workspace, non-zero exit, misconfigured surfacing) are covered by
  the same `decideRunnability`/marker machinery proven in T7's deterministic suite. Adequate; a real run is not
  required and not feasible in this worktree.

## Constraints (R7)

- **Isolation (R7.1):** all new logic in one self-contained `src/policy/runnability.ts`, SDK-free runtime imports.
- **Minimal change (R7.2 / AC6.1):** the only incidental edit is `const`→`let selfImprovement`. No existing
  function signature removed or changed. `prepareSummary`/`isRowPass`, `classifyVerdict`, the `Provider` contract,
  tracker enums/counters, and `mergeIntoRunningReport`/reselection are untouched.
- **Sparse comments (R7.3 / AC6.3):** new comments are few and only on non-obvious code; the two pre-existing
  "acceptance" comments in `agent-loop.ts` and the "spec failure" comment in the testing-project config are
  **not** in the diff (unchanged-code comments untouched).
- **No process vocabulary (R7.4 / AC6.2):** grep across all shipped files for phase/spec/design/plan/acceptance-
  criteria/task-id vocabulary is clean. (Hits for `acceptance:` in scenario YAML, `e2e.spec.mjs` testMatch, and
  the pre-existing "spec failure" comment are domain terms / not in the diff.)
- The committed fixtures are only the 4 intended files each; the `.skillsmith/` run artifacts present locally are
  gitignored and not committed.

## Minor, non-blocking observation

- The `agentRunnable` unknown-id throw (Task 1 acceptance) is implemented and correct but has no dedicated unit
  test. Task 3's required assertions do not include it, so this is not a plan violation — noting only for future
  coverage.

## Conclusion

All requirements R1–R7 and acceptance criteria AC1–AC6 are met (AC5 via the appropriate, adequate deterministic
fallback). The central anti-regression is correct and the key role test is demonstrably discriminating. Gates are
green at the expected baseline. **Approved.**
