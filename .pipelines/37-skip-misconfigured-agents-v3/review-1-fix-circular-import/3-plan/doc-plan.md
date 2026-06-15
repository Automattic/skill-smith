# Doc Plan: Fix the testing-project circular import (v3)

## Overview

This review run is an internal bug fix to a non-published fixture. It breaks a
circular import inside `testing-project/` (delete the back-edge `import config`
and the module-init read in `eval/utils/verify-e2e.ts`; add a
`configuredProjectNames` parameter to `runE2eVerification`; supply it from the
`afterAllScenarios` hook in `skillsmith.config.ts`) and adds one root-suite
regression test under `src/__tests__/`. No published API, runtime behavior, or
consumer-facing contract changes. A repository-wide sweep for documentation that
references the surfaces this fix touches found no prose, README, contributor-doc,
or pipeline-doc passage that goes out of date as a result — and the one inline
narrative comment that *is* being removed (`verify-e2e.ts` lines 21–24) is
deleted by the code plan's Task 1, so it is code-phase work, not doc-phase work.
The only documentation-policy deliverable, therefore, is the **changeset
decision**, and that decision is that **no changeset is required**. This plan
records that decision, the evidence behind it, and the verification that both
docs-phase changeset guardrails (`changeset-format`, `changeset-status`) exit 0
with no changeset added. It defines exactly one task — a verification/no-op task
— and no prose-doc tasks.

## Changeset decision (summary)

**No changeset is required, and none should be added.** Every file this fix
touches is on an explicitly excluded path:

- `testing-project/eval/utils/verify-e2e.ts`,
  `testing-project/skillsmith.config.ts` — the `testing-project/` fixture, which
  `CONTRIBUTING.md#when-a-changeset-is-required` lists among the paths that do
  **NOT** need a changeset ("…the `testing-project/` fixture…").
- `src/__tests__/config-loads.test.ts` (new) — a tests-only path; the same
  section states "Tests-only changes (`src/__tests__/**`) do not require a
  changeset; the gate excludes that path explicitly."

No published export, runtime, type re-export, `examples/`, `README` contract
section, or `package.json` field is modified, so none of the changeset-requiring
categories is triggered. Adding a changeset (even an empty one) is therefore
unwarranted and would be a false signal; the plan's single task asserts that no
`.changeset/*.md` file is created or edited.

This matches the conclusion already reached by the code plan and its review.

## Tasks

### Task 1: Verify and record that no changeset (and no prose-doc edit) is required

- **Goal:** Confirm — without adding or editing any documentation, changeset, or
  source file — that this fix needs no changeset and no prose-doc update, and that
  both docs-phase changeset guardrails pass. Produce the recorded rationale (this
  file is that record) and the read-only verification evidence.
- **Audience:** The pipeline orchestrator and the doc-reviewer (phase 5/review),
  plus any future contributor auditing why this fixture+test fix shipped without a
  changeset.
- **Files to change:** None. This is a verification/no-op task. In particular: do
  **not** create or edit any file under `.changeset/`, and do **not** edit
  `CONTRIBUTING.md`, `README.md`, `.rp.md`, `docs/`, or any inline source comment.
  (The deletion of the `verify-e2e.ts` lines 21–24 narrative comment is owned by
  the code plan's Task 1, not by this doc task.)
- **Sections / scope:**
  - Re-confirm the excluded-path rule in `CONTRIBUTING.md` (the
    "When a changeset is required" / "Where the gate fires" guidance) covers every
    file the code plan changes: `testing-project/**` (fixture) and
    `src/__tests__/**` (tests). Both are listed as excluded.
  - Run the two docs-phase guardrails read-only and confirm exit 0 **with no
    changeset added**:
    - `changeset-format` — `npx tsx scripts/validate-changesets.ts` (validates the
      *format* of any existing changesets; it does not require a new one, so it
      passes untouched).
    - `changeset-status` — `npx changeset status --since=origin/trunk` (exits 0;
      it does not fail for a missing changeset on excluded-only paths). Note for
      the executor: the code is not written yet, so a read-only run reflects only
      already-committed artifacts on the branch — a green result here plus the
      excluded-path rule together establish the decision; the authoritative green
      is re-confirmed in phase 5 against the landed tree.
  - Confirm the repository sweep result holds: the only markdown mentions of the
    touched guardrail (`.rp.md` guardrails table row for `config-smoke`;
    `CONTRIBUTING.md` bullet describing `check:config`) describe the guardrail by
    its purpose ("loads the fixture config through its real import graph, catching
    config-load and import regressions"), which the fix makes pass rather than
    redefines — so both remain accurate and need no edit.
- **Depends on:** none.
- **Traces to:** Code plan "Scope and guardrail notes for code-writers" ("No
  changeset is required."); code plan Tasks 1–3 (all changes confined to
  `testing-project/**` and `src/__tests__/**`); Spec "Out of Scope" ("Changing the
  public API of the `@automattic/skillsmith` package" is out of scope) and AC1/AC5
  (the guardrail and regression test are the verification surface, not a
  documentation surface).
- **Acceptance:**
  - The reader (orchestrator / doc-reviewer) leaves understanding that **no
    changeset is required** for this fix and **why**: all changed files are on
    `CONTRIBUTING.md`-excluded paths (`testing-project/**` fixture and
    `src/__tests__/**` tests), and no changeset-requiring category is triggered.
  - The record confirms **no `.changeset/*.md` file is created or modified** by
    this review run, and that doing so would be incorrect.
  - The record confirms both docs-phase changeset guardrails exit 0 with no
    changeset present: `changeset-format`
    (`npx tsx scripts/validate-changesets.ts`) and `changeset-status`
    (`npx changeset status --since=origin/trunk`).
  - The record confirms the repository sweep found no prose, README, contributor
    doc, inline-comment, example, or pipeline-doc passage that this fix renders
    inaccurate and that any doc-writer must update — i.e. there are **no
    prose-doc tasks** in this plan, and that absence is justified, not an
    oversight.
