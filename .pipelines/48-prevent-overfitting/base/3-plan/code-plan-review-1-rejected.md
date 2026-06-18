# Code plan review — REJECTED (review 1)

Reviewing `.../base/3-plan/code-plan.md` (commit dc4e9eb, tasks T1–T14) adversarially against the
approved spec (`.../base/1-spec/spec.md`), the approved design doc
(`.../base/2-design-doc/design-doc.md`), and the live worktree code.

**Verdict: REJECTED.** One blocking sequencing defect (B1) makes a task non-committable as written
under the project guardrails, and two smaller actionable issues (B2, B3) should be fixed in the same
pass. Everything else is in good shape — see "What is solid" at the end. The fixes are localized;
this is close.

---

## Blocking

### B1 — T10 cannot commit green: it adds two REQUIRED `RunImprovementParams` fields that T10 does not populate at the sole call site (T11 does). The intermediate state (post-T10, pre-T11) fails typecheck, violating the per-task guardrail.

**What the plan claims.** The preamble states each task "is implemented by a fresh code-writer with
TDD on the shared pipeline branch" and lists "typecheck" as a guardrail "every task's commit must keep
green" (plan lines 4–5, 18–19). T10's Acceptance says "Typecheck + lint clean" as a standalone bar
(plan line 479). The dependency graph orders **T10 before T11** (plan lines 42–44, and T11 `Depends on`
lists T10 at line 511).

