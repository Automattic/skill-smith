# Docs Plan: Leaner judge briefs — natural-language rubrics and an auto-supplied task

## Overview

This is a **revision** (review-2) of the #55 pipeline. The code phase is replacing the review-1 "reusable rubrics **by id**" model with a leaner one: a scenario's `JUDGE.md` becomes fully opaque prose (Skillsmith parses **no** `# Rubrics` section and no other reserved section out of it); an author names the rubric to grade against in **natural-language prose**; Skillsmith automatically loads **all** rubrics from the optional `paths.rubrics` directory and supplies them to the judge (the prose selects which apply); there is no enumeration-time validation of rubric references; and the testing agent's task is auto-supplied to the judge on every run **minus** its `# Skills` section, keeping the judge skill-agnostic. The verdict stays `{ pass, notes }` and reporting/self-improvement are unchanged.

The branch's user-facing docs currently describe the review-1 rubric-by-id model and must be brought in sync. The documentation surface that must change is: **`README.md`** (the primary surface — a breaking-change callout, the judge-brief section, the entire "Reusable rubrics" section, the Configuration section, and the "Migrating from the old model" section all describe the removed id model), **`examples/skillsmith.config.ts`** (the `paths.rubrics` comment describes the `# Rubrics` id-list opt-in), and **`testing-project/skillsmith.config.ts`** (a one-line comment that says a `JUDGE.md` references rubrics "by id" — a surface the code phase deliberately does not touch). Surfaces that were swept and require **no** change are recorded in the notes below so the docs-reviewer can confirm the sweep was exhaustive.

## Guardrail scopes

No scoped gates were passed for this run — the docs gates are fixed commands (`npx tsx scripts/validate-changesets.ts`, `npx changeset status --since=origin/trunk`) with no `{scope}` to supply.

| Gate | Scope |
| ---- | ----- |
| None | None |

## Sweep notes — surfaces assessed, no docs task needed

These were checked against the branch (and `origin/trunk` where relevant) and are **not** documentation tasks, either because they are model-agnostic or because they are owned by the code phase. They are listed so the reviewer can confirm nothing was missed.

- **`docs/index.html`** — the landing page. Describes scenarios generically ("a judge brief that says how to verify the result", "a judge follows the judge brief to verify behavior live"). It never mentions rubrics, `# Rubrics`, `paths.rubrics`, or `## Scenario requirements`. Still accurate under the new model. **No change.**
- **`testing-project/eval/scenarios/*/JUDGE.md` (all 11)** and **`src/__tests__/testing-project-scenarios.test.ts`** — the scenario briefs and their conformance test. **Owned by the code phase (code-plan Task 7)**, which converts the briefs to the opaque prose shape and reconciles the conformance test. Not a docs task.
- **`.changeset/flexible-scenarios-judge-verification.md`** — **owned by the code phase (code-plan Task 8)**, which amends it to the final model. The docs gates only validate changeset format/status; do not author a changeset here.
- **`CHANGELOG.md`, `CONTRIBUTING.md`** — swept; no references to the rubric/`JUDGE.md` model. **No change.**
- **`testing-project/eval/prompts/judge.md`** (and the other `testing-project/eval/prompts/*.md`) — the reference "judge environment manual" and role prompts. Swept; no rubric or `# Rubrics` references (they cover WP-CLI, env vars, publishing a post). **No change.**
- **`README.md` lifecycle/step content unrelated to rubrics** (the flow diagram, the environment-ownership section, the reports section, the self-improvement section) — accurate under the new model; only the rubric- and judge-brief-scoped passages change (Task 1).

## Tasks

### Task 1: Rewrite the README rubric/judge-brief model to natural-language references and the auto-supplied task

- **Goal:** Bring `README.md` fully in sync with the shipped model. Replace every description of the review-1 "reference rubrics **by id** / `# Rubrics` section / enumeration-time id validation" with the new model: `JUDGE.md` is fully opaque prose (no reserved sections); an author names the applicable rubric in **plain-language prose**; Skillsmith supplies rubric content to the judge automatically from the optional `paths.rubrics` directory (all rubrics loaded; the prose selects which apply); a mistyped/unmatched rubric reference is **not** reported; and the testing agent's task is auto-supplied to the judge on every run, **skill-agnostic** (its `# Skills` section stripped) so `JUDGE.md` need not restate the task.
- **Audience:** Skillsmith users authoring scenarios and configuring projects (skill authors and project maintainers).
- **Files to change:** `README.md`
- **Sections / scope:**
  - The `> [!IMPORTANT]` breaking-change callout that currently says a `JUDGE.md` may "reference reusable rubrics **by id**" — restate as prose rubric references resolved from the optional `paths.rubrics`.
  - The **"The judge brief"** section — remove the claim that the brief has "one optional `# Rubrics` section"; describe the brief as fully opaque prose that may name a rubric in plain language, and state that the judge is auto-supplied the testing task so `JUDGE.md` need not repeat it.
  - The **"Reusable rubrics"** section (heading, anchor, and body) — rewrite end-to-end to the natural-language model: rubrics referenced in prose (not a `# Rubrics` id list), all rubrics under `paths.rubrics` loaded automatically and supplied to the judge, `paths.rubrics` optional, no enumeration-time validation and no per-scenario error for an unmatched reference. Remove the `# Rubrics`-section authoring example and the id-resolution mechanics.
  - The **"Configuration"** prose describing `paths.rubrics` and the judge system-prompt composition (the sentences stating the directory "is required to exist only when a `JUDGE.md` references a rubric by id" and that the judge prompt includes "the resolved content of any referenced rubrics under a `# Grading rubrics` heading") — restate: `paths.rubrics` is optional with no existence gate; when set, its rubrics are supplied to the judge; when unset/empty the judge simply runs with no rubric context and no error; note the task is auto-supplied to the judge minus the `# Skills` section.
  - The **"Migrating from the old model"** bullets that mention the `# Rubrics` section and converting "rubrics to references **by id**" — restate to prose rubric references and the auto-supplied task.
  - Fix any in-page anchors/links that point at the renamed/rewritten rubric section so cross-links stay valid.
