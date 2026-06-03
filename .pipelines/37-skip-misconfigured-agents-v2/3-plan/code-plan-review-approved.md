# Code plan review — APPROVED

Adversarial review of `3-plan/code-plan.md` (Tasks T1–T9, revised) against the
approved `2-design-doc/design-doc.md` and `1-spec/spec.md` (R1–R7 / AC1–AC6 /
Out of Scope). This is review iteration 2; iteration 1 rejected on a single
blocking issue (B1). All file/symbol anchors were re-verified against the live
source in this worktree.

Verdict: **Sound and complete.** B1 is genuinely fixed, the two non-blocking
notes (N1/N2) are handled, and a fresh full pass finds no new blockers. Ready to
hand to implementers as-is.

---

## B1 is genuinely fixed — the improver-degrade case now discriminates

The iteration-1 rejection was that Task 7's improver-degrade case passed whether
or not Task 5's degrade logic existed. Re-traced against the live runtime:

- `runPipeline` breaks the loop on `if (mergedPass) break;`
  (`pipeline.ts:212`) for **both** modes, and the improver only runs under
  `!mergedPass && i < maxIterations && mode === "self-improvement"`
  (`pipeline.ts:188-192`). With an all-pass iteration-1 matrix, "one iteration",
  "no `improvement.md`", and "exit 0" are all true **with or without** the
  degrade. So those assertions alone cannot catch a degrade regression.

The revised plan fixes this by giving the degrade a dedicated, branch-gated
observable signal and asserting on it:

- **Task 5 (lines 319–330)** now *requires* a single `console.log` degrade line
  that writes `plan.improver.reason` verbatim (carrying
  `MISCONFIGURED_REASON_PREFIX` + the variable name, e.g.
  `"misconfigured: OPENAI_API_KEY is not set"`). This line fires **only** inside
  the `if (plan.improver.degrade)` branch, so it exists in the degraded world and
  not in the non-degraded world. Task 5's acceptance (lines 352–356) makes this
  explicit: "if the degrade path is removed, the line disappears and that
  assertion fails."
