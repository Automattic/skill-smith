# Doc Plan: Trim over-explanation from the guardrails adoption

## Overview

This is the documentation half of a presentation-only trim of the base "guardrails adoption" change (GitHub issue #43). It conveys the same information more leanly, with no behaviour change. The only documentation surface in scope is `CONTRIBUTING.md` at the repo root — the human-facing contributor/maintainer reference — and only its "Running tests and checks locally" section. Two distinct edits land there: the pipeline-internal guardrails cross-reference paragraph is removed entirely, and the verbose `check:config` bullet is tightened to a single em-dash clause that matches the surrounding terse bullets while retaining both of its required facts. The `.rp.md` section trims and the `scripts/bootstrap-worktree.sh` deletion are handled by the code plan (phase 4) and are not part of this plan. No changeset is required and none should be added: this review touches only non-versionable paths.

## Tasks

### Task 1: Remove the `CONTRIBUTING.md` guardrails cross-reference paragraph

- **Goal:** Delete the paragraph that cross-references the `.rp.md` Guardrails from `CONTRIBUTING.md` entirely. It carries pipeline-internal detail (that the local checks double as pipeline gates judged by exit code) that a human contributor does not need, and it lives in `.rp.md` where the pipeline machinery reads it.
- **Audience:** Contributors and maintainers running local checks before pushing a PR.
- **Files to change:** `/Users/darerodz/Code/skillsmith/.claude/worktrees/43-adopt-guardrails/CONTRIBUTING.md`
- **Sections / scope:** The "Running tests and checks locally" section — specifically the standalone paragraph (currently line 15) that begins "These same commands are declared as **Guardrails** in [`.rp.md`]…", which sits between the `check:config` bullet and the `## Versioning policy` heading. Remove the paragraph in full, and remove the surrounding blank line so no double blank line is left behind; after the edit the `## Versioning policy` heading sits one blank line below the final bullet of the check list.
- **Depends on:** none (independent of Task 2; edits a distinct, non-overlapping line of the same file).
- **Traces to:** Spec requirement 4; Spec acceptance criterion 6 (the cross-reference paragraph no longer present); Design doc "Edit 4 — remove the `CONTRIBUTING.md` guardrails cross-reference" and Decision "Drop the `CONTRIBUTING.md` guardrails cross-reference".
- **Acceptance:**
  - The reader of `CONTRIBUTING.md` no longer encounters any statement that the local checks are declared as guardrails in `.rp.md` or are run/judged by the pipeline — that cross-reference is gone in full.
  - The "Running tests and checks locally" section flows directly from its check-list bullets to the next heading with clean single blank-line separation (no double blank line and no orphaned blank line where the paragraph was).
  - No other content in `CONTRIBUTING.md` is changed by this task.

### Task 2: Tighten the `CONTRIBUTING.md` `check:config` bullet

- **Goal:** Reduce the `check:config` bullet to a single em-dash clause matching the surrounding terse bullet style, retaining exactly the two required facts: that the check loads the fixture config through its real import graph, and that this catches config-load and import regressions the other checks miss.
- **Audience:** Contributors and maintainers running local checks before pushing a PR.
- **Files to change:** `/Users/darerodz/Code/skillsmith/.claude/worktrees/43-adopt-guardrails/CONTRIBUTING.md`
- **Sections / scope:** The "Running tests and checks locally" section — the `check:config` bullet (currently line 13), the last bullet of the check list. Replace it with the design doc's exact final text:

  ```markdown
  - `npm --prefix testing-project run check:config` — loads the fixture config through its real import graph, catching config-load and import regressions the other checks miss.
  ```

  Use a real em dash (U+2014) with a space on each side, matching the sibling bullets (`` `command` `` + " — " + one short clause + period). Do not retain the parenthetical scope note ("no agents, no API key, no wp-env, no network") or the trailing "because none of them…" clause — both are elaboration beyond the two required facts.
- **Depends on:** none (independent of Task 1; edits a distinct line of the same file).
- **Traces to:** Spec requirement 5; Spec acceptance criterion 6 (single em-dash clause matching siblings, still states facts (a) and (b)); Design doc "Edit 5 — tighten the `CONTRIBUTING.md` `check:config` bullet" and Decision "Tighten the `check:config` bullet to the sibling bullet style".
- **Acceptance:**
  - The `check:config` bullet is a single em-dash clause in the same shape as its sibling bullets (`` `command` `` + " — " + one short clause + period), using a real em dash (U+2014) with surrounding spaces, not a hyphen.
  - The bullet still conveys that the check loads the fixture config through its real import graph and that doing so catches config-load and import regressions the other checks miss.
  - The bullet text matches the design doc's exact final text quoted above; the verbose parenthetical and the trailing "because none of them…" clause are gone.
  - No other content in `CONTRIBUTING.md` is changed by this task.

## Cross-cutting acceptance (whole change)

These hold once Tasks 1–2 are complete; they are integration checks for the doc batch, not separate tasks.

- The only documentation change in the diff is to `CONTRIBUTING.md` (the two edits above, both within "Running tests and checks locally"). No other documentation surface is touched. The `.rp.md` and `scripts/bootstrap-worktree.sh` changes belong to the code plan, not here.
- No out-of-scope base-run artifact is modified by the docs work — not the `@automattic/skillsmith` dependency rename, the `verify-e2e` import-specifier fix, `testing-project/package.json`'s `check:config` script, the lockfile, `.github/workflows/changeset-gate.yml`, or the Radical Pipelines plugin.
- No changeset is added: this review touches only non-versionable paths (`.rp.md`, `CONTRIBUTING.md`, `scripts/`), so the docs-phase guardrails (`changeset-format`, `changeset-status`) pass without one.
