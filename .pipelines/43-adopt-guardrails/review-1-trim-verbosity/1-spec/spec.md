# Spec: Trim over-explanation from the guardrails adoption

## Overview

A prior change ("guardrails adoption", GitHub issue #43) added pipeline guardrails and supporting documentation to this repository. The shipped output is over-explained: the `.rp.md` "Guardrails" section restates what a guardrail is and explains each changeset gate at length, the "Worktree bootstrap" section hides two simple `npm ci` commands behind a wrapper script plus a multi-paragraph rationale, and `CONTRIBUTING.md` carries a pipeline-internal guardrails cross-reference and a verbose `check:config` bullet that breaks the surrounding terse style.

This change is a presentation-only trim. It conveys the same information more leanly: the guardrails are communicated by the table alone, the worktree-bootstrap step names its two commands directly instead of behind a script, and the human-facing contributor docs drop pipeline-internal detail and match their own terse bullet style. The behaviour of the guardrails — their set, commands, and phase assignments — does not change.

## Requirements

1. The `.rp.md` `## Guardrails` section contains only its heading and the existing 6-row guardrails table. The lead paragraph and all five trailing explanatory paragraphs are removed; no intro or explanatory prose remains. The table is unchanged in rows, commands, and phase assignments: `typecheck`, `lint`, `tests`, `config-smoke` run at phase `code`; `changeset-format` runs at phases `code, docs`; `changeset-status` runs at phase `docs`.

2. The `.rp.md` `## Worktree bootstrap` section retains its heading and reduces its body to a single sentence that keeps the timing cue ("after `EnterWorktree`, and before launching any phase agent or running any guardrail") and names the two commands `npm ci` and `npm ci --prefix testing-project` directly. The recommended text is:

   ```markdown
   ## Worktree bootstrap

   After `EnterWorktree`, and **before launching any phase agent or running any guardrail**, the orchestrator runs `npm ci` and `npm ci --prefix testing-project` from the worktree root.
   ```

   No reference to `scripts/bootstrap-worktree.sh` remains anywhere in `.rp.md`.

3. The file `scripts/bootstrap-worktree.sh` is deleted. `scripts/validate-changesets.ts` remains in place, so the `scripts/` directory is not removed.

4. The `CONTRIBUTING.md` guardrails cross-reference paragraph ("These same commands are declared as **Guardrails** in [`.rp.md`]…") is removed entirely.

5. The `CONTRIBUTING.md` `check:config` bullet is tightened to a single em-dash clause matching the surrounding terse bullet style (`` `command` `` + em dash + one short clause + period). It still conveys (a) that the check loads the fixture config through its real import graph and (b) that this catches config-load and import regressions the other checks miss. The recommended text is:

   ```markdown
   - `npm --prefix testing-project run check:config` — loads the fixture config through its real import graph, catching config-load and import regressions the other checks miss.
   ```

6. No guardrail command, name, or phase assignment changes. The other changes that shipped with the base run are left intact: the `@automattic/skillsmith` dependency rename, the `verify-e2e` import-specifier fix, the `check:config` script in `testing-project/package.json`, and the lockfile.

## Out of Scope

- Changing any guardrail command, name, or phase assignment (the contents of the `.rp.md` Guardrails table).
- The `@automattic/skillsmith` dependency rename, the `verify-e2e` import-specifier fix, the `check:config` script in `testing-project/package.json`, and the lockfile.
- The Radical Pipelines plugin itself.
- `scripts/validate-changesets.ts` (the `changeset-format` gate's command) and `.github/workflows/changeset-gate.yml`.

## Acceptance Criteria

- Given the `.rp.md` `## Guardrails` section, when it is read, then it contains only the `## Guardrails` heading and the 6-row table, with no lead or trailing prose paragraphs, and the six rows' names, commands, and phases are identical to before the change.
- Given the `.rp.md` `## Worktree bootstrap` section, when it is read, then it contains the heading and one sentence that names both `npm ci` and `npm ci --prefix testing-project` directly and keeps the "after `EnterWorktree` / before launching any phase agent or running any guardrail" timing cue.
- Given the repository after the change, when `.rp.md` is searched, then no reference to `scripts/bootstrap-worktree.sh` (or `bootstrap-worktree`) remains in it.
- Given the repository after the change, when the filesystem is inspected, then `scripts/bootstrap-worktree.sh` does not exist and `scripts/validate-changesets.ts` still exists.
- Given a repo-wide search for `bootstrap-worktree` (excluding `node_modules`, `.git`, and `.pipelines`), when it is run, then it returns no live reference (no hit in `package.json`, `testing-project/package.json`, `.github/**`, `AGENTS.md`, `CLAUDE.md`, `README.md`, or `.rp.md`).
- Given `CONTRIBUTING.md`, when it is read, then it no longer contains the "These same commands are declared as **Guardrails** in `.rp.md`…" cross-reference paragraph.
- Given the `CONTRIBUTING.md` `check:config` bullet, when it is read, then it is a single em-dash clause matching the sibling bullets' style and still states that the check loads the fixture config through its real import graph and that this catches regressions the other checks miss.
- Given the change is complete, when the guardrail gates are run, then they still pass, and no out-of-scope base-run change (dependency rename, `verify-e2e` import fix, `testing-project` `check:config` script, lockfile, or the Radical Pipelines plugin) has been modified.
