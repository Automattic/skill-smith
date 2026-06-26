# Docs Plan: More flexible scenario definition and judge-verified behavior

## Overview

This change replaces Skillsmith's structured scenario model (`scenario.yaml` + linked rubrics + per-scenario `acceptance`/`prompt`/`description`, plus Playwright `e2e.spec.mjs` runtime checks) with **two opaque prose files per scenario** — a testing-agent brief (`TESTING-AGENT.md`) and a judge brief (`JUDGE.md`) — where the only parsed structure is a `# Skills` section in the testing brief. The judge stops being a read-only rubric grader and becomes a **live behavioral verifier** running against an isolated copy of the produced workspace with a **project-configured capability set** (tools / MCP / sandbox), returning a single `{ pass, notes }` verdict, and never able to mutate the artifact under evaluation. The consuming project owns its live environment via the existing `beforeJudgeAgent`/`afterJudgeAgent` hooks, gated by a new `roles.judge.concurrency` knob. This is a clean break with no backward compatibility. Because the README, the public landing page, the reference example config, and several narrative files across the repo describe the old model, every prose surface that mentions `scenario.yaml`, rubrics, acceptance, the e2e/`afterAllScenarios` verification gate, the read-only-grader judge, or the `{ rubrics, acceptance }` verdict must be rewritten to the new model so the shipped behavior and its documentation stay in sync. The docs phase runs **after** the code lands and documents the actually-shipped code.

These tasks cover **narrative/README/guide/example/configuration docs and non-symbol inline narrative only**. Two adjacent kinds of work are explicitly **out of scope here** because they belong to the code phase: (a) symbol-level JSDoc on exported symbols (shipped in the code phase), and (b) the breaking-change changeset (code-plan Task 19). Scenario-input files (`TESTING-AGENT.md`/`JUDGE.md` for the 11 `testing-project` scenarios), the `testing-project/skillsmith.config.ts` rewrite, the deletion of the Playwright harness, and the `_candidates.yaml` header scrub are all **code-plan tasks (16–18)**, not documentation tasks — this plan does not duplicate them.

## Guardrail scopes

No scoped gates were passed to this phase. The docs phase enforces the two fixed (unscoped) changeset gates — `npx tsx scripts/validate-changesets.ts` (changeset format) and `npx changeset status --since=origin/trunk` (changeset present) — which the code-phase changeset (code-plan Task 19) keeps green; no documentation task here authors or alters a changeset.

| Gate | Scope |
| ---- | ----- |
| None | None |

## Tasks

The tasks are ordered most-load-bearing first (README, then the landing page, then the reference config), followed by the smaller narrative surfaces. Each is independently committable. Every task documents the **actually-shipped** code — the docs-writer reads the merged implementation (the new `Scenario` shape, the `# Skills` rules, the judge capability descriptor, the `{ pass, notes }` verdict, the concurrency knob, the env-ownership hook timing) to fill in concrete wording, names, and examples.

### Task 1: Rewrite the README to the two-file scenario + live-judge model

