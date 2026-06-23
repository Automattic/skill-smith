# Docs Plan: Reconcile the skip-misconfigured-agents branch with current `trunk`

## Overview

This is a **reconciliation run, not a feature build**, and the documentation phase is
**verification-only** — no new documentation is authored here. The skip-misconfigured-agents
feature was already documented and shipped across this branch's prior runs: the README already
carries the `### Exit codes` / "When an agent can't run" / `### Skipped agents in report.json` /
hook-context `skipped` sections, the example config already comments the per-provider skip
behavior, `CONTRIBUTING.md` already pins the `requiredEnv` / `RunContext.skipped` / top-level
`skipped` array contract, and the three feature changesets already describe what ships. The code
phase (a single `trunk`→branch merge) is what physically folds `trunk`'s intervening prose
(nested-scenario-folder selection, `scenario.name` precision, claude-code subscription-auth) into
the two prose-bearing files in the 19-file conflict set — `README.md` (code-plan Task 4, an
explicit human-judgment prose merge) and `examples/skillsmith.config.ts` (code-plan Task 5) — and
auto-merges every other doc surface (`CONTRIBUTING.md`, the changesets, the in-source JSDoc).

The code phase's correctness oracle is the guardrail set (typecheck, test, lint, format,
changeset status) — **none of which read prose for accuracy, anchor/cross-link integrity,
terminology consistency, or freedom from internal-process vocabulary.** That gap is exactly the
documentation phase's job. Accordingly this plan, which runs **after the code-phase merge has
landed and resolved the README + example-config + changesets**, is a small ordered set of
verification tasks: confirm the merged human-facing docs accurately and coherently reflect the
reconciled code, catch any doc drift the merge introduced, confirm the changeset surface stays
coherent, and confirm there is genuinely nothing new to document. If any task finds a defect, the
fix is a targeted doc correction within that same surface (no new surfaces, no feature
documentation — Requirement 9 forbids gratuitous change).

## Guardrail scopes

The two docs-phase guardrails (`changeset-format` → `npx tsx scripts/validate-changesets.ts`;
`changeset-status` → `npx changeset status --since=origin/trunk`) are **fixed commands** with no
scoped gates, so there is no `{scope}` value to fill.

| Gate | Scope |
| ---- | ----- |
| (none — both docs-phase guardrails are fixed commands) | None |

## Tasks

> All tasks run **after** the code phase has committed the merge (code-plan Tasks 1–8): the README
> prose merge, the example-config merge, and the changeset union are already in the tree. These
> tasks verify the merged human-facing documentation against the reconciled code; they author no
> new documentation and add no new doc surface. Any defect found is corrected in place within the
> surface named by the task.

### Task 1: Verify the merged `README.md` accurately reflects the reconciled behavior, with both feature stories intact

- **Goal:** Confirm that the post-merge `README.md` faithfully documents the reconciled code —
  carrying **both** the already-shipped skip-misconfigured-agents story **and** `trunk`'s
  nested-scenario-folder / subscription-auth story — and that the two overlapping paragraphs the
  code phase hand-merged read as a single coherent statement, not a dropped side or a duplicated
  one.
- **Audience:** Skillsmith end users and fork authors who configure runs, read `report.json`, and
  write hooks (the README's existing audience).
- **Files to change:** `README.md` (read in full against the shipped source; correct in place only
  if a stated behavior is wrong, a section was dropped, or a merge left a duplicated/contradictory
  paragraph).
- **Sections / scope:** The skip-feature sections (`### Exit codes`, "When an agent can't run",
  judge-stops / improver-halt prose, `### Skipped agents in report.json`, the hook-context
  `skipped` field) **and** `trunk`'s additive sections (nested scenario-ID selection prose with
  the `/`-normalized IDs and the `blocks/counter` example, the `beforeAll … scenarios` records,
  the claude-code subscription-auth prose). Pay particular attention to the two paragraphs the
  code phase merged by hand — the `afterAllScenarios` bullet and the self-improvement-summary
  sentence — which must each appear **once** and carry both the skip/runnable-exclusion prose and
  `trunk`'s `scenario.name` / `(scenario.name, agent)` precision.
