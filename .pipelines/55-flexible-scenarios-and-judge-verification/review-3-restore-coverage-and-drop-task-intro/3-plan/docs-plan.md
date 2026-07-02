# Docs Plan: Restore full trunk judging coverage in the JUDGE.md briefs, without task repetition

## Overview

This revision's code phase rewrites the bundled testing-project's 11 `testing-project/eval/scenarios/<id>/JUDGE.md` briefs to a fixed two-section template (a task-free all-must-pass decision-rule opener; `## Code checks` carrying trunk's acceptance bullets and closing with a rubric instruction that names the bare rubric id; `## Behavior checks` carrying trunk's live coverage) and realigns one conformance test — zero Skillsmith core changes, no config changes, no changeset. Two documentation surfaces model the now-superseded brief style and must be aligned with what ships: the README's only example judge brief (in `### Reusable rubrics`) still opens with "Decide whether the produced block satisfies the task it was given …" and names the rubric by human-readable title, and the reference example config's `paths.rubrics` comment illustrates rubric referencing with the same title-style example. The design doc explicitly handed the README divergence to this docs phase (design Decision 6 and its Risks entry). Both updates are illustrative-example alignments; no core mechanics changed, so all prose describing how Skillsmith actually works stays as-is.

Per spec R8, this plan deliberately creates **no coverage-mapping documentation** of any kind — coverage parity with trunk is verified by the pipeline's reviewers, not recorded in the repo.

