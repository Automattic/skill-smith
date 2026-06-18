# Doc plan — Stop the self-improvement loop from overfitting skills to eval scenarios (#48)

This plan decomposes the **documentation** work for the validator feature into an ordered set of
discrete tasks. It documents the feature the approved code plan ships (T1–T13, design-doc commit
43d3626) — it does **not** introduce behavior. Every doc task ties to a concrete code/config artifact
so a doc-writer can verify the prose against the shipped code, and a doc-reviewer can catch drift.

**Source of truth.** The approved spec (`.../base/1-spec/spec.md`, R1–R9 / C1–C6 / AC1–AC7 / D2 / D5),
the approved design doc (`.../base/2-design-doc/design-doc.md`), and the approved code plan
(`.../base/3-plan/code-plan.md`, T1–T13). Where this plan cites an `R#`/`C#`/`§#`/`T#`, the doc-writer
should confirm the shipped code matches before writing — narrative must reflect what landed, not what
was planned.

**Scope boundary (what the doc phase does NOT own).**
- **Symbol-level / inline API doc-comments** (JSDoc/TSDoc on `runValidator`, `classifyValidatorVerdict`,
  `readSkillsRoot`, the new config types, `DEFAULT_VALIDATOR_PROMPT`, etc.) are owned by the **code
  phase** — do not re-document them here. The doc phase owns **narrative / reference / guide** docs
  (README), the **consumer-facing reference config** (`examples/`), and any **non-symbol inline
  narrative** (e.g. the explanatory comments inside `examples/skillsmith.config.ts`, which are
  documentation prose, not API doc-comments).
- **The release changeset** is owned by **code-plan T13** (one changeset for the whole feature,
  `minor`). The doc phase does **not** author a second changeset. DT4 only *verifies* T13's changeset
  summary names the user-facing surface this plan documents, and confirms no extra doc-only changeset
  is required.

**Surface inventory (where the feature is currently documented, established by inspection).**
- `README.md` — the canonical narrative + reference. Four regions touch this feature:
  - "How the Self-Improvement works" narrative (`README.md:88–124`), incl. the improver paragraph
    (`:116`, `:124`) and the run-tree artifact listing (`:100–112`).
  - "Configuration" reference — the `roles` block (`:178–185`), the `selfImprovement` block
    (`:186–190`), and the prompt-precedence paragraph (`:200`).
  - "CLI flags" (`:204–210`).
  - "Hooks" table (`:212–224`) — **unchanged** by this feature (hooks fire once, §2.3; no new hook),
    noted here so a doc-writer does not invent hook docs.
- `examples/skillsmith.config.ts` — the surface-area reference config (every provider/option). The
  `roles` block (`:84–102`) and the `selfImprovement` block (`:113–130`) are where the new optional
  fields are demonstrated for consumers.
- `CONTRIBUTING.md` bump-type table already covers "New optional `selfImprovement` field" and
  "Additive new CLI flag with sensible default" (`CONTRIBUTING.md:46`) — **no edit needed**; noted so a
  doc-writer does not add a redundant row.
- `docs/index.html` (landing page) — marketing prose only; carries **no** config/CLI/roles reference
  (verified). It is changeset-exempt and explicitly out of contract (`CONTRIBUTING.md:32`). **Out of
  scope** — nothing to drift; do not edit.
- `AGENTS.md` / `CLAUDE.md` — project/changeset policy only; **no** validator surface. **No edit.**

**The feature's documentable surface (what every task collectively must cover).**
1. New config option `selfImprovement.maxValidationRounds` — integer ≥ 1, clamped, default **2**, same
   shape/precedence as `maxIterations` (R7, §8.2, T2/T5).
2. New optional role `roles.validator` — string shorthand or `{ agent, prompt }`; **prompt REPLACES**
   the built-in (mirrors `improver`, not `test`/`judge`) (C5, §6.3, T2/T4/T9).
3. New CLI flag `--validation-rounds N` — mirrors `--iterations`, precedence CLI > config > default
   (R7, §8.3, T13).