- **Depends on:** none (the code-phase merge is a precondition for the whole docs phase)
- **Traces to:** Spec Requirement 2 (both sides preserved) / Acceptance criterion 2; Spec
  Requirement 5 (skip behavior observably unchanged); Spec Requirement 7 (`trunk`'s nested-folders
  work intact); Code-plan Task 4 (README prose merge).
- **Acceptance:**
  - A reader leaves understanding both stories from one coherent README: how a misconfigured agent
    is skipped (detection, surfacing, exit code `2`, `report.json` `skipped` array, hook-context
    `skipped`) **and** how nested scenario IDs are selected/normalized — with no section of either
    story missing.
  - Every behavior the README states matches the reconciled source it describes (no claim
    contradicts the shipped exit-code rule, the surfacing rule, the report shape, or the
    scenario-selection rule).
  - The two hand-merged paragraphs each appear exactly once, with neither the skip/runnable prose
    nor `trunk`'s `scenario.name` precision dropped, and with no leftover duplicate or
    contradictory adjacent variant.

### Task 2: Verify README internal coherence — anchors, cross-links, and terminology after the merge

- **Goal:** Confirm the merge did not break the README's internal navigation or split its
  vocabulary — every in-document link still resolves to a heading that exists, and the same
  concept is named the same way throughout (e.g. the skip surfacing, the `skipped` field, scenario
  IDs vs `scenario.name`).
- **Audience:** Any README reader following cross-references between the exit-codes, hooks,
  report-shape, and scenario-selection sections.
- **Files to change:** `README.md` (fix only broken anchors, stale link targets, or a
  terminology split introduced by the merge).
- **Sections / scope:** All intra-document links (the `#exit-codes`, `#hooks`,
  `#skipped-agents-in-reportjson`, `#afterallscenarios--the-verification-gate`,
  `#how-the-self-improvement-works`, `#how-the-skill-tester-works` style references) and the
  shared terminology across the skip sections and the scenario-selection sections.
- **Depends on:** Task 1
- **Traces to:** Spec Requirement 2 (both sides preserved without weakening); Spec Requirement 9
  (minimal, coherent result); Code-plan Task 4.
- **Acceptance:**
  - Every in-document cross-link in the merged README resolves to a heading that exists in the
    merged README (no dangling anchor introduced by the merge).
  - A concept that appears in both stories is named consistently across the merged sections (the
    reader is not handed two competing names for the same thing).

### Task 3: Verify `examples/skillsmith.config.ts` doc comments carry both sides and match the reconciled providers

- **Goal:** Confirm the merged reference config's **documentation comments** retain both `trunk`'s
  subscription-auth guidance on the `claude-code` agent **and** the branch's per-provider skip
  comments on the API-provider agents, and that each credential-env comment names the env var the
  reconciled provider actually requires.
- **Audience:** Fork authors copying the reference config — they rely on these comments to know
  which agents need which credentials and what happens when one is missing.
- **Files to change:** `examples/skillsmith.config.ts` (correct a doc comment only if it names the
  wrong credential env var, drops one side's guidance, or contradicts the shipped provider
  behavior).
- **Sections / scope:** The doc comments only — the subscription-auth comment on the `claude-code`
  agent and the "skipped (not failed) when the key is unset" comments on the `anthropic-api`,
  `openai-api`, and `gemini-api` agents, including that the gemini comment names the same
  credential env var the gemini provider requires. (Behavior/config values are the code phase's
  concern; this task verifies the prose.)
- **Depends on:** none (parallel with Task 1)
- **Traces to:** Spec Requirement 2 (both sides preserved) / Acceptance criterion 2; Spec
  Requirement 5 (per-provider skip story); Code-plan Task 5 (`examples/skillsmith.config.ts`
  resolution and the gemini-env characterization correction).
