# Design doc — Adopt Radical Pipelines guardrails (#43)

## 1. Summary

Radical Pipelines (RP) 0.3.0 introduced a **Guardrails** convention: a project
declares a fixed set of deterministic, exit-code-only verification commands in
its `.rp.md`, and the pipeline's code and docs phases run exactly those commands
instead of letting agents pick verification commands ad hoc. This repo
(`@automattic/skillsmith`) declares no Guardrails yet.

This work adopts that convention for skillsmith. It is a **documentation and
configuration change** — there are no new runtime modules and no algorithm to
design. The design problem is therefore one of **placement, wording, and one
small helper script**, not data structures or control flow. Concretely, the
code and docs phases will produce:

1. A `## Guardrails` section appended to `.rp.md`, declaring six gates as a
   `| Name | Command | Phase |` table with accurate per-gate prose.
2. A `## Worktree bootstrap` section in `.rp.md` plus a committed
   `scripts/bootstrap-worktree.sh`, so a fresh worktree is fully installed
   before any gate runs.
3. Two edits to `testing-project/package.json` (a dependency-key rename and a
   new `check:config` script) and the resulting `testing-project/package-lock.json`
   refresh, which together make the headline `config-smoke` gate green.
4. An optional, recommended one-line alignment of an import specifier in
   `testing-project/eval/utils/verify-e2e.ts`.

The headline gate is **config-smoke**, which imports
`testing-project/skillsmith.config.ts` and its full module graph without
spawning agents, requiring API keys, or booting wp-env. It exists because a real
regression slipped through every existing check: a prior pipeline introduced a
circular import between `testing-project/skillsmith.config.ts` and
`testing-project/eval/utils/verify-e2e.ts` that only manifests when the CLI
actually loads the config — a path that typecheck, lint, and the unit tests
never exercise. config-smoke exercises exactly that import/resolution path, so a
regression of that class cannot ship green again.

## 2. Background and problem statement

### 2.1 What "Guardrails" is in RP 0.3.0

A Guardrails declaration is a table of named verification commands, each tagged
with the pipeline phase(s) it applies to. The RP plugin's loader reads the
declaration from the committed `.rp.md`, and at each phase it selects the
guardrails whose phase column includes the current phase and runs them. Each
command is judged **solely by its exit code**: `0` = pass, any non-zero = fail.
There is no stdout/stderr parsing — the command text and the phase value are the
load-bearing parts of each row; the name is a human label only.

Two facts about the loader shape this design:

- **Selection is by phase, never by position.** The loader picks guardrails by
  matching the Phase column against the current phase (RP 0.3.0
  `reference/conventions/load.md:30`), and every run-time consumer — the
  code-writer, code-reviewer, doc-writer, and doc-reviewer agents — selects by
  the Phase column too. Nothing in the loader or any agent cares where the
  `## Guardrails` section sits in the file. This makes the placement of the
  section a readability decision, not a correctness one.
- **Guardrails is read only from the committed `.rp.md`**, never from a
  `.rp.local.md` overlay (`load.md:46`). The declaration must be committed to be
  honoured.

### 2.2 Why config-smoke is the centerpiece

The repo's existing checks — `npm run typecheck` (`tsc --noEmit` from the repo
root), `npm run lint`, and `npm test` — all pass on trunk, yet none of them
loads `testing-project/skillsmith.config.ts` through its real runtime import
graph. The root `tsconfig.json` does not compile `testing-project/`, so a
type-only import there is never type-checked; the unit tests don't import the
fixture config; lint is static. A circular import that only surfaces when the
config is actually `import()`ed at runtime therefore passes every existing gate.
config-smoke closes that hole by doing exactly one thing: `import()` the config
and let its full module graph resolve.

### 2.3 Why config-smoke cannot run green today

`testing-project/package.json` declares its dependency on the repo under the
**bare key** `"skillsmith": "file:.."`, but `skillsmith.config.ts` imports the
package under its **real, scoped name** `@automattic/skillsmith` (the name after
the package rename). At runtime that import fails with `ERR_MODULE_NOT_FOUND`
because npm linked `node_modules/skillsmith`, not `node_modules/@automattic/skillsmith`.
So before config-smoke can be a meaningful gate, the dependency must be made
resolvable under its scoped name (Section 5).