- **Task 7 (lines 446–474)** sets the fixture to
  `{ mode: "self-improvement", maxIterations: 3 }` (`> 1`), **captures** stdout
  (push each `console.log`'s joined args — not the silence idiom), and asserts in
  order: (1) at least one captured line matches
  `/misconfigured: OPENAI_API_KEY is not set/` — the discriminating assertion;
  (2) `existsSync(iteration-1/improvement.md) === false` — the improver-ran
  artifact (`self-improvement-loop.test.ts:81-84`) is absent; (3) exactly one
  iteration despite `maxIterations: 3` (`run.json.iterations.length === 1`,
  single `iteration-1`, no `iteration-2`); (4) `exitCode === 0`.

I traced both worlds against the real code:

- **Degrade present:** `plan.improver.degrade === true` →
  `selfImprovement = { ...selfImprovement, mode: "test-only" }` →
  `maxIterations` collapses to 1 (`pipeline.ts:118-119`) → iteration 1 all-pass,
  break at 212; the degrade `console.log` fires. Assertion (1) passes.
- **Degrade absent (Task 5 unwritten):** mode stays `"self-improvement"` →
  `maxIterations = 3`; iteration 1 still all-pass and breaks at 212; no degrade
  `console.log` is ever emitted. **Assertion (1) fails.**

The plan's own "Note on discrimination" (lines 470–474) correctly states that
assertion (1) (the surfaced degrade line), backstopped by (2) (no
`improvement.md`), is what makes this case fail if Task 5's degrade logic is
removed — and that the single-iteration count alone is insufficient because of
the `mergedPass` break. With `maxIterations > 1` set on the fixture, "one
iteration" is a real consequence of the test-only collapse, not the default.
B1 is resolved as required.

---

## Non-blocking notes from iteration 1 are handled

- **N1 — `agentRunnable` throws on an unknown id.** Task 1 (lines 60–69) now
  documents this as the public contract: an `agentId` absent from
  `config.agents` makes the `.provider` access throw; internal callers are safe
  because they only pass ids from `config.roles.test.agents`, which config
  validation guarantees reference real agents (`config/validate.ts:130-132`,
  verified). It explicitly forbids coercing an unknown id to `false` (which would
  mask a config error). Task 1's acceptance (lines 124–126) makes the throw
  testable. Handled as a documented, intentional public-surface choice.
- **N2 — `writeAgentReport` arg order.** Task 4 (lines 240–249) states the
  signature `writeAgentReport(agentDirectory, testing, review)`, that it persists
  `{ testing, review }` (verified `agent-loop.ts:298-308`), and warns not to swap
  the second (`{ duration: 0 }`) and third (`{ skipped: reason }`) args. Handled.

---

## Fresh full pass (anchors, ordering, coverage, mechanism, constraints)

**Anchors are real (re-verified live):**

- `src/policy/` does not yet exist (T1 is a genuinely new isolated module).
- `src/index.ts:34` is `export { run } from "./runner";`; the two runnability
  predicates are not yet exported (T2 is additive). `ProviderId` is exported
  `type`-only at `index.ts:32`, so T1's `import type` discipline is achievable.
- `runAgents`@`agent-loop.ts:66`; `agentIdFilter` narrowing @81-86;
  `runAgentPair` `Promise.all`@94; `mkdirSync(agentWorkspace…)`@144 (so excluding
  an agent from `Promise.all` creates no `workspace` dir — AC2.2);
  `writeAgentReport`@298 (already `mkdirSync`es internally, so T4's extra mkdir is
  harmlessly redundant).
- `pipeline.ts`: `resolveSelfImprovement`@84; `maxIterations`@118-119 (collapses
  to 1 when mode is `"test-only"`); outer `try`@141; improvement guard@188-192;
  `mergedPass` break@212; final-sweep guard@215-220. A single T5 insertion right
  after line 84 satisfies both "before `maxIterations`" and "before the outer
  `try`" — no conflict. `UserFacingError` is already imported.
- testing-project: `skillsmith.config.ts` has `agents: { haiku, opus }` and
  `roles.test.agents: ["haiku"]` (T6 targets these); `playwright.config.ts:23-26`
  is the exact `projects` map T8 replaces, and its default-imported `config` is
  the raw `SkillsmithConfigInput` (`defineConfig` identity), which
  `runnableTestAgentIds` accepts.

**Types check out:** `SkillsmithConfigInput.agents:
Record<string, AgentDefinitionInput>` with `.provider`; raw
`roles.test.agents: string[]`; normalized `SkillsmithConfig.roles.test.agents:
AgentDefinition[]`, `judge/improver.agent: AgentDefinition`
(`config/types.ts:25-29,56-59,69-73,99-121`). `ProviderId` union is exactly
`claude-code | openai-api | anthropic-api | gemini-api | codex | mock`
(`providers/types.ts:3-9`). `ResolvedSelfImprovement.mode` is a mutable `RunMode`
on a fresh object (`config/self-improvement.ts:3-8,44-49`), so the T5
reassignment is type-legal. All four T1 signatures are sound.

**The marker-row anti-regression genuinely threads to exit 1, all-excluded guard
preserved:** `aggregateScenarioReport` enumerates agent subdirs from disk and
copies `body.review` verbatim (`scenario-report.ts:53-79`); the scenario all-pass
requires every agent's `classifyVerdict(review).kind === "PASS"`
(`scenario-report.ts:82-92`); `classifyVerdict` maps `{ skipped: string }` →
`SKIPPED` with no change (`verdict.ts:20-28`); `isRowPass` requires every cell
PASS (`summary.ts:309-317`); `prepareSummary` returns `exitCode: allPass ? 0 : 1`
with `allPass = rows.length > 0 && rows.every(isRowPass)` (`summary.ts:64-76`).
A SKIPPED marker forces exit 1; when *all* test agents are excluded every cell is
SKIPPED, so the matrix is non-green for free (R3.4 implicit). `failureLines`
surfaces `SKIPPED <reason>` to the human summary (`summary.ts:331-333`), and the
`"misconfigured: "` prefix machine-distinguishes the row from a FAIL (no
`skipped` key) and from the testing-failure skip (`"testing failed: "`) — AC2.4.

**Judge stop is correctly placed and not swallowed (R4.1/AC3.1):** the throw
before the outer `try` (line 141) fires no `finally`/`afterAll`, writes no
`report.json`, never reaches `prepareSummary`; `run()` catches `UserFacingError`,
prints, returns 1. T7's judge-stop case asserts `existsSync(runId/report.json)
=== false`, distinguishing the stop from a FAIL matrix.

**Ordering is a valid single sequential shared tree:** T1 (no deps) → T2/T3
(→T1), T4/T5 (→T1), T6 (independent), T7 (→T1/T4/T5), T8 (→T2/T6), T9
(→T4/T5/T6/T8). No task depends on later work.

**Per-task acceptance is concrete**, including T9's real `npx skillsmith counter`
path (`bin.skillsmith` exists in `package.json`) with `OPENAI_API_KEY` unset, plus
an explicit deterministic fallback (unit suites + a direct
`runnableTestAgentIds` check excluding `openai-api-nano` when the key is absent,
including it when present — AC5.2). `npm test` globs `src/__tests__/*.test.ts`, so
the two new test files are picked up automatically. The `mock` provider defaults
to PASS for fixtures without `MOCK_GATE` (`providers/mock.ts`), backing T7's "mock
runs and PASS" claim; the `judge-skip-project`/`smoke-project` fixtures the plan
copies from exist.

**Constraints honored:** new logic isolated to one SDK-free module with a
type-only provider import (T1 acceptance greps for it); no policy-name string
literal and no `if (policy === …)` branching at any call site (AC4.1); `SKIPPED`
reused rather than a new verdict kind; no `"warn"`/`"fail"`/`"skip"` implemented
and no scope creep into those policies; `prepareSummary`/`isRowPass`/
`classifyVerdict`/`writeAgentReport`/`mergeIntoRunningReport` signatures
untouched; no internal-process vocabulary in shipped deliverables; the
`Traces to`/`Depends on` plan fields are plan-only by instruction.

**Coverage:** every R# and AC# maps to a task — R1→T1/T3; R2→T1 (structural);
R3→T4/T7; R4→T5/T7; R5→T1/T2/T8; R6→T6/T8/T9; R7→all; AC1→T3; AC2→T4/T7/T9;
AC3→T7; AC4→T1; AC5→T8/T9; AC6→all. No requirement dropped; the iteration-1 gap
(AC3.2 test strength) is closed.

---

## Bottom line

B1 is genuinely resolved (the improver-degrade test now fails if Task 5's degrade
logic is absent), N1/N2 are handled, and a fresh adversarial pass surfaces no new
blockers. The plan is sound, complete, and implementable as written. **Approved.**
