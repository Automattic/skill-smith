# Design Doc: Trim over-explanation from the guardrails adoption

## Overview

A prior change ("guardrails adoption", GitHub issue #43) added pipeline guardrails and supporting documentation to this repository. The shipped output is over-explained: the `.rp.md` "Guardrails" section restates what a guardrail is and explains each changeset gate at length, the "Worktree bootstrap" section hides two simple `npm ci` commands behind a wrapper script plus a multi-paragraph rationale, and `CONTRIBUTING.md` carries a pipeline-internal guardrails cross-reference plus a verbose `check:config` bullet that breaks the surrounding terse bullet style.

This is a **presentation-only trim**. It conveys the same information more leanly across three files and removes one redundant wrapper script. The behaviour of the guardrails — their set, commands, and phase assignments — does not change. There is no new architecture, no new dependency, and no change to any executable code path: every edit is to documentation prose or is the deletion of a script that has no programmatic caller.

## Approach

The change is five edits across three files. None introduces or removes a capability; each strips redundant explanation while preserving every load-bearing instruction.

1. `.rp.md` `## Guardrails` — reduce to the heading plus the existing 6-row guardrails table; remove the lead paragraph and all five trailing explanatory paragraphs.
2. `.rp.md` `## Worktree bootstrap` — replace the multi-paragraph body (which named `bash scripts/bootstrap-worktree.sh` plus rationale) with a single sentence that names the two commands `npm ci` and `npm ci --prefix testing-project` directly and keeps the timing cue.
3. `scripts/bootstrap-worktree.sh` — delete the file.
4. `CONTRIBUTING.md` — remove the guardrails cross-reference paragraph entirely.
5. `CONTRIBUTING.md` — tighten the `check:config` bullet to a single em-dash clause matching the sibling bullets.

The mental model for the implementer: `.rp.md` is an instruction file read by the orchestrator agent — nothing executes it — and `CONTRIBUTING.md` is a human-facing contributor reference. Both are documentation. The wrapper script being deleted (edit 3) is invoked only by a human or agent reading the `.rp.md` prose and typing the command; it has no shell/hook/workflow/settings caller. So all five edits are safe text/file operations. The only coupling is that the `.rp.md` worktree-bootstrap prose must stop naming the script before or together with deleting it, so no live reference outlives the file.

## Components

All affected components are documentation or a standalone shell script. No source module, build step, or runtime path is touched.

- **`.rp.md` (modified).** The Radical Pipelines project-conventions file at the repo root. It is plain instruction prose read by the orchestrator agent; nothing executes it. Two non-overlapping sections change: `## Worktree bootstrap` (currently lines 65–73) and `## Guardrails` (currently lines 93–114, the file's last section). The guardrails *table* inside the latter is preserved verbatim.
- **`scripts/bootstrap-worktree.sh` (deleted).** A 5-line wrapper that runs `set -euo pipefail` followed by `npm ci` and `npm ci --prefix testing-project`. Deleted in full.
- **`CONTRIBUTING.md` (modified).** The human-facing contributor/maintainer reference at the repo root. Two distinct lines change: the `check:config` bullet (currently line 13) is tightened, and the guardrails cross-reference paragraph (currently line 15) is removed.
- **`scripts/validate-changesets.ts` (untouched, relevant).** The `changeset-format` gate's command target. It must remain in place — its presence is why deleting `bootstrap-worktree.sh` does not remove the `scripts/` directory.
- **Out-of-scope artifacts (untouched, relevant).** The `@automattic/skillsmith` dependency rename, the `verify-e2e` import-specifier fix, `testing-project/package.json`'s `check:config` script, the lockfile, `.github/workflows/changeset-gate.yml`, and the Radical Pipelines plugin itself. All base-run changes other than the five edits above stay intact.

## Interfaces and Data Flow

There are no programmatic interfaces in this change — no APIs, function signatures, or message shapes. The "interfaces" here are the exact final text of the edited documentation regions and the deleted file. The implementer should produce these end states verbatim.

### Edit 1 — `.rp.md` `## Guardrails` final text

Reduce the section to its heading plus the existing table. Remove the lead paragraph (current line 95) and all five trailing explanatory paragraphs (current lines 106, 108, 110, 112, 114). The table (current lines 97–104) is kept exactly — same rows, commands, and phases. Final state of the section:

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

`## Guardrails` is the last section in `.rp.md`, so after this trim the file ends with the table. No intro or explanatory prose remains in the section.

### Edit 2 — `.rp.md` `## Worktree bootstrap` final text

Replace the section body (current lines 65–73: heading + four paragraphs) with the heading plus a single sentence. Final state of the section:

```markdown
## Worktree bootstrap

After `EnterWorktree`, and **before launching any phase agent or running any guardrail**, the orchestrator runs `npm ci` and `npm ci --prefix testing-project` from the worktree root.
```

After this edit, no reference to `scripts/bootstrap-worktree.sh` (or the substring `bootstrap-worktree`) remains anywhere in `.rp.md`.

### Edit 3 — delete `scripts/bootstrap-worktree.sh`

Delete the file. Its full current contents are:

```bash
#!/usr/bin/env bash
set -euo pipefail

npm ci
npm ci --prefix testing-project
```

`scripts/validate-changesets.ts` remains, so `scripts/` is not removed.

### Edit 4 — remove the `CONTRIBUTING.md` guardrails cross-reference

Delete the paragraph (current line 15) that begins "These same commands are declared as **Guardrails** in [`.rp.md`]…", in full. Remove the blank line that separated it from surrounding content so no double blank line is left behind. The `## Versioning policy` heading that follows should sit one blank line below the `check:config` bullet that precedes the deleted paragraph.

### Edit 5 — tighten the `CONTRIBUTING.md` `check:config` bullet

Replace the verbose bullet (current line 13) with a single em-dash clause. Final text of the bullet:

```markdown
- `npm --prefix testing-project run check:config` — loads the fixture config through its real import graph, catching config-load and import regressions the other checks miss.
```

The em dash is U+2014 with a space on each side, matching the sibling bullets (`` `command` `` + " — " + one short clause + period).

### Data flow

The only data flow worth noting is the human/agent reading path, which is unchanged in effect:

- An orchestrator agent reads `.rp.md` `## Worktree bootstrap` and runs the two named commands from the worktree root. Before the change it reads "run `bash scripts/bootstrap-worktree.sh`" and the script runs the two `npm ci` commands; after the change it reads the two `npm ci` commands directly and runs them. The commands executed in the worktree are identical.
- A contributor reads `CONTRIBUTING.md` "Running tests and checks locally" and runs the listed commands; the command set is unchanged.

## Key Decisions

### Decision: Deleting `scripts/bootstrap-worktree.sh` is behaviour-preserving

- **Choice:** Delete the wrapper script and inline its two commands into the `.rp.md` worktree-bootstrap sentence, rather than keeping the script and only trimming the prose.
- **Alternatives:** (a) Keep the script and only shorten the surrounding prose — rejected because it leaves the indirection the owner explicitly objected to and keeps a file whose only purpose is to hold two one-liners. (b) Keep the script but stop referencing it in `.rp.md` — rejected because it would orphan the file (a script no document points to), which is worse than either keeping it referenced or deleting it.
- **Trade-offs:** The script added one behaviour over "run two commands": `set -e` fail-fast on the first failed `npm ci` (`-u`/`-o pipefail` are inert here — the body has no variables or pipes). Inlining does not weaken this in practice: an agent running two ordered commands surfaces a non-zero exit and stops, and a failed `npm ci` is loud (non-zero exit + error output) with or without a `set -e` wrapper. No silent-success path is introduced. The benefit is removing an indirection layer and a file with no programmatic caller. **Verification that the script has no caller:** a repo-wide search for `bootstrap-worktree` (excluding `node_modules`/`.git`/`.pipelines`) finds the live string in exactly one place — `.rp.md` line 67. No root or `testing-project` `package.json` script, no `.github/**` workflow, no `.claude/` hook or `settings.json`, and no shell invocation calls it. Its sole "caller" is the `.rp.md` prose, which edit 2 updates. So deletion cannot break automation.
- **Traces to:** Requirement 3; acceptance criteria 4 and 5 (`scripts/bootstrap-worktree.sh` absent, `scripts/validate-changesets.ts` present, no live `bootstrap-worktree` reference anywhere).

### Decision: The one-sentence worktree-bootstrap replacement keeps every operative element

- **Choice:** Replace the four paragraphs with one sentence that preserves the three load-bearing elements verbatim: the two commands (`npm ci`, `npm ci --prefix testing-project`), the timing cue ("after `EnterWorktree`, and before launching any phase agent or running any guardrail"), and the location ("from the worktree root").
- **Alternatives:** Keep one or two of the rationale paragraphs (e.g. the "two workspaces" explanation). Rejected because each dropped paragraph is explanatory-only, not an instruction (see trade-offs).
- **Trade-offs:** The dropped paragraphs are all elaboration: (1) "two workspaces must be installed separately because root `package.json` has no `workspaces` key" is the *reason* there are two commands — fully encoded by naming both commands explicitly (confirmed: root `package.json` has no `workspaces` key, so two commands are genuinely required); (2) "'bootstrapped' means a complete clean install (`npm ci`), not just node_modules exists" is intrinsic to `npm ci`, which by definition wipes `node_modules` and installs from the lockfile — naming `npm ci` (not `npm install`) carries this; (3) "omitting bootstrap → gates fail their execute test → agent reports a BLOCKER" is failure-mode handling owned by the guardrail/skill convention machinery, independent of this paragraph; (4) "a command-not-found in an un-bootstrapped worktree is a bootstrap omission, not a guardrail defect" is a diagnostic-attribution note, not an instruction. Removing them loses no operative contract.
- **Traces to:** Requirement 2; acceptance criterion 2 (heading + one sentence naming both commands and keeping the timing cue).

### Decision: The Guardrails table communicates the guardrails on its own

- **Choice:** Keep only the heading and the 6-row table; remove the lead paragraph defining what a guardrail is and the five paragraphs explaining the changeset gates and `--since=origin/trunk`.
- **Alternatives:** Keep the lead paragraph (the "judged by exit code" definition). Rejected because the skill's own convention loader already defines what a guardrail is and that it is judged by exit code, so the lead paragraph is redundant. The owner's stated intent is that an agent should infer each command's purpose and "simply run these commands with no questions."
- **Trade-offs:** Readers lose inline narrative about the two changeset gates (presence-agnostic `changeset-format`, conditional `changeset-status`, the empty-changeset and `README.md` nuances) and the rationale for `--since=origin/trunk`. This is acceptable: that detail is pipeline-internal explanation, the commands themselves are self-describing for an agent that just runs them, and the table's rows/commands/phases — the only operative content — are preserved verbatim.
- **Traces to:** Requirement 1; acceptance criterion 1 (only the heading and the 6-row table, rows identical to before).

### Decision: Drop the `CONTRIBUTING.md` guardrails cross-reference

- **Choice:** Delete the paragraph cross-referencing the `.rp.md` Guardrails entirely.
- **Alternatives:** Shorten it to a single sentence. Rejected per the owner's follow-up direction to drop it entirely — the link between local checks and pipeline gates is pipeline-internal detail a contributor does not need.
- **Trade-offs:** Contributors no longer see, in `CONTRIBUTING.md`, that these local checks double as pipeline guardrails. Acceptable: `CONTRIBUTING.md` is a human contributor reference, and the pipeline-gate relationship lives in `.rp.md` where the pipeline machinery reads it.
- **Traces to:** Requirement 4; acceptance criterion 6 (the cross-reference paragraph no longer present).

### Decision: Tighten the `check:config` bullet to the sibling bullet style

- **Choice:** Reduce the bullet to `` `command` `` + " — " + one clause + period, retaining exactly two facts: (a) it loads the fixture config through its real import graph, and (b) this catches config-load and import regressions the other checks miss.
- **Alternatives:** Keep the parenthetical scope note ("no agents, no API key, no wp-env, no network") or the trailing "because none of them…" clause. Rejected: both are elaboration, not one of the two mandated facts — the parenthetical is scope-narrowing colour about what the check does *not* exercise, and the trailing clause is a redundant restatement of why the other checks miss these regressions once (a) and (b) are stated.
- **Trade-offs:** The generalised "the fixture config" drops the explicit filename `testing-project/skillsmith.config.ts`. This stays unambiguous because the bullet's own command, `npm --prefix testing-project run check:config`, pins execution to `testing-project/`, whose `check:config` script imports `./skillsmith.config.ts` relative to that directory — so within this bullet "the fixture config" can only denote `testing-project/skillsmith.config.ts`. (Other `skillsmith.config.ts` files exist under `examples/` and `src/__tests__/fixtures/`, but `--prefix testing-project` disambiguates.) The participial "loads…, catching…" form is in-family with the sibling "runs…" bullet.
- **Traces to:** Requirement 5; acceptance criterion 6 (single em-dash clause matching siblings, still states facts (a) and (b)).

### Decision: Edit independence and ordering

- **Choice:** Treat edits 2 and 3 as one logical unit; the other edits are independent with no required global ordering.
- **Alternatives:** Impose a strict global order across all five. Unnecessary — the regions do not overlap and `.rp.md` is not executed, so there is no live coupling to sequence except the script-reference one.
- **Trade-offs:** Edits 2 + 3 are the only dependency: the `.rp.md` body must stop naming `bash scripts/bootstrap-worktree.sh` before or together with deleting the script, so no live reference outlives the file. The order between just these two does not strictly matter (a momentary dangling reference mid-edit is harmless because nothing executes `.rp.md`), but the end state must have both done — best done together. Edits 1 and 2 both touch `.rp.md` but in non-overlapping sections (Guardrails = the file's last section; Worktree bootstrap = earlier), so no conflict. Edits 4 and 5 both touch `CONTRIBUTING.md` but distinct lines (15 = cross-ref paragraph; 13 = bullet), no overlap. Edits 1, 4, and 5 are mutually independent and independent of the 2+3 unit.
- **Traces to:** Acceptance criterion 3 (no `bootstrap-worktree.sh` reference remains in `.rp.md`) and the overall integrity of all seven criteria.

## Dependencies

No new dependencies, internal or external. The change adds no library, service, or module. It depends on no build or runtime step. The only relationship to existing artifacts is the requirement to leave them untouched: `scripts/validate-changesets.ts` (the `changeset-format` gate target) and all out-of-scope base-run artifacts (the `@automattic/skillsmith` dependency rename, the `verify-e2e` import fix, `testing-project/package.json`'s `check:config` script, the lockfile, `.github/workflows/changeset-gate.yml`, and the Radical Pipelines plugin) must remain intact.

## Failure Modes and Observability

This is a documentation/file-deletion change with no runtime surface, so its failure modes are scoping and faithfulness errors caught by review and search, not runtime errors.

- **A live `bootstrap-worktree` reference survives.** Detected by a repo-wide search for `bootstrap-worktree` (excluding `node_modules`, `.git`, `.pipelines`) returning a hit in `.rp.md`, `package.json`, `testing-project/package.json`, `.github/**`, `AGENTS.md`, `CLAUDE.md`, or `README.md`. The end state must return zero such hits.
- **The guardrails table is altered.** Detected by comparing the six rows' names, commands, and phases against the pre-change table. They must be byte-identical: `typecheck`/`lint`/`tests`/`config-smoke` at `code`, `changeset-format` at `code, docs`, `changeset-status` at `docs`.
- **An out-of-scope artifact is modified.** Detected by inspecting the diff: only `.rp.md`, `CONTRIBUTING.md`, and the deletion of `scripts/bootstrap-worktree.sh` should appear. No change to the dependency rename, `verify-e2e` import fix, `testing-project` `check:config` script, lockfile, `.github/workflows/changeset-gate.yml`, or the Radical Pipelines plugin.
- **`scripts/` directory accidentally removed.** Detected by confirming `scripts/validate-changesets.ts` still exists after the deletion.
- **Gate regression.** The guardrail gates (typecheck, lint, tests, config-smoke, changeset-format, changeset-status) must still pass after the change. Because no gate command, name, or phase changes and no source is touched, they are expected to pass unchanged; running them is the observable confirmation.

The observability of this change is the diff itself plus the `bootstrap-worktree` search — both are the acceptance signals an implementer and reviewer should check.

## Risks and Open Questions

No open questions. The current state of all three files has been confirmed to match this design (the `.rp.md` sections, the `CONTRIBUTING.md` lines, and the two-command script body are exactly as described above), and the no-caller search result for `bootstrap-worktree` is confirmed.

Risks are low and bounded:

- **Whitespace artifact from paragraph deletions.** Removing the `CONTRIBUTING.md` cross-reference paragraph (edit 4) and the `.rp.md` explanatory paragraphs (edits 1 and 2) can leave a double blank line or a trailing blank line. Mitigation: the implementer must produce the exact final section text given above, with single blank-line separation and the file ending at the guardrails table for `.rp.md`.
- **Em-dash character.** The tightened `check:config` bullet must use a real em dash (U+2014) with surrounding spaces, not a hyphen, to match the sibling bullets. Mitigation: copy the final bullet text given above verbatim.
- **Lost narrative for the changeset gates.** Trimming the Guardrails prose removes the only in-`.rp.md` explanation of the changeset gates' semantics. This is the explicit intent of the change (the owner wants the table to stand alone and the agent to just run the commands), so it is an accepted trade-off, not a defect; the gate behaviour is unchanged and the equivalent CI gate (`.github/workflows/changeset-gate.yml`) is untouched.