### 2.4 Why the bootstrap requirement exists

A fresh RP worktree has **no installed dependencies**, and the RP plugin does
not install them: `EnterWorktree` creates and enters the worktree but runs no
`npm install` (`reference/conventions/claude-code.md:14`), and the
orchestrator's run-start procedure is exactly three steps — create the team,
start the health monitor, capture the base ref — with no bootstrap step
(`reference/autonomous-workflow.md:35-39`). In an un-bootstrapped worktree every
`npm`/`npx` gate would hit command-not-found and block the pipeline. The repo
must therefore own a complete install of both npm workspaces and trigger it
before any gate runs (Section 6).

## 3. Goals and non-goals

### 3.1 Goals

- Declare the six guardrails in `.rp.md` so the pipeline gates on commands the
  project owns, with accurate prose about what each changeset gate guarantees.
- Make config-smoke green on a fully bootstrapped trunk worktree, and have it
  catch the prior pipeline's circular-import regression class.
- Capture the worktree-bootstrap requirement durably, so every future run
  performs the install before gating — not just this one.

### 3.2 Non-goals (out of scope per spec)

- **Changing the RP plugin** (e.g. adding a first-class bootstrap hook). The
  bootstrap is satisfied project-side.
- **Including a full `skillsmith` run in any gate.** A full run spawns real
  agents via the local `claude` CLI; it is slow and nondeterministic.
- **Fixing the circular import itself.** That belongs to the pipeline that
  introduced it; this work only *detects* the regression class.
- **Skipping or pre-fixing `validate-changesets.test.ts`.** Those tests pass on
  current trunk and `npm test` exits 0; there is nothing to skip.

## 4. The Guardrails declaration (R1, R2, R6)

### 4.1 The six gates

A new top-level `## Guardrails` section in `.rp.md` declares exactly these six
gates, as a three-column table preceded by a one-line description:

| Name             | Command                                          | Phase      |
| ---------------- | ------------------------------------------------ | ---------- |
| typecheck        | `npm run typecheck`                              | code       |
| lint             | `npm run lint`                                   | code       |
| tests            | `npm test`                                       | code       |
| config-smoke     | `npm --prefix testing-project run check:config`  | code       |
| changeset-format | `npx tsx scripts/validate-changesets.ts`         | code, docs |
| changeset-status | `npx changeset status --since=origin/trunk`      | docs       |

Every command runs from the repo root. Pass/fail is exit code only. On a freshly
and fully bootstrapped trunk worktree, all five non-config-smoke gates are green
today; config-smoke reaches exit 0 only after the Section 5 prerequisites are
applied.

The `--since=origin/trunk` form of `changeset-status` is deliberate: it compares
against the **remote-tracking ref**, which is the safe choice in a pipeline
worktree where local `trunk` may be stale or absent.

### 4.2 Section shape and placement

**Decision (D1): append `## Guardrails` as the final top-level section of
`.rp.md`, immediately after `## Health monitoring`** (currently the file's last
section). It is a peer `##` — *not* a `###` nested under a grouping heading —
because this repo's `.rp.md` is a flat, one-`##`-per-convention file with no
`## Shared conventions` wrapper. The section is committed to `.rp.md`, never to
`.rp.local.md`.

Why a peer `##` and why last:

- **Heading level follows the file's existing shape.** The file's current
  top-level sections are `## Managing tasks`, `## Pipeline slugs`,
  `## Artifact folders`, `## Commit format`, `## Claude Code worktrees`,
  `## Branch names`, `## Team spawning`, and `## Health monitoring` — a flat list
  of `##` peers. A peer `## Guardrails` matches that shape. (RP's own example
  files nest conventions as `###` under a single `## Shared conventions` group
  and place Guardrails last *within that group*; the structure-preserving image
  of "last in the group" in a flat-`##` file is a `## Guardrails` appended last.)