- **Acceptance:**
  - A reader of the example config understands both how the `claude-code` agent authenticates via
    subscription and that each API-provider agent is skipped (not failed) when its credential is
    unset — neither comment story dropped.
  - Each credential-env comment names the env var the corresponding reconciled provider actually
    requires (no mismatched or substituted key name).

### Task 4: Verify the changeset surface stays coherent and accurate after the union merge

- **Goal:** Confirm the merged `.changeset/` directory accurately and coherently describes what
  ships — the three branch changesets and the three `trunk` changesets together — with no entry
  dropped, emptied, downgraded, or duplicated, and that the docs-phase changeset guardrails are
  green.
- **Audience:** Release consumers reading `CHANGELOG.md` entries, and maintainers running the
  release workflow.
- **Files to change:** none expected — verification only. (Per the spec and code plan, **no
  changeset change is planned**: do not add, edit, downgrade, or delete any changeset. If a
  changeset is found dropped or emptied by a mis-merge, that is a code-phase regression to report,
  not a docs edit to author.)
- **Sections / scope:** All six changeset bodies — `skip-misconfigured-agents.md` (minor),
  `early-skip-announcement.md` (patch), `initial-scaffolding.md` (none),
  `claude-code-subscription-auth.md`, `nested-scenario-folders.md`,
  `wordpress-coding-standards.md` — read for the consistency between what each describes and what
  the reconciled tree actually ships.
- **Depends on:** none (parallel with Task 1)
- **Traces to:** Spec Requirement 8 (changesets coherent; `@automattic/skillsmith` at `minor`; no
  changeset deleted/emptied/downgraded/added); Code-plan Task 8 / Flow 8.
- **Acceptance:**
  - `npx tsx scripts/validate-changesets.ts` exits 0 and `npx changeset status --since=origin/trunk`
    exits 0 reporting `@automattic/skillsmith` bumped at `minor`.
  - All six changesets are present and non-empty, and each still accurately describes a
    behavior/contract the reconciled tree ships (the skip story, early-announcement, scaffolding,
    subscription-auth, nested folders, and the WordPress-standards tooling bump) — none dropped,
    downgraded, or rendered inaccurate by the merge; and the reconciliation itself adds no new
    changeset.

### Task 5: Sweep the merged docs for internal-process vocabulary and confirm nothing new needs documenting

- **Goal:** Confirm the merged human-facing documentation contains **no internal-process
  vocabulary** (no phase names, no spec/design/plan references, no acceptance-criteria or task
  identifiers) — a doc-quality property no code guardrail checks — and make the explicit
  determination that the reconciliation introduces no consumer-visible behavior requiring new
  documentation.
- **Audience:** All external readers of the public docs (README, example config, CONTRIBUTING,
  changesets) — the property protects them from leaked internal vocabulary.
- **Files to change:** `README.md`, `examples/skillsmith.config.ts` (and a read-only confirmation
  of the auto-merged `CONTRIBUTING.md` and the changeset bodies). Remove any process-vocabulary
  leak found in the merged prose; otherwise change nothing.
- **Sections / scope:** The merged prose introduced or touched by the code phase — chiefly the
  README's two hand-merged paragraphs and any newly adjacent merged sections, plus the
  example-config comments — checked for phase/spec/design/plan/task/acceptance-criteria
  vocabulary. Also a closing determination, recorded in the task's execution, that no new
  user-facing surface is warranted because the reconciliation ships no behavior beyond what the
  existing docs and changesets already cover.
- **Depends on:** Task 1, Task 3, Task 4
- **Traces to:** Spec Requirement 10 (no internal-process vocabulary leaks) / its Acceptance
  criterion; Spec Requirement 9 (minimal change — no invented documentation); Code-plan Task 4 /
  Task 8 / Flow 9.
- **Acceptance:**
  - No phase name, spec/design/plan reference, or acceptance-criteria/task identifier appears
    anywhere in the merged README, example-config comments, CONTRIBUTING, or changeset bodies.
  - The plan executor records an explicit confirmation that the reconciliation introduces no
    consumer-visible behavior beyond what the existing documentation already describes, so no new
    documentation surface is created (the docs phase remains verification-only).
