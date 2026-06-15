# Doc Plan: Adopt Radical Pipelines guardrails

Issue: [Automattic/skillsmith#43](https://github.com/Automattic/skillsmith/issues/43) — _Adopt Radical Pipelines guardrails_

## Overview

This is a **documentation-and-configuration** change with no `src/` edits. Most of what would normally be "documentation" for this change is **the change itself**: the `.rp.md` `## Guardrails` and `## Worktree bootstrap` sections (with their explanatory prose) are authored by the code phase (code-plan T4 and T5), not the docs phase. The code-plan tasks already specify accurate, no-over-claiming prose for the changeset gates and the bootstrap rationale, so the docs phase does **not** re-author those sections — it verifies they landed as specified and fills the two genuine documentation gaps the code phase leaves open.

The two gaps:

1. **Contributor-facing local-checks documentation drift.** `CONTRIBUTING.md` § "Running tests and checks locally" lists the four commands a contributor runs before pushing (`npm run lint`, `npm run typecheck`, `npm test`, `npm run smoke`). After this change, the project owns a declared set of pipeline gates (the six guardrails) and a new `testing-project` config-smoke check. A contributor reading `CONTRIBUTING.md` today would not learn that `npm --prefix testing-project run check:config` exists or what it guards, nor that the pipeline now gates on a fixed command set. This is the human-facing counterpart to the machine-facing `.rp.md` declaration, and it is the docs phase's to write.
2. **The changeset decision for this PR.** The project requires a committed `.changeset/*.md` for every release-relevant change (AGENTS.md; `CONTRIBUTING.md#adding-a-changeset`). The docs phase must make and record the changeset decision for *this* PR. As established below, the correct decision is **no changeset** (an explicit, verified determination — not an omission), because every path this PR touches is non-versionable.

A note on division of labor with the code phase: code-plan T4 and T5 are the load-bearing documentation for the *pipeline/orchestrator* audience (they author the `.rp.md` prose). This doc plan covers the *human contributor* audience (CONTRIBUTING.md) and the *release/changeset* obligation. The doc-writer must **read the code phase's actual `.rp.md` output before writing**, so the contributor-facing prose stays consistent with the committed declaration rather than drifting from it.

### Audiences

- **Human contributor / maintainer** — clones the repo, runs local checks before pushing a PR, and needs to know the project now has a declared guardrail set and a `testing-project` config-smoke check, and how to run it. Served by `CONTRIBUTING.md`.
- **Pipeline orchestrator and phase agents** (code-writer, code-reviewer, doc-writer, doc-reviewer) — read `.rp.md` to learn which gates to run at each phase and to bootstrap the worktree first. Served by the `.rp.md` sections **authored in the code phase** (T4, T5); this doc plan does not re-author them, only verifies them.
- **Release / changeset reader** — the changeset gate and any maintainer auditing release-relevance. Served by the changeset decision recorded for this PR.

## Tasks

### Task 1: Verify the code-phase `.rp.md` sections, then document the project's checks in `CONTRIBUTING.md`

- **Goal:** Two parts, in order. **(1a) Verify** — confirm the code phase landed the `## Guardrails` and `## Worktree bootstrap` sections in `.rp.md` as the code plan specifies (this is a read-and-confirm gate, not a rewrite; the prose is the code phase's deliverable). **(1b) Document for humans** — update `CONTRIBUTING.md` § "Running tests and checks locally" so a human contributor learns that the project now declares a fixed guardrail set and owns a `testing-project` config-smoke check, and how to run it locally. This is the contributor-facing counterpart to the machine-facing `.rp.md` declaration.

- **Audience:** Human contributors and maintainers running local checks before pushing a PR. (The orchestrator/agent audience is served by `.rp.md`, authored in the code phase — not by this task.)

- **Files to change:**
  - `CONTRIBUTING.md` (existing — edit the "Running tests and checks locally" section near the top; do not touch the changeset/release sections)
  - `.rp.md` (read-only verification — **do not edit**; it is the code phase's artifact)

- **Sub-step 1a — Verify the code-phase `.rp.md` output (read-only):**

  Read `.rp.md` and confirm all of the following landed (per code-plan T4 and T5 and design-doc §4, §6). If any is missing or contradicts the spec/design, **stop and report a blocker to the orchestrator** — do not edit `.rp.md` to fix it, because that section is the code phase's deliverable and a discrepancy means the code phase is incomplete.

  - A top-level `## Guardrails` section exists as the **last** section of `.rp.md` (peer `##`, after `## Health monitoring`).
  - It contains the six-row table with header `| Name | Command | Phase |` and these exact commands and phase values (commands and phases are load-bearing; verify byte-for-byte):

    | Name             | Command                                          | Phase      |
    | ---------------- | ------------------------------------------------ | ---------- |
    | typecheck        | `npm run typecheck`                              | code       |
    | lint             | `npm run lint`                                   | code       |
    | tests            | `npm test`                                       | code       |
    | config-smoke     | `npm --prefix testing-project run check:config`  | code       |
    | changeset-format | `npx tsx scripts/validate-changesets.ts`         | code, docs |
    | changeset-status | `npx changeset status --since=origin/trunk`      | docs       |

  - The changeset-gate prose does **not over-claim** (design-doc §4.3, D3): changeset-format is described as shape-only and presence-agnostic; changeset-status is described as the *conditional* presence check ("release-relevant/versionable changes carry a changeset"), and **not** as "the doc-writer always authors a changeset regardless of what changed." Confirm `--since=origin/trunk` (not `--since=trunk`).
  - A standalone top-level `## Worktree bootstrap` section exists immediately after `## Claude Code worktrees` (and before `## Branch names`), directing the orchestrator to run `bash scripts/bootstrap-worktree.sh` after `EnterWorktree` and before any phase agent or guardrail, and naming the script (not only inlining the two `npm ci` commands).

  This sub-step produces **no edits** — it is a precondition check that the human-facing prose in 1b will be consistent with the committed declaration.

- **Sub-step 1b — Update `CONTRIBUTING.md` (the actual edit):**

  In `CONTRIBUTING.md` § "Running tests and checks locally", make the contributor aware of two new facts, matching the file's existing terse bullet style (each bullet maps a command to one line; see the four existing bullets):

  1. **Add the config-smoke check to the local-checks list.** Add a bullet for the new `testing-project` config check, naming the exact command and what it guards. Read the real command from `testing-project/package.json` after the code phase lands T1 (it is `npm --prefix testing-project run check:config`, which runs the `check:config` script). The one-line description should convey: it imports `testing-project/skillsmith.config.ts` and its full module graph (no agents, no API key, no wp-env, no network), catching config-load/import regressions that `typecheck`, `lint`, and `test` miss because none of them loads the fixture config through its real runtime import graph. Keep it to one or two lines consistent with the neighboring bullets.
  2. **Note that the pipeline gates on a declared guardrail set.** Add a short sentence or bullet stating that these local checks are also declared as **Guardrails** in `.rp.md`, which the Radical Pipelines code and docs phases run automatically (judged by exit code), so the same commands a contributor runs locally are the commands the pipeline gates on. Cross-reference `.rp.md` by name. Keep this to one or two lines; do **not** reproduce the six-row table (it lives in `.rp.md`; duplicating it invites drift). The point is discoverability and the local↔pipeline correspondence, not a second copy of the declaration.

  Calibrate scope: this is a **small** edit to an existing section (a handful of lines), not a new section or a rewrite. Do not restate the changeset-gate semantics here — those already live in `CONTRIBUTING.md` § "Adding a changeset" and in `.rp.md`. Do not document the bootstrap script for contributors (it is an orchestrator/pipeline run-step, per design-doc §6.2 "AGENTS.md is intentionally not the trigger"; a human cloning the repo runs `npm ci` / `npm ci --prefix testing-project` themselves, which the existing setup docs already cover or which is standard). If, while editing, the doc-writer judges a one-line human-facing pointer to the bootstrap commands genuinely helps a fresh contributor, it may add it — but it is optional and must not imply the pipeline relies on a contributor running it.

- **Depends on:** Code phase complete (T1 must have landed so the `check:config` command and script name are real and verifiable in `testing-project/package.json`; T4/T5 must have landed so sub-step 1a can verify the `.rp.md` sections). Independent of Task 2 within the docs phase.

- **Traces to:**
  - Spec: R1, R2, R6 (verification that the declared gates and their accurate prose landed); R4 (the `check:config` command the contributor doc names).
  - Design doc: §4.1 (the six gates), §4.3/D3 (no-over-claiming changeset prose to verify), §6.2/D2 (`## Worktree bootstrap` placement to verify), §5.2 (the `check:config` script the contributor doc references).
  - Code plan: T1 (the `check:config` script and command), T4 (`## Guardrails`), T5 (`## Worktree bootstrap`).

- **Acceptance:**
  - Sub-step 1a was performed and either confirmed all `.rp.md` items above are present and correct, or a blocker was reported to the orchestrator (and `.rp.md` was **not** edited by this task).
  - `CONTRIBUTING.md` § "Running tests and checks locally" now names the `testing-project` config check with its exact command (`npm --prefix testing-project run check:config`, read from `testing-project/package.json` to confirm) and a one-line description of what it guards.
  - The same section tells the reader these checks are declared as Guardrails in `.rp.md` that the pipeline runs automatically, and cross-references `.rp.md` by name — without reproducing the six-row table.
  - The edit is confined to the local-checks section; the changeset/release sections of `CONTRIBUTING.md` are unmodified.
  - The new prose matches the file's existing terse, imperative, sentence-case, no-emoji style and bullet shape.
  - `CONTRIBUTING.md` is a non-versionable path (`changedFilePatterns` does not match it), so this edit does not trigger the changeset-status gate. Confirm by re-reading Task 2's determination.

### Task 2: Make and record the changeset decision for this PR

- **Goal:** Satisfy the project's changeset requirement (AGENTS.md; `CONTRIBUTING.md#adding-a-changeset`) by making an explicit, verified determination of whether this PR needs a `.changeset/*.md`, and recording the basis. The determination is **no changeset is required** — but it must be *reached and stated*, not silently skipped, because "we forgot a changeset" and "we determined none was needed" look identical in a diff and only the latter is correct here.

- **Audience:** The changeset gate (`changeset-status`) and any maintainer auditing whether this PR is release-relevant.

- **Files to change:** **None** (the determination is that no `.changeset/*.md` is added). If the determination ever flips (see below), the deliverable becomes a single `.changeset/<name>.md` authored per `CONTRIBUTING.md` § "How to add a changeset — interactive or direct-write".

- **Scope / determination:**

  This PR's complete set of changed paths is: `.rp.md`, `scripts/bootstrap-worktree.sh` (new), `testing-project/package.json`, `testing-project/package-lock.json`, optionally `testing-project/eval/utils/verify-e2e.ts`, `CONTRIBUTING.md` (Task 1), and `.pipelines/**` (the pipeline artifacts). The doc-writer must verify this set against the actual diff (`git diff --name-only origin/trunk...HEAD`) rather than trusting this list.

  Check each changed path against the repo's release-relevance rules:

  - **`.changeset/config.json` `changedFilePatterns`** is `src/**`, `bin/**`, `package.json`, `examples/**`, `README.md`, excluding `src/__tests__/**`. None of this PR's paths matches: `package.json` in the pattern means the **root** `package.json`, which this PR does not change — it changes `testing-project/package.json`, a different file the pattern does not cover.
  - **`CONTRIBUTING.md` § "Adding a changeset" → "When a changeset is required"** explicitly lists the exclusions, and they cover every path here: "pipeline artefacts (`.rp.md`, `.pipelines/**`)", "the `testing-project/` fixture", "`package-lock.json`-only changes", and "documentation prose-only edits" (the `CONTRIBUTING.md` edit from Task 1). The `scripts/` change is internal tooling not in `changedFilePatterns`. So the human policy and the machine pattern agree: **no release-relevant path is touched.**

  Therefore the correct outcome is **no changeset**, and `changeset-status` (`npx changeset status --since=origin/trunk`) exits 0 on this branch with no changeset present — verified at plan time (exit 0, "NO packages to be bumped"). This is the conditional-presence gate behaving exactly as designed (design-doc §4.3): a change confined to non-versionable paths is correctly not forced to carry a changeset.

  **Do not add an empty changeset to "be safe."** The empty-changeset escape (`npx changeset --empty`, `CONTRIBUTING.md` § "Empty changesets") is for a PR that touches a *release-relevant* path but warrants no release entry (e.g. a cosmetic `README.md` edit). This PR touches no release-relevant path, so an empty changeset would be noise, not correctness.

  **Flip condition (record and check, don't assume away):** if the code phase deviated from the plan and a versionable path *was* touched — most plausibly the **root** `package.json` (e.g. if a script or dependency was added there instead of, or in addition to, `testing-project/package.json`), or `README.md`, `src/**`, `bin/**`, `examples/**` — then a changeset **is** required. In that case author one `.changeset/<short-name>.md` per `CONTRIBUTING.md` § "How to add a changeset", front-matter key `@automattic/skillsmith`, bump type chosen from the bump-type table (most likely `patch` for tooling, or `none` if genuinely non-release-affecting), summary in imperative present describing the consumer-visible change. The doc-writer determines this from the actual diff, not from this plan's assumption.

- **Depends on:** Code phase complete and Task 1 (so the full diff — including the `CONTRIBUTING.md` edit — is present when the determination is made). Doing this **last** in the docs phase ensures the determination covers every file the PR actually changed.

- **Traces to:**
  - Spec: R6 (the changeset gates' guarantees), AC4 (changeset-status behaves as the conditional presence check — exit 0 when only non-versionable paths changed).
  - Design doc: §4.3/D3 (the conditional guarantee; non-versionable changes correctly carry no changeset).
  - Code plan: T4/T5 acceptance (each notes `npx changeset status --since=origin/trunk` exits 0 because the `.rp.md` edit is non-versionable) and the cross-cutting acceptance (changeset-status exits 0; no changeset required).
  - Project: AGENTS.md changeset requirement; `CONTRIBUTING.md#adding-a-changeset` (when required / exclusions / empty-changeset rule).

- **Acceptance:**
  - The doc-writer verified the PR's changed-path set against the actual diff and checked each path against both `changedFilePatterns` and the `CONTRIBUTING.md` exclusion list.
  - The determination "no changeset required" is recorded with its basis (every path non-versionable per both the machine pattern and the human policy) in the doc-writer's completion message to the orchestrator — so the absence of a changeset is a documented decision, not an apparent oversight.
  - `npx changeset status --since=origin/trunk` exits 0 on the branch (the docs-phase `changeset-status` gate), and `npx tsx scripts/validate-changesets.ts` exits 0 (the `changeset-format` gate — trivially, since no changeset was added; and it also passes on the existing committed changesets in `.changeset/`).
  - **No empty changeset was added.** No `.changeset/*.md` file was created unless the flip condition triggered (a versionable path was actually touched), in which case exactly one correctly-authored changeset was added and `changeset-status` still exits 0.

## Out of scope (do not do these)

- **Do not re-author the `.rp.md` `## Guardrails` or `## Worktree bootstrap` sections.** They are the code phase's deliverable (code-plan T4, T5). The docs phase verifies them (Task 1, sub-step 1a) and reports a blocker if they are wrong — it does not rewrite them.
- **Do not reproduce the six-row guardrail table in `CONTRIBUTING.md`** (or anywhere outside `.rp.md`). The declaration lives in `.rp.md`; a second copy would drift. `CONTRIBUTING.md` cross-references it.
- **Do not document the bootstrap helper script as a contributor workflow.** It is an orchestrator/pipeline run-step (design-doc §6.2: AGENTS.md is intentionally not the trigger). A one-line human pointer is optional, not required, and must not imply the pipeline depends on a human running it.
- **Do not restate the changeset-gate semantics** (shape-only vs. conditional-presence) in `CONTRIBUTING.md`. That prose lives in `.rp.md` (code phase) and the existing `CONTRIBUTING.md` § "Adding a changeset"; the docs phase does not duplicate it.
- **Do not add an empty or speculative changeset.** Add a changeset only if the actual diff touches a versionable path (the flip condition in Task 2).
- **Do not edit `src/`, `README.md`, or the root `package.json`** — none is in this change's scope, and touching any would itself make the PR release-relevant and require a changeset.