- **Goal:** Replace every old-model section of the root README with the new model: a scenario is two self-contained prose files (a testing-agent brief and a judge brief); the only parsed structure is a required `# Skills` section in the testing brief; the judge verifies behavior live against a project-owned environment with project-configured capabilities and returns an overall pass/fail plus notes; the project owns environment setup/teardown via the per-pair judge hooks; and there is no `scenario.yaml`, no rubrics/acceptance/`prompt`/`description` fields, no `Paths.rubrics`, and no Playwright/`afterAllScenarios` e2e gate. Prominently flag the clean break (no backward compatibility) for existing consumers.
- **Audience:** Consumers of `@automattic/skillsmith` — people defining scenarios, configuring the judge, and reading run reports (both first-time evaluators and existing users migrating off the old model).
- **Files to change:** `README.md` (root).
- **Sections / scope:**
  - "How the Skill Tester works" — redefine a scenario as the two briefs; replace the `scenario.yaml` ID examples with the equivalent two-file folder layout; keep the scenario-ID / parent-folder filtering and nested-discovery semantics (these are retained), but drop any wording implying scenarios are defined by `scenario.yaml` and drop the "filters match scenario IDs, not `scenario.name` inside `scenario.yaml`" caveat that no longer applies under `name === id`.
  - Lifecycle / hook descriptions — update the per-agent steps so the testing agent receives the testing brief (not `scenario.prompt`) and the judge runs live against the project environment with project-configured capabilities; remove the duplicate-`scenario.name`-rejection language (names are unique by construction now); describe environment ownership through the per-pair `beforeJudgeAgent`/`afterJudgeAgent` hooks and the new judge-concurrency knob.
  - "Rubrics and the judge" — remove or replace wholesale: the judge no longer consults rubrics or a per-scenario acceptance list; document instead that the judge brief is freeform prose the project writes to ask for whatever it needs (code review, acceptance checks, live UX/console checks, etc.), and explain the no-modify guarantee (the judge runs against an isolated copy of the produced workspace).
  - "afterAllScenarios — the verification gate" — rewrite so live behavioral verification is now the judge's job (no separate Playwright e2e gate); if the generic `afterAllScenarios` extension point is retained in the shipped code, describe it accurately as an optional generic gate rather than the e2e mechanism, otherwise remove the section.
  - "Per-iteration reports" / the report-JSON example — replace the `{ rubrics, acceptance }` review block and its failing-items example with the shipped `{ pass, notes }` verdict shape, and reflect how notes surface on failure.
  - Self-improvement section — keep its behavior, but ensure any references to rubrics/acceptance/e2e as the failure signal are updated to the judge's notes.
  - Configuration block — update so it reflects the new judge-capability configuration surface and the judge-concurrency knob, and remove `paths.rubrics`.
- **Depends on:** none
- **Traces to:** Spec requirements 1, 2, 3, 4, 6, 7, 9, 10, 11; Acceptance criteria 1, 2, 5, 7, 8, 10; Design "Docs → README.md"; Risk R10 (README/docs drift); Code tasks 1, 2, 4, 11, 12, 13.
- **Acceptance:**
  - A consumer reading the README understands that a scenario is defined by exactly two prose files in its folder (a testing-agent brief and a judge brief), with no `scenario.yaml`.
  - The reader can identify the one required structural element — the `# Skills` section in the testing brief — and understands the rest of each file is opaque prompt text passed through to the relevant agent.
  - The reader understands the judge verifies behavior on a live, project-owned environment using project-configured capabilities, returns an overall pass/fail plus notes, and cannot alter the files the testing agent produced.
  - The reader understands the project owns environment setup/teardown (Skillsmith does not manage environments) and where in the lifecycle that happens, plus the existence and purpose of the judge-concurrency control.
  - The report/verdict documentation shows the shipped overall pass/fail-plus-notes shape; no remaining README text references `scenario.yaml`, rubrics, an `acceptance`/`prompt`/`description` scenario field, `Paths.rubrics`, `e2e.spec.mjs`, or Playwright as part of the model.
  - The clean break (no backward compatibility) is called out where a migrating consumer will see it.

### Task 2: Rewrite the public landing page (`docs/index.html`) to the new model

- **Goal:** Update the marketing/landing copy so it no longer sells the old model. Replace mentions of rubrics, acceptance criteria as a scenario field, and the Playwright/runtime-hook verification gate with the new model's framing: prose-defined scenarios, a freeform live judge with project-configured capabilities, and project-owned environments — while preserving the page's high-level value story (test skills with real evidence, self-improve, the case-study metrics).
- **Audience:** Prospective and evaluating users landing on the public GitHub Pages site — a lighter-touch audience than the README reader.
- **Files to change:** `docs/index.html`.
- **Sections / scope:**
  - "The problem" / feature cards ("Prompt-based scenarios", "Runtime validation") — adjust copy that frames a scenario as carrying "acceptance criteria" and that frames runtime validation as a separate gate; reframe around the freeform judge verifying behavior live.
  - "How it works" flow cards ("Define scenarios", "Judge and execute") — remove "specify rubrics and acceptance criteria" and "reviewed against rubrics"; describe writing a testing brief and a judge brief and the judge verifying live with project-supplied capabilities.
  - Self-improvement card ("Edit the skill … The scenarios, rubrics, and harness are never touched") — drop "rubrics" from the never-touched list (rubrics no longer exist), keeping the accurate point that the improver only edits skills.
  - The "Validate against the real runtime, not just the rubric" note card — reframe so the live check is the judge's behavior verification (the bundled WordPress example still stands up wp-env and drives a real browser, but as the judge's project-configured environment, not a separate Playwright e2e gate); keep "that runtime belongs to the example, not to Skillsmith."
  - Leave the case-study metrics, CLI examples, and scenario-ID/parent-folder discovery copy intact (still accurate).
