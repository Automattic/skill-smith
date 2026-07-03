# Docs Plan: Unified cleanup, judge library, and centralized decision rule

## Overview

This revision's code phase replaces Skillsmith's two judge-material config channels (`roles.judge.prompt` + `paths.rubrics`) with a single judge-scoped directory, `roles.judge.library` — its entry `README.md` inlined into the judge prompt as the environment manual, its full contents copied per pair into the judge's working directory at `judge-library/` and announced by a manifest, with an inline fallback for judges without file tools, a `checkPaths` existence gate, and loud validation-time rejection of the two removed keys. It also centralizes the all-must-pass decision rule into the harness output instruction as an overridable default (the 11 bundled briefs drop their repeated opener and re-point their rubric sentence to a `judge-library/<rel>` path form), adds an always-present missing-material failure duty to the output instruction, removes the write-only `RunScenario.dirName` alias, adds a `judging: { duration, tokenUsage? }` block to the per-pair `report.json`, deletes the testing-project's `env:start`/`env:stop` npm scripts, and lands three changeset actions. The documentation phase realigns every consumer-facing surface to that shipped state (spec R8): five README workstreams (the judge-material model, the configuration reference, the lifecycle/report schema, the breaking-change note and migration section, and a crash-recovery note replacing the deleted `env:stop` script), the fuller comment realignment of `examples/skillsmith.config.ts` that the design's comment-split rule reserved for phase 5, a release-record consistency pass over the pending changesets (including one pre-existing changeset the code plan does not touch whose prose the `dirName` removal falsifies), and a final cross-surface sweep.

**Changeset posture:** no docs task adds a changeset. The branch's code phase lands the three changeset actions that cover every semantic change these docs describe (the rewritten feature changeset, the `BREAKING:` wave changeset with the migration recipe, and the `judging`-block changeset); the README and `examples/` edits planned here are prose/comment realignment to those already-recorded changes, and CONTRIBUTING exempts documentation prose, `testing-project/`, and the `docs/` landing page outright. Task 7 edits the text of one existing pending changeset (release-record maintenance), which requires no additional changeset. Both docs-phase gates are run after every task.

**Standing rules for every task:**

- **Derive wording from the shipped state, not from this plan.** Exact key names, prompt-section shapes, error messages, sentence forms, and file layouts are read from the code, briefs, and changesets on the branch after the code phase. Where this plan names specifics (e.g. `roles.judge.library`, `judge-library/`), they are the design-fixed contract the code phase implements; verify them against the shipped code before writing.
- **No coverage-mapping documentation** (spec R6): no task creates any artifact mapping briefs to trunk checks; coverage parity is verified by the pipeline's reviewers only.
- **Docs do not change behavior:** tasks touch Markdown prose, comments, and changeset text only. Anything discovered that requires a source-code change is reported as a blocker, not fixed in this phase.
- **Keep intra-document anchors working:** README section headings are cross-linked from multiple places (including the top-of-file breaking-change note); any heading change must update every referring link in the same task.
- **Gates:** every task finishes by running both docs-phase gates (`npx tsx scripts/validate-changesets.ts`, `npx changeset status --since=origin/trunk`) and commits only when both pass.

## Guardrail scopes

Both docs-phase gates are fixed commands with no `{scope}` placeholders; there are no scope values to fill.

| Gate | Scope |
| ---- | ----- |
| changeset-format | None — fixed command `npx tsx scripts/validate-changesets.ts` |
| changeset-status | None — fixed command `npx changeset status --since=origin/trunk` |

## Surfaces surveyed

Recorded so the reviewer can verify the sweep. Verified at planning time against branch head `9a9dbb3` (pre-code-phase) and against the approved code plan's declared end state; line numbers are pre-code-phase. Negative claims ("no task") assert that the surface, as it will exist after the code phase, makes no claim this revision falsifies.

