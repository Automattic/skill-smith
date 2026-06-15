# Code Plan: Trim over-explanation from the guardrails adoption

## Overview

This is a presentation-only trim of the base "guardrails adoption" change (GitHub issue #43). It conveys the same information more leanly with no behaviour change: the `.rp.md` `## Guardrails` section is reduced to its heading plus the existing 6-row table (all explanatory prose dropped); the `.rp.md` `## Worktree bootstrap` section is collapsed to a single sentence that names `npm ci` and `npm ci --prefix testing-project` directly instead of behind a wrapper script; and the now-orphaned wrapper `scripts/bootstrap-worktree.sh` is deleted. This plan covers only the code/config changes — the two `.rp.md` edits and the script deletion. The two `CONTRIBUTING.md` edits belong to the doc plan (phase 5) and are not part of this plan.

The two `.rp.md` edits touch non-overlapping sections (`## Guardrails` is the file's last section; `## Worktree bootstrap` is earlier), so they cannot conflict. The worktree-bootstrap edit and the script deletion are one logical unit: the `.rp.md` prose must stop naming the script before or together with deleting it, so no live reference outlives the file. Tasks are ordered so that the `.rp.md` worktree-bootstrap edit (Task 1) lands first, then the script deletion (Task 2), then the independent guardrails-table trim (Task 3).

All work is confined to `.rp.md` and `scripts/bootstrap-worktree.sh` in the worktree root `/Users/darerodz/Code/skillsmith/.claude/worktrees/43-adopt-guardrails` (branch `worktree-43-adopt-guardrails`). No source, build, or runtime path is touched. No changeset is required: no versionable path (`src/**`, `bin/**`, `package.json`, `examples/**`, `README.md`) is modified — do not add one.

## Tasks

### Task 1: Collapse the `.rp.md` `## Worktree bootstrap` section to one sentence

- **Goal:** Replace the multi-paragraph worktree-bootstrap body with a single sentence that names the two `npm ci` commands directly, keeps the timing cue and the worktree-root location, and removes the only live reference to the wrapper script from `.rp.md`.
- **Files to change:** `/Users/darerodz/Code/skillsmith/.claude/worktrees/43-adopt-guardrails/.rp.md`
- **Changes:** In the `## Worktree bootstrap` section (currently lines 65–73 — the heading plus four paragraphs, the first of which names `bash scripts/bootstrap-worktree.sh`), replace the entire body with the heading plus exactly one sentence. The end state of the section must be, verbatim:

  ```markdown
  ## Worktree bootstrap

  After `EnterWorktree`, and **before launching any phase agent or running any guardrail**, the orchestrator runs `npm ci` and `npm ci --prefix testing-project` from the worktree root.
  ```

  Use single blank-line separation between the heading and the sentence, and a single blank line before the following `## Branch names` heading. Do not leave a double blank line or trailing blank line behind. Do not touch any other section. The mention of `bash scripts/bootstrap-worktree.sh` (current line 67) must be gone after this edit.
- **Depends on:** none
- **Traces to:** Spec requirement 2; Spec acceptance criteria 2 and 3; Design doc "Edit 2 — `.rp.md` `## Worktree bootstrap` final text" and Decision "The one-sentence worktree-bootstrap replacement keeps every operative element".
- **Acceptance:**
  - The `## Worktree bootstrap` section contains its heading and exactly one sentence (no other paragraphs).
  - That sentence names both `npm ci` and `npm ci --prefix testing-project` directly.
  - That sentence keeps the timing cue ("After `EnterWorktree`, and **before launching any phase agent or running any guardrail**") and the location ("from the worktree root").
  - The section body matches the verbatim text above, including the bold span and the single blank-line spacing, with no double or trailing blank line and a single blank line before `## Branch names`.
  - No reference to `scripts/bootstrap-worktree.sh` (or the substring `bootstrap-worktree`) remains anywhere in `.rp.md`.
  - No other section of `.rp.md` is modified.

### Task 2: Delete `scripts/bootstrap-worktree.sh`

- **Goal:** Remove the orphaned wrapper script now that no document references it, while keeping `scripts/validate-changesets.ts` so the `scripts/` directory survives.
- **Files to change:** delete `/Users/darerodz/Code/skillsmith/.claude/worktrees/43-adopt-guardrails/scripts/bootstrap-worktree.sh`
- **Changes:** Delete the file `scripts/bootstrap-worktree.sh` in full (its current contents are the five-line `set -euo pipefail` wrapper running `npm ci` and `npm ci --prefix testing-project`). Use a git-aware deletion (`git rm`) so the removal is staged for the diff. Do not modify, move, or delete `scripts/validate-changesets.ts`.
- **Depends on:** Task 1 (the `.rp.md` prose must stop naming the script before or together with deleting it; Task 1 removes the only live reference).
- **Traces to:** Spec requirement 3; Spec acceptance criteria 4 and 5; Design doc "Edit 3 — delete `scripts/bootstrap-worktree.sh`" and Decision "Deleting `scripts/bootstrap-worktree.sh` is behaviour-preserving".
- **Acceptance:**
  - `scripts/bootstrap-worktree.sh` no longer exists on the filesystem.
  - `scripts/validate-changesets.ts` still exists and is unchanged, so the `scripts/` directory is not removed.
  - A repo-wide search for `bootstrap-worktree` (excluding `node_modules`, `.git`, and `.pipelines`) returns no live reference — no hit in `package.json`, `testing-project/package.json`, `.github/**`, `AGENTS.md`, `CLAUDE.md`, `README.md`, or `.rp.md`.

### Task 3: Trim the `.rp.md` `## Guardrails` section to heading plus table

- **Goal:** Reduce the `## Guardrails` section to its heading and the existing 6-row table, removing the lead definition paragraph and all five trailing explanatory paragraphs, while keeping the table's rows, commands, and phases byte-identical.
- **Files to change:** `/Users/darerodz/Code/skillsmith/.claude/worktrees/43-adopt-guardrails/.rp.md`
- **Changes:** In the `## Guardrails` section (currently lines 93–114, the file's last section), remove the lead paragraph (current line 95, "Gates are exit-code-only verification commands…") and all five trailing explanatory paragraphs (current lines 106, 108, 110, 112, 114 covering the GitHub Actions lift, `changeset-format`, `changeset-status`, the "two properties", and `--since=origin/trunk`). Keep the table (current lines 97–104) exactly as-is. The end state of the section must be, verbatim:

  ```markdown
  ## Guardrails

  | Name             | Command                                         | Phase      |
  | ---------------- | ----------------------------------------------- | ---------- |
  | typecheck        | `npm run typecheck`                             | code       |
  | lint             | `npm run lint`                                  | code       |
  | tests            | `npm test`                                      | code       |
  | config-smoke     | `npm --prefix testing-project run check:config` | code       |
  | changeset-format | `npx tsx scripts/validate-changesets.ts`        | code, docs |
  | changeset-status | `npx changeset status --since=origin/trunk`     | docs       |
  ```

  `## Guardrails` is the last section in `.rp.md`, so after this trim the file ends with the table. Use single blank-line separation between the heading and the table; do not leave a double blank line after the heading or a stray blank line after the table beyond a single trailing newline. Do not touch any other section.
- **Depends on:** none (independent of Tasks 1 and 2; edits a non-overlapping section of `.rp.md`).
- **Traces to:** Spec requirement 1; Spec acceptance criterion 1; Design doc "Edit 1 — `.rp.md` `## Guardrails` final text" and Decision "The Guardrails table communicates the guardrails on its own".
- **Acceptance:**
  - The `## Guardrails` section contains only its heading and the 6-row table — no lead paragraph and no trailing explanatory prose.
  - The six rows' names, commands, and phases are identical to before the change: `typecheck`, `lint`, `tests`, `config-smoke` at phase `code`; `changeset-format` at `code, docs`; `changeset-status` at `docs`.
  - `.rp.md` ends with the guardrails table (it is the last section), with no trailing explanatory paragraphs and no double blank line after the heading.
  - No other section of `.rp.md` is modified.

## Cross-cutting acceptance (whole change)

These hold once Tasks 1–3 are complete; they confirm scope discipline and gate health. They are not separate tasks — they are the integration checks for the batch.

- The only changes in the diff are: edits to `.rp.md` (worktree-bootstrap section and guardrails section) and the deletion of `scripts/bootstrap-worktree.sh`. No out-of-scope base-run artifact is modified — not the `@automattic/skillsmith` dependency rename, the `verify-e2e` import-specifier fix, `testing-project/package.json`'s `check:config` script, the lockfile, `.github/workflows/changeset-gate.yml`, or the Radical Pipelines plugin. (`CONTRIBUTING.md` is changed only by the separate doc plan, not here.)
- The code-phase guardrails — `typecheck`, `lint`, `tests`, `config-smoke`, and `changeset-format` — still pass, since no TypeScript/source change is made.
- No changeset is added: no versionable path (`src/**`, `bin/**`, `package.json`, `examples/**`, `README.md`) is touched, so `changeset-status` is satisfied without one.
