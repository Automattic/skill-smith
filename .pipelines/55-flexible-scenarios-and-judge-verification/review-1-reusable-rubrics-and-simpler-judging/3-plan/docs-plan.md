# Docs Plan: Reusable rubrics and a leaner, human-language live-judge setup

## Overview

This review-1 increment layers four behavior changes onto the already-rewritten base docs: (1) **reusable rubrics referenced by id** are reintroduced as Skillsmith-core capability — a `JUDGE.md` may name shared grading criteria under a `# Rubrics` section, resolved from an optional `paths.rubrics` location and injected into the judge's grading material (verdict still `{ pass, notes }`); (2) the bundled WordPress example now **boots its environment once per run** instead of per (scenario, agent) pair; (3) the **judge drives the live setup itself** in plain language (activate, discover/insert the produced block(s), open the page, check) rather than the harness pre-creating a post and handing over a URL; and (4) **block naming is no longer enforced** — the judge discovers produced block name(s) and supports multiple. The base docs currently assert the opposite of several of these (e.g. "there is no `paths.rubrics`", "inline rubrics into `JUDGE.md`", per-pair env boot, a fixed `skillsmith/testing-block` name), so the consumer-facing narrative must be corrected wherever it now misstates the shipped model. This plan covers **only the consumer-facing narrative docs** the code phase does not already rewrite — `README.md`, `examples/skillsmith.config.ts`, `CONTRIBUTING.md`, and a verify-only pass over `docs/index.html`. The per-scenario `JUDGE.md` briefs, the `testing-project` prompt files, the env-helper doc comments, and the judge "environment manual" are all rewritten inside the **code phase** (code-plan Tasks 9, 10, 12, 13) and are out of scope here.

## Guardrail scopes

The docs phase runs the two changeset gates (`validate-changesets`, `changeset status`). Neither is a scoped gate, and no scoped gates were passed to this planner. The changeset itself is authored in the code phase (code-plan Task 15); the docs phase keeps both gates green by **not** authoring or editing any changeset.

| Gate | Scope |
| ---- | ----- |
| None | None |

## Tasks

### Task 1: Reintroduce reusable rubrics-by-id in the README