- **Position is machine-irrelevant.** Because the loader selects by phase and
  never by position (Section 2.1), "where in the file" is purely a readability
  choice. Appending at the end reads naturally as a run-time operational
  convention and matches both RP worked examples (each places its Guardrails
  section last, immediately after its health-monitoring section).
- **No anchoring constraint.** No loader or agent requires Guardrails to sit
  adjacent to any other section, so "append at end" is unconstrained and safe.

### 4.3 What each changeset gate guarantees (R6)

The accompanying prose must describe the two changeset gates accurately, without
over-claiming. The two gates divide the labor cleanly:

- **changeset-format** (`code, docs`) validates the **shape** of every
  `.changeset/*.md` that exists — front-matter fence, valid bump type, known
  package name, non-empty body, and the pre-1.0 rule that `major` is forbidden.
  It is **presence-agnostic**: it passes when no changesets exist and never
  asserts that a changeset is present. That presence-agnosticism is exactly why
  it is safe to run on both phases — including the code phase, where no changeset
  has been authored yet.
- **changeset-status** (`docs`) is a **conditional changeset-presence check**: it
  exits non-zero **if and only if** the branch changed a *versionable* path
  **and** no `.changeset/*.md` file exists. "Versionable" is the set of changed
  paths matching the repo's `.changeset/config.json` `changedFilePatterns`:
  `src/**`, `bin/**`, `package.json`, `examples/**`, `README.md`, excluding
  `src/__tests__/**`. It is docs-only because the doc-writer is the phase that
  authors the changeset.

**Decision (D3): the intended guarantee is the conditional one — "release-relevant
(versionable) changes carry a changeset" — and changeset-status delivers exactly
that.** It does **not** guarantee "the doc-writer always authors a changeset
regardless of what changed," and the prose must not imply it does. A docs-phase
change confined to non-versionable paths (e.g. `AGENTS.md`, `CONTRIBUTING.md`,
`.rp.md`, `.pipelines/**`, `docs/`) is correctly **not** forced to carry a
changeset.

Two properties of changeset-status are worth stating explicitly in the prose
because they were verified empirically and prevent false expectations:

- **An empty changeset counts as "present."** changeset-status keys off *"does a
  `.changeset/*.md` file exist,"* not *"does it bump a package."* An empty
  changeset (`---\n---\n`) or a `none`-bump changeset satisfies the gate. This
  matches the project's documented "empty changeset" escape for cosmetic
  versionable-path edits (e.g. a cosmetic `README.md` change), so the gate is
  **aligned with the project's policy, not stricter than it**. (It also explains
  why trunk is green today: a committed `none`-bump changeset already counts as
  present.)
- **The gate has real teeth, including for `README.md`.** A change to a
  versionable path (`src/**`, `bin/**`, `package.json`, `examples/**`,
  `README.md`) with no changeset present exits non-zero; the `!src/__tests__/**`
  exclusion correctly lets test-only changes pass without a changeset.

**Continuity framing (rationale, not a new policy):** these two changeset gates
are a one-to-one lift of the repo's existing GitHub Actions changeset gate
(`.github/workflows/changeset-gate.yml`): its "Validate changeset shape" step
runs `npx tsx scripts/validate-changesets.ts` (= changeset-format), and its
"Require a changeset for release-relevant changes" step runs
`npx changeset status --since=origin/<base>` (= changeset-status). Adopting them
as Guardrails brings a gate the project already trusts in CI into the pipeline's
code/docs phases — it is continuity, not a new contract.

## 5. config-smoke prerequisites (R3, R4)

config-smoke is `npm --prefix testing-project run check:config`, which runs a new
`check:config` script. Two edits to `testing-project/package.json` (plus the
lockfile refresh they produce) make this gate green.

### 5.1 Make `@automattic/skillsmith` resolvable (R3)

In `testing-project/package.json`, rename the dependency key:

```diff
   "dependencies": {
-    "skillsmith": "file:.."
+    "@automattic/skillsmith": "file:.."
   }
```

The repo root's package `name` is `@automattic/skillsmith`, so after this rename
`npm install` links `node_modules/@automattic/skillsmith` → the repo root, and
the config's `import … from "@automattic/skillsmith"` resolves at runtime.