4. Validator behavior: **optional**, **read-only**, **fail-open**, **advisory keep+warn gate**, what it
   **sees** (post-edit whole skill + scenario corpus + rubrics; NOT the judge reviews/answer key), and
   the **honest legible-not-subtle** scope (catches blatant leakage; human PR review is the
   authoritative gate) (R1/R2/R4/R7/R8, C6, D2, §2.4).
5. New evidence artifact `validation-round-K.md` in `iteration-N/` (the validator's prose transcript;
   distinguishes "approved" from "failed-open → treated as approve") (R5/R8, §9.3).
6. **Backward-compat note**: with no `roles.validator` configured, the loop behaves exactly as today,
   zero behavior change (C4/AC4).
7. The changeset/CHANGELOG entry naming the surface (verify T13; DT4).

---

## Task graph (dependency order)

```
DT1  README — self-improvement narrative + run-tree artifact (validator behavior, validation-round-K.md)  → no deps
DT2  README — Configuration reference (roles.validator + selfImprovement.maxValidationRounds) + precedence → no deps
DT3  README — CLI flags (--validation-rounds)                                                              → DT2 (shared example line)
DT4  examples/skillsmith.config.ts — reference config (roles.validator + maxValidationRounds) + changeset verify → no deps
```

All four are README/examples edits with no inter-file code dependency. DT3 depends on DT2 only because
both touch the same README "Configuration → CLI flags" example invocation line and should land
consistently; DT1/DT2/DT4 are independent. A doc-writer may take them in any order consistent with
`Depends on`. Each task's prose must be verified against the **shipped** code (the run is post-code).

---

## DT1 — README: self-improvement narrative + run-tree artifact

**Goal.** Teach a reader what the validator *does* inside the self-improvement loop — that it is an
optional, read-only reviewer of the improver's edit that returns approve / revise-with-findings, loops
to a cap, is **advisory** (keep + warn on cap, no revert), **fails open**, and catches only **legible**
leakage with human PR review as the authoritative gate — and list its evidence artifact
`validation-round-K.md` in the run tree. Make the **backward-compat** guarantee explicit (no validator
configured ⇒ unchanged).

**Audience.** Skill authors / maintainers running the self-improvement loop, and reviewers reading the
evidence trail — people who need to understand the loop's behavior and trust its honest scope.

**Files.**
- MODIFY `README.md`

