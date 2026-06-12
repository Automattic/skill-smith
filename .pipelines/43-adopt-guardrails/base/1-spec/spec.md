# Spec — Adopt Radical Pipelines guardrails (#43)

## Overview

Radical Pipelines 0.3.0 introduced a **Guardrails** convention: a project
declares a fixed set of deterministic, exit-code verification commands in its
`.rp.md`, and the pipeline's code and docs phases run exactly those commands —
rather than letting agents choose verification commands ad hoc. This repo
(`@automattic/skillsmith`) declares none yet.

This work adds that Guardrails declaration so the pipeline gates on commands the
project owns. The headline gate is **config-smoke**: it imports
`testing-project/skillsmith.config.ts` and its full module graph without
spawning agents, requiring API keys, or booting wp-env. config-smoke exists
because a real regression slipped through every existing check: pipeline
`37-skip-misconfigured-agents-v3` introduced a circular import between
`testing-project/skillsmith.config.ts` and `testing-project/eval/utils/verify-e2e.ts`
that only manifests when the CLI actually loads the config — a path that
typecheck, lint, and the unit tests never exercise. config-smoke exercises
exactly that import/resolution path, so a regression of that class cannot ship
green again.

config-smoke cannot run green today because of a pre-existing dependency-key
mismatch: `testing-project/package.json` declares the dependency under the bare
key `"skillsmith": "file:.."`, but `skillsmith.config.ts` imports the package as
`@automattic/skillsmith` (the package's real name after the rename). At runtime
that import fails with `ERR_MODULE_NOT_FOUND`. Making the package resolvable
under its scoped name from `testing-project/`, and adding a `check:config`
script that config-smoke invokes, are therefore prerequisites of this work.

Because a fresh worktree has no installed dependencies and the Radical Pipelines
plugin does not install them, every gate (all `npm`/`npx` commands) would hit
command-not-found in an un-bootstrapped worktree and block the pipeline. This
spec therefore also requires the project to own and perform a complete
dependency install of both npm workspaces before any gate runs, and to capture
that requirement durably so every future run honours it.

The deliverable is the declared guardrails (committed in `.rp.md`), the three
prerequisite edits that make config-smoke green on trunk, and a durable
statement of the bootstrap requirement — such that every declared code-phase
gate executes and exits 0 on a freshly and fully bootstrapped trunk worktree,
config-smoke demonstrably catches the issue-37 regression, and the docs-phase
changeset gates behave as specified.

## Requirements

### R1 — Declare a Guardrails convention in `.rp.md`

Add a top-level `## Guardrails` section to this repo's `.rp.md`. This repo's
`.rp.md` is a flat list of `##` conventions with no shared/per-tool grouping
heading, so Guardrails is a peer `##` section, not a `###` subsection nested
under a grouping heading. (The plugin's loader finds Guardrails semantically
from the committed `.rp.md` prose and does not parse by heading level, so a
top-level `## Guardrails` is valid for machine consumption and matches the
file's existing one-`##`-per-convention shape.) It must be committed to
`.rp.md` itself; it must never live in `.rp.local.md` (the plugin reads
Guardrails only from the committed file). The exact placement of the section
within `.rp.md` is delegated to the design phase.

The declaration is a three-column markdown table with header `| Name | Command | Phase |`,
preceded by a one-line description of what the gates are. For each row:

- **Name** — a short label (the column may be capitalized or styled to match the
  repo's house format; it is not load-bearing).
- **Command** — the exact literal command to run, judged pass/fail **solely by
  exit code** (0 = pass, any non-zero = fail). The command text is load-bearing.
- **Phase** — the only valid values are `code`, `docs`, or both written as
  `code, docs`. The phase value is load-bearing.

An absent or empty Guardrails declaration is itself a valid, complete state; this
requirement is to populate it with R2's gates.

### R2 — The declared gates

Declare exactly these six guardrails:

| Name             | Command                                          | Phase      |
| ---------------- | ------------------------------------------------ | ---------- |
| typecheck        | `npm run typecheck`                              | code       |
| lint             | `npm run lint`                                   | code       |
| tests            | `npm test`                                       | code       |
| config-smoke     | `npm --prefix testing-project run check:config`  | code       |
| changeset-format | `npx tsx scripts/validate-changesets.ts`         | code, docs |
| changeset-status | `npx changeset status --since=origin/trunk`      | docs       |

Each command runs from the repo root. Each must be runnable and exit 0 on a
freshly and fully bootstrapped trunk worktree (config-smoke reaches exit 0 only
after R3/R4; the other five are already green on trunk today). The `--since=origin/trunk`
form of `changeset-status` is deliberate — it compares against the
remote-tracking ref, which is safer in a pipeline worktree where local `trunk`
may be stale or absent.

### R3 — Dependency-key prerequisite (config-smoke enabler)

Make `@automattic/skillsmith` resolvable from `testing-project/` so config-smoke
imports cleanly at runtime. This requires exactly three edits:

1. In `testing-project/package.json`, rename the dependency key
   `"skillsmith": "file:.."` → `"@automattic/skillsmith": "file:.."`. (The root
   package's `name` is `@automattic/skillsmith`, so `npm install` links
   `node_modules/@automattic/skillsmith` to the repo root.)
2. Update `testing-project/package-lock.json` by running `npm install` in
   `testing-project/`. The lockfile is part of the change, not just
   `package.json`; npm re-keys the dependency to `@automattic/skillsmith` and
   replaces the bare `node_modules/skillsmith` symlink with the scoped one.
3. Add the `check:config` script (R4).

These three edits make config-smoke green on trunk **and** keep the declared
`typecheck` gate green: `npm run typecheck` runs `tsc --noEmit` from the repo
root, whose `tsconfig.json` does not compile `testing-project/`, so the bare
`skillsmith` type-only import at `testing-project/eval/utils/verify-e2e.ts:11`
is never type-checked by any declared gate. (config-smoke type-erases that
import at runtime; the root typecheck never compiles the file.)

**Note (not scope creep):** the committed `testing-project/package-lock.json` is
already stale relative to the current root `package.json` (it records the
mirrored root `zod ^3.25.76` where root is now `^4.0.0`, and is missing the
`@changesets/*` devDeps and the root `name` field). The prerequisite `npm install`
will absorb that pre-existing drift in the same lockfile update, so the PR's
lockfile diff is larger than the dependency-key rename alone.

**Optional cleanup (recommended, not required by any gate):** change
`testing-project/eval/utils/verify-e2e.ts:11`'s `import type … from "skillsmith"`
to `"@automattic/skillsmith"`. After the dependency-key rename, the bare name no
longer resolves, so anyone running `tsc` directly inside `testing-project/`
(not a declared gate) would see a latent `TS2307`. Aligning the specifier
removes that latent error but is not required for any guardrail to pass.

### R4 — Add the `check:config` script

Add to `testing-project/package.json` scripts:

```json
"check:config": "node --import tsx -e \"await import('./skillsmith.config.ts')\""
```

The script must import the config and its full module graph with no agent spawn,
no wp-env boot, no API key, and no network access. (`defineConfig` is a pure
identity passthrough; the harness validates and normalizes the config only later
at load time, which this script does not invoke. Importing the config reads two
prompt files and pulls in the `@automattic/skillsmith` module graph, nothing
more.) This satisfies the constraint that no full `skillsmith` run is part of
any gate.

### R5 — Worktree bootstrap is project-owned and must run before any gate

The Radical Pipelines plugin does not install dependencies on `EnterWorktree`,
and changing the plugin is out of scope. Therefore this repo must own the
bootstrap: after entering a fresh worktree and **before** launching any phase
agent or running any guardrail, perform a complete install of **both** npm
workspaces — `npm ci` at the repo root and `npm ci --prefix testing-project`.

"Bootstrapped" means a *complete, clean* install, not merely "`node_modules`
exists." A partial `node_modules` is a real, observed failure mode: an
incomplete tree makes `npx`-based gates either fail to execute or silently fall
back to a nondeterministic network fetch, neither acceptable for a deterministic
gate.

This bootstrap requirement must be captured durably (the durable home — `.rp.md`
prose, a documented run step, `AGENTS.md`, or a helper script — is a design/plan
decision) so every future run performs it, not just this one.

This does not weaken the guardrail contract. If the orchestrator omits the
bootstrap, the gates fail the *execute* test and the agent reports a BLOCKER,
surfacing the omission loudly rather than passing silently. A command-not-found
in an un-bootstrapped worktree is a bootstrap omission (whose fix is to
bootstrap), not a defect in the guardrail.

### R6 — State what each changeset gate guarantees (no over-claiming)

The `.rp.md` description (and any accompanying prose) must describe the two
changeset gates accurately:

- **changeset-format** (`code, docs`) validates the *shape* of every
  `.changeset/*.md` that exists (front-matter fence, valid bump type, known
  package name, non-empty body, pre-1.0 `major` forbidden) and passes when no
  changesets exist. It is **presence-agnostic** — it never enforces that a
  changeset is present. This is why it is safe on both phases.
- **changeset-status** (`docs`) is a **conditional changeset-presence check**: it
  exits non-zero if and only if the branch changed a *versionable* path **and**
  no changeset file exists. "Versionable" means a changed path matching the
  repo's `.changeset/config.json` `changedFilePatterns` — `src/**`, `bin/**`,
  `package.json`, `examples/**`, `README.md`, excluding `src/__tests__/**`. It
  has real teeth (including for `README.md` edits) but does **not** force a
  changeset for a docs-phase change confined to non-versionable files (e.g.
  `AGENTS.md`, `CONTRIBUTING.md`). It is docs-only because the doc-writer is the
  phase that authors the changeset.

The design phase should confirm the intended guarantee is "release-relevant
(versionable) changes carry a changeset" — which changeset-status delivers —
rather than "the doc-writer always authors a changeset regardless of what
changed," which this gate does not guarantee.

## Out of Scope

- **Changing the Radical Pipelines plugin** — e.g. adding a first-class
  bootstrap concept for guardrails. The bootstrap requirement (R5) is satisfied
  project-side.
- **Including a full `skillsmith` run in any gate.** A full run spawns real
  agents via the local `claude` CLI; it is slow and nondeterministic. No gate
  may invoke it.
- **Fixing the issue-37 circular import itself** (the cycle between
  `testing-project/skillsmith.config.ts` and `verify-e2e.ts`). That belongs to
  the `37-skip-misconfigured-agents-v3` pipeline. This work only *detects* the
  regression class via config-smoke.
- **Skipping or fixing `validate-changesets.test.ts`.** The issue intent assumed
  two pre-existing CLI smoke failures in that test (`ERR_MODULE_NOT_FOUND` for
  `tsx`). That assumption is **stale**: on current trunk those tests pass, and
  `npm test` exits 0 (149 tests: 147 pass, 0 fail, 2 skipped — the 2 skips are
  unrelated codex end-to-end tests). Do not add a skip-with-reason or pre-fix
  for the changeset tests.

## Acceptance Criteria

### AC1 — Each declared command executes

Every command in the R2 table executes (resolves to a runnable binary/script) in
the main checkout. This is the setup-time "did it execute?" bar — distinct from
exit code.

### AC2 — All code-phase guardrails exit 0 on a fresh, fully bootstrapped trunk worktree

On a freshly and fully bootstrapped trunk worktree, every `code`-phase gate
exits 0: typecheck, lint, tests, config-smoke, and changeset-format. typecheck,
lint, tests, and changeset-format are green on trunk today; config-smoke reaches
exit 0 only after the R3/R4 prerequisites are applied.

### AC3 — config-smoke catches the issue-37 regression class

With the dependency-key fix (R3) applied on the
`37-skip-misconfigured-agents-v3` branch, config-smoke exits non-zero with the
signature:

```
TypeError: Cannot read properties of undefined (reading 'roles')
  at testing-project/eval/utils/verify-e2e.ts:24
```

(the symptom of the circular import — `verify-e2e` reads `config.roles` while
`config` is still `undefined` mid-cycle), **and** config-smoke exits 0 on a
dependency-key-fixed trunk (where the cycle is already gone). Applying the
dependency-key fix on the v3 branch is what isolates the circular import as the
cause; without it, config-smoke still exits non-zero on v3 but for the earlier
`ERR_MODULE_NOT_FOUND` dependency-key reason, which conflates the two failures.
This stronger form is the required demonstration.

### AC4 — Docs-phase guardrails behave as specified

- **changeset-format** exits 0 (shape-only, presence-agnostic) on trunk and on a
  branch with no changesets.
- **changeset-status** exits non-zero on a branch that changed a versionable
  path with no changeset present, and exits 0 once a changeset is added (or when
  only non-versionable paths changed) — the conditional presence check of R6.

### AC5 — Bootstrap precedes gates

The run procedure performs the complete `npm ci` of both workspaces (root and
`testing-project/`) before any guardrail runs. A deliberately un-bootstrapped
worktree makes the `npm`/`npx` gates report a BLOCKER (cannot execute),
confirming the drift guard rather than silently passing.