The lockfile is part of the change, not just `package.json`. Running
`npm install` in `testing-project/` re-keys the dependency to
`@automattic/skillsmith` and replaces the bare `node_modules/skillsmith` symlink
with the scoped one. **Note:** `testing-project/package-lock.json` is already
stale relative to the current root `package.json` (it records the old mirrored
`zod` version and is missing the `@changesets/*` devDeps and the root `name`
field). The prerequisite `npm install` absorbs that pre-existing drift in the
same lockfile update, so the PR's lockfile diff will be larger than the
dependency-key rename alone — this is expected, not scope creep.

**This rename does not break the declared `typecheck` gate.** `npm run typecheck`
runs `tsc --noEmit` from the repo root, whose `tsconfig.json` does not compile
`testing-project/`. The bare `skillsmith` *type-only* import at
`testing-project/eval/utils/verify-e2e.ts:11` is therefore never type-checked by
any declared gate, and config-smoke type-erases that import at runtime. So no
declared guardrail regresses from the rename.

### 5.2 Add the `check:config` script (R4)

Add to `testing-project/package.json` scripts:

```json
"check:config": "node --import tsx -e \"await import('./skillsmith.config.ts')\""
```

This imports the config and its full module graph and nothing more. It spawns no
agent, boots no wp-env, needs no API key, and makes no network call.
`defineConfig` is a pure identity passthrough; the harness validates and
normalizes the config only later at load time, which this script never invokes.
Importing the config reads two prompt files and pulls in the
`@automattic/skillsmith` module graph — exactly the runtime import path that the
existing gates miss, and nothing that would constitute a "full run."

### 5.3 Optional alignment of the import specifier (recommended)

After the dependency-key rename, the bare name `skillsmith` no longer resolves,
so anyone running `tsc` directly inside `testing-project/` (which is **not** a
declared gate) would see a latent `TS2307` at
`testing-project/eval/utils/verify-e2e.ts:11`. Changing that line's
`import type … from "skillsmith"` to `"@automattic/skillsmith"` removes the
latent error.

**Recommendation: make this change.** It is cheap drift-elimination consistent
with this pipeline's purpose. It is **not** load-bearing for any guardrail — no
declared gate compiles that file — so it is advisory, not required. The code
phase should apply it but treat it as non-blocking if anything about it proves
surprising.

## 6. Worktree bootstrap (R5)

### 6.1 The requirement

After entering a fresh worktree and **before** launching any phase agent or
running any guardrail, the repo must perform a **complete, clean** install of
**both** npm workspaces:

```
npm ci                          # repo root
npm ci --prefix testing-project # the testing-project workspace
```

Two commands are **genuinely required**, not belt-and-suspenders: the root
`package.json` has **no** npm `workspaces` key, so a single root `npm ci` does
not install `testing-project/`. The two workspaces have independent lockfiles
(`package-lock.json` at the root and `testing-project/package-lock.json`), and
each must be installed on its own. Both lockfiles are present and
`lockfileVersion: 3`, so `npm ci` is valid in both.

"Bootstrapped" means a *complete, clean* install, not merely "`node_modules`
exists." A partial `node_modules` is a real, observed failure mode: an
incomplete tree makes `npx`-based gates either fail to execute or silently fall
back to a nondeterministic network fetch — neither acceptable for a
deterministic gate. This is why the install must be `npm ci` (which removes any
existing `node_modules` and installs exactly the lockfile) rather than
`npm install` (which can mutate the lockfile and leave a partial tree).

### 6.2 Where the requirement lives, and what runs it

**Decision (D2): a new standalone `## Worktree bootstrap` section in `.rp.md`,
placed immediately after `## Claude Code worktrees`, written as an orchestrator
run-step that names a committed helper script `scripts/bootstrap-worktree.sh`.**
The `.rp.md` step is the durable **trigger**; the script is the **body**.

The section reads as an imperative orchestrator instruction: *after
`EnterWorktree`, and before launching any phase agent or running any guardrail,
run `bash scripts/bootstrap-worktree.sh`.*

The helper script:

