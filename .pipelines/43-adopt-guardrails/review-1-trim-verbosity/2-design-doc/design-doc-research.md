# Design research: Trim over-explanation from the guardrails adoption

Running design rationale for the review-1 "trim verbosity" change (GitHub issue #43).
This is a **REVIEW (incremental) run** layered on a complete base run. The change is
presentation-only: it trims over-explanation from documentation and deletes one wrapper
script. It changes **no** guardrail behaviour. This document is self-contained — agents
implementing the change do not need to open the spec, intent, or source issue.

## Scope recap

The change is five textual/file edits across three files:

1. `.rp.md` `## Guardrails` — trim to heading + the existing 6-row table.
2. `.rp.md` `## Worktree bootstrap` — replace the multi-paragraph body with one sentence.
3. `scripts/bootstrap-worktree.sh` — delete the file.
4. `CONTRIBUTING.md` — remove the guardrails cross-reference paragraph.
5. `CONTRIBUTING.md` — tighten the `check:config` bullet to one em-dash clause.

Nothing else changes. The guardrail set, commands, and phase assignments are untouched.
The base run's other changes (the `@automattic/skillsmith` dependency rename, the
`verify-e2e` import-specifier fix, the `check:config` script in
`testing-project/package.json`, the lockfile, `scripts/validate-changesets.ts`,
`.github/workflows/changeset-gate.yml`, and the Radical Pipelines plugin) are all
out of scope and must remain intact.

## Design decisions

### D1 — Deleting `scripts/bootstrap-worktree.sh` is behaviour-preserving

**Decision.** Delete the script and inline its two commands into the `.rp.md`
Worktree-bootstrap sentence. This is a safe, behaviour-preserving trim, not a silent
weakening of the bootstrap contract.

**Evidence — the script has no programmatic caller.** `.rp.md` is purely an instruction
file read by the orchestrator agent; nothing executes it. A repo-wide search
(`grep -rn "bootstrap-worktree"` and `grep -rn "bash scripts/"`, excluding
`node_modules`/`.git`) finds the live string `bash scripts/bootstrap-worktree.sh` in
exactly one non-`.pipelines` location: `.rp.md:67`. Every other hit is inside
`.pipelines/**` (pipeline artifacts, not executable config). Specifically:

- `.claude/` (outside worktrees) holds only `settings.local.json` — no hooks, no
  settings.json referencing bootstrap or `scripts/`.
- `.github/**` has no `bootstrap-worktree` reference (its only "bootstrap" hits are
  unrelated `release.yml` prose about the "Bootstrap PR").
- Root `package.json` scripts (lint, lint:fix, format, typecheck, test, smoke,
  changeset, release) — none call the script.
- `testing-project/package.json` scripts (env:start, env:stop, test:e2e, skillsmith,
  check:config) — none call the script.

The script's sole "caller" is a human/agent reading the `.rp.md:67` prose and typing the
command. There is no shell, hook, workflow, or settings.json invocation, so deletion
cannot break any automation.

**Evidence — the one-sentence replacement keeps every operative element.** The operative
contract is "run these two exact commands, before any phase agent or guardrail, from the
worktree root." The replacement sentence preserves all three load-bearing elements
verbatim: the two commands (`npm ci` and `npm ci --prefix testing-project`), the timing
cue ("after `EnterWorktree`, and before launching any phase agent or running any
guardrail"), and the location ("from the worktree root").

The dropped paragraphs are explanatory-only:

- "two workspaces must each be installed separately because root `package.json` has no
  `workspaces` key" — the *reason* there are two commands. Confirmed: root
  `package.json` has no `workspaces` key, so two commands are genuinely required — and
  that requirement is fully encoded by naming both commands explicitly.
- "'bootstrapped' means a complete clean install (`npm ci`), not just node_modules
  exists" — `npm ci` *is* a clean install by definition (it wipes `node_modules` and
  installs from the lockfile). Naming `npm ci` (not `npm install`) carries this
  intrinsically.
- "omitting bootstrap → gates fail their execute test → agent reports a BLOCKER" —
  failure-mode handling governed by the guardrail/skill convention machinery, not by the
  bootstrap sentence. It exists independent of this paragraph.
- "a command-not-found in an un-bootstrapped worktree is a bootstrap omission, not a
  guardrail defect" — a diagnostic-attribution note, not an instruction.

On `set -euo pipefail`: the script's only behavioural addition over "run two commands"
was fail-fast (`set -e` aborts on the first failed `npm ci`; `-u`/`-o pipefail` are inert
here — the body has no variables or pipes). Inlining the two commands does not weaken
this in practice: an agent executing two ordered commands surfaces a non-zero exit and
stops, and a failed `npm ci` is loud (non-zero exit + error output) with or without a
`set -e` wrapper. No silent-success path is introduced.

### D2 — Final text for the `.rp.md` Worktree-bootstrap section (edit 2)

**Decision.** Replace the section body (`.rp.md` lines 65–73, heading + four paragraphs)
with the heading plus a single sentence:

```markdown
## Worktree bootstrap

After `EnterWorktree`, and **before launching any phase agent or running any guardrail**, the orchestrator runs `npm ci` and `npm ci --prefix testing-project` from the worktree root.
```

No reference to `scripts/bootstrap-worktree.sh` (or `bootstrap-worktree`) remains anywhere
in `.rp.md` after this edit.

### D3 — Final text for the `.rp.md` Guardrails section (edit 1)

**Decision.** Reduce the `## Guardrails` section (`.rp.md` lines 93–114) to its heading
plus the existing 6-row table. Remove the lead paragraph (line 95) and all five trailing
explanatory paragraphs (lines 106, 108, 110, 112, 114). The table (lines 97–104) is kept
exactly as-is — same rows, commands, and phases:

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

