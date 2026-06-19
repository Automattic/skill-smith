# Code review — APPROVED

**Batch:** T1–T13 (skillsmith #48 — stop the self-improvement loop from overfitting skills to eval scenarios)
**Diff reviewed:** `git diff 95414566..HEAD` (HEAD `5245c2e`)
**Verdict:** APPROVED

The batch is correct, complete, and faithful to the approved spec (R1–R9, C1–C6, AC1–AC7, D2, D5),
the design doc, and the code plan. All thirteen tasks are delivered as specified, every coverage-matrix
cell is genuinely owned by shipped code, and all six guardrails pass on HEAD (independently re-run).

---

## Correctness — the load-bearing paths

### Inner validate/revise loop (`improver.ts:206-239`)

Re-traced against AC3 and AC5:

- **AC3 (converge, N=2):** `invokeImprover(undefined)` → improver #1 adds MARKER+LEAK → loop round 0:
  `readSkillsRoot` → `runValidator(round=0)` writes `validation-round-0.md`, verdict `revise` →
  `round(0) >= cap(2)`? no → `round++` → `invokeImprover(findings)` improver #2 strips LEAK → loop
  round 1: `runValidator(round=1)` writes `validation-round-1.md`, verdict `approve` → break.
  **2 improver invokes, 2 transcripts (round-0, round-1), one revise round, final skill leak-free.** ✓
- **AC5 (cap, N=2, never-approve):** improver #1 → validate#0 revise → improver #2 → validate#1 revise
  → improver #3 → validate#2 revise → `round(2) >= cap(2)` → WARN + break.
  **3 improver invokes (N+1), 3 transcripts (N+1), last edit KEPT, no revert.** ✓

The structural choice the design calls load-bearing is implemented exactly: `while (true)` with the cap
check **after** each validation and **before** the next improver invoke (`improver.ts:229-237`). This
guarantees the terminal validation of the last un-revised edit always runs and its findings feed the
warning — `while (round < cap)` would have skipped it and broken AC5's N+1.

### Fail-open (R8 / AC7)

Both entry points verified, both set `failedOpen: true`:
- **(a) provider error** — short-circuits in `runValidator` (`validator.ts:188-200`) **before** parsing,
  with the precise reason `provider error: <err>` threaded into the transcript header.
- **(b) parse/shape** — inside `classifyValidatorVerdict` (rows 1/2/5). The loop breaks as approve on
  `outcome.verdict !== "revise"` (`improver.ts:229`), so a broken validator never blocks the loop.

`validator.test.ts` exercises path (a) end-to-end (swaps the registry provider to force an error,
asserts `failedOpen:true` + the `FAILED-OPEN: provider error: boom` header). The registry swap is sound:
`PROVIDERS` is a mutable export and `getProvider` reads it live; restored in `finally`.

### Verdict classifier 5-row table (AC2) — `validator-verdict.ts:56-72`

The table is complete and each row correct: row 1 (unparseable → approve, failedOpen), row 2 (verdict
not in enum, incl. wrong type `1` → approve, failedOpen), row 3 (approve, normalized empty findings),
row 4 (revise + non-empty array, lenient — a finding missing `suggested_fix` does NOT fail open), row 5
(revise + empty/absent findings → approve, failedOpen). `findings` is normalized to `[]` on every
approve outcome, keeping the loop break clean. `validator-verdict.test.ts` pins all five rows plus fenced
JSON (orthogonal) and the lenient case.

---

## Settled decisions honored (verified against the diff, not just claimed)

- **C1 — judge stays skill-blind.** `judge-agent.ts` changed ONLY by the `parseJudgeJson` →
  `parseAgentJson` import swap; the lifted body is byte-identical to the deleted local copy.
  `grep -rn parseJudgeJson src/` → none. Prompt-building and skill-blindness untouched.
- **C4 / AC4 — byte-identity.** `self-improvement-loop.test.ts` and `fixtures/loop-project/` are
  **untouched** (empty diff confirmed). The no-validator path is `invokeImprover(undefined)` plus an
  explicit no-op `if (config.roles.validator === undefined)` branch. The two modified config test files
  are purely additive (138 insertions, **0 deletions**) — the existing roles-triple and maxIterations
  cases pass unchanged.
- **C5 — no new Role.** `providers/types.ts` Role union untouched; the validator invokes `role:"judge"`
  (`validator.ts:178`).
- **Answer-key exclusion (R4 / §4.4).** `RunValidatorParams` (`validator.ts:112-128`) carries no
  `iterationReport`, no `report`, no judge-review field, no failing-scenario `skillsBlob` — structurally
  excluded, not a prompt instruction.
- **Full-corpus threading (R3/R3a/C2 / §4.3).** `pipeline.ts` splits the inline enumerate/filter and
  threads `corpus: enumerated` (the FULL, pre-`--scenarios` set) distinct from the improver's filtered
  `allScenarios`. The validator reads `s.scenario.<field>` and `s.scenario.rubrics` (the plan's typo fix
  over the design snippet), which typechecks.
- **D2 advisory.** The validator never writes a `ScenarioReport` cell, never touches `report.json`, the
  matrix, or the exit code — only `validation-round-{round}.md` transcripts and `log.info` lines. The cap
  keeps the last edit and warns; no revert.
- **`improvement.md` round-0-only (§2.0 rule 2).** Guarded by `if (findings === undefined)`
  (`improver.ts:189`); revise rounds re-edit and log but never clobber it. No `improvement-round-K.md`.
- **Findings render into the USER message with `span` verbatim (§2.0 rule 1).** `renderFindings`
  (`improver.ts:259-266`) appends `# Validator findings` to the user message only when
  `findings !== undefined`; round 0 emits nothing, keeping the user message byte-identical to today's.

---

## Quality

- No debug leftovers, no dead code. The only casts (`v as Record<string, unknown>`,
  `findings as ValidatorFinding[]`) are legitimate narrowings **after** a shape check, not type holes;
  no `as any` anywhere in the shipped source.
- `readSkillsRoot` (`read-skills-root.ts`) gates each dir on `isDirectorySafe` + `existsSync(SKILL.md)`
  before `loadSkill` (which throws only on a missing top-level SKILL.md). `loadSkill` itself tolerates
  broken md-links (`skill-loader.ts:28`), so the reader cannot crash the loop mid-run. Pure `fs`, writes
  nothing, no git (C3/R5). Its unit test asserts md-link following, non-skill-dir skipping, and that the
  tree is unmodified.
- Mock (`mock.ts`): the validator branch keys on `systemPrompt.includes("validator agent")` inside
  `invokeJudge` (safe — validator runs `role:"judge"`, never the `role:"testing"` improver branch). The
  gated improver add-leak/remove-leak behavior is behind `VALIDATOR_LOOP_FIXTURE`, so `loop-project`
  keeps the unchanged `applyMarkerToSkills` path. The fixture corpus is clean of the literal `LEAK_TOKEN`
  (verified), so round 0 cannot falsely trip the revise branch.
- `DEFAULT_VALIDATOR_PROMPT` opens with the `"validator agent"` sentinel, encodes the full
  R2/R3/R3a/R9 contract (four leak types with exact enum spellings, the bright line, two-prong AND,
  precision bias, harm asymmetry, output format, recursion guard), and contains no `"improver agent"`
  substring (belt-and-suspenders guard).
- Tests are meaningful, not vacuous. AC1 (`config-validate` + `self-improvement` resolve/validate),
  AC2 (`validator-verdict` 5-row string table), AC3/AC5/AC6 (`validator-loop` E2E), AC7
  (`validator` provider-error), plus `read-skills-root` and `parse-agent-json` units. The E2E tests reset
  the fixture skill to pristine in `finally` and leave the working tree clean.

## Changeset

`.changeset/validator-agent.md`: `"@automattic/skillsmith": minor`, non-empty body naming the surface
(`roles.validator`, `selfImprovement.maxValidationRounds`, `--validation-rounds`), no `BREAKING:` prefix
— correct for an additive, backward-compatible feature. `changeset status` → minor.

## Guardrails (independently re-run on HEAD)

- `npm run typecheck` — clean.
- `npm run lint` — clean (107 files).
- `npm test` — 186 tests, **184 pass / 2 skipped / 0 fail**. The 2 skips are the pre-existing codex
  provider end-to-end tests (require a real codex binary), unrelated to this batch.
- config-smoke (`smoke.test.ts`) — green.
- changeset-format (`validate-changesets` B8 CLI smoke) — green.
- `changeset status` — minor for `@automattic/skillsmith`.

Nothing is gamed: no test asserts nothing, no `as any` hides a type hole, the byte-identity claims are
backed by empty diffs, and the guardrail counts match the orchestrator's report.

---

## Coverage matrix spot-check

R1 (T2/T4/T9/T10), R2 (T9 prompt / T7 enum), R3+R3a (T9 prompt / T10 full corpus), R4 (T8/T9
exclusion), R5 (T8/T10), R6 (T10/T11), R7 (T2/T3/T5/T10 warn/T13 CLI), R8 (T7 rows / T9 provider path),
R9 (T7/T9/T11), C1 (T1/T9), C2 (T10), C3 (T8), C4 (guards + untouched AC4), C5 (no Role edit), C6
(advisory) — each spot-checked to its shipped owner. AC1–AC7 all pinned by passing tests. The D5 pre-scan
is deferred within the spec's explicit grant; no AC depends on it.

**Approved.**