- **Depends on:** none
- **Traces to:** Spec requirements 1, 3, 6, 7, 10; Acceptance criteria 5, 7; Design "Docs → `docs/index.html`"; Risk R10; Code tasks 13, 18.
- **Acceptance:**
  - No card or body copy on the landing page presents rubrics or a scenario-level "acceptance criteria" field as part of the model.
  - The "how it works" and validation copy describes the judge verifying behavior on a project-owned live environment with project-configured capabilities, with the WordPress browser/runtime presented as belonging to the example project, not to Skillsmith core.
  - The page's overall value story, case-study metrics, and CLI/discovery examples remain intact and accurate.

### Task 3: Update the reference example config (`examples/skillsmith.config.ts`) narrative and demonstrated surface

- **Goal:** Make the consumer-facing reference config demonstrate the new configuration surface: drop the removed `paths.rubrics` entry, replace the `afterAllScenarios` e2e-verification hook example with the new env-ownership pattern (project stands up/tears down its environment in the per-pair judge hooks and configures the judge's capabilities), document the judge-capability configuration keys and the judge-concurrency knob, and update the explanatory comments accordingly — so a consumer copying from this file lands on the new model.
- **Audience:** Consumers authoring their own `skillsmith.config.ts` — this file is explicitly the "document the surface area" reference.
- **Files to change:** `examples/skillsmith.config.ts`.
- **Sections / scope:**
  - The `paths` block — remove the `rubrics` entry and any comment implying a rubrics directory is scanned.
  - The `roles.judge` assignment and surrounding comments — show the configurable judge capabilities (tools / MCP / sandbox-or-write / network as shipped) and the judge-concurrency option, with comments explaining that core defaults to read-only and that WordPress/browser specifics belong to the project.
  - The `hooks` block — replace the `afterAllScenarios` "run your own e2e suite, return failures" example with the per-pair environment-up/-down pattern in the judge hooks (build/stand-up before the judge, tear down after), reflecting that the judge now does live verification; if the generic `afterAllScenarios` gate remains in shipped core, keep at most a brief accurate mention of it as an optional generic gate rather than the e2e mechanism.
  - The header/intro comment and any per-block comments that reference rubrics, acceptance, or the e2e gate — update to the new model.
- **Depends on:** Task 1 (so the config example's narrative is consistent with the README's model description)
- **Traces to:** Spec requirements 6, 7, 10; Acceptance criteria 5, 7; Design "Judge capability descriptor", "Judge concurrency knob", "Decision: `testing-project` — per-pair WP env in `beforeJudgeAgent`"; Code tasks 1, 2, 11, 18; CONTRIBUTING.md note that `examples/skillsmith.config.ts` is consumer-facing reference code.
- **Acceptance:**
  - A consumer copying from the example lands on the new model: no `paths.rubrics`, no e2e/`afterAllScenarios`-as-verification example presented as the way to validate behavior.
  - The example demonstrates configuring the judge's capabilities and the judge-concurrency control, and shows where the project owns environment setup/teardown in the lifecycle, with comments that match the shipped configuration surface.
  - The file still loads/type-checks against the shipped public API (it is exercised by `npm --prefix testing-project run check:config`-style import checks and the typecheck gate), and its comments contain no remaining old-model terminology.

### Task 4: Audit and correct old-model references in `CONTRIBUTING.md`

- **Goal:** Bring the contributor reference into line with the new model where it describes scenario/judge/report contracts or treats the old-model concepts as live. Confirm and correct any wording that assumes `scenario.yaml`, rubrics, the e2e gate, the old report-JSON shape, or a duplicate-`scenario.name` rejection path; ensure example phrasings that reference public types (e.g. a `Scenario`-shaped argument) and the changeset bump-type examples remain accurate under the new public API.
- **Audience:** Contributors and maintainers of Skillsmith.
- **Files to change:** `CONTRIBUTING.md`.
- **Sections / scope:**
  - The "when a changeset is required" / report-JSON and hook-contract bullets — verify they describe the shipped contracts (the new `Scenario`/`Paths` shape, the `{ pass, notes }` report shape) and adjust any example that names a removed field.
  - The consumer-perspective writing-guidance examples that reference public types or report fields — keep them accurate against the new public surface (do not invent new ones; only correct ones that now reference removed concepts).
  - The lists that mention the `docs/` landing page and the `testing-project/` fixture as changeset-exempt paths — leave the policy intact; only fix wording if it implies the old scenario model.
- **Depends on:** none
- **Traces to:** Spec requirements 2, 15; Acceptance criterion 10; Code tasks 1, 12, 13, 19.
- **Acceptance:**
  - `CONTRIBUTING.md` contains no statement that assumes the old scenario model (`scenario.yaml`, rubrics, acceptance fields, the e2e verification gate, or a duplicate-`scenario.name` rejection) as a current contract.
  - Any example that references a public type or report field is accurate against the shipped new model; the changeset policy and bump-type guidance are otherwise unchanged.

### Task 5: Update the `testing-project` improver-prompt narrative

- **Goal:** Correct the project's improver prompt prose so it no longer instructs the agent to consult "e2e results" or refers to "scenarios and rubrics" as the testing artifacts, aligning it with the new model (the judge's behavioral verdict and notes are the signal; scenarios are the two-file briefs; rubrics no longer exist as a separate input). Preserve the prompt's intent (build a focused, Skillsmith-agnostic Interactivity API skill).
- **Audience:** Maintainers of the bundled `testing-project` reference (and, indirectly, the improver agent that reads this prose).
- **Files to change:** `testing-project/eval/prompts/improver.md`.
- **Sections / scope:** The references to "e2e results" and to "scenarios and rubrics" as testing artifacts; reframe to the judge-notes signal and the two-file scenario model. Keep the WordPress Interactivity API guidance, the "skill is agnostic to Skillsmith" framing, and the docs link.
- **Depends on:** none
- **Traces to:** Spec requirements 2, 12, 13, 15; Acceptance criteria 9, 10, 11; Design "`testing-project`" (improver prompt retained, mechanism unchanged); Code task 18 (keeps `roles.improver.prompt` as the unchanged mechanism, but this prose file is not edited by the code plan).
- **Acceptance:**
  - The improver prompt no longer references a separate e2e result or "rubrics" as a testing input; it frames the testing signal in terms of the judge's behavioral verdict/notes and the two-file scenario model.
  - The prompt's original intent (focused, Skillsmith-agnostic Interactivity API skill) and the reference docs link are preserved.