No intro or explanatory prose remains in the section. The skill's own convention loader
already defines what a guardrail is and that it is judged by exit code, so the removed
lead paragraph is redundant. (`## Guardrails` is the last section in `.rp.md`, so after
this trim the file ends with the table.)

### D4 — Remove the `CONTRIBUTING.md` guardrails cross-reference (edit 4)

**Decision.** Delete `CONTRIBUTING.md` line 15 in full — the paragraph beginning "These
same commands are declared as **Guardrails** in [`.rp.md`]…". This is pipeline-internal
detail a contributor does not need. The blank line separating it from the surrounding
content goes with it so no double blank line is left behind.

### D5 — Tighten the `CONTRIBUTING.md` `check:config` bullet (edit 5)

**Decision.** Replace the verbose `check:config` bullet (`CONTRIBUTING.md` line 13) with
a single em-dash clause matching the sibling bullets:

```markdown
- `npm --prefix testing-project run check:config` — loads the fixture config through its real import graph, catching config-load and import regressions the other checks miss.
```

**Style match.** The sibling bullets (lines 9–12) all follow `` `command` `` + " — "
(space, em-dash U+2014, space) + one short clause ending in a period, e.g.:

- `` - `npm run lint` — Biome lint over the repo. ``
- `` - `npm run smoke` — runs `bin/skillsmith.mjs` end-to-end against the working directory. ``

The tightened bullet matches this shape exactly; its participial "loads…, catching…"
form is in-family with line 12's "runs…".

**Faithfulness.** The two facts the change must retain are both kept:

- (a) "loads the fixture config through its real import graph" — from the current
  "imports `testing-project/skillsmith.config.ts` and its full module graph" / "through
  its real runtime import graph".
- (b) "catching config-load and import regressions the other checks miss" — retained
  nearly verbatim.

The dropped material is elaboration, not a third required fact:

- "(no agents, no API key, no wp-env, no network)" — scope-narrowing colour about what
  the check does *not* exercise; not one of the two mandated facts.
- "because none of them loads the fixture config through its real runtime import graph" —
  a trailing restatement of why the other checks miss these regressions, redundant once
  (a) and (b) are stated.

**"the fixture config" stays unambiguous.** The generalised phrase drops the explicit
filename, but the bullet's own command, `npm --prefix testing-project run check:config`,
pins execution to `testing-project/`. That script imports `./skillsmith.config.ts`
relative to `testing-project/`, so within this bullet "the fixture config" can only denote
`testing-project/skillsmith.config.ts`. (The repo has other `skillsmith.config.ts` files
under `examples/` and `src/__tests__/fixtures/`, but the `--prefix testing-project` in the
command disambiguates which one.)

### D6 — Edit independence and ordering

**Decision.** Treat edits (2) and (3) as one logical unit; the other edits are
independent with no required global ordering.

- **(2) + (3) are the only dependency.** The `.rp.md` Worktree-bootstrap body must stop
  naming `bash scripts/bootstrap-worktree.sh` before/with deleting the script, so no live
  reference outlives the file. Order between just these two does not strictly matter (a
  momentary dangling reference mid-edit is harmless because nothing executes `.rp.md`),
  but the end state must have both done. Best done together.
- **Edits (1) and (2) both touch `.rp.md` but different, non-overlapping sections**
  (Guardrails = lines 93–114, the file's last section; Worktree bootstrap = lines 65–73).
  No conflict, no ordering constraint between them.
- **Edits (4) and (5) both touch `CONTRIBUTING.md` but distinct lines** (15 = cross-ref
  paragraph; 13 = the bullet). No overlap.
- **(1), (4), (5) are mutually independent** and independent of the (2)+(3) unit. No
  global ordering is required across the five.

### D7 — Behaviour preservation and out-of-scope protection

**Decision.** None of the five edits alters guardrail behaviour or any out-of-scope
artifact.

- No guardrail table row (name/command/phase) is touched. Edit (1) removes only the prose
  around the table and keeps all six rows verbatim; edits (2)–(5) do not touch the table.
- No out-of-scope base-run artifact is touched: the `@automattic/skillsmith` dependency
  rename, the `verify-e2e` import-specifier fix, `testing-project/package.json`'s
  `check:config` script, the lockfile, `scripts/validate-changesets.ts`,
  `.github/workflows/changeset-gate.yml`, and the Radical Pipelines plugin all remain
  intact.
- The only file deleted is `scripts/bootstrap-worktree.sh`. `scripts/validate-changesets.ts`
  remains, so the `scripts/` directory survives.

## Acceptance signals the implementation should preserve

- `.rp.md` `## Guardrails` contains only the heading and the 6-row table; the six rows'
  names, commands, and phases are identical to before.
- `.rp.md` `## Worktree bootstrap` contains the heading and one sentence naming both
  `npm ci` and `npm ci --prefix testing-project` with the "after `EnterWorktree` / before
  any phase agent or guardrail" timing cue.
- A repo-wide search for `bootstrap-worktree` (excluding `node_modules`, `.git`,
  `.pipelines`) returns no live reference — none in `.rp.md`, `package.json`,
  `testing-project/package.json`, `.github/**`, `AGENTS.md`, `CLAUDE.md`, `README.md`.
- `scripts/bootstrap-worktree.sh` does not exist; `scripts/validate-changesets.ts` still
  exists.
- `CONTRIBUTING.md` no longer contains the "These same commands are declared as
  **Guardrails** in `.rp.md`…" paragraph.
- The `CONTRIBUTING.md` `check:config` bullet is a single em-dash clause matching the
  sibling bullets and still states facts (a) and (b) from D5.
- Running the guardrail gates still passes; no out-of-scope base-run change is modified.