**Why it breaks.** T10 instructs: "Add two new `RunImprovementParams` fields (§3): `corpus:
EnumeratedScenario[]` and `maxValidationRounds: number`." (plan lines 421–422) — both **non-optional**,
matching design §3 (design line 235). But the only thing that *populates* those fields,
`pipeline.ts`'s `runImprovement({...})` call, is modified in **T11** (plan lines 504–507).

Verified against the live code:
- `src/pipeline/pipeline.ts:17` + `:193` is the **sole** caller of `runImprovement`
  (`grep -rn "runImprovement\b" src/ bin/` → one import, one call), and it is an **object literal**
  (`pipeline.ts:193–207`). TypeScript reports missing required properties on an object-literal argument.
- Baseline is green today (`npx tsc --noEmit` → exit 0; `npm test` → 147 pass / 2 skip / 0 fail), so
  this guardrail is real and currently enforced.

Therefore, at T10's commit (before T11 lands), `pipeline.ts:193` fails to typecheck with
"missing properties `corpus`, `maxValidationRounds`". T10 is **not** independently committable green as
the plan asserts. Because tasks commit sequentially on the shared branch and the guardrail is per-task,
this is a hard break, not a cosmetic one.

**Required fix (pick one, and state it in the plan):**
1. **Merge T10 + T11** into one task (the integration spine commits atomically — the new required
   fields and their population land together). Simplest; matches the design's "non-optional" intent.
   OR
2. **Make the two fields optional in T10** (`corpus?: EnumeratedScenario[]`,
   `maxValidationRounds?: number`) with a safe internal fallback (e.g. the inner loop only runs when
   `config.roles.validator !== undefined`, and at that gate require `corpus`/`maxValidationRounds` to
   be present — or default `maxValidationRounds` via `?? 2` and treat an absent `corpus` as `[]`), then
   T11 supplies them. This keeps T10/T11 split but costs a small amount of defensive code that the
   design's required-field shape doesn't want.

Option 1 is cleaner and preserves design §3's non-optional contract. Whichever is chosen, update the
task graph note (plan lines 47–51) and T10/T11 `Depends on`/Acceptance so no intermediate commit is
left non-typechecking.

(Note: the analogous case in **T5** is fine — T5 adds the required `ResolvedSelfImprovement.maxValidationRounds`
*and* returns it in `resolveSelfImprovement` in the same task (plan lines 186–191), and
`SelfImprovementOverrides.maxValidationRounds` is optional. T5 is self-consistent and commits green.
The defect is specific to T10's cross-file required-field-without-its-populator split.)

---

## Should-fix (actionable, same pass)

### B2 — Design's rubric-dedup snippet (`s.rubrics`) is a typecheck error; the plan silently uses the correct `s.scenario.rubrics`, but should call out the divergence so a code-writer doesn't "fix" the plan back to the design's broken form.

`EnumeratedScenario` is `{ scenario: Scenario; dirName: string; error?: string }` (verified
`src/scenarios/enumerate.ts:7–11`); scenario fields are reached via `s.scenario.X` everywhere
(`select-scenarios.ts:47`, `pipeline.ts:112`). So:

- **Plan T9** (line 382): `new Set(corpus.flatMap(s => s.scenario.rubrics))` — **correct**.
- **Design §4.3** (design line 367): `new Set(corpus.flatMap(s => s.rubrics))` — **wrong** (would not
  typecheck; `EnumeratedScenario` has no `rubrics`).

The plan is *more correct than the design here*, which is good — but the plan also tells the writer
the design "is the source of truth for every signature" (plan line 7) and T9 elsewhere phrases corpus
fields loosely as "per-scenario `{name, description, prompt, acceptance}` from `corpus`" (plan line
379). A code-writer cross-checking against design §4.3 could be misled. **Add a one-line note in T9**
that all corpus-scenario fields are read via `s.scenario.<field>` (name/description/prompt/acceptance/
rubrics), explicitly overriding the design §4.3 `s.rubrics` typo. This removes the only place a writer
could reintroduce a typecheck failure from the design text.

### B3 — Per-file test invocations in T6/T7/T13 acceptance drop `--import tsx`; as written they will not run.

The project test script is `node --import tsx --test src/__tests__/*.test.ts` (verified
`package.json` `"test"`). The repo's tests are TypeScript and require the tsx loader. The plan's
acceptance lines invoke, e.g., `node --test src/__tests__/config-validate.test.ts` (plan line 239),
`node --test src/__tests__/validator-verdict.test.ts` (line 292), `node --test
src/__tests__/validator-loop.test.ts` (line 653) — **without** `--import tsx`. Run verbatim, these
fail to load the TS test file. Fix: either prefix `--import tsx` in each per-file command, or change
the acceptance to run the guardrail suite (`npm test`) / `node --import tsx --test
src/__tests__/<file>.test.ts`. Non-fatal to the design, but the acceptance commands should be
copy-pasteable.

---

## Verified accurate (spot-checks that passed)

These were checked against the live worktree and are correct — calling them out so the re-review can
move fast:

- **All cited file:line anchors are accurate.** `types.ts` `RolesInput :50–54`, `NormalizedRoles
  :69–73`, `SelfImprovementConfig :81–85`; `validate.ts` `validateRoles` improver check at `:100`,
  `validateSingleRole :139–175`, `validateSelfImprovement :177–204`, `maxIterations` block `:188–194`,
  top-level roles message `:94`; `normalize.ts` roles literal `:28–39`, test-prompt spread `:33–35`,
  `normalizeSingleRole :54–66`, imperative `out.x` pattern `:47–50`; `self-improvement.ts`
  `:3–8/:10–15/:17–25/:44–49`, `Pick<…>` union `:18–19`; `improver.ts` user message `:134–142`,
  invoke+write+logs `:148–168`, `skillsDir :117`, instructions `:118–121`, sentinel `:124`, recursion
  guard `:130–132`, `prompt: userMessage` at `:152`; `judge-agent.ts` `parseJudgeJson :141–153`, call
  site `:77`, rubric read `:95–100`, recursion guard `:129–131`; `pipeline.ts` inline enumerate
  `:85–88` and `runImprovement` call `:193–207`; `mock.ts` improver branch `:61`, `invokeJudge :96`,
  `applyMarkerToSkills :111–129`; `bin/skillsmith.mjs` options `:24–30`, `--iterations` block `:53–60`,
  usage `:35`. Every one matches.

- **Settled decisions are respected, none reopened.** D2 advisory keep+warn (T10), D5 pre-scan
  DEFERRED / LLM-only (plan lines 11–13, 734–738), full-corpus input (T11/§4.3), fail-open (T7/T9),
  AC4 byte-identity with `self-improvement-loop.test.ts` + `loop-project/` untouched (T10/T12/T13),
  `role:"judge"` reuse with no `Role`-union edit (T2/T9, C5). The `Role` union is correctly left
  untouched — verified `src/providers/types.ts:16` is `"testing" | "judge"` and the plan forbids
  touching it.

- **Backward-compat / byte-identity is mechanically sound.** The no-validator path (T10) runs only the
  round-0 `invokeImprover(undefined)`, which emits no findings section (→ user message byte-identical
  to `improver.ts:134–142`) and writes `improvement.md` under the `findings === undefined` guard once.
  T12's `VALIDATOR_LOOP_FIXTURE` opt-in keeps `loop-project` on the unchanged `applyMarkerToSkills`
  path. Verified the AC3 convergence mechanic end-to-end: the improver helper appends the MARKER
  constant (`SKILLSMITH_LOOP_OK`, `mock.ts:20`) to SKILL.md → the next iteration's testing agent
  inlines the skill blob into its **system prompt** (`testing-agent.ts:37–45,61`) → `invokeTesting`
  flips `GATE_FAIL`→`GATE_PASS` on `systemPrompt.includes(MARKER)` (`mock.ts:78–82`) → `invokeJudge`
  passes on `GATE_PASS` (`mock.ts:102`). The mock's revise detection keys on
  `params.prompt.includes("LEAK_TOKEN")` where `prompt` is the improver **user** message
  (`improver.ts:152`), which is exactly where T10 renders findings with `span` verbatim — consistent.

- **Fail-open paths and the InvokeParams contract typecheck.** `InvokeParams` requires both `cwd` and
  `role` (`src/providers/types.ts:18–24`), which T9's invoke supplies (`cwd: skillsDir`, `role:
  "judge"`). The two fail-open entry points (T9 provider-error / T7 parse-shape) and the 5-row AC2
  table are internally complete.

- **Coverage matrix genuinely owns R1–R9, C1–C6, AC1–AC7.** Spot-checks confirmed the named task
  actually delivers (not just claims): AC4 → `self-improvement-loop.test.ts` untouched + T12 gate;
  AC5 N+1 = the `while(true)` cap-after-validate structure (T10); C3 no-git → `readSkillsRoot` pure fs
  (T8); C5 no new Role (T2/T9). The inner-loop N+1 count lives entirely inside one `runImprovement`
  call and is independent of the outer `maxIterations` (which only gates whether `runImprovement` is
  *called*, `pipeline.ts:188–192`) — so T13's "maxIterations ≥ 2 so the improver runs" is the correct
  and sufficient fixture constraint.

- **T14 changeset is satisfiable as `minor`, no `BREAKING:`/no conventional prefix.** Matches
  `CONTRIBUTING.md:46` ("Additive new CLI flag with sensible default" + "New optional `selfImprovement`
  field" + new optional `roles.validator`). The new symbols are internal (no `src/index.ts` export
  added), and the three widened public interfaces (`RolesInput`/`NormalizedRoles`/
  `SelfImprovementConfig`, all re-exported from `index.ts`) gain only optional fields — additive,
  backward-compatible.

- **Dependency order is otherwise correct.** T1–T9 leaf/near-leaf deps all precede their dependents;
  T6 after T3/T4/T5; T7 after T1; T9 after T1/T7/T8/T2; T13 after T10/T11/T12; T14 after T5. The only
  ordering defect is B1 (T10's required-field-before-populator split).

---

## Required for approval

Fix **B1** (eliminate the non-typechecking intermediate commit — merge T10+T11, or make the two new
`RunImprovementParams` fields optional in T10), and address **B2** and **B3** in the same revision.
Re-submit; the rest of the plan is ready for code-writers.