| Surface | Finding |
| --- | --- |
| `README.md:25–26` — the `> [!IMPORTANT]` breaking-change note (pre-existing, from the base run) | **Stale — Task 4.** Describes rubric supply "automatically from an optional `paths.rubrics` directory". |
| `README.md:137–148` — `### The judge brief` | **Stale — Task 1.** Points shared grading criteria at the reusable-rubric/`paths.rubrics` channel; says nothing about the harness-owned decision-rule default, brief-prose override, or missing-material failure duty. |
| `README.md:149–172` — `### Reusable rubrics` (incl. the example brief at :157–166 with the opener, and the ":168 Note the opening" paragraph added by review-3's docs phase) | **Stale — Task 1.** The whole section documents the retired load-all model: flat `<id>.md` under `paths.rubrics`, bare-id naming, `# Grading rubrics` heading, selection lead-in, "silently unavailable" missing-rubric behavior, "no existence gate". |
| `README.md:261–318` — `### Configuration` (config example :263–312; `paths` paragraph :314; prompt-assembly paragraph :316) | **Stale — Task 2.** :314 documents `paths.rubrics`; :316 documents `roles.judge.prompt`, `# Role instructions` on the judge, and the `# Grading rubrics` section; the example's judge role shows no `library`. |
| `README.md:89–99, 102–125` — lifecycle diagram and numbered lifecycle (`dirName` alias :105; copy step :115; judge prompt :117; agent report :118) and `README.md:237–259` — `### Per-iteration reports` | **Stale/incomplete — Task 3.** :105 documents the removed `dirName` alias; the copy step and diagram omit the per-pair library copy; :118 and the report example omit the new `judging` block. |
| `README.md:174–185` — `### Environment ownership and judge concurrency`; `README.md:127–135` — `### Hook examples` | **Accurate but gains content — Task 5.** Describes the once-per-run warm `wp-env` lifecycle; the design mandates a crash-recovery one-liner here after `env:start`/`env:stop` are deleted. No claim falsified. |
| `README.md:342–349` — `## Migrating from the old model` | **Stale — Task 4.** :347 directs migrating users to `paths.rubrics`; no notes exist for this revision's breaking wave (library replaces the two keys; `dirName` gone; decision rule centralized). |
| `README.md` — everything else (Two parts, scenario/usage/selection docs :28–87, self-improvement :187–235, hooks table :328–340, CLI flags, installation, releases) | Accurate post-change: no references to rubrics, the judge prompt key, `dirName`, or env scripts (verified by sweep). Re-verified by Task 8; no dedicated task. |
| `examples/skillsmith.config.ts` | **Stale beyond the code-phase minimum — Task 6.** Code Task 7 makes the compile-forced edit (swap `prompt` → `library`, delete the `judgePrompt` boilerplate and the `paths.rubrics` block with attached comments, minimal judge-comment rewrite). The design reserves the fuller consumer-docs realignment (library conventions, rubric-by-path illustration) for phase 5. |
| `testing-project/skillsmith.config.ts` comments | Rewritten minimally by code Task 8 (library wiring, no comment naming a removed key). Verified adequate by Task 8 of this plan; residue fixed there if the minimal rewrite left stale prose. |
| `testing-project/eval/judge/README.md` (post-code; today `eval/prompts/judge.md`) | **Code-phase content, no docs task.** Its relocation (code Task 8) and framing-sentence merge (code Task 9) are code-plan work with their own acceptance. |
| `testing-project/eval/prompts/testing-agent.md`, `improver.md` | Accurate — only generic judge/verdict mentions ("the judge's verdict and its notes", "a testing-agent brief and a judge brief"), all still true. No rubric/`dirName`/env-script references (verified). No task. |
| `testing-project/eval/scenarios/_candidates.yaml` header | Accurate — delegates brief conventions to "the converted scenarios alongside this file", which remains correct once code Task 9 lands. No task. |
| `testing-project/package.json` | `env:start`/`env:stop` deleted by code Task 2; contains no prose. No task (the surviving crash-recovery use is documented by Task 5). |
| `.changeset/flexible-scenarios-judge-verification.md` + the two new changesets | Written/rewritten by code Task 12. Task 7 verifies the three read together consistently (design risk: "the retired load-all model is described nowhere"). |
| `.changeset/nested-scenario-folders.md` | **Stale — Task 7.** Says "`dirName` remains available as an alias" — falsified by code Task 11 and not covered by code Task 12's three actions. |
| `.changeset/initial-scaffolding.md`, `claude-code-subscription-auth.md`, `wordpress-coding-standards.md`, `.changeset/README.md` | Accurate/boilerplate — no mention of rubrics, judge prompt, `dirName`, or env scripts (verified). No task. |
| `CONTRIBUTING.md` | No mention of the judge-material model, rubrics, `dirName`, or env scripts (verified); its gate/script lists are unaffected by this revision. Governs the changeset posture above. No task. |
| `docs/index.html` (landing page) | Generic two-brief/judge/live-verification prose only; no config-surface, rubric, report-schema, or `dirName` claims (verified). Still accurate post-change. No task (re-verified by Task 8). |
| `CHANGELOG.md` | Historical release record; not retroactively edited. No task. |
| `AGENTS.md`, `CLAUDE.md`, `.rp.md` | Changeset-policy and pipeline-convention docs; no product-behavior claims affected. No task. |
| `assets/` | `self-improvement-loop.png` stays live (README:193). `skill-tester-workflow.png` is deleted by code Task 1 with zero references outside `.pipelines/` (verified). No task. |
| `src/` code comments and `src/__tests__/` file headers | Phase-4 property per the design's comment-split rule (no comment may name a removed key); out of docs-phase scope. No task. |
| `bin/`, `scripts/`, `.github/`, `package.json` description, `testing-project/skills/` | No affected documentation text (verified: no rubric/judge-key/`dirName`/env-script references). No task. |

## Tasks

### Task 1: README — rewrite the judge-material sections to the judge-library model

- **Goal:** Replace the README's account of how grading material reaches the judge — currently the load-all `paths.rubrics` model with a selection lead-in — with the shipped judge-library model, and document the two verdict-semantics defaults that moved into the harness: the all-must-pass decision rule (brief prose overrides) and the missing-material failure duty. After this task a reader can set up a judge library, understand what the judge receives and from where, reference library items from a brief, and predict what happens when a referenced item is missing.
- **Audience:** External consumers of `@automattic/skillsmith` authoring judge briefs and judge material — the README is their primary manual.
- **Files to change:** `README.md`
- **Sections / scope:** `### Reusable rubrics` (:149–172 at planning time — rewrite wholesale, retitling the section to match the shipped library concept if the writer judges that clearer, updating every anchor link to it: :26, :139, :314, :347 at planning time) and `### The judge brief` (:137–148 — the shared-criteria sentence, plus new coverage of the decision-rule default/override and the observable-failure behavior where the section describes verdict semantics). Content to cover, with specifics read from the shipped code (`src/pipeline/judge-library.ts`, `src/pipeline/judge-agent.ts`, the shipped briefs, and the testing-project's shipped library): the single judge-scoped directory knob and what users may put in it; the entry `README.md` inlined as the environment manual (replacing the old judge role prompt); the per-pair copy into the judge's working directory and the manifest announcing it; how briefs opt into specific items (relative-path form — update the fenced example brief to mirror a shipped brief's conventions, including the absence of the opener); the selection semantics (only brief-named items apply); the layered observable-failure story as shipped (start-up gate for a missing library directory; validation-time rejection of the removed keys; the judge-time duty to fail and name missing material — replacing the current "silently unavailable … proofread yourself" paragraph); and the supply degradation for judges without file-reading tools.
- **Depends on:** none
- **Traces to:** Spec R3 and acceptance criteria 3–4; spec R4 and acceptance criterion 5 (the documented home of the decision rule); code plan Tasks 6, 7, 9; design decisions "Two-tier supply", "Tool-less degradation rule", "The selection lead-in dies", "Observable failure … layered", "Decision rule lives in the harness output instruction".
- **Acceptance:**
  - A reader can create and wire a judge library from these sections alone: which config key to set, what an entry `README.md` does, how the material reaches the judge (prompt vs. working-directory copy), and how a brief names an item — all consistent with the shipped testing-project's library and briefs.
  - The sections state that grading material is supplied to judges only (the testing agent never receives it) and that a judge without file-reading tools still receives the material.
  - The missing-material behavior documented is the shipped observable-failure contract; the claim that a missing rubric's criteria are "silently unavailable" appears nowhere in the file.
  - The decision rule is documented as a harness-owned default with the brief-prose override, and the fenced example brief models the shipped brief conventions (no decision-rule opener; library-path rubric reference); the ":168 Note the opening" framing paragraph no longer describes an opener that briefs no longer carry.
  - No paragraph in either section still describes the load-all model, the `# Grading rubrics` prompt section, the selection lead-in, bare-id rubric naming as the convention, or `paths.rubrics`; every anchor that pointed at the rewritten section still resolves.
  - Both docs-phase gates pass with no new changeset.

### Task 2: README — realign the configuration reference

- **Goal:** Make the `### Configuration` section describe the shipped config surface: the judge role's `library` knob (with its existence gate), the `paths` block without `rubrics`, and the judge system-prompt assembly as actually built — so a reader configuring a project from this section sets only keys that exist.
- **Audience:** External consumers writing `skillsmith.config.ts` for their own projects.
- **Files to change:** `README.md`
- **Sections / scope:** `### Configuration` only: the annotated config example (:263–312 at planning time — the judge role and any comment prose that references judge prompts; show the library knob the way the section shows the other judge knobs), the `paths` defaults paragraph (:314 — drop the `paths.rubrics` sentence, keeping the surviving defaults accurate), and the role-prompt/prompt-assembly paragraph (:316 — rewrite to the shipped facts: which roles still take `prompt` and what each does; the judge's system-prompt section order as read from the shipped `judge-agent.ts`/`judge-library.ts`, including where the library section and the manual land; note the validation-time rejection of the removed keys where the section documents config errors, cross-linking the migration notes from Task 4).
- **Depends on:** Task 1 (shares terminology and anchor targets with the rewritten judge-material section)
- **Traces to:** Spec R3 and acceptance criterion 3 (removed config surface, single directory); code plan Task 7; design decisions "Config key is `roles.judge.library`" and the "Interfaces and Data Flow" config-surface section.
- **Acceptance:**
  - A reader following the configuration section configures only keys that exist on the shipped surface: the section presents the judge's library knob and no longer presents `paths.rubrics` or a judge-role `prompt`.
  - The prompt-assembly description matches the shipped judge system prompt section-for-section (verifiable against the shipped assembler), and correctly scopes `prompt` to the roles that still accept it.
  - The section (or a cross-linked note) tells a reader with the old keys what error they will hit and where to find the migration path.
  - The `test` and `improver` role documentation is unchanged in meaning (both keep `prompt`; improver semantics untouched).
  - Both docs-phase gates pass with no new changeset.

### Task 3: README — lifecycle, diagram, and report schema

- **Goal:** Bring the lifecycle walkthrough, the flow diagram, and the report documentation in line with the shipped run: no `dirName` alias on scenario records, the per-pair judge-library copy in the judge bracket, and the `judging` block in the per-pair report with its exact presence rule.
- **Audience:** Hook authors and report consumers — readers who destructure scenario records in hooks and parse `report.json`.
- **Files to change:** `README.md`
- **Sections / scope:** The `### Lifecycle` numbered walkthrough (:102–125 at planning time): remove the `dirName` alias from the scenario-record description (:105), add the library copy where the walkthrough narrates the judge bracket (copy timing relative to `beforeJudgeAgent` as shipped, only when a library is configured), align the judge-prompt and agent-report steps (:117–118) with the shipped assembly and report shape. The Mermaid flow diagram (:89–99): update only if the writer judges the shipped flow (library copy) belongs at the diagram's altitude; it must at minimum not contradict the shipped flow. `### Per-iteration reports` (:237–259): extend the JSON example and prose with the `judging` block and state its presence rule as shipped (present iff the judge phase ran; `tokenUsage` iff the provider reported usage; never zero-filled). `### Hooks` (:328–340) checked for scenario-record field mentions.
- **Depends on:** Task 1 (uses the library terminology introduced there)
- **Traces to:** Spec R5 via the ship-now dispositions (proposal 6 scoped, `dirName`) and acceptance criterion 7; code plan Tasks 7 (agent-loop wiring), 10 (`judging` block), 11 (`dirName` removal); design decisions "`dirName` removal", "`judging: { duration, tokenUsage? }` report block", "Per-pair report".
- **Acceptance:**
  - A hook author reading the lifecycle learns the scenario-record surface that ships (no `dirName` anywhere in the file; `id`/`scenario` documented as the surface), and learns at what point the judge library appears on disk relative to `beforeJudgeAgent`.
  - A report consumer can predict from the README exactly when `report.json` contains a `judging` block and when it carries `tokenUsage`, and the documented shape matches a real shipped report (verifiable against the code phase's report tests).
  - The flow diagram does not contradict the shipped flow.
  - Both docs-phase gates pass with no new changeset.

### Task 4: README — breaking-change note and migration notes for the new wave

- **Goal:** Update the two places that frame breaking changes for consumers — the pre-existing top-of-file `> [!IMPORTANT]` note and the `## Migrating from the old model` section — so they describe the shipped model and give a migration path for this revision's wave: the two removed config keys (with the library as the target), the removed `dirName` alias, and the centralized decision rule for brief authors.
- **Audience:** Consumers upgrading a project that used the previous config surface (including anyone tracking this branch pre-release), and new readers gauging the package's current model from the top-of-file note.
- **Files to change:** `README.md`
- **Sections / scope:** The `> [!IMPORTANT]` note (:25–26 at planning time): rewrite its rubric sentence to the shipped supply model, keeping the note's role (a concise no-backward-compatibility banner) intact. `## Migrating from the old model` (:342–349): fix the `paths.rubrics` instruction (:347) to point at the shipped mechanism, and add migration notes for this revision's breaking wave — move the manual into the library's entry file, move rubric files into the library and re-point brief references to the path form, replace the removed keys with the library knob (naming the validation error a stale config hits), drop per-brief decision-rule openers (the harness owns the default; brief prose overrides), and switch any hook code reading `dirName` to `id`. Whether the wave lands as an extension of the existing section or a sibling subsection is the writer's call; the recipe's substance must match the breaking changeset the code phase wrote (read them together).
- **Depends on:** Task 1, Task 2 (links into the sections they rewrite)
- **Traces to:** Spec R8 ("migration notes for the removed config keys") and R7; acceptance criteria 3 (removed surface) and 8; code plan Tasks 7, 11, 12; design decisions "Config key is `roles.judge.library`" (rejection message serves the migration notes) and "Changeset plan".
- **Acceptance:**
  - A consumer with a config setting either removed key can migrate using the README alone: they learn what error they will see, where each piece of material goes, and how briefs reference it afterwards.
  - A hook author destructuring `dirName` learns the replacement (`id`) from the migration notes.
  - A brief author learns they no longer state the all-must-pass rule per brief and how to override the default when they need a different rule.
  - The README's migration guidance and the breaking changeset on the branch agree (no contradictory recipe); the top-of-file note no longer describes rubric supply via `paths.rubrics`.
  - Both docs-phase gates pass with no new changeset.

### Task 5: README — crash-recovery one-liner replacing the deleted `env:stop` script

- **Goal:** Preserve the one real use of the deleted `env:stop` npm script — stopping a leftover warm environment after a crashed run — as a one-line manual command in the docs, per the design's cleanup decision ("phase 5 adds that line to the docs where the warm-env lifecycle is described").
- **Audience:** Contributors running the bundled testing-project, and consumers who copied its warm-environment pattern into their own projects.
- **Files to change:** `README.md`
- **Sections / scope:** `### Environment ownership and judge concurrency` — the paragraph describing the reference project's once-per-run warm `wp-env` lifecycle (:178 at planning time) is the chosen home (this plan's decision: it is the only section that explains the boot-once/stop-at-end lifecycle whose crash case the note addresses; `### Hook examples` :133 may be touched instead if the writer finds the note reads better there, but the note lands exactly once). One or two sentences: if a run dies before `afterAllScenarios`, the warm environment stays up; how to stop it manually — the exact command derived from the shipped testing-project state (the design records it as `npx wp-env stop` run from the testing-project root; verify against the shipped `package.json` and `wp-env-judge.ts` before writing).
- **Depends on:** none
- **Traces to:** Spec R1 (cleanup finding: `env:start`/`env:stop` deletion) and acceptance criterion 1; code plan Task 2; design decision "Cleanup plan — `env:start`/`env:stop`: delete both".
- **Acceptance:**
  - A reader whose run crashed mid-sweep finds, in the section describing the warm-environment lifecycle, the manual command to stop the leftover environment — stated exactly once in the file.
  - The command works against the shipped testing-project (no reference to the deleted npm scripts anywhere in the file).
  - Both docs-phase gates pass with no new changeset.

### Task 6: `examples/skillsmith.config.ts` — full comment realignment to the library model

- **Goal:** Complete the consumer-docs half of the design's comment split: the code phase made the minimum compile-forced edit (library key set, removed-key comments deleted, minimal judge-comment rewrite); this task realigns the file's annotation prose so the reference config teaches the library model as thoroughly as it taught the prompt/rubrics model.
- **Audience:** Users scaffolding a new project from the annotated reference config (consumer-facing reference code per CONTRIBUTING).
- **Files to change:** `examples/skillsmith.config.ts`
- **Sections / scope:** Comment text only — no code changes beyond what phase 4 shipped. The judge-role comment block: expand the code phase's minimal rewrite into full guidance on the library knob, at the depth the old block gave `prompt` — what belongs in the directory (environment manual as the entry `README.md`, rubrics, reference docs), what Skillsmith does with it (manual inlined; contents copied per pair into the judge's working directory; manifest; inline fallback for tool-less judges — depth at the writer's judgment, consistent with the shipped mechanics), and how briefs opt in (a rubric-by-path illustration replacing the deleted `paths.rubrics` comment's bare-id illustration, mirroring a shipped brief's reference form). Sweep the file's other comments (file header, prompt-loading preamble, `paths` block, hook comments) for any prose the new model stales; the hook comments destructuring `judgeWorkspace` are correct and stay.
- **Depends on:** Task 1 (the README sections this file's comments implicitly parallel)
- **Traces to:** Spec R8; acceptance criteria 3–4 (the surface the example demonstrates); code plan Task 7 (the minimum edit this task builds on); design "Components — `examples/skillsmith.config.ts`" (phase-4/phase-5 comment split).
- **Acceptance:**
  - A user copying the judge role from the example learns what to put in a library directory, what Skillsmith does with each part, and how a brief references an item — consistent with the shipped testing-project's library and briefs.
  - The file contains a rubric-by-path illustration and no comment presenting bare-id rubric naming, `paths.rubrics`, or a judge-role `prompt` as current surface.
  - The edit is comment-only relative to the code phase's shipped file (no configuration values change); `npm run typecheck` and `npm run lint` still pass.
  - Both docs-phase gates pass with no new changeset (comment-only edit exercising no new public API, per CONTRIBUTING).

### Task 7: Changesets — fix the falsified `dirName` clause and verify the release record reads consistently

- **Goal:** Make the pending release record internally consistent with the shipped surface: one pre-existing pending changeset asserts "`dirName` remains available as an alias", which the code phase's `dirName` removal falsifies and code Task 12's three actions do not touch; and the design directs the docs phase to read the three code-phase changeset texts together so the retired model is described nowhere.
- **Audience:** Consumers reading the eventual release notes (every pending changeset becomes a bullet in the same first release).
- **Files to change:** `.changeset/nested-scenario-folders.md` (edit); `.changeset/flexible-scenarios-judge-verification.md` and the two changesets added by code Task 12 (read-and-verify only — edit only if a falsified-by-the-shipped-state claim survived the code phase)
- **Sections / scope:** In `nested-scenario-folders.md`, amend the alias clause so the entry no longer asserts `dirName`'s availability (the entry's real payload — recursive discovery and folder filters — is untouched; the breaking changeset owns the removal story). Then read all pending changesets together and verify: the retired load-all rubric model and the removed keys are described nowhere as current behavior; the breaking wave and its migration recipe appear exactly once; the `judging` entry states its presence rule; no entry uses `major`. Fix only textual inconsistencies of this kind; report anything structural (missing changeset, wrong bump type) as a blocker rather than authoring new release records in the docs phase.
- **Depends on:** none (runs against the post-code-phase changeset set)
- **Traces to:** Spec R7 and R8; acceptance criterion 8; code plan Tasks 11, 12; design "Changeset plan — three actions" and the risk "the three changeset actions must stay mutually consistent … the docs phase should read them together".
- **Acceptance:**
  - No pending changeset asserts that `dirName` is available, or presents `paths.rubrics`, `roles.judge.prompt`, or the load-all rubric model as current behavior (removal/migration descriptions are the permitted mentions).
  - The pending set read as one release note is coherent: the wave and migration recipe stated once, the `judging` presence rule stated, and no mutual contradictions.
  - `npx tsx scripts/validate-changesets.ts` and `npx changeset status --since=origin/trunk` pass; no changeset uses `major`; no new changeset was added by this task.

### Task 8: Cross-surface consistency sweep

- **Goal:** Close the phase with a verified negative: after Tasks 1–7, no documentation surface in the repository still presents the retired model as current. This is the docs-phase backstop for drift between this plan's survey (taken pre-code-phase) and what actually shipped.
- **Audience:** The docs reviewer and future contributors — this task's value is the guarantee, plus fixes for any residue it finds.
- **Files to change:** None expected; any file where residue is found, provided the fix is docs-phase scope (Markdown prose, comments, changeset text). Residue requiring source-code changes is reported as a blocker.
- **Sections / scope:** Sweep the repository's documentation surfaces — at minimum: `README.md` end-to-end (including sections no earlier task edited), `examples/skillsmith.config.ts`, `testing-project/skillsmith.config.ts` comments (verify the code phase's minimal rewrite reads as adequate consumer guidance; align if stale prose survived), `testing-project/eval/prompts/*.md`, `testing-project/eval/judge/README.md` (verify-only — its content is code-phase property; report contradictions as blockers rather than editing), `testing-project/eval/scenarios/_candidates.yaml` header, `docs/index.html`, `CONTRIBUTING.md`, `CHANGELOG.md`, `.changeset/*.md`, `AGENTS.md`/`CLAUDE.md` — for references to: `paths.rubrics`, `roles.judge.prompt`, bare-id rubric naming as the convention, the `# Grading rubrics`/selection-lead-in prompt shape, `dirName`, `env:start`/`env:stop`, `eval/prompts/judge.md`, `eval/rubrics/`, the per-brief decision-rule opener, and the silently-missing-rubric behavior. Treat this list as a starting point: also sweep for the shipped surface being described *incorrectly*, not just the old surface being described at all.
- **Depends on:** Tasks 1–7
- **Traces to:** Spec R8 (docs reflect the shipped state) and acceptance criteria 3, 5, 7, 8; the whole code plan (Tasks 1–12) as the shipped state being reflected.
- **Acceptance:**
  - A repository-wide search for each retired-surface term above finds no documentation text presenting it as current (permitted mentions: migration notes, release-record removal descriptions, and historical records such as `CHANGELOG.md`).
  - The testing-project config's comments accurately describe its shipped library wiring.
  - Any residue found was either fixed in this task's commit (docs-phase scope) or reported as a blocker naming the file and the required code-phase change.
  - Both docs-phase gates pass with no new changeset.