## Notes for the docs-writer

- **Do not touch `.changeset/nested-scenario-folders.md` or any other pending changeset.** It describes already-shipped recursive-discovery behavior (`RunScenario.id`/`dirName`, still present) and is not old-model-coupled; the breaking-change changeset for this work is authored separately in the code phase (code-plan Task 19). Altering historical/pending changesets would corrupt the release log.
- **`testing-project/eval/scenarios/_candidates.yaml`** header scrub and the **11 scenario `TESTING-AGENT.md`/`JUDGE.md`** files are produced/scrubbed in the **code phase** (code-plan Task 16). Treat their content as code-phase output; do not author scenario briefs here.
- **`testing-project/skillsmith.config.ts`**, the Playwright harness deletion, and the rubric-file deletion are **code-phase** work (code-plan Tasks 17–18). The docs surface that mirrors them here is only the *consumer-facing reference* `examples/skillsmith.config.ts` (Task 3) and the narrative pages (Tasks 1–2).
- **`testing-project/eval/prompts/testing-agent.md`** is workspace-scaffold instructions with no old-model model terminology (no `scenario.yaml`/rubrics/e2e); it needs no documentation task and is left untouched.
- When filling in concrete names, field names, examples, and the verdict/report JSON, **read the merged implementation** (the shipped `Scenario` type, the `# Skills` parser rules, the `JudgeCapabilities`/`McpServerConfig` types, the `{ pass, notes }` verdict, the `roles.judge.concurrency` knob, and the hook timing) so the docs match what actually shipped rather than the working names in this plan (`TESTING-AGENT.md`/`JUDGE.md` are the spec's working filenames; confirm against the shipped named constants).