```bash
#!/usr/bin/env bash
set -euo pipefail

npm ci
npm ci --prefix testing-project
```

`set -euo pipefail` makes a partial or failed install a non-zero exit, so a
broken bootstrap surfaces loudly rather than letting a half-installed tree slip
through to the gates.

Why this shape:

- **`.rp.md` is the only artifact the orchestrator reliably reads at the start of
  every run** (RP `SKILL.md:42-46`, `load.md:5,7`, and this repo's `.rp.md:3`:
  "Read it at the start of any workflow"). Its run-start procedure has no
  bootstrap step (`autonomous-workflow.md:35-39`) and `EnterWorktree` installs
  nothing (`claude-code.md:14`), so the project must own the trigger in the one
  place the orchestrator always loads.
- **Orchestrator-directed prose in `.rp.md` is an established, obeyed pattern.**
  It need not be one of the plugin's named conventions to be honoured: this
  repo's own `### Orchestrator updates during a run` block (`.rp.md:26-39`)
  already directs the orchestrator with imperative, non-convention run-steps
  (Linear sync and branch push) that the orchestrator follows. The RP plugin
  author's own example file carries the same kind of `Orchestrator updates during
  a run` subsection. A bootstrap run-step is the same shape and squarely within
  the orchestrator's remit.
- **Standalone, not folded into `## Claude Code worktrees`.** That block is
  plugin-canonical content (`claude-code.md:7,10-16` prescribes it as "the
  canonical content for `.rp.md`"). A future RP `setup` re-run can regenerate
  canonical blocks; project-specific steps folded inside one would be the first
  thing lost. (`setup.md:213-218` does require owner confirmation before
  overwriting, so it is not silent — but a standalone section is structurally
  safer and survives a careless merge.) Placing the new section immediately after
  `## Claude Code worktrees` preserves the "post-EnterWorktree" reading without
  the overwrite coupling. This is orthogonal to D1: bootstrap sits near
  Worktrees; Guardrails goes last.
- **Helper script as the body, named (not restated) by `.rp.md`.** Centralizing
  the exact `npm ci` complete-clean-install semantics in one committed, testable
  file means the `.rp.md` prose names the script rather than restating the two
  commands, so the two can't drift apart. `scripts/` already exists
  (`scripts/validate-changesets.ts`), so this adds no new structure. Durability
  comes from the `.rp.md` step naming the script — the script's mere existence
  doesn't make the orchestrator run it; the named run-step does. (Inline prose
  listing the two commands is an acceptable zero-new-files fallback, but it loses
  the testable, centralized contract and invites drift.)
- **AGENTS.md is intentionally not the trigger** — it is not the orchestrator's
  run-start read. A one-line human-facing pointer there (for human contributors
  who clone the repo) is optional belt-and-suspenders the writer may add, but it
  must not be the thing the pipeline relies on.

### 6.3 This does not weaken the guardrail contract

If the orchestrator omits the bootstrap, the gates fail the *execute* test and
the running agent reports a **BLOCKER** — surfacing the omission loudly rather
than passing silently. A command-not-found in an un-bootstrapped worktree is a
**bootstrap omission** (whose fix is to bootstrap), not a defect in the
guardrail. The `set -euo pipefail` in the helper extends the same loud-failure
property to a partial install.

## 7. Acceptance criteria mapping

The design satisfies all five acceptance criteria from the spec:

