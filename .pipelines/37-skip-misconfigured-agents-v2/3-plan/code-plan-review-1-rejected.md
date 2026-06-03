# Code plan review 1 — REJECTED

Adversarial review of `3-plan/code-plan.md` (Tasks T1–T9) against the approved
`2-design-doc/design-doc.md` and `1-spec/spec.md` (R1–R7 / AC1–AC6 / Out of
Scope). Verified file/symbol anchors against the live source in this worktree.

Verdict: **Needs changes.** The plan is structurally sound and almost
implementable as-is — anchors are real, ordering is valid, and the central
anti-regression mechanism is correct — but **one acceptance criterion (AC3.2,
improver degrade) is covered by a non-discriminating test**: the test passes
whether or not the degrade logic is implemented, so it cannot catch a regression
of the single most behavior-dependent role path. That must be fixed before
implementers pick this up.

---

## Blocking issue

### B1 — Task 7's improver-degrade case is non-discriminating (AC3.2 not actually verified)

**Where:** Task 7, fourth fixture (`misconfigured-improver`), and its acceptance
("Assert `exitCode === 0` … a single `iteration-1` dir and no `iteration-2` …
no improvement step ran"). Same weakness mirrored in design Section 11's
improver-degrade bullet, but the plan is what implementers execute, so fix it in
the plan.

**Why it fails as a test.** The fixture is specified with a test/judge matrix
that **PASSes on iteration 1**. Trace the runtime against the real code:

- `runPipeline` breaks the iteration loop on `if (mergedPass) break;`
  (`src/pipeline/pipeline.ts:212`) — for **both** modes. An all-pass iteration 1
  stops at one iteration whether or not the run was degraded.
- The improver only runs under `!mergedPass && i < maxIterations &&
  selfImprovement.mode === "self-improvement"` (`pipeline.ts:188-192`). With an
  all-pass matrix, `!mergedPass` is already false, so the improver never runs —
  again, **independently of degrade**.

Consequently every assertion the plan lists for this case — `exitCode === 0`, a
single `iteration-1` dir, no `iteration-2`, no improvement step — is **equally
true in the world where the improver-degrade code (Task 5) was never written**.
The test is green either way and therefore proves nothing about AC3.2. AC3.2 is
the criterion that says a misconfigured improver must *degrade to test-only and
surface the degrade*; this test does not exercise that transition.

**What must change (pick one, and make it concrete in Task 7):**

1. **Assert the degrade is surfaced (minimum fix).** Task 5 already requires a
   `log`/console line announcing the improver was degraded for the missing
   credential, and Task 7 already captures stdout (it silences `console.log`).
   Capture those lines instead of discarding them and assert the degrade message
   appears (keyed off the missing-variable text, e.g. matching
   `MISCONFIGURED_REASON_PREFIX` / `OPENAI_API_KEY`). This is the only signal
   that actually differs between the degraded and non-degraded worlds for an
   all-pass matrix, so the assertion must exist or AC3.2 is untested. If the
   degrade is surfaced via a report note rather than a log line, assert on that
   note instead — but assert on *something the degrade produces*.

2. **Make the matrix discriminating (stronger fix, optional).** In addition to
   (1), prove that without degrade the improver *would* have run: assert the
   degraded run wrote **no** `improvement.md` in `iteration-1` (the existing
   improver-ran signal — see `src/__tests__/self-improvement-loop.test.ts:81-84`)
   **and** that `maxIterations` collapsed (e.g. assert `run.json` records exactly
   one iteration even though the fixture's `selfImprovement.maxIterations > 1`).
   With `maxIterations > 1` set on the fixture, "exactly one iteration ran"
   becomes a real consequence of the degrade rather than a tautology.

Either way, the fixture should set `selfImprovement.maxIterations` to a value
`> 1` so that "single iteration" is a degrade consequence, not the default, and
Task 7's acceptance bullet for this case must name the degrade-surfacing
assertion explicitly.

---

## Non-blocking observations (fix encouraged, not required to approve)

- **N1 — `agentRunnable` on an unknown id throws.** `agentRunnable` does
  `config.agents[agentId].provider`; an `agentId` absent from `config.agents`
  would throw at the `.provider` access. In practice `runnableTestAgentIds` only
  feeds ids drawn from `config.roles.test.agents`, and config validation
  (`src/config/validate.ts:130-132`) guarantees those reference real agents, so
  the internal callers are safe. This is noted only because `agentRunnable` is a
  *public* export (R5.1) a third party could call with an arbitrary id. Not a
  spec/AC violation (AC1.1/AC1.2 only exercise declared agents), so it does not
  block — but a one-line guard or a comment that the id must reference a declared
  agent would harden the public surface.

- **N2 — Task 4 marker-shape wording.** Task 4 says call `writeAgentReport(
  agentDirectory, { duration: 0 }, { skipped: reason })`. Verified against
  `src/pipeline/agent-loop.ts:298-308`: the signature is
  `writeAgentReport(agentDirectory, testing, review)` and it persists
  `{ testing, review }`, so this yields exactly
  `{ testing: { duration: 0 }, review: { skipped: "misconfigured: …" } }` — the
  marker the design and Task 9 assert on. Correct as written; flagged only so the
  implementer keeps the second arg as the `testing` block and the third as the
  `review` (don't swap them).

---

## What was verified (and passed)

- **Anchors are real.** `src/policy/` does not yet exist (T1 is a genuinely new
  isolated module). `src/index.ts:34` has `export { run } from "./runner";`
  (T2 insertion point). `runAgents` at `agent-loop.ts:66`; `agentIdFilter`
  narrowing at `agent-loop.ts:81-86`; `writeAgentReport` at `agent-loop.ts:298`.
  In `pipeline.ts`: `UserFacingError` imported at line 40; `resolveSelfImprovement`
  at 84; `maxIterations` at 118-119; outer `try` at 141; improvement guard at
  188-192; final-sweep guard at 215-220. testing-project anchors
  (`skillsmith.config.ts` agents map + `roles.test.agents: ["haiku"]`;
  `playwright.config.ts` `projects` map at lines 23-26) match the cited lines.

- **Types check out.** `SkillsmithConfigInput.agents` is
  `Record<string, AgentDefinitionInput>` with `.provider` (`config/types.ts:25-29,
  99-106`); raw `roles.test.agents: string[]` (`types.ts:56-59`); normalized
  `SkillsmithConfig.roles` is `NormalizedRoles` with `test.agents:
  AgentDefinition[]` and `judge/improver.agent: AgentDefinition` (`types.ts:69-73,
  114-121`). All four signatures in T1 are type-safe. `defineConfig` is identity
  (`config/define-config.ts`), so the testing-project holds the raw input that
  `runnableTestAgentIds` accepts. `ResolvedSelfImprovement.mode` is a mutable
  `RunMode` field (`config/self-improvement.ts:3-8`), so the T5 degrade
  reassignment/mutation is type-legal.

- **The central anti-regression mechanism is correct (R3.3/R3.4, AC2.x).**
  `classifyVerdict` maps `{ skipped: string }` → `SKIPPED` with no change
  (`reports/verdict.ts:26-28`). `aggregateScenarioReport` enumerates agent
  subdirectories from disk (`reports/scenario-report.ts:53-79`), so the marker
  `report.json` becomes a scenario row; its all-pass test requires every agent to
  classify PASS (`scenario-report.ts:82-92`), so a SKIPPED marker drops the
  scenario. `prepareSummary` exits 1 unless `rows.length > 0 &&
  rows.every(isRowPass)`, and `isRowPass` requires every cell PASS
  (`reports/summary.ts:66-77, 309-317`); the all-excluded matrix is non-green for
  free, and `failureLines` surfaces `SKIPPED <reason>` to the human summary
  (`summary.ts:331-333`). The marker genuinely threads to exit 1 — it is not a
  row-drop yielding exit 0.

- **Judge stop is correctly placed and not swallowed (R4.1/AC3.1).** `run()`
  catches `UserFacingError` and returns 1 (`runner.ts:40-42`); placing the throw
  before the outer `try` (line 141) means no `finally`/`afterAll`, no
  `report.json`, no `prepareSummary` — observably distinct from a FAIL matrix, as
  the design states.

- **Ordering is valid for one sequential shared tree.** T1 has no deps; T2/T3
  depend on T1; T4/T5 depend on T1; T6 independent; T7 depends on T1/T4/T5; T8
  depends on T2/T6; T9 (e2e verification) is last and depends on T4/T5/T6/T8. No
  task depends on something built later. The T5 pre-flight placed right after
  line 84 satisfies *both* "before `maxIterations` (118-119)" and "before the
  outer `try` (141)" with no conflict.

- **Constraints baked in.** New logic isolated to one module with type-only
  provider import (T1 acceptance greps for it); `prepareSummary`/`isRowPass`/
  `classifyVerdict`/`mergeIntoRunningReport`/`writeAgentReport` signatures left
  untouched; `SKIPPED` reused rather than a new verdict kind. No `"warn"`/`"fail"`
  /`"skip"` policy implemented, and the plan forbids policy-name string literals
  and `if (policy === …)` branching (T1 acceptance). No internal-process
  vocabulary in shipped artifacts; the `Traces to` field is plan-only by
  instruction. Deterministic tests use the real credential gate
  (`providers.test.ts:261-290` scrub idiom) with no network and `mock` PASS
  fixtures (`providers/mock.ts` default-pass; config validation has no model
  allow-list, `config/validate.ts:77-84`).

- **Coverage.** Every R#/AC# maps to a task: R1→T1/T3; R2→T1 (structural);
  R3→T4/T7; R4→T5/T7; R5→T1/T2/T8; R6→T6/T8/T9; R7→all. AC1→T3; AC2→T4/T7/T9;
  AC3→T7 (AC3.2 the weak spot above); AC4→T1 (structural); AC5→T8/T9; AC6→all
  (reviewable). No requirement is dropped; the only gap is *test strength* for
  AC3.2, not coverage.

---

## Bottom line

Resolve **B1** (make the improver-degrade case actually verify the degrade —
assert the surfaced degrade signal, and set the fixture `maxIterations > 1` so
"one iteration" is a degrade consequence). N1/N2 are advisory. With B1 fixed,
this plan is ready to hand to implementers.