- **Goal:** Correct every README statement that now misstates the rubric model, and document reusable rubrics referenced by id as the shipped capability — distinct from the old prescriptive per-rubric *scoring* (the verdict stays `{ pass, notes }`).
- **Audience:** Consumers writing scenarios and configuring Skillsmith (skill authors, harness adopters).
- **Files to change:** `README.md`.
- **Sections / scope:** The "Breaking change" callout (currently lists "no separate rubric/prompt files", "no `rubrics` scenario field", "no `paths.rubrics`"); "The judge brief" section (currently advises inlining "a reusable best-practices rubric ... into the file"); the `paths` paragraph in "Configuration" (currently parenthetically asserts "There is no `paths.rubrics`"); and the "Migrating from the old model" section (currently says "There are no separate rubric files and no `paths.rubrics`. Inline ... rubric ... directly into each `JUDGE.md`"). Add a short treatment of how a scenario references reusable rubrics by id and where they resolve from — read the shipped parser/loader/config behavior to describe the surface; do not invent a grammar.
- **Depends on:** none
- **Traces to:** Spec requirements 1, 2, 4, 5; Acceptance criteria 1, 2, 4; Code tasks 1, 2, 3, 4, 5.
- **Acceptance:**
  - A consumer learns that a `JUDGE.md` may reference one or more reusable rubrics **by id**, that referencing them is optional, and that the referenced content is supplied to the judge automatically (not pasted into the brief).
  - The reader understands rubrics are reusable **content**, not a structured scoring grid — the judge's verdict is still a single overall pass/fail with notes.
  - No remaining README statement asserts that rubrics, the rubric scenario field, or the optional rubrics path do not exist; the breaking-change callout, the judge-brief guidance, the `paths` note, and the migration guidance are all consistent with the restored, optional rubrics surface.
  - The reader learns the rubrics location is configurable and optional (required to exist only when a project uses it), cross-referenced to where the config surface is documented (Task 2's example / the `paths` discussion).

### Task 2: Show optional `paths.rubrics` and the judge "environment manual" in the example config

- **Goal:** Update the reference config so it demonstrates the optional rubrics location and the `roles.judge.prompt` "environment manual" pattern as shipped, and stops asserting there is no rubrics directory.
- **Audience:** Consumers copying the reference config into their own project.
- **Files to change:** `examples/skillsmith.config.ts`.
- **Sections / scope:** The `paths` block and its comment (currently: "There is no rubrics directory ... `paths` is just these three keys"); the `roles.judge` block (demonstrate the project-supplied judge `prompt` as a reusable "environment manual" carrying runtime mechanics, mirroring how the shipped `testing-project` config does it, without copying WordPress-specific command text verbatim — keep the example generic per the file's "no WordPress/browser vocabulary in core" stance). Read the shipped `Paths` type and the `testing-project` config to describe the surface accurately.
- **Depends on:** none
- **Traces to:** Spec requirements 5, 9; Acceptance criteria 2, 6; Code tasks 1, 10; Design "Components → `skillsmith.config.ts`".
- **Acceptance:**
  - The example shows `paths.rubrics` as an optional entry a project may declare, with a comment explaining it is optional and points at a rubrics location, replacing the current "there is no rubrics directory" assertion.
  - The example illustrates the `roles.judge.prompt` "environment manual" pattern — a reusable, project-owned prompt the judge memorizes for runtime mechanics — without prescribing the exact WordPress command strings (those live in the project, not in this generic reference).
  - A consumer can copy the `paths` and `roles.judge` blocks and understand both the optional rubrics path and the judge-prompt pattern from the comments alone.
  - The file still type-checks and loads (the example remains valid consumer-facing reference code).

### Task 3: Reflect env-once and judge-driven setup in the README's WordPress narrative

- **Goal:** Update the README's reference-project narrative so it describes the bundled WordPress example booting its environment **once per run** and the **judge** performing the live setup (activate, discover/insert produced block(s), open page, check), correcting the prose that describes per-pair env boot and a harness that pre-creates the post and hands over a URL.
- **Audience:** Consumers reading how the reference WordPress project wires the judge and its environment (adopters modeling their own project on it).
- **Files to change:** `README.md`.
- **Sections / scope:** The "Hook examples" entry for `beforeJudgeAgent` / `afterJudgeAgent` (currently: "boots `wp-env`, activates the plugin, creates a test post, and exports the per-pair facts ... the post URL ... `afterJudgeAgent` tears that environment back down"); the prose in "Environment ownership and judge concurrency" that frames the shared env as stood up/torn down **per pair**. Distinguish what the **harness** still owns deterministically (boot once, build, install, clean slate, a bridge for the judge to reach the env) from what the **judge** now does live (discover/insert block(s), open page, verify). Keep the core, project-agnostic contract intact: Skillsmith still owns no environment, and the per-pair `beforeJudgeAgent`/`afterJudgeAgent` hooks plus run-level `beforeAllScenarios`/`afterAllScenarios` hooks are unchanged core mechanisms — only the *reference project's* use of them changed. Do not rewrite the generic hook-lifecycle tables (those remain accurate).
- **Depends on:** none
- **Traces to:** Spec requirements 6, 7, 8, 9, 10; Acceptance criteria 5, 6, 7; Code tasks 9, 10, 11, 13; Design "Track B".
- **Acceptance:**
  - The reader understands the reference WordPress example boots its environment once per run (kept warm) and installs/activates each pair's plugin against that one environment with a clean slate before the judge runs — not a per-pair boot/teardown.
  - The reader understands the judge itself performs the live behavioral setup from a plain-language brief (activate, discover and insert the produced block(s), open the page, verify), while the harness retains the deterministic infrastructure (boot, build, install, clean slate, and a reliable bridge to the environment).
  - The prose no longer states that the harness pre-creates the test post or hands the judge a fixed URL for that reference project, and no longer describes the shared env as booted/torn down per pair.
  - The generic, project-agnostic core contract is preserved: the description still makes clear Skillsmith owns no environment and the documented hook set is unchanged — only the reference project's usage is updated.

### Task 4: Reflect env-once and judge-driven setup in the example-config hook comments

- **Goal:** Update the narrative comments in the reference config's `hooks` block so they describe the judge-driven, env-aware pattern consistently with the README, without implying the harness pre-creates a post or that the shared env is booted per pair.
- **Audience:** Consumers copying the hooks block as a starting point for their own environment wiring.
- **Files to change:** `examples/skillsmith.config.ts`.
- **Sections / scope:** The `hooks` block comments — the `beforeJudgeAgent` comment ("build the artifact from `judgeWorkspace`, boot a server, and set process.env facts the JUDGE.md brief references") and `afterJudgeAgent` comment ("stop the server and clear the per-pair env vars"), plus the block-level comment about the project standing the env up "per pair". Keep the example generic (no WordPress specifics): the point is that a project may keep deterministic infra in hooks while the judge performs the live checks. The README (Tasks 1, 3) and CONTRIBUTING (Task 5) remain the detailed narrative; this is comment-level alignment only.
- **Depends on:** none
- **Traces to:** Spec requirements 6, 7, 9; Acceptance criteria 5, 6; Code task 10; Design "Track B".
- **Acceptance:**
  - The hook comments describe a project that may export the facts the judge needs to reach the environment and run deterministic setup, while leaving live behavioral verification (insert block, open page, check) to the judge — consistent with the README narrative.
  - The comments no longer imply, as the canonical pattern, that the harness pre-creates a post/URL for the judge.
  - The comments remain generic (no WordPress/browser vocabulary leaks into the core-facing example) and the file still type-checks and loads.

### Task 5: Audit CONTRIBUTING for rubric/contract drift

- **Goal:** Ensure CONTRIBUTING's public-contract references stay accurate now that `Scenario` regains an optional `rubrics` field and `Paths` regains optional `paths.rubrics`, and that no contributor-facing example or guidance contradicts the restored surface.
- **Audience:** Contributors and maintainers (the audience CONTRIBUTING already targets), especially around changeset and public-contract guidance.
- **Files to change:** `CONTRIBUTING.md`.
- **Sections / scope:** Sweep CONTRIBUTING for any statement that pins the absence of `rubrics` / `paths.rubrics` or otherwise describes the `Scenario`/`Paths` contract in a way the increment invalidates (the "When a changeset is required" / `defineConfig` schema discussion and any illustrative type examples are the likely touch points). If nothing references those surfaces, this task records that finding and makes no change. **Do not** author or edit any changeset, and do not restate changeset content — the changeset is a code-phase artifact (code-plan Task 15); CONTRIBUTING documents the *process*, not this feature's entry.
- **Depends on:** none
- **Traces to:** Spec requirements 5, 12; Acceptance criteria 2, 8; Code tasks 1, 15.
- **Acceptance:**
  - Any CONTRIBUTING statement or example that described `Scenario`/`Paths` as lacking `rubrics`/`paths.rubrics` is corrected to the restored-optional contract, or the task explicitly records that CONTRIBUTING contains no such reference and needs no change.
  - The changeset-process guidance remains accurate and is not turned into a feature-specific entry; no changeset is authored or edited by this task (the two changeset gates stay green).
  - CONTRIBUTING contains no statement that contradicts the shipped optional `rubrics` field, optional `paths.rubrics`, or the rubrics-by-id model.

### Task 6: Verify the landing page does not misstate the model

- **Goal:** Confirm `docs/index.html` does not assert anything the increment makes false (e.g. that rubrics no longer exist, or that the judge does not drive the live setup); correct only if a card or body now misstates the model.
- **Audience:** First-time visitors to the project landing page.
- **Files to change:** `docs/index.html` (only if a misstatement is found; otherwise no change).
- **Sections / scope:** Review the marketing/body cards — in particular the "The judge checks behavior, not just prose" note-card, which currently says the WordPress example "stands up `wp-env` and drives a real browser as the judge's environment." Confirm this still reads true under the env-once, judge-driven model (the judge still drives the browser; the example still owns the runtime). The landing page deliberately carries no rubric vocabulary; confirm no card claims rubrics were removed. Make an edit **only** if a specific card or sentence now misstates the shipped model.
- **Depends on:** none
- **Traces to:** Spec requirements 9, 11; Acceptance criteria 6, 8; Design "Track B" (judge-driven setup); base-doc surface `docs/index.html`.
- **Acceptance:**
  - The landing page is confirmed to contain no card or body sentence that contradicts the shipped model (rubrics restored as reusable-by-id; env booted once; judge drives the live setup); if one is found, it is corrected to match.
  - If no misstatement exists, the task records that finding and leaves `docs/index.html` unchanged (no gratuitous edit).