| AC  | Criterion (abbreviated)                                   | How the design satisfies it |
| --- | --------------------------------------------------------- | --------------------------- |
| AC1 | Each declared command executes (resolves to a runnable binary/script) in the main checkout. | The six commands in §4.1 are all `npm`/`npx` invocations of scripts that exist (or are added: `check:config` in §5.2) and run from the repo root. |
| AC2 | All code-phase gates exit 0 on a fresh, fully bootstrapped trunk worktree. | typecheck, lint, tests, changeset-format are green on trunk today; config-smoke reaches exit 0 after the §5 prerequisites. The §6 bootstrap ensures the binaries exist. |
| AC3 | config-smoke catches the circular-import regression class. | config-smoke `import()`s the config's full module graph (§2.2). With the §5.1 dependency-key fix applied on the regressing branch, it exits non-zero with the `Cannot read properties of undefined (reading 'roles')` signature; on a dependency-key-fixed trunk (cycle already gone) it exits 0. The §5.1 fix is what isolates the cycle as the cause rather than the earlier `ERR_MODULE_NOT_FOUND`. |
| AC4 | Docs-phase gates behave as specified. | changeset-format is shape-only and presence-agnostic (§4.3), exit 0 with or without changesets. changeset-status is the conditional presence check (§4.3): non-zero on a versionable change with no changeset, 0 once a changeset (even empty) is added or when only non-versionable paths changed. |
| AC5 | Bootstrap precedes gates. | The §6.2 `.rp.md` run-step triggers `scripts/bootstrap-worktree.sh` (both `npm ci`s) before any phase agent or guardrail runs; a deliberately un-bootstrapped worktree makes the gates report a BLOCKER (§6.3), confirming the drift guard. |

## 8. Net artifacts the code and docs phases produce

All of these are already in spec scope; none touches `src/` and none changes the
RP plugin.

1. **`.rp.md`** — append `## Guardrails` (last) and insert `## Worktree
   bootstrap` (immediately after `## Claude Code worktrees`). [D1, D2; R1, R2,
   R5, R6]
2. **`scripts/bootstrap-worktree.sh`** — new, committed, `set -euo pipefail`,
   two `npm ci`s. [D2; R5]
3. **`testing-project/package.json`** — rename the dependency key
   `skillsmith` → `@automattic/skillsmith`; add the `check:config` script. [R3,
   R4]
4. **`testing-project/package-lock.json`** — refreshed by `npm install` in
   `testing-project/` (absorbs the pre-existing drift noted in §5.1). [R3]
5. **`testing-project/eval/utils/verify-e2e.ts`** (optional, recommended) —
   align the import specifier at line 11 to `@automattic/skillsmith`, removing a
   latent `TS2307`. Not required by any declared gate. [R3 optional cleanup]

## 9. Trade-offs and alternatives considered

- **`## Guardrails` last vs. somewhere in the middle.** Position is
  machine-irrelevant (the loader selects by phase, §2.1), so this is purely
  readability. "Last" was chosen because it matches both RP worked examples and
  reads as an operational run-time convention. No correctness difference either
  way.
- **Bootstrap home: standalone section vs. folding into `## Claude Code
  worktrees`.** Folding in would co-locate the bootstrap with the worktree
  lifecycle, but `## Claude Code worktrees` is plugin-canonical content a future
  `setup` re-run can regenerate, which would drop a folded-in project step. A
  standalone `## Worktree bootstrap` section is immune to that and more
  discoverable, at the cost of one extra top-level heading. The safety win
  outweighs the heading cost.
- **Helper script vs. inline `npm ci` commands in `.rp.md`.** A script
  centralizes the exact install semantics in one testable place and prevents the
  prose and the commands from drifting; inline commands add no new file but
  duplicate the contract in prose. The script was chosen because `scripts/`
  already exists and the drift-resistance is worth one small file.
- **`npm ci` vs. `npm install` for the bootstrap.** `npm ci` is mandated by R5's
  "complete, clean install" definition: it wipes `node_modules` and installs
  exactly the lockfile, eliminating the partial-tree failure mode that makes
  `npx` gates nondeterministic. `npm install` can leave a partial tree and mutate
  the lockfile, so it is not acceptable for the bootstrap.
- **`changeset-status --since=origin/trunk` vs. `--since=trunk`.** The
  remote-tracking ref is safer in a pipeline worktree where local `trunk` may be
  stale or absent. Comparing against `origin/trunk` is deterministic regardless
  of the worktree's local branch state.
- **Aligning `verify-e2e.ts:11` now vs. deferring it.** Aligning it removes a
  latent `TS2307` that would only appear to someone running `tsc` directly inside
  `testing-project/` (not a gate). It is recommended as cheap drift-elimination
  but kept advisory because no declared guardrail depends on it, so it can't
  block the pipeline if it proves surprising.