**Sections-scope.**
- "How the Self-Improvement works" (`README.md:88–124`):
  - Add a short narrative subsection (e.g. `### The validator — anti-leakage review`) **after** the
    improver paragraph (`:116`/`:124`) describing the inner validate/revise loop: optional (gated by
    `roles.validator`); read-only; reviews the **resulting skill state** (post-edit whole skill), the
    **scenario corpus**, and the **rubrics**; returns `approve` or `revise`-with-findings; on `revise`
    the **improver** (still the sole writer) re-edits in place and the validator re-reviews; the loop
    caps at `selfImprovement.maxValidationRounds` revise rounds.
  - State the four behaviors precisely, each traceable: **advisory keep+warn** on cap (keeps the last
    edit, records a prominent warning, does **not** revert — D2/R7/§2.4); **fail-open** (a provider
    error or unparseable/malformed verdict is treated as approve and logged, so a broken validator never
    blocks the improver — R8/AC7); **honest scope** (catches blatant/legible leakage — scenario names,
    scenario-unique literals, verbatim acceptance/rubric copying, single-case answers — **not** subtle
    or paraphrased overfitting; it is a floor-raiser, and **human PR review remains the authoritative
    merge gate** — C6/R2); **what it does NOT see** (it never sees the judge's pass/fail reviews or the
    testing agents' produced files — the "answer key" exclusion, R4/§4.4) and that showing it the corpus
    is not a new leak because the corpus reaches only the ephemeral reviewer, never the persisted skill.
  - State the **backward-compat** guarantee in one sentence: with no `roles.validator` configured the
    loop behaves exactly as today, with zero behavior change (C4/AC4).
- Run-tree listing (`README.md:100–112`): add a `validation-round-K.md` line under `iteration-N/`
  (sibling to `improvement.md`) with a comment noting it is the validator's prose verdict transcript,
  present only when a validator is configured, and that it distinguishes a clean `approve` from a
  `FAILED-OPEN` approve (R5/R8/§9.3). Do **not** claim a persisted diff or any git artifact — the
  capture is in-process/ephemeral, no `*.diff`, no git (R5/C3/§5.1).

**Depends on.** —

**Traces to.** Spec R1, R2, R4, R5, R6, R7, R8, C3, C4, C6, D2, AC4, AC7; design §2.1, §2.4, §4.2,
§4.4, §5.1, §9.3; code-plan T8, T9, T10.

**Acceptance.**
- A new validator subsection exists in "How the Self-Improvement works", placed after the improver
  paragraph, and states: optional/read-only; approve vs revise-with-findings; improver is still the
  sole writer; loop caps at `selfImprovement.maxValidationRounds`.
- The four load-bearing properties are present and **accurate to the shipped code**: advisory keep+warn
  (no revert), fail-open, honest legible-not-subtle scope with human PR review as the authoritative
  gate, and the answer-key (judge-reviews) exclusion.
- The backward-compat sentence ("no `roles.validator` ⇒ unchanged") is present.
- The run-tree block lists `validation-round-K.md` with an accurate comment; it does **not** mention a
  persisted diff or git.
- No claim of behavior the code plan does not ship (no revert-on-cap, no held-out split, no
  deterministic pre-scan, no new hook, no exit-code change — the validator is advisory and never touches
  `report.json`/the matrix/exit code, §2.4). `npm run lint` / markdown checks (if any) pass; the
  project `check` stays green.

---

## DT2 — README: Configuration reference (`roles.validator` + `selfImprovement.maxValidationRounds`)

**Goal.** Document the two new config fields in the README Configuration block so a consumer can turn on
the validator and tune the round cap, with correct **prompt-precedence** semantics (validator prompt
**replaces** the built-in, like `improver`).

**Audience.** Consumers writing `skillsmith.config.ts` — they need the field names, types, defaults, and
the REPLACE-vs-append prompt semantics.

**Files.**
- MODIFY `README.md`

**Sections-scope.**
- "Configuration" code block (`README.md:167–202`):
  - In the `roles` block (`:178–185`), add `validator` as an **optional** role — show both the string
    shorthand and the `{ agent, prompt }` object form (mirror how `judge`/`improver` are shown). Make
    clear it is optional and that **absence is the on/off gate** (no `roles.validator` ⇒ validator off ⇒
    loop unchanged, C4). Keep `Role` semantics correct: the validator runs on the existing read-only
    judge tool surface — do **not** describe a new provider role/permission tier (C5).
  - In the `selfImprovement` block (`:186–190`), add `maxValidationRounds` with an inline comment:
    integer ≥ 1, **default 2** (the improver's first pass plus up to 2 revise rounds), clamped to ≥ 1
    (a configured `0` clamps to `1` — it does **not** disable the validator; on/off is governed solely
    by `roles.validator`) (R7/§8.2). Place it alongside `maxIterations` so the parallel shape is visible.
  - In the prompt-precedence paragraph (`:200`): add that **`roles.validator.prompt` replaces** the
    built-in validator instructions entirely (same as `roles.improver.prompt`, **unlike**
    `roles.test`/`roles.judge` which append a `# Role instructions` section), and note the override
    footgun in one clause — a project that overrides the validator prompt must preserve the verdict JSON
    schema and the validator identity (§6.3).

**Depends on.** —

**Traces to.** Spec R1, R7, C4, C5, AC1; design §6.3, §8.1, §8.2; code-plan T2, T4, T5.

**Acceptance.**
- The README `roles` block shows `validator` in both shorthand and object form, marked optional, with
  the "absence = off" gate stated; it does **not** imply a new provider role/permission tier.
- The `selfImprovement` block shows `maxValidationRounds` with: integer ≥ 1, default **2**, clamp
  behavior (`0` → `1`, not "disabled"), placed next to `maxIterations`.
- The prompt-precedence paragraph states `roles.validator.prompt` **replaces** the built-in (grouped
  with `improver`, contrasted with `test`/`judge`), and names the schema-preservation footgun.
- Field names, the default value (2), and the REPLACE semantics match the shipped config code (T2/T5)
  and the validator agent (T9) — verify against the code, not the plan. `check` stays green.

---

## DT3 — README: CLI flags (`--validation-rounds`)

**Goal.** Document the new `--validation-rounds N` CLI flag in the README CLI section, mirroring
`--iterations`, with the correct precedence (CLI override > config > default).

**Audience.** Operators running `skillsmith` from the command line who want to override the round cap
for a single invocation.

**Files.**
- MODIFY `README.md`

**Sections-scope.**
- "CLI flags" (`README.md:204–210`):
  - Add `--validation-rounds N` to the example invocation line and/or surrounding prose, mirroring how
    `--iterations` is shown (`:209`). State that it **overrides** `selfImprovement.maxValidationRounds`
    for a single run, takes an integer ≥ 1, and that a value `< 1` is rejected (matches the shim's
    validation, T13/§8.3). Keep the "flags override the config block for a single invocation" framing
    already present (`:206`).
  - Do **not** introduce a separate flags table — match the existing inline example style. Do **not**
    document a `--validator`-style on/off flag: there is none; the validator's on/off is `roles.validator`
    presence only (R7/C4), so the CLI flag governs **only the round cap**.

**Depends on.** DT2 (both touch the README Configuration → CLI region; land the field and its flag with
consistent naming and default).

**Traces to.** Spec R7, AC1; design §8.3; code-plan T13.

**Acceptance.**
- `--validation-rounds N` appears in the CLI section, mirroring `--iterations`, with precedence
  (CLI > config > default) and the integer-≥-1 / reject-`<1` behavior stated.
- It is documented as governing the **round cap only** — no implication that the flag turns the
  validator on/off (the doc must not contradict "on/off = `roles.validator` presence").
- The flag spelling and error behavior match the shipped `bin/skillsmith.mjs` (T13) — verify against the
  shim, not the plan. `check` stays green.

---

## DT4 — `examples/skillsmith.config.ts` reference config + changeset verification

**Goal.** Show the two new optional fields in the surface-area reference config so a consumer copying
from `examples/` sees how to configure the validator and the round cap, with the explanatory inline
comments that file uses; and **verify** (not author) that code-plan T13's single feature changeset names
this user-facing surface and that no additional doc-only changeset is required.

**Audience.** Consumers who read `examples/skillsmith.config.ts` to learn the full option surface (the
file's stated purpose: "document the surface area").

**Files.**
- MODIFY `examples/skillsmith.config.ts`
- VERIFY (read-only) `.changeset/<feature>.md` (the changeset authored by code-plan T13)

**Sections-scope.**
- `roles` block (`examples/skillsmith.config.ts:84–102`): add an optional `validator` role with the
  file's comment idiom — show the object form `{ agent, prompt }`, note it is **optional** (absence =
  validator off), runs **read-only**, and that its `prompt` **REPLACES** the built-in (group it with the
  `improver` comment at `:99–101`, which already explains REPLACE-vs-augment). If a prompt file is
  referenced, mirror the existing `readFileSync(...prompts/...)` pattern (`:19–26`) or inline a short
  illustrative string — match the file's existing style; do not invent a new prompt-loading convention.
- `selfImprovement` block (`:113–130`): add `maxValidationRounds: 2` with a comment matching the
  surrounding style — integer ≥ 1, default 2 (first pass + up to 2 revise rounds), clamped (a `0` clamps
  to `1`, does not disable), and that the validator's on/off is `roles.validator` presence, not this cap.
- Changeset verification (read-only): open the changeset T13 wrote and confirm its summary names the
  user-facing surface — `roles.validator`, `selfImprovement.maxValidationRounds`, and
  `--validation-rounds` — at a `minor` bump with no conventional-commit prefix (per
  `CONTRIBUTING.md:46`/`:86`). If the summary is missing any of the three surface names, flag it to the
  team lead rather than editing T13's file (single-changeset ownership stays with T13). Confirm **no
  separate doc-only changeset** is needed: README "mixes prose and contract" (`CONTRIBUTING.md:38`) and
  `examples/` is consumer-facing (`:36`), but both are covered by T13's feature changeset — a second
  changeset would double-count the release entry.

**Depends on.** —

**Traces to.** Spec R1, R7, C4, C5; design §6.3, §8.1, §8.2; code-plan T2, T4, T5, T13;
`CONTRIBUTING.md` bump-type table (`:46`) and changeset rules (`:36`, `:38`, `:86`).

**Acceptance.**
- `examples/skillsmith.config.ts` shows an optional `validator` role (object form, with the
  REPLACE-prompt comment) and `selfImprovement.maxValidationRounds: 2` with an accurate comment; the
  file still typechecks against the shipped public types (`defineConfig` accepts the new optional
  fields — T2) and follows the file's existing comment/style idiom.
- The example does **not** mark the validator required, does **not** imply a new provider role, and does
  **not** invent a CLI/`mode` toggle for the validator.
- The T13 feature changeset is confirmed to name all three surface elements at `minor`; if it does not,
  the gap is reported to the team lead (not silently fixed here). No second doc-only changeset is
  created. `check` stays green (the example compiles; the changeset validates).

---

## Coverage matrix — every documentable surface is owned

| Documentable surface | Owning task(s) |
|---|---|
| Validator behavior: optional, read-only, approve/revise loop, improver sole writer | DT1 |
| Advisory **keep+warn** gate (no revert) on cap | DT1 (narrative), DT2 (`maxValidationRounds` semantics) |
| **Fail-open** (provider error / unparseable verdict → approve, logged) | DT1 |
| **What it sees** (post-edit skill + corpus + rubrics) and the answer-key (judge-reviews) **exclusion** | DT1 |
| **Honest scope** (legible-not-subtle; human PR review is the authoritative gate) | DT1 |
| Evidence artifact `validation-round-K.md` (clean vs FAILED-OPEN), no diff/git | DT1 |
| **Backward-compat** (no `roles.validator` ⇒ unchanged) | DT1 (narrative), DT2 (config gate), DT4 (example optional) |
| `selfImprovement.maxValidationRounds` (int ≥ 1, default 2, clamp, precedence) | DT2 (README), DT4 (example) |
| `roles.validator` (optional; shorthand + object form; prompt REPLACES; read-only judge surface, no new `Role`) | DT2 (README), DT4 (example) |
| CLI `--validation-rounds N` (mirrors `--iterations`, cap only, CLI > config > default) | DT3 |
| Changeset / CHANGELOG entry names the surface | DT4 (verify T13; no second changeset) |
| Hooks table, landing page, AGENTS/CLAUDE/CONTRIBUTING bump-table | **Unchanged — explicitly not edited** (noted in DT1/preamble so no drift is introduced) |

**Drift-resistance.** Every task pins its prose to a shipped artifact: DT1 → the loop in `improver.ts`
+ `validator.ts` + the `validation-round-K.md` write (T8–T10); DT2/DT4 → the config types/resolve
(T2/T4/T5) and the validator agent's REPLACE-prompt semantics (T9); DT3 → the `--validation-rounds` shim
(T13). A doc-writer **verifies against the code**, not this plan, before writing; a doc-reviewer can
diff each prose claim against the named symbol/field/flag.

**Explicitly NOT documented (would be documenting non-existent behavior).** Revert-on-cap / staging
(non-goal, D2); a held-out / train-test split (out of scope, C2); a deterministic pre-scan (deferred,
D5/§8.4 — v1 is LLM-validator-only); a `--validator` on/off flag or a `mode` toggle for the validator
(none exists — gate is `roles.validator` presence); any new hook (hooks fire once, no new hook, §2.3);
any exit-code/`report.json`/matrix effect (validator is advisory, §2.4); per-revise improver transcripts
(`improvement.md` is round-0 only; no `improvement-round-K.md`, §2.0).
