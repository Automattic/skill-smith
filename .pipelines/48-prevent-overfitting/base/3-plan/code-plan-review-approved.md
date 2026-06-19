# Code plan review — APPROVED

Re-reviewing the revised `.../base/3-plan/code-plan.md` (commit 43d3626, tasks **T1–T13**)
adversarially against the approved spec (`.../base/1-spec/spec.md`), the approved design doc
(`.../base/2-design-doc/design-doc.md`), the prior rejection
(`.../base/3-plan/code-plan-review-1-rejected.md`, B1/B2/B3), and the live worktree code.

**Verdict: APPROVED.** All three prior blockers are fixed, the T1–T13 renumber is internally
consistent, and a fresh adversarial pass found no new blocking issues. The plan is ready for
code-writers.

---

## Prior blockers — all fixed

### B1 (cross-file typecheck break) — FIXED
Old T10 + T11 are merged into **one atomic task "T10 — Integration spine"** that edits both files in
ONE commit:
- **Part A (`improver.ts`)** adds the two REQUIRED `RunImprovementParams` fields (`corpus:
  EnumeratedScenario[]`, `maxValidationRounds: number`) and the inner loop / `invokeImprover`
  extraction.
- **Part B (`pipeline.ts`, SAME commit)** populates them at the sole call site — `corpus: enumerated`
  and `maxValidationRounds: selfImprovement.maxValidationRounds` in the `runImprovement({...})` object
  literal.

Verified against live code: `RunImprovementParams` is a single interface (`improver.ts:37–55`); the
sole caller is the object literal at `pipeline.ts:193–207` (`grep` confirms one import + one call).
Because the required fields and their populator land in the same commit, there is no intermediate
non-typechecking state. The `enumerated`/`allScenarios` split (`pipeline.ts:85–88` → two statements)
is behavior-preserving: `allScenarios` keeps its exact prior value
(`filterScenarios(enumerateScenarios(...), params.scenarios)`), and the new `const enumerated` at
module scope does NOT collide with the same-named *parameter* inside the unrelated helper at
`pipeline.ts:497–559` (separate scopes). T10's `Depends on` (T5, T8, T9, T2) covers every external
symbol it uses (`runValidator`, `readSkillsRoot`, `ValidatorFinding`, `config.roles.validator`,
`maxValidationRounds`); `invokeImprover`/`renderFindings` are introduced within T10 itself.

### B2 (`s.scenario.rubrics` field access) — FIXED
T9 (plan lines 387–396) pins **every** corpus-scenario read to `s.scenario.<field>`
(name/description/prompt/acceptance/rubrics) and explicitly OVERRIDES design §4.3's broken
`s.rubrics` snippet with "Do NOT 'fix' the plan back to the design's broken `s.rubrics` form."
Verified: `Scenario.rubrics` is `string[]` (`config/types.ts`), while `EnumeratedScenario` is
`{ scenario; dirName; error? }` with **no** `rubrics` field (`scenarios/enumerate.ts:7–11`) — so
`s.rubrics` would not typecheck and `s.scenario.rubrics` is correct, matching the existing
`s.scenario.X` patterns (`select-scenarios.ts:47`, `pipeline.ts:112`).

### B3 (per-file test commands missing `--import tsx`) — FIXED
All per-file acceptance commands now use `node --import tsx --test`: T6 (lines 241–242), T7 (line
296), T12 (line 677), matching `package.json`'s `"test": "node --import tsx --test
src/__tests__/*.test.ts"`. The lone bare `node --test` at line 18 is the prose-level guardrail
summary, not a copy-paste command — acceptable.

---

## Renumber T1–T13 — internally consistent

- **Headers** are contiguous `## T1` … `## T13`; no gap, no duplicate.
- **No dangling old numbers.** The only `T14` occurrence is inside the explanatory renumber comment
  (line 545) documenting the old→new mapping (`T12→T11, T13→T12, T14→T13`). No live dependency,
  graph edge, or matrix cell references a non-existent task.
- **Dependency ordering is forward-clean** (no task depends on a higher number): T3/T4/T5→T2;
  T6→T3,T4,T5; T7→T1; T9→T1,T7,T8,T2; T10→T5,T8,T9,T2; T12→T10,T11; T13→T5. T11 has no hard task
  dependency (only the agreed sentinel/identity strings). The task-graph block (lines 30–44) and the
  coverage matrix (lines 730–754) both use the renumbered ids consistently — former-T11's "Part B
  full corpus" responsibility is correctly re-attributed to T10 across R3/R3a/R5/C2.

---

## Fresh adversarial pass — clean

- **AC3 / AC5 cap arithmetic correct.** With `maxValidationRounds = 2` and the `while(true)` loop
  whose cap check sits *after* each validation and *before* the next invoke: AC3 converges in 2
  transcripts / 1 revise round; AC5 caps at 3 transcripts (N+1) / 2 re-invokes, emitting the exact
  `"WARNING: validation cap reached without approval"` literal via `log.info` and keeping (not
  reverting) the last edit (R7/D2). The "terminal validation always runs" invariant holds.
- **AC4 byte-identity intact.** The no-validator path runs only round-0 `invokeImprover(undefined)`
  (no findings section → user message byte-identical to `improver.ts:134–142`; `improvement.md`
  written once under the `findings === undefined` guard) and the `config.roles.validator === undefined`
  branch does nothing else. T11 gates new improver behavior behind `VALIDATOR_LOOP_FIXTURE`, which
  `loop-project` does not carry, so `self-improvement-loop.test.ts` stays untouched. The mock's new
  validator branch keys on `systemPrompt.includes("validator agent")` and is placed before the
  generic `invokeJudge` PASS/FAIL fallthrough — no collision with the gated judge's `prompt`-keyed
  `GATE_PASS`/`GATE_FAIL` checks (verified `mock.ts:61/96/99/111–129`).
- **Each task commits green independently.** T13's CLI flag (`bin/skillsmith.mjs`) only sets
  `overrides.maxValidationRounds = n`, which is typed by T5's `SelfImprovementOverrides.maxValidationRounds`;
  depending on T5 alone is correct (the flag is committable before the loop exists).
- **Settled decisions not reopened.** D2 advisory keep+warn, D5 pre-scan DEFERRED / LLM-only,
  full-corpus input (§4.3), fail-open (T7/T9), AC4 byte-identity, `role:"judge"` reuse with NO
  `Role`-union edit (C5) — all respected.
- **Changeset (T13) valid.** Single changeset, `"@automattic/skillsmith": minor`, non-empty body, no
  `BREAKING:` / no conventional-commit prefix — matches `CONTRIBUTING.md:46` ("Additive new CLI flag
  with sensible default" + "New optional `selfImprovement` field" + new optional `roles.validator`),
  all backward-compatible.
- **Coverage matrix** genuinely owns R1–R9, C1–C6, AC1–AC7 with the renumbered task ids; every named
  owner delivers (spot-checked, not just claimed).

---

## Approved

The three prior blockers are resolved, the renumber is consistent, and no new blocking issue was
found. Ready for the code phase.