- **Depends on:** none
- **Traces to:** Spec requirements 1–7; Acceptance criteria 1, 2, 3, 4, 5, 6; Code plan Tasks 3, 4, 5 (opaque enumeration, load-all rubric delivery, auto-supplied skill-agnostic task); Design doc "Risks → R6 (stale docs/examples)".
- **Acceptance:**
  - A reader understands that `JUDGE.md` is fully opaque prose with no required or reserved sections, and that a rubric is selected by naming it in plain language rather than by an id list.
  - A reader understands rubrics are optional: with no `paths.rubrics` (or an empty one) the judge runs with no rubric context and no error; when set, Skillsmith supplies the rubric content to the judge automatically.
  - A reader understands that a mistyped or unmatched rubric reference is **not** reported by Skillsmith (accepted trade-off), and does **not** cause the scenario to error — this contradicts the old "clear per-scenario error" behavior, which must be removed.
  - A reader understands the judge is automatically told the testing task on every run, and that the task the judge sees excludes the `# Skills` section so the judge stays skill-agnostic; `JUDGE.md` therefore need not restate the task.
  - No remaining text in `README.md` instructs authors to add a `# Rubrics` section, reference rubrics by id, or expect enumeration-time id validation; the verdict is still described as `{ pass, notes }` with reporting and the self-improvement loop unchanged.
  - All in-page cross-links referencing the rubric section resolve to a valid heading anchor.

### Task 2: Reconcile the reference example config's rubrics comment with the new model

- **Goal:** Update the reference config so the `paths.rubrics` documentation describes the natural-language model, not the `# Rubrics` id-list opt-in. Keep `paths.rubrics` documented as optional.
- **Audience:** Skillsmith users copying the reference config into their own project.
- **Files to change:** `examples/skillsmith.config.ts`
- **Sections / scope:** The comment block on the `paths.rubrics` entry that currently says a scenario "opts in by listing rubric ids under a `# Rubrics` heading in its `JUDGE.md`; the harness loads each `<rubrics>/<id>.md` … (An id with no matching file fails that scenario with a clear per-scenario error …)". Rewrite it to: point `paths.rubrics` at a directory of reusable rubric files; a scenario opts in by **naming the rubric in prose** in its `JUDGE.md`; Skillsmith supplies the rubric content to the judge automatically; the key stays optional (omit it when no scenario uses rubrics), with no existence gate; drop the id-matching semantics and the "clear per-scenario error" for an unmatched reference. Keep the surrounding config code and other comments unchanged.
- **Depends on:** none (may proceed in parallel with Task 1; keep the wording consistent with Task 1)
- **Traces to:** Spec requirements 3, 4, 5; Acceptance criteria 2, 3, 4; Design doc "Risks → R6"; Code plan Tasks 2, 3 (load-all rubric delivery).
- **Acceptance:**
  - The `paths.rubrics` comment describes rubric selection as a plain-language reference in `JUDGE.md`, with no mention of a `# Rubrics` id list, id-to-file resolution, or a per-scenario error on an unmatched id.
  - `paths.rubrics` is still documented as optional with no default and no existence gate.
  - The comment is consistent with the README rubric wording from Task 1 (same model, no contradictions).

### Task 3: Fix the testing-project config comment that references rubrics "by id"

- **Goal:** Correct the one-line comment in the bundled testing-project config that states a scenario's `JUDGE.md` references rubrics "by id". The code phase deliberately leaves this file otherwise untouched (it keeps `paths.rubrics: './eval/rubrics'`), so the stale comment must be fixed here or it will contradict the shipped model.
- **Audience:** Contributors and users reading the reference testing-project as an example of a rubrics-enabled project.
- **Files to change:** `testing-project/skillsmith.config.ts`
- **Sections / scope:** Only the comment above the `paths` block that reads "Reusable rubric definitions a scenario's JUDGE.md can reference by id." Reword so it describes a scenario naming the rubric in prose (rubric content supplied to the judge automatically from this directory). Do **not** change the `paths.rubrics: './eval/rubrics'` value or any other code — that value is intentionally retained by the code phase.
- **Depends on:** none
- **Traces to:** Spec requirements 4, 10 (testing-project stays opted into rubrics via `paths.rubrics`); Acceptance criterion 8; Design doc "Risks → R6"; Code plan Task 7 note ("`skillsmith.config.ts` keeps `paths.rubrics` … not touched").
- **Acceptance:**
  - The comment no longer says rubrics are referenced "by id"; it describes a prose reference in `JUDGE.md` with rubric content supplied automatically.
  - The `paths.rubrics: './eval/rubrics'` configuration value is unchanged.
  - The wording is consistent with the README and example-config rubric descriptions (Tasks 1 and 2).