**Changeset posture (verified on the branch):** no docs task adds a changeset. The branch already carries `.changeset/flexible-scenarios-judge-verification.md` (a `minor` entry for the whole PR's feature work), and `npx changeset status --since=origin/trunk` passes with it today; the README and `examples/` edits planned here are prose/comment-only and are covered by that existing entry (CONTRIBUTING: documentation prose-only edits need no changeset; an `examples/skillsmith.config.ts` change requires one only when it exercises a new public API, which these comment edits do not). The existing changeset's content was checked against this revision and remains accurate — it describes core mechanics (two-file model, opaque `JUDGE.md`, rubric naming in prose, auto-supplied task, verdict shape) that this revision does not change.

## Surfaces surveyed

Recorded so reviewers can verify the sweep, per the repo state at planning time (branch `worktree-55-flexible-scenarios-and-judge-verification`, after code-plan approval `409ef10`):

| Surface | Finding |
| --- | --- |
| `README.md` `### Reusable rubrics` example brief (fenced `md` block, ~lines 157–163) | **Stale — Task 1.** Models the superseded task-referencing opener and rubric-by-title naming. |
| `examples/skillsmith.config.ts` `paths.rubrics` comment (~lines 187–199) | **Stale — Task 2.** Illustrates rubric referencing by human title. |
| `README.md` — everything else (two-brief model, lifecycle diagram, `### The judge brief`, judge prompt assembly, `Migrating from the old model`) | Accurate. Describes core mechanics this revision does not change; "You do not restate the task in `JUDGE.md`" already documents the auto-supply rationale. No task. |
| `.changeset/flexible-scenarios-judge-verification.md` | Accurate (core mechanics only; nothing about brief templates or the decision rule). No task. |
| `CONTRIBUTING.md` | No mention of the brief model, rubrics, or the judge. No task. |
| `docs/index.html` (landing page) | Generic two-brief/judge descriptions only; accurate. No task. |
| `testing-project/eval/prompts/judge.md`, `testing-agent.md` | Frozen by spec Out of Scope; verified to be environment/scaffold manuals with no brief-shape references. No task. |
| `testing-project/eval/prompts/improver.md` | Improver prompt is spec Out of Scope; its only brief mention is generic ("a testing-agent brief and a judge brief") and stays accurate. No task. |
| `testing-project/eval/scenarios/_candidates.yaml` header comment | Delegates brief shape to "the converted scenarios alongside this file" — stays accurate once the code phase lands. No task. |
| `src/__tests__/testing-project-scenarios.test.ts` header comment | Rewritten by code-plan Tasks 1 and 13; not docs work. No task. |
| `src/__tests__/testing-project-e2e-removal.test.ts` header comment | Says the rubric "is referenced by id from each scenario" — consistent with the shipped template. No task. |
| Core comments (`src/pipeline/judge-agent.ts`, `src/scenarios/rubric-loader.ts`, `src/scenarios/enumerate.ts`, `src/config/types.ts`) | Describe unchanged mechanics accurately ("apply only the rubric(s) the brief names"). No task — and editing core files is out of scope for this revision. |
| `CHANGELOG.md`, `AGENTS.md`/`CLAUDE.md`, `assets/`, `scripts/` | Historical, changeset-policy-only, or unrelated to the brief model. No task. |

## Guardrail scopes

Both docs-phase gates are fixed commands with no `{scope}` placeholders; there are no scope values to fill.

| Gate | Scope |
| ---- | ----- |
| changeset-format | None — fixed command `npx tsx scripts/validate-changesets.ts` |
| changeset-status | None — fixed command `npx changeset status --since=origin/trunk` |

## Tasks

Both tasks run after the code phase; the docs-writer derives the conventions to model by reading the shipped briefs (any `testing-project/eval/scenarios/<id>/JUDGE.md` on the branch), not this plan or the design doc's illustrations.

### Task 1: Align the README's example judge brief with the shipped brief conventions

- **Goal:** The README's only `JUDGE.md` example — the fenced block inside `### Reusable rubrics` — models the pre-revision brief style: an opening line that references the task ("Decide whether the produced block satisfies the task it was given …") and rubric selection by human-readable title. Update the example (and only as much surrounding prose as consistency requires) so it models the conventions the shipped briefs now embody: a task-free opening that states the all-must-pass decision rule, and rubric selection by the rubric's id.
- **Audience:** Skillsmith users authoring scenarios and judge briefs — external consumers of the `@automattic/skillsmith` package reading the README as the primary manual.
- **Files to change:** `README.md`
- **Sections / scope:** The fenced example in `### Reusable rubrics` (~lines 157–163 at planning time), plus the sentence(s) that directly frame it if they describe the example's contents. Read-and-verify only (no rewrite expected): the rest of `### Reusable rubrics` and `### The judge brief`, which describe unchanged core mechanics and were checked accurate at planning time.
- **Depends on:** none
- **Traces to:** Design Decision 6 (README divergence explicitly handed to the docs phase) and Decision 3 (the template the example must reflect); spec R2 / acceptance criterion 3 (rubric named, not inlined) and R5 / acceptance criterion 4 (no task restatement) as the rationale the example teaches; code-plan Tasks 2–12 (the shipped briefs the example mirrors).
- **Acceptance:**
  - The example no longer opens by referencing the task the block was given; a reader sees a task-free opening that states the verdict rule (pass only when every check, including the rubric check, is satisfied), consistent in intent with the fixed opener of the shipped briefs.
  - The example demonstrates selecting a rubric by its id — the filename-derived id that matches the `# Rubric: <id>` label the judge sees — rather than by a prose title, so a reader learns the unambiguous selection pattern.
  - The surrounding prose still accurately states the unchanged core mechanics: rubric selection is plain-language prose, Skillsmith parses nothing from `JUDGE.md`, and rubric references are not validated. The update introduces no claim that Skillsmith parses or enforces rubric ids.
  - A reader who copies the example's shape into a new project produces a brief consistent with the bundled testing-project's shipped briefs (cross-checkable against any scenario's `JUDGE.md` on the branch).
  - Both docs-phase gates pass without adding a changeset (`npx tsx scripts/validate-changesets.ts`; `npx changeset status --since=origin/trunk` — satisfied by the branch's existing changeset).

### Task 2: Align the reference config's rubric-reference illustration with the id-naming convention

- **Goal:** The annotated reference config's comment above `paths.rubrics` illustrates how a `JUDGE.md` opts into a rubric with a title-style example ("grade the code against the WordPress Interactivity API best-practices rubric"). Update the illustration so it demonstrates naming the rubric by its id, matching the convention the shipped briefs use.
- **Audience:** Users scaffolding a new project from the annotated reference config (`examples/skillsmith.config.ts` is consumer-facing reference code).
- **Files to change:** `examples/skillsmith.config.ts`
- **Sections / scope:** Comment text only, in the `paths` block's `rubrics` annotation (~lines 187–199 at planning time). No code changes; no other comment blocks unless they repeat the superseded illustration (none found at planning time).
- **Depends on:** none
- **Traces to:** Design Decision 3 (the bare rubric id is the activation key under the judge's rubric-selection lead-in); spec R2 / acceptance criterion 3; code-plan Tasks 2–12 (the shipped rubric sentence the illustration should be consistent with).
- **Acceptance:**
  - The comment's illustrative rubric reference demonstrates naming the rubric id, consistent with how the shipped briefs reference the rubric; it no longer presents a title-only reference as the pattern to follow.
  - The comment still accurately states the unchanged mechanics it documents today: the key is optional with no default and no existence gate, there is no `# Rubrics` id list and no reserved grammar, and Skillsmith supplies loaded rubric content to the judge automatically.
  - The change is comment-only and behaviorally inert: `npm run typecheck` and `npm run lint` pass unchanged.
  - Both docs-phase gates pass without adding a changeset (comment-only edit to reference code that exercises no new public API, per CONTRIBUTING's changeset policy).
