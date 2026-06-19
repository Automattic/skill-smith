# Docs review — APPROVED

**Batch:** DT1–DT4 (validator feature docs for skillsmith #48)
**Diff reviewed:** `95414566..e161613 -- README.md examples/skillsmith.config.ts` (+ DT4 changeset verification)
**Verdict:** APPROVED

The doc batch is accurate to the shipped code, complete against the doc-plan coverage matrix,
and in scope. Every load-bearing prose claim was verified against the actual code in the
worktree (not the plan). Guardrails (typecheck, lint, changeset status) are green on HEAD.

---

## Per-task verification

### DT1 — README self-improvement narrative + run-tree artifact (`README.md:127–142`, `:109`)

Accurate. The `### The validator — anti-leakage review` subsection is placed after the improver
paragraph and states optional/read-only, approve-vs-revise-with-findings, improver-is-sole-writer,
and the `selfImprovement.maxValidationRounds` cap. The four load-bearing properties each check out:

- **Advisory keep+warn, never revert** — matches `src/improvement/improver.ts:233–236`: the exact
  literal `WARNING: validation cap reached without approval`, keeps the last edit, `break`s without
  revert. Nothing touches `report.json`, the matrix, or the exit code (the loop only logs).
- **Fail-open** — matches both entry points: provider-error short-circuit
  (`src/improvement/validator.ts:188–200`, `failedOpen: true`) and the parse/shape rows 1/2/5 in
  `src/improvement/validator-verdict.ts:56–72`. The README phrasing "a verdict that does not parse
  to a well-shaped `revise`" is precise: it correctly excludes the clean-approve case (row 3, which
  is *not* fail-open) while covering rows 1/2/5.
- **Honest scope / human PR review authoritative** — matches the precision-bias mandate in
  `DEFAULT_VALIDATOR_PROMPT` (`validator.ts:78–82`): blatant/legible leakage only, bias toward
  approve, human PR review remains the merge gate.
- **No answer key** — matches `RunValidatorParams` (`validator.ts:112–128`): the validator is given
  only `skillsBlob` + `corpus` + rubrics (built in `buildUserMessage`, `validator.ts:209–251`);
  no judge pass/fail reviews, no testing-agent files.

Run-tree line `validation-round-K.md` (`README.md:109`) is accurate; the "no diff, no git artifact"
claim (`:140`) matches reality — `writeTranscript` is the only write. The backward-compat sentence
(`:142`) matches the no-validator branch at `improver.ts:208–211`.

### DT2 — README Configuration reference (`README.md:203–207`, `:211`, `:224`)

Accurate. `roles.validator` shown in both string shorthand and `{ agent, prompt }` object form —
matches `SingleRoleInput` (`src/config/types.ts:62`) and the conditional normalize at
`src/config/normalize.ts:39–41`. "Absence is the on/off gate" matches `improver.ts:208`.
`maxValidationRounds` documented as integer ≥ 1, default **2**, clamp `0 → 1` (not disable) —
matches `src/config/self-improvement.ts:25,50–55`. The REPLACE-prompt semantics + schema-preservation
footgun (`:224`) match `validator.ts:162–165` and the `DEFAULT_VALIDATOR_PROMPT` doc-comment. No new
provider role / permission tier implied (validator runs `role:"judge"`, `validator.ts:178`).

### DT3 — README CLI flags (`README.md:233`, `:236`)

Accurate. `--validation-rounds N` spelling, integer-≥-1, reject-`<1`, and CLI > config > default
precedence all match `bin/skillsmith.mjs:28,62–69`. Correctly states the flag governs only the
round cap, not validator on/off.

### DT4 — `examples/skillsmith.config.ts` + changeset verification

Accurate and typechecks. The example is in the tsconfig `include` (`examples/**/*`) and
`npm run typecheck` is green, so the new optional `validator` role (`:114`) and
`maxValidationRounds: 2` (`:149`) compile against the shipped public types. The comments follow the
file's idiom and group the validator with `improver` for REPLACE-prompt semantics. The
`prompts/validator.md` reference mirrors the file's pre-existing convention (the equally-nonexistent
`prompts/testing-agent.md` / `prompts/improver.md` references) — the file is an illustrative
surface-area reference, not a runnable config, and `readFileSync` is not executed by the typechecker.

Changeset verified read-only: `.changeset/validator-agent.md` is the single feature changeset,
`minor` bump (correct pre-1.0; no `major`), no conventional-commit prefix, and names all three
surface elements (`roles.validator`, `selfImprovement.maxValidationRounds`, `--validation-rounds`).
No second doc-only changeset was added. `npx changeset status` confirms a single minor bump.

---

## Scope discipline — clean

Nothing from the plan's "Explicitly NOT documented" list crept in: no revert-on-cap/staging, no
held-out/train-test split, no deterministic pre-scan, no `--validator` on/off flag, no `mode`
toggle for the validator, no new hook, no exit-code/`report.json`/matrix effect, no per-revise
improver transcripts (`improvement.md` is still described as round-0 only). Symbol-level doc-comments
were not duplicated into the narrative docs.

## Guardrails

`npm run typecheck` — pass. `npm run lint` (biome, 107 files) — pass. `npx changeset status` —
single `@automattic/skillsmith` minor bump. Diff touches only the doc-owned surfaces
(`README.md`, `examples/skillsmith.config.ts`) plus the code-owned changeset/code/tests.

---

## Non-blocking nit (not re-dispatched)

- `README.md:109` — "K = revise round 0,1,…". Per design-doc §183, `round` counts revise rounds
  *taken*, and round 0 is the validation of the first (zero-revises) improver pass — so K=0 is not
  strictly a "revise round." The zero-indexed `0,1,…` numbering and the `validation-round-K.md`
  artifact name are both correct, and the wording is consistent with the design doc's own "round 0"
  usage. Cosmetic only; does not warrant re-dispatch.
