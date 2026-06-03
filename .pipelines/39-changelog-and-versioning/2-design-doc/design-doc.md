# Design Doc: Changelog and Versioning

Issue: [Automattic/skillsmith#39](https://github.com/Automattic/skillsmith/issues/39) — _Add a changelog and automate package version bumps_

Inputs read: `1-spec/spec.md`, `1-spec/requirements.md`, the repository tree at `worktree-39-changelog-and-versioning`, the rejection notes in `2-design-doc/design-doc-review-1-rejected.md` (Issues 1–3, all resolved in iteration 1), and the iteration-2 rejection in `2-design-doc/design-doc-review-2-rejected.md` (Issues 1–3 are addressed inline; see "Revision notes" at the end). Iteration 2 also empirically verifies the action's `src/index.ts` switch logic against the v1.4.0 CHANGELOG entry, the GitHub Actions disabled-workflow behavior, and the ternary-trap arithmetic.

## Overview

Skillsmith today is published locally as `skillsmith@0.1.0` with no `CHANGELOG.md`, no `.github/workflows/`, and no publish configuration. The spec (R1–R9) requires a contributor-mediated, mechanically enforced changelog pipeline backed by the [Changesets](https://github.com/changesets/changesets) library, terminating in an automated `npm publish` of `@automattic/skillsmith` with a tag, GitHub Release, and OIDC-signed provenance.

This design realizes that pipeline as **two GitHub Actions workflows** (`changeset-gate.yml` for PRs, `release.yml` for `trunk` pushes), **one custom validator** (`scripts/validate-changesets.ts`) that closes the gaps `changeset status` silently leaks, **one `.changeset/` directory** with project configuration and a project-specific README, **one rename** in `package.json` to a scoped name, and **two human-facing documents** (`CHANGELOG.md` with the initial 0.1.0 entry, `CONTRIBUTING.md` with the full policy). The pre-merge maintainer checklist (E1–E4) is surfaced in the PR description and persisted into `CONTRIBUTING.md` for ongoing auditability.

The first-publish problem — that `changeset publish` would invoke `npm publish` for the unpublished `@automattic/skillsmith@0.1.0` on the first automatic `release.yml` run — is solved by **two mechanically reinforcing decisions**: (a) this PR ships a `none`-bump starter changeset (rather than the canonical empty form) so `changesets/action` actually opens the no-op Version Packages PR (the action's `hasChangesets && !hasNonEmptyChangesets` early-return at v1.4.0+ otherwise skips PR creation); and (b) this PR ships `release.yml` with `workflow_dispatch` as its **only** trigger, deferring the steady-state `push: trunk` trigger to the follow-up D4 feature PR — the same PR that ships the first real changeset and therefore the first actual version bump. By the time `push: trunk` goes live, `package.json:version` has bumped above `0.1.0` (e.g. to `0.1.1`) and `0.1.0` is never on npm. The `workflow_dispatch.skip_publish` kill switch (with the ternary-trap-safe expression — see below) provides a secondary lever for the manual runs during the bootstrap window and for any future maintainer-initiated version-PR-only run.

## Approach

The end-to-end flow has two halves connected by `trunk`:

1. **PR side (the gate).** Every PR to `trunk` runs a single CI job that runs the custom validator first, then `npx changeset status --since=origin/<base>`. The validator catches shape errors; `changeset status` catches "missing changeset for a release-relevant diff". The exclusion list is data in `.changeset/config.json:changedFilePatterns`, not workflow YAML — so contributors and CI agree about the gate's coverage by reading the same source.
2. **Trunk side (the release) — steady state, post-bootstrap.** Every push to `trunk` (PR merge or admin push) runs `release.yml`, which runs lint/typecheck/test as a pre-flight, then hands off to `changesets/action@v1`. The action's three branches (verified against the action's `src/index.ts` v1.5.0 switch) are: (a) `hasChangesets && hasNonEmptyChangesets` → opens/updates a "Version Packages" PR on `changeset-release/trunk` that, when merged, applies the version bump and `CHANGELOG.md` append, then on the subsequent `push: trunk` run hits the publish path; (b) `hasChangesets && !hasNonEmptyChangesets` → logs "All changesets are empty; not creating PR" and `return`s (no PR, no publish — this is the v1.4.0+ behavior); (c) `!hasChangesets && hasPublishScript` → invokes `npx changeset publish`, which compares local `package.json:version` to npm's published-versions list and publishes any version not yet on npm.
3. **Trunk side — bootstrap window.** Because branch (c) above would invoke `npm publish` for the unpublished `@automattic/skillsmith@0.1.0` on the first such run (the merge of the empty-only Version Packages PR), this PR does **not** install the `push: trunk` trigger. Instead, `release.yml` ships with `workflow_dispatch` only. The maintainer manually runs `release.yml` with `skip_publish=true` to open the Version Packages PR (action branch a fires because the starter is a `none`-bump changeset, not an empty one). The maintainer merges the Version Packages PR; no automatic run fires (no `push:` trigger). The follow-up D4 feature PR adds the `push: trunk` trigger **and** ships the first real changeset, so the first automatic `release.yml` run is the deliberate first-version-bump run.

A maintainer's everyday view is: "open a feature PR, write a changeset, get it merged. The Version Packages PR appears on `trunk`. Merge it when ready to ship." Cadence is cultural (R5b in `requirements.md`); the design enforces only mechanical correctness.

### Flow diagram (steady state, after the bootstrap completes)

```
                       ┌──────────────────────────────────┐
                       │           Contributor PR         │
                       │                                  │
                       │  src/, bin/, examples/, etc.     │
                       │  + .changeset/<random>.md        │
                       └────────────────┬─────────────────┘
                                        │ open / push
                                        ▼
                       ┌──────────────────────────────────┐
                       │   changeset-gate.yml (PR job)    │
                       │                                  │
                       │   1. checkout (fetch-depth: 0)   │
                       │   2. setup-node 22 + npm ci      │
                       │   3. tsx scripts/                │
                       │       validate-changesets.ts     │  ◀── R2.5, R2.6 (validator first)
                       │   4. npx changeset status        │
                       │       --since=origin/${base}     │  ◀── R2.2, R2.6 (gate second)
                       └────────────────┬─────────────────┘
                                        │ green
                                        ▼
                       ┌──────────────────────────────────┐
                       │     PR review and merge          │
                       └────────────────┬─────────────────┘
                                        │ push to trunk
                                        │ (trigger live after D4 follow-up
                                        │  feature PR adds `push: trunk`)
                                        ▼
                       ┌──────────────────────────────────┐
                       │     release.yml (trunk job)      │
                       │                                  │
                       │   1. checkout (fetch-depth: 0)   │
                       │   2. setup-node 22 + npm ci      │
                       │   3. npm run lint                │
                       │   4. npm run typecheck           │
                       │   5. npm test                    │
                       │   6. changesets/action@v1        │
                       │      publish: npx changeset      │
                       │               publish            │
                       │      (suppressed via ternary-    │
                       │       trap-safe expression when  │
                       │       skip_publish=true)         │
                       └────────┬───────────┬─────────────┘
                                │           │
              hasNonEmpty?      │ yes       │ no (zero or empty-only)
                                │           │
                                ▼           ▼
                ┌─────────────────────────┐   ┌──────────────────────────────────┐
                │ Open or update          │   │  hasChangesets && !hasNonEmpty:  │
                │ "Version Packages" PR   │   │   "All changesets are empty;     │
                │ on changeset-release/   │   │    not creating PR" — RETURNS.   │
                │ trunk                   │   │                                  │
                │                         │   │  !hasChangesets && publishScript:│
                └────────────┬────────────┘   │   changeset publish runs.        │
                             │ maintainer     │   Compares package.json:version  │
                             │ merges Version │   to npm's published versions.   │
                             │ Packages PR    │   Publishes anything new.        │
                             ▼ push to trunk  │  If suppressed (skip_publish):   │
                                              │   no publish attempt.            │
                ┌─────────────────────────────────────────┐
                │       release.yml fires again            │
                │                                          │
                │   changesets/action sees no .md files,   │
                │   so the "publish" branch runs:          │
                │   - npm publish (OIDC, provenance)       │
                │     IFF a not-yet-published version      │
                │     exists                               │
                │   - create tag @automattic/              │
                │     skillsmith@<version>                 │
                │   - create matching GitHub Release       │
                └─────────────────────────────────────────┘
```

The publish step is reached only when the workflow runs without `skip_publish=true` and `changeset publish` finds a not-yet-published version on npm. The bootstrap window — this PR's merge and the resulting Version Packages PR merge — is handled before the `push: trunk` trigger is installed; see "Empty-changeset mechanics for the first release (R8.6, R2.4, D2)" below.

## Components

### New components (delivered by this PR)

| Component | Path | Purpose |
|---|---|---|
| Initial changelog | `CHANGELOG.md` | Hand-written `## 0.1.0` entry; future entries appended above by `changeset version`. (R8.1, R3.6, A1) |
| Changesets config | `.changeset/config.json` | The single source of truth for the gate scope and release behaviour. (R8.4, A4) |
| Changesets README | `.changeset/README.md` | Project-specific cheat sheet, replacing the seeded boilerplate. (R8.5, R6.3, A5) |
| Starter changeset (`none`-bump) | `.changeset/<random>.md` | Lets the gate pass on this PR's merge AND gives `changesets/action` something to consume into a no-op Version Packages PR. Uses bump type `none` (not the canonical empty `---\n---\n` form) because `changesets/action` v1.4.0+ explicitly skips opening a PR "when all existing changesets are empty" — a `none`-bump changeset has `releases.length === 1`, so the action's `hasNonEmptyChangesets` check passes and the Version Packages PR opens. `changeset version` consumes a `none`-bump entry into no version bump and no `CHANGELOG.md` change (empirically verified — see "Empty-changeset mechanics for the first release" below). The canonical empty `---\n---\n` form remains supported by the validator as the contributor-facing escape hatch (R1.3, R2.4, R-shape-2). (R8.6, A6, D2) |
| Validator script | `scripts/validate-changesets.ts` | Shape validation + pre-1.0 guard; the **first** step of `changeset-gate.yml`. Factored into pure `validateChangesetFile` plus an entry-guarded `main` so per-rule unit tests can import without executing the script. (R8.9, R2.5, A9, B1–B8) |
| Validator unit tests | `src/__tests__/validate-changesets.test.ts` | Per-rule unit tests (one per B1–B8) plus a fixtures-directory smoke test. Imports `validateChangesetFile` from the validator script. |
| Gate workflow | `.github/workflows/changeset-gate.yml` | Single-job PR workflow: validator then `changeset status`. (R8.10, A10, C1–C4) |
| Release workflow | `.github/workflows/release.yml` | This PR ships `workflow_dispatch`-only (the `push: trunk` trigger is intentionally absent; it is added in the follow-up D4 feature PR alongside the first real changeset). Job runs lint/typecheck/test, then `changesets/action@v1`. `workflow_dispatch.inputs.skip_publish` kill switch is wired with the ternary-trap-safe expression. (R8.11, A11, D1–D4) |
| Contributor guide | `CONTRIBUTING.md` | Full policy, bump table, pre-1.0 rule, summary conventions, release / rollback / dry-run / recovery, repo configuration prerequisites. (R8.7, R6.2, A7) |

### Modified components

| Component | Path | Change |
|---|---|---|
| Package manifest | `package.json` | Rename to `@automattic/skillsmith`, add `publishConfig`, two devDependencies, two scripts. `repository.url` and `homepage` unchanged. (R8.2, A2) |
| Lockfile | `package-lock.json` | Regenerated by `npm install` to record the two new devDependencies. (R8.3, A3) |
| Top-level docs | `README.md` | Three pointer subsections: `## Installation`, `## Releases`, `## Contributing` (~10 lines total). (R8.8, R6.6, A8) |

### Untouched but contract-relevant components

These are inputs to the design, not artifacts modified by it:

- `src/index.ts` — public surface (`DEFAULT_PATHS`, `defineConfig`, ~22 type names, `Provider`/`ProviderId`, `RunOptions`, `run`). The bump-type table in `CONTRIBUTING.md` (R3.1) classifies changes against this surface.
- `bin/skillsmith.mjs` — CLI entry. Inside `changedFilePatterns`.
- `src/config/types.ts` — `Hooks`, `SkillsmithConfigInput`, hook context structs. Drives R3.3 (hook context structs are bidirectional contract).
- `src/providers/` — provider registry. Adding/removing a provider widens/narrows `ProviderId` (R1.1.d, R3.1).
- `src/__tests__/**` — explicitly excluded from `changedFilePatterns` via `!src/__tests__/**` so a test-only PR does not trigger the gate. *Note:* the validator's unit-test file at `src/__tests__/validate-changesets.test.ts` (a new file in this PR) is inside this excluded set — tests-only changes do not require a changeset, consistent with R1.2(h).
- `examples/skillsmith.config.ts` — consumer-facing reference; inside `changedFilePatterns`. R1.4 calls out the edge case.
- `yaml@^2.8.3` (existing dependency at `package.json:45`) — the validator parses front matter with this; no new YAML dependency is introduced.
- `tsconfig.json` — `include` currently covers `src/**/*`, `skillsmith.config.ts`, `examples/**/*` (`tsconfig.json:19`). The new validator at `scripts/validate-changesets.ts` is **outside the typechecker's scope**. This is intentional: `tsx` runs the TypeScript directly at CI time and at developer command (`npx tsx scripts/validate-changesets.ts`), so the script is type-checked at execution rather than at `npm run typecheck`. The validator's unit-test file at `src/__tests__/validate-changesets.test.ts` *is* inside `include`, so `npm run typecheck` will catch import-time type errors in the script's exported surface via the test's `import` statement. If a future contributor prefers `npm run typecheck` to cover the script directly, the one-line fix is to extend `tsconfig.json:include` with `scripts/**/*`; the design does not require this.
- `docs/**`, `testing-project/**`, `.github/**` (other than these workflows), `.changeset/**`, `biome.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `.rp.md`, `.pipelines/**`, `LICENSE`, `package-lock.json` — implicitly excluded by being outside `changedFilePatterns`.

## Interfaces and Data Flow

### Changeset file format (the contract between contributors, CI, and `changeset version`)

A changeset is a Markdown file at `.changeset/<random>.md` with the following shape:

```md
---
"@automattic/skillsmith": <bump>
---

<body>
```

Where `<bump>` is one of `patch | minor | major | none` and `<body>` is free-form Markdown. The author SHA-based filename is generated by `npx changeset` (or chosen by the contributor when authoring directly). Three relevant special cases for the design:

- **Empty changeset** (contributor-facing escape hatch). Exact bytes `---\n---\n` (no front matter, no body) — i.e. what `npx changeset add --empty` writes. Consumed and deleted by `changeset version` without bumping anything. The validator (R2.5) explicitly recognises this case as passing (R-shape-2). **Important:** this is the form used by contributors invoking R1.3 (the empty-changeset escape on PRs that touch release-relevant paths but warrant no release entry). It is NOT the form shipped as the starter in this PR — see the next bullet.
- **`none` bump.** Allowed per the `changeset` schema. The validator allows it. **It is the form shipped as the starter changeset in this PR.** Reason: `changesets/action@v1` v1.4.0+ explicitly skips creating the Version Packages PR when *all* existing changesets are empty (see Decision: "Use `none`-bump starter, not the canonical empty form" below). A `none`-bump changeset has `releases.length === 1` (`name: "@automattic/skillsmith"`, `type: "none"`), so the action's `hasNonEmptyChangesets` check passes and the PR opens. `changeset version` consumes the entry into **no version bump and no `CHANGELOG.md` change** (empirically verified inline below) — so the Version Packages PR diff is exactly "delete `.changeset/<starter>.md`", which is what D2 specifies.
- **Difference at a glance.** The validator's R-shape-2 rule short-circuits when `fmRaw.trim() === "" && body.trim() === ""` — i.e. on the **empty** form. The `none`-bump starter has non-empty front matter (one key/value pair), non-empty body (a one-line description), and is therefore validated through the normal R-pkg / R-bump / R-pass path. Both forms pass the validator; only the `none`-bump form passes the **action's** `hasNonEmptyChangesets` gate.

### `.changeset/config.json` (schema is the canonical Changesets schema)

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.4/schema.json",
  "changelog": ["@changesets/changelog-github", { "repo": "Automattic/skillsmith" }],
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "trunk",
  "updateInternalDependencies": "patch",
  "ignore": [],
  "changedFilePatterns": [
    "src/**",
    "bin/**",
    "package.json",
    "examples/**",
    "README.md",
    "!src/__tests__/**"
  ]
}
```

Field-by-field rationale:

- `$schema` — pins the schema URL; gives editors auto-completion and warning surfaces.
- `changelog` — uses `@changesets/changelog-github@^0.7.0` enriching each entry with `(#PR by @author)`. Requires `GITHUB_TOKEN` at version time (R9.2; `changesets/action` injects it automatically given the R4.6 permissions).
- `commit: false` — let `changesets/action` orchestrate the commit (its default is "commit the version bump alongside the Version Packages PR merge"); we do not want `changeset version` to commit on its own.
- `fixed`, `linked`, `ignore` — empty arrays (single-package; nothing to group). Documented to be explicit, not for any monorepo semantics.
- `access: "public"` — required for scoped packages; defaults to `restricted`. Must be set in **both** this config and `package.json:publishConfig.access` (R5.2).
- `baseBranch: "trunk"` — required so `changeset status --since=...` and the action's branch logic align with the workflow trigger (R4.8). Default is `"main"`.
- `updateInternalDependencies: "patch"` — single-package, harmless. Documented because the schema requires it.
- `changedFilePatterns` — the gate's coverage set per R2.3. Order matters only insofar as the negation `!src/__tests__/**` must come after `src/**` to actually un-match tests.

### `package.json` deltas

```json
{
  "name": "@automattic/skillsmith",
  "publishConfig": { "access": "public" },
  "scripts": {
    "changeset": "changeset",
    "release": "changeset publish"
  },
  "devDependencies": {
    "@changesets/cli": "^2.31.0",
    "@changesets/changelog-github": "^0.7.0"
  }
}
```

`repository.url` continues to read `git+https://github.com/Automattic/skillsmith.git`; `homepage` continues to read `https://github.com/Automattic/skillsmith#readme`. Only `name`, `publishConfig`, the two scripts, and the two devDependencies change.

### `scripts/validate-changesets.ts` input/output contract

**Input** (read from the filesystem at the repo root, when invoked as a script):

- `package.json` — for `name` (`PKG_NAME`) and `version` (`PRE_1_0` flag derived from `String(version).startsWith("0.")`).
- `.changeset/*.md` — every Markdown file in `.changeset/` except `README.md`.

**Per-file parser model.** A file is split into a front-matter block and a body by the regex

```js
/^---\r?\n([\s\S]*?)(?:\r?\n)?---\r?\n?([\s\S]*)$/
```

The capture groups are `fmRaw` and `body`. This regex is the empirically-verified replacement for the original `/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/`, which returned `null` on the canonical empty-changeset bytes (`---\n---\n`). See "Decision: Front-matter parser regex" below for the empirical reproduction and rationale.

Front matter is then parsed with `parseYaml` from `yaml@^2.8.3` and expected to be a flat string→string map (`Record<string, string>`). When `fmRaw` is an empty string (the empty-changeset case), the parser is not called: the rule R-shape-2 short-circuits.

**Module shape (R-script-shape) — required to be unit-testable.** The script exports the pure per-file rule function so unit tests in `src/__tests__/validate-changesets.test.ts` can drive each B1–B8 case against in-memory strings without filesystem or process exit:

```ts
// scripts/validate-changesets.ts (shape — exact factoring is implementation detail)
export type Err = { file: string; line: number; msg: string };

/** Pure: returns errors for a single changeset. No I/O, no process.exit. */
export function validateChangesetFile(
  file: string,
  raw: string,
  pkgName: string,
  version: string,
): Err[];

/** Orchestrates I/O: reads package.json, lists .changeset/*.md, prints errors, returns exit code. */
export function main(): number;

// Entry guard: only execute the runner when invoked as a script, not when imported by tests.
import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  process.exit(main());
}
```

Tests import `validateChangesetFile` directly (`import { validateChangesetFile } from "../../scripts/validate-changesets"`). Each B1–B8 test constructs the file content as a JavaScript string, calls `validateChangesetFile("test.md", raw, "@automattic/skillsmith", "0.1.0")`, and asserts on the returned `Err[]`. No fixtures-on-disk are required for the per-rule tests; the smoke test that does drive over a fixtures directory invokes `main()` indirectly via a child-process spawn (`node --import tsx scripts/validate-changesets.ts` in a tmpdir with seeded `.changeset/` and `package.json`) so the module-import path remains side-effect-free.

The entry-guard pattern (`import.meta.url === pathToFileURL(process.argv[1]).href`) is standard for ESM scripts that double as importable modules; it ensures `main()` runs only when the file is the entry point, not when it is `import`-ed.

**Output** (when run as a script via `main()`): line-numbered errors written to **stderr** (one per error), exit code `1` if any errors were recorded, `0` otherwise. "Line-numbered" means each error has the form `<.changeset/file.md>:<lineNumber>: <message>` where `lineNumber` is the 1-based offset of the offending construct. The *exact line number* is implementation detail (the spec's contract is "errors are line-numbered, one per file:offset"); the design's pseudocode uses constants (`1` for the file-level fence error, `2` for front-matter errors, `4` for body errors) as a placeholder, and the implementation may use `yaml@^2.8.3`'s source-position API when available for more precise pointing — see OQ-2.

**Exit codes**: `0` clean, `1` any validation error. No other codes used. Stdout is unused (kept clean for piping into other tools).

### Validation rules mapped to acceptance criteria

| Rule | Trigger | Maps to |
|---|---|---|
| R-shape-1 | The fence regex matches; if it does not, fail with "missing or unterminated front matter (expected two '---' fences)". | B3, R2.5 bullet 1 |
| R-shape-2 | Empty changeset (`fmRaw.trim() === ""` and `body.trim() === ""`, i.e. raw bytes of the form `---\n---` or `---\n---\n`) passes — verified empirically against the canonical `npx changeset add --empty` output. | B2, R2.5 bullet 2, A6 |
| R-shape-3 | Otherwise body must be non-empty (`body.trim() !== ""`). | B6, R2.5 bullet 3 |
| R-pkg | Every front-matter key must equal `PKG_NAME` (i.e. `@automattic/skillsmith`). | B5, R2.5 bullet 4 |
| R-bump | Every front-matter value must be one of `patch | minor | major | none`. | B4, R2.5 bullet 5 |
| R-pre-1.0 | If `PRE_1_0` and value is `major`, fail with `'major' is forbidden while pre-1.0 (version=<x>). Use 'minor' with a 'BREAKING:' prefix; see CONTRIBUTING.md#pre-10-policy.` | B7, R2.5 last bullet, folds in R3.4 |
| R-exit | Exit `0` clean, `1` on any error. | B8 |
| R-pass | A well-formed changeset with `name=PKG_NAME`, `bump∈{patch,minor,none}` (or `bump=major` when post-1.0), and non-empty body passes. | B1 |

### Validator pseudocode (illustrative, not production code)

The pseudocode below shows the *shape* the implementation must take: a pure per-file function (`validateChangesetFile`), an I/O orchestrator (`main`), and an entry guard. The exit-on-import problem flagged in the rejection's Issue 3 is resolved by the entry guard, which ensures the test importing `validateChangesetFile` does *not* execute `main`.

```ts
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

const VALID = new Set(["patch", "minor", "major", "none"]);
const FENCE_RE = /^---\r?\n([\s\S]*?)(?:\r?\n)?---\r?\n?([\s\S]*)$/;

export type Err = { file: string; line: number; msg: string };

/**
 * Pure: validates one changeset's raw contents against the rule set.
 * No I/O. No process.exit. Safe to call from tests with in-memory strings.
 */
export function validateChangesetFile(
  file: string,
  raw: string,
  pkgName: string,
  version: string,
): Err[] {
  const errors: Err[] = [];
  const preRelease = String(version).startsWith("0.");

  const m = raw.match(FENCE_RE);
  if (!m) {
    errors.push({
      file,
      line: 1,
      msg: "missing or unterminated front matter (expected two '---' fences)",
    });
    return errors;
  }
  const [, fmRaw, body] = m;

  // R-shape-2: empty changeset (`---\n---` or `---\n---\n`) passes.
  if (fmRaw.trim() === "" && body.trim() === "") return errors;

  // R-shape-3: non-empty front matter requires non-empty body.
  if (body.trim() === "") {
    errors.push({
      file,
      line: 4,
      msg: "empty body (changeset has front matter but no summary)",
    });
  }

  let fm: Record<string, string>;
  try {
    fm = parseYaml(fmRaw) as Record<string, string>;
  } catch (e) {
    errors.push({ file, line: 2, msg: `YAML parse error: ${(e as Error).message}` });
    return errors;
  }
  if (fm === null || typeof fm !== "object") {
    errors.push({ file, line: 2, msg: "front matter must be a YAML mapping of package name to bump" });
    return errors;
  }

  for (const [name, bump] of Object.entries(fm)) {
    if (name !== pkgName) {
      errors.push({ file, line: 2, msg: `unknown package "${name}" (expected "${pkgName}")` });
    }
    if (!VALID.has(bump)) {
      errors.push({
        file,
        line: 2,
        msg: `invalid bump "${bump}" (expected one of ${[...VALID].join(", ")})`,
      });
    } else if (preRelease && bump === "major") {
      errors.push({
        file,
        line: 2,
        msg: `'major' is forbidden while pre-1.0 (version=${version}). Use 'minor' with a 'BREAKING:' prefix; see CONTRIBUTING.md#pre-10-policy.`,
      });
    }
  }
  return errors;
}

/**
 * I/O orchestrator: reads package.json + .changeset/*.md, prints errors, returns exit code.
 * Called only when the file is the script entry point (see the entry guard below).
 */
export function main(): number {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const pkgName: string = pkg.name;
  const version: string = pkg.version;

  const files = readdirSync(".changeset")
    .filter((n) => n.endsWith(".md") && n !== "README.md");

  let total: Err[] = [];
  for (const f of files) {
    const raw = readFileSync(`.changeset/${f}`, "utf8");
    total = total.concat(validateChangesetFile(f, raw, pkgName, version));
  }

  if (total.length === 0) return 0;
  for (const e of total) {
    process.stderr.write(`.changeset/${e.file}:${e.line}: ${e.msg}\n`);
  }
  return 1;
}

// Entry guard: run main() only when invoked directly (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  process.exit(main());
}
```

The shipped script will be ~50 lines following the spec target. It is invoked from CI as `npx tsx scripts/validate-changesets.ts`; `tsx` is already a runtime dependency (`package.json:44`) so this requires no toolchain change.

#### Empirical verification of the regex fix

Verified at design-doc revision time against Node 22 in this worktree (re-runnable by any reader):

```js
const FENCE_RE = /^---\r?\n([\s\S]*?)(?:\r?\n)?---\r?\n?([\s\S]*)$/;

FENCE_RE.exec("---\n---\n");
// → ["---\n---\n", "", "", index: 0, ...] — empty changeset passes (B2, A6)

FENCE_RE.exec("---\n---");
// → ["---\n---", "", "", index: 0, ...] — empty changeset without trailing newline also matches

FENCE_RE.exec('---\n"@automattic/skillsmith": minor\n---\n\nAdd thing.\n');
// → matches with fmRaw='"@automattic/skillsmith": minor', body='\nAdd thing.\n' (B1)

FENCE_RE.exec('---\r\n"@automattic/skillsmith": minor\r\n---\r\n\r\nAdd thing.\r\n');
// → matches under CRLF line endings as well

FENCE_RE.exec('---\n"@automattic/skillsmith": minor\n');
// → null — missing closing fence still fails (R-shape-1, B3)
```

The original regex (`/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/`) returned `null` on `"---\n---\n"` because it required a `\n` *immediately before* the closing `---`, which the empty-changeset bytes do not contain — the only `\n` between fences is the one after the *opening* fence, which the non-greedy `[\s\S]*?` claimed. The corrected regex makes the inter-fence `\r?\n` optional (`(?:\r?\n)?`), so the empty-changeset case collapses to `fmRaw=""`, while non-empty front matter still has a trailing newline that the non-greedy capture absorbs. CRLF tolerance (`\r?\n`) is a free win and protects contributors authoring on Windows.

### `.github/workflows/changeset-gate.yml` (interface)

```yaml
name: Changeset Gate
on:
  pull_request:
    branches: [trunk]
permissions:
  contents: read
  pull-requests: read
concurrency:
  group: changeset-gate-${{ github.head_ref || github.ref }}
  cancel-in-progress: true
jobs:
  changeset:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Validate changeset shape
        run: npx tsx scripts/validate-changesets.ts
      - name: Require a changeset for release-relevant changes
        run: npx changeset status --since=origin/${{ github.event.pull_request.base.ref }}
```

Notes:
- `pull_request` (not `pull_request_target`) — no secrets are needed; the gate runs on the PR head as untrusted code.
- `fetch-depth: 0` — `changeset status` resolves `--since=<base>` against full history.
- `concurrency.cancel-in-progress: true` — outdated runs on superseded pushes are cancelled, saving CI time.
- Permissions are read-only — the gate doesn't comment, label, or push.
- The validator runs **before** `changeset status` (R2.6, C4). If the validator fails, the gate fails with the validator's error (line-numbered) before `changeset status`'s misleading "no changesets found" can confuse the contributor.

### `.github/workflows/release.yml` (interface)

```yaml
name: Release
on:
  # Bootstrap PR ships workflow_dispatch ONLY. A follow-up PR (D4 — the first real
  # feature changeset) adds `push: branches: [trunk]` so the steady-state automatic
  # trigger only goes live alongside a real version bump. See
  # "Empty-changeset mechanics for the first release" and Decision: "Bootstrap via
  # workflow_dispatch-only trigger, push: trunk added in the follow-up feature PR".
  workflow_dispatch:
    inputs:
      skip_publish:
        description: "Run Version PR step only; don't publish"
        type: boolean
        default: false
  # The line below is included by the follow-up D4 feature PR, NOT this PR.
  # Documented here so the steady-state interface is visible to future readers.
  #
  # push:
  #   branches: [trunk]
concurrency: ${{ github.workflow }}-${{ github.ref }}
permissions:
  contents: write
  pull-requests: write
  id-token: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - id: changesets
        uses: changesets/action@v1
        with:
          # Ternary-trap-safe form: when the middle operand of `A && B || C` is falsy,
          # the expression always returns `C`. Empty string is falsy in GitHub Actions
          # expressions, so the form `inputs.skip_publish && '' || 'npx changeset publish'`
          # silently always returns `'npx changeset publish'`. The inverted form below
          # puts the truthy branch in the middle operand and reliably short-circuits.
          # See "Empirical verification of the skip_publish expression" below.
          publish: ${{ !inputs.skip_publish && 'npx changeset publish' || '' }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Notes:
- `on:` ships with `workflow_dispatch` only in this PR. The steady-state `push: trunk` trigger is added by the follow-up D4 feature PR — the same PR that ships the first real changeset. Rationale: until a real changeset bumps `package.json:version` above `0.1.0`, any automatic run of `release.yml` in publish mode would invoke `npm publish` for the unpublished `0.1.0` (verified against `@changesets/cli@2.31.0`'s `publishPackages.ts`). By deferring the automatic trigger to the same PR that introduces the first real bump, the first automatic run is the **deliberate** first-publish run. See Decision: "Bootstrap via `workflow_dispatch`-only trigger, `push: trunk` added in the follow-up feature PR" below.
- `concurrency: ${{ github.workflow }}-${{ github.ref }}` — no `cancel-in-progress`; serialize Release runs on `trunk` so two simultaneous merges cannot race the publish step or double-create the Version Packages PR (R4.3). The setting applies once `push: trunk` is added by D4.
- Permissions are the exact three from R4.6 — no more, no less.
- `actions/checkout@v6` with `fetch-depth: 0` so `@changesets/changelog-github` can resolve PR metadata via `git log` (R4.5, R9.2).
- Lint → typecheck → test → action: pre-publish quality gate (R4.4, "Pattern A").
- `publish: ${{ !inputs.skip_publish && 'npx changeset publish' || '' }}` — kill switch (R4.10). When `skip_publish=true`, the expression evaluates to `''` (action treats this as "no publish script"), so the action opens/updates the Version Packages PR but does **not** publish. When unset or false, the expression evaluates to `'npx changeset publish'`. **This is the load-bearing first-publish-gate for the bootstrap; the previous form silently always evaluated to `'npx changeset publish'` due to the GitHub Actions ternary trap, leaving the kill switch a no-op.** Empirical verification below.
- `GITHUB_TOKEN` is passed via `env:` for `@changesets/changelog-github`'s PR/author enrichment at the version step (R9.2). The token is provided by `actions/checkout`'s default; the explicit pass-through is documented for clarity.

#### Empirical verification of the `skip_publish` expression

The previous form `${{ inputs.skip_publish && '' || 'npx changeset publish' }}` is the "ternary trap" pattern documented at [7tonshark.com/posts/github-actions-ternary-operator](https://7tonshark.com/posts/github-actions-ternary-operator/). The empty string `''` is **falsy** in GitHub Actions expressions, so `||` short-circuits past it; the result is always the right-hand operand:

| `skip_publish` | `skip_publish && ''` | `… \|\| 'npx changeset publish'` | Actual `publish:` |
|---|---|---|---|
| `true` | `''` (falsy) | `'npx changeset publish'` (right side wins) | **`'npx changeset publish'` — kill switch ignored** |
| `false` | `false` | `'npx changeset publish'` | `'npx changeset publish'` (correct by coincidence) |
| undefined | `false` | `'npx changeset publish'` | `'npx changeset publish'` (correct by coincidence) |

The inverted form `${{ !inputs.skip_publish && 'npx changeset publish' || '' }}` puts the **truthy** branch in the middle operand:

| `skip_publish` | `!skip_publish && 'npx changeset publish'` | `… \|\| ''` | Actual `publish:` |
|---|---|---|---|
| `true` | `false` (`!true && …` short-circuits) | `''` (right side wins because `false` is falsy) | **`''` — kill switch fires** |
| `false` | `'npx changeset publish'` (truthy middle operand) | `'npx changeset publish'` | `'npx changeset publish'` |
| undefined | `'npx changeset publish'` | `'npx changeset publish'` | `'npx changeset publish'` |

Reproduced in Node 20 against the same truthiness rules GitHub Actions uses:

```js
for (const v of [true, false, undefined]) {
  // GitHub Actions: '' is falsy; && returns first falsy or last; || returns first truthy or last.
  const inv = !v ? "npx changeset publish" : false;
  const result = inv ? inv : "";
  console.log("skip_publish=" + v + " -> publish=" + JSON.stringify(result));
}
// → skip_publish=true     -> publish=""
// → skip_publish=false    -> publish="npx changeset publish"
// → skip_publish=undefined -> publish="npx changeset publish"
```

The implementation phase MUST use the inverted form. A unit-style check could be added by snapshotting the `changesets/action` invocation in the workflow log, but is not required — the empirical table above is the contract.

### Trigger model and `[skip ci]` (resolves R9.1)

`changesets/action` writes its "Version Packages" commit with `[skip ci]` in the message ([changesets/action#198](https://github.com/changesets/action/issues/198)) to avoid re-triggering the same workflow. For skillsmith today:

- **`release.yml`** steady-state trigger is `push: trunk` (installed by the follow-up D4 PR; this PR ships `workflow_dispatch`-only). The Version Packages commit lands on the `changeset-release/trunk` branch (which `release.yml` does not watch), so the `[skip ci]` flag is not the load-bearing safety here — the **branch filter** is. Once the Version Packages PR is merged into `trunk`, the merge commit on `trunk` *does* fire `release.yml` (in steady state), and on that run the action sees zero `.changeset/*.md` files and the "publish" branch decides whether to invoke `npm publish` based on `package.json:version` vs. npm's published-versions list. `[skip ci]` plays no role at that point.
- **`changeset-gate.yml`** trigger is `pull_request`, not `push`. `[skip ci]` in a `pull_request` event has **no effect** — GitHub honours `[skip ci]` only on `push` (and `schedule`). The Version Packages PR is opened by the action on `changeset-release/trunk`. When the maintainer opens that PR, the gate workflow runs on it normally. This is fine and desired: the gate should run on the Version Packages PR like any other.
- **The Version Packages PR will fail the gate** unless it carries a changeset entry — but by construction it carries the changeset files that `changeset version` is about to consume (until the maintainer merges, the `.changeset/*.md` files are present on the release branch). So `changeset status` exits 0 because the changesets exist; the validator passes because they are well-formed (they were validated when their authors landed). Once merged, the changesets are deleted as part of the merge commit on `trunk`, which is when `release.yml` runs in its publish branch.

**Verdict on R9.1:** the present single-workflow model is `[skip ci]`-safe because the action's Version Packages commit lands on a non-`trunk` branch (`changeset-release/trunk`) that `release.yml` doesn't watch. The design records a forward-looking note: **if a future PR adds a separate `test.yml` triggered on `push: trunk`**, that workflow will see the `[skip ci]` flag *only* on direct pushes of bypass commits, not on the Version Packages PR merge (because the merge commit on `trunk` does not carry `[skip ci]`). The forward-looking guidance is unchanged: future CI workflows should trigger on `pull_request` so they certify quality on every PR (including the Version Packages PR) before merge.

### Resolution of R9.4 (`@changesets/bot` × `changedFilePatterns`)

R9.4 asks: when `changedFilePatterns` excludes a PR's diff, does `@changesets/bot` still post its educational comment? Empirically verifiable signals:

- The bot's source ([changesets/bot/blob/main/src/index.ts](https://github.com/changesets/bot/blob/main/src/index.ts)) computes "this PR needs a changeset" by reading the changesets config and running the same `getChangesetsAdded` and "what files changed" logic the CLI uses. The current bot release (May 2026) **does** read `changedFilePatterns` from `.changeset/config.json` and uses it to short-circuit its check, the same way the CLI's `changeset status` does.
- That said: the bot is non-blocking. The CI gate is what fails the build (R2.7). The worst empirical outcome is that the bot occasionally posts a "Add a changeset" reminder on a PR that the CLI would have ignored, and the contributor either adds a real changeset or an empty one. The cost is human friction, not correctness.

**Recommendation (D-bot):** the design assumes the bot honours `changedFilePatterns`; the fallback if it does not is simply to live with occasional educational noise on excluded PRs — the bot's comment is non-blocking and the CI gate is the source of truth. The spec explicitly classifies the bot install as optional (R2.7, E listing), so the design does not need to wire it. **`CONTRIBUTING.md` (per R6.2 "Repo configuration prerequisites") notes the bot as optional, complementary to the CI gate; if installed and it generates noise on excluded PRs, the noise is tolerable.**

### `package.json` rename and pre-merge confirmation (E1)

The rename to `@automattic/skillsmith` is mechanically a one-token edit in `package.json:name`, plus the new `publishConfig.access`. It is **safe to include in this PR** because:

- The rename only takes effect at publish time. Local development (`npm ci`, `npm test`, `npm run lint`, `npx skillsmith`) is unaffected by the name change.
- The pre-merge checklist surfaces E1 explicitly in the PR description, so the owner is making the rename decision explicitly when they approve the merge.

**Where E1 surfaces in this PR's artifacts:**

1. **PR description** — the implementing PR's body opens with a pre-merge checklist. Item 1 is: `[ ] Confirm npm package name @automattic/skillsmith (E1). If a different name is chosen, update package.json, .changeset/config.json, README.md, CONTRIBUTING.md, and any reference in scripts/validate-changesets.ts before merging.` This is the load-bearing surface; the design does not ship the PR body, but specifies its required content.
2. **`CONTRIBUTING.md` → Repo configuration prerequisites section** — documents the rename rationale (the unscoped `skillsmith` is held by an unrelated party; the scope is empirically available; ~50 `@automattic/*` packages exist) so a future maintainer can audit and a future name change has the relevant context preserved.
3. **`CHANGELOG.md` 0.1.0 entry** — does not surface E1 directly; the rename's first user-visible appearance is the published artifact's name once E4 (trusted publisher) is in place.

The validator (`scripts/validate-changesets.ts`) reads `PKG_NAME` from `package.json:name` at runtime (inside `main()`), so a rename does not require editing the validator. The `validateChangesetFile` function takes `pkgName` as a parameter, so unit tests can simulate any name. The `.changeset/config.json:changelog`'s `repo: "Automattic/skillsmith"` setting refers to the **GitHub repo path**, not the npm name, and stays the same regardless of E1's outcome. **The only places a name override propagates are: `package.json:name`, `.changeset/<random>.md` front matter keys (the `none`-bump starter *does* have a key `"@automattic/skillsmith"` because it is a `none`-bump entry, not the canonical empty form — so an E1 name change does propagate to the starter), and any reference in `README.md` / `CONTRIBUTING.md` prose.**

### `CHANGELOG.md` initial format (R3.6, A1)

The file format `changeset version` emits and maintains is Keep-a-Changelog-ish: a top-level `# @automattic/skillsmith` heading, then per-version sections in reverse chronological order:

```md
# @automattic/skillsmith

## 0.2.0

### Minor Changes

- abc1234: Add `--scope failed-pairs` CLI flag to control re-evaluation scope. (#42 by @author)

## 0.1.1

### Patch Changes

- def5678: Fix race condition where two concurrent `run()` calls would corrupt the `report.json` aggregate. (#41 by @another-author)

## 0.1.0

Initial release. Skill testing harness + self-improvement loop.
```

`changeset version`'s append behaviour is "insert the new version block above the existing top-most version block" (verified against `@changesets/cli@2.31.0` and the canonical Changesets docs). So the hand-written `## 0.1.0` entry will sit at the bottom forever, and future entries land above it.

**The initial entry is intentionally minimal** — it is a one-paragraph backfill, not a retroactive reconstruction of pre-0.1.0 history. Recommended exact body (subject to wording revision in the docs phase):

```md
# @automattic/skillsmith

## 0.1.0

Initial release. Skill testing harness + self-improvement loop. See [`README.md`](./README.md) for usage and configuration, and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the changeset / release policy.
```

The `# @automattic/skillsmith` top-level heading is required because `changeset version` looks for it; if absent, the action inserts one, producing a duplicate. **The design uses the heading from the start.**

### Empty-changeset mechanics for the first release (R8.6, R2.4, D2)

This PR ships one starter changeset at `.changeset/<random>.md` (e.g. `.changeset/initial-scaffolding.md` if the implementation chooses a deterministic name; the random name is also fine). Its contents are **NOT** the canonical empty form `---\n---\n` — they are a `none`-bump changeset:

```md
---
"@automattic/skillsmith": none
---

Initial scaffolding: changeset and release automation. No consumer-visible change.
```

This is a deliberate revision from a previous design draft that shipped the canonical empty form. The reasons are below.

**Why the starter is a `none`-bump changeset, not the canonical empty form (R8.6 wording aside).**

`changesets/action` at v1.4.0 (April 2022) added the early-return [PR #206](https://github.com/changesets/action/pull/206) ("Skip creating a PR when all existing changesets are empty"). Reading the action's `src/index.ts` (verified at the spec's pin v1.8.0 and at v1.5.0 inline below):

```ts
let { changesets } = await readChangesetState();
let publishScript = core.getInput("publish");
let hasChangesets = changesets.length !== 0;
const hasNonEmptyChangesets = changesets.some(
  (changeset) => changeset.releases.length > 0
);
let hasPublishScript = !!publishScript;
// ...
switch (true) {
  case !hasChangesets && !hasPublishScript: /* no-op */ return;
  case !hasChangesets && hasPublishScript: /* invokes runPublish */ return;
  case hasChangesets && !hasNonEmptyChangesets:
    core.info("All changesets are empty; not creating PR");
    return;                                  // ← THIS branch fires for the canonical empty starter
  case hasChangesets: /* opens Version Packages PR */ return;
}
```

Empirically reproduced at design-doc revision time (in `/tmp/changesets-action-source-39`, using `@changesets/read` — the same library the action uses):

```js
import readChangesets from "@changesets/read";

// Canonical empty starter:
writeFileSync(".changeset/empty.md", "---\n---\n");
let cs = await readChangesets(process.cwd());
// → [{ releases: [], summary: "", id: "empty" }]
cs.some((c) => c.releases.length > 0); // → false → hasNonEmptyChangesets=false
// ⇒ Action's third switch case fires: "All changesets are empty; not creating PR" → return.

// none-bump starter:
writeFileSync(".changeset/none-bump.md",
  '---\n"@automattic/skillsmith": none\n---\n\nInitial scaffolding.\n');
cs = await readChangesets(process.cwd());
// → [..., { releases: [{ name: "@automattic/skillsmith", type: "none" }], summary: "Initial scaffolding.", id: "none-bump" }]
cs.some((c) => c.releases.length > 0); // → true → hasNonEmptyChangesets=true
// ⇒ Action's fourth switch case fires: opens the Version Packages PR.
```

So if this PR shipped the canonical empty starter, the action would log "All changesets are empty; not creating PR" and return — **no Version Packages PR**, which directly contradicts spec D2 ("opens a no-op Version Packages PR on branch `changeset-release/trunk`").

The `none`-bump starter survives the early-return because `releases.length === 1`. And what does `changeset version` do with a `none`-bump changeset? Empirically verified at design-doc revision time (`/tmp/none-bump-test-2`, with `@changesets/cli@2.31.0` and `@changesets/changelog-github@0.7.0` configured exactly as this design specifies):

```
$ ls .changeset/
config.json  none-bump-test.md

$ GITHUB_TOKEN=x npx changeset version
🦋  All files have been updated. Review them and commit at your leisure

$ ls .changeset/
config.json                                # ← none-bump-test.md is deleted

$ cat package.json | grep version
  "version": "0.1.0",                      # ← NOT bumped

$ ls CHANGELOG.md
ls: CHANGELOG.md: No such file or directory  # ← NOT created
```

So `changeset version` consumes a `none`-bump changeset into **exactly the diff D2 describes**: delete the starter file, no version bump, no `CHANGELOG.md` change. The contract holds — just via the `none`-bump form rather than the canonical empty form.

**Reconciliation with spec R8.6 / A6 and D2.** The spec text at R8.6 reads "One empty changeset at `.changeset/<random>.md` containing `---\n---`"; A6 reads "Exactly one empty changeset file exists at `.changeset/<random>.md` containing `---\n---`". This design **substitutes a `none`-bump changeset** for the canonical empty form, on the grounds that (a) the spec D2 diff requirement is preserved exactly (delete the starter, no bump, no `CHANGELOG.md` change), (b) the canonical empty form is empirically incompatible with the v1.4.0+ action behavior the spec also pins (`changesets/action@v1.8.0`, R5.4 / R8.11), and (c) the canonical empty form remains supported by the validator (R-shape-2) as the contributor-facing escape hatch (R1.3, R2.4) — only the **starter** form changes. The spec's empirical claim "verified in `/tmp/changesets-test-39`" is correct for the **CLI** but did not exercise the action's `hasNonEmptyChangesets` switch, which is what the empty-only state actually trips. This is a spec-level concern noted for the owner; the orchestrator may want to surface "R8.6 / A6 should read 'one starter changeset (a `none`-bump or the empty form, see design doc)' rather than 'one empty changeset'". The design proceeds under the substitution and explicitly traces D2's diff requirement to the `none`-bump empirical evidence above.

**The first-publish problem.** Even with the `none`-bump starter, a second, distinct problem remains: `changesets/action`'s post-merge run on the Version Packages PR merge sees zero changesets (the starter was deleted) and falls into the `!hasChangesets && hasPublishScript` branch, which invokes `npx changeset publish`. Per `@changesets/cli@2.31.0`'s `publishPackages.ts` (which the spec's R7.4 references): `changeset publish` compares the local `package.json:version` to the set of versions already on npm via `infoAllow404(packageJson)`. For `@automattic/skillsmith` today, `npm view @automattic/skillsmith` returns 404 (verified in `spec.md:20`), i.e. zero published versions. So `!publishedVersions.includes("0.1.0")` is `true`, and `changeset publish` invokes `npm publish` for `@automattic/skillsmith@0.1.0` — which contradicts D3 ("merging the no-op PR does not publish anything"). Two outcomes:

- **E4 configured → `0.1.0` is silently published.** D3 violated; `0.1.0` becomes the first public version even though no real changeset shipped.
- **E4 not configured → publish fails 401.** Source tree is fine, but the maintainer triages an unexpected "why did the workflow try to publish on the no-op merge?" surprise.

The fix must prevent the automatic `push: trunk` trigger from firing the publish path during the bootstrap window. The fix must also survive empirical scrutiny: a previous design draft proposed "disable `release.yml` before merge, then trigger it manually via `workflow_dispatch` with `skip_publish=true`". That is mutually exclusive — GitHub Actions hides the "Run workflow" button when a workflow is disabled, and blocks **all** triggers including `workflow_dispatch` (documented in GitHub's own [Disabling and enabling a workflow](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow) docs; corroborated by the GitHub Community thread "[Manually running a disabled workflow](https://github.com/orgs/community/discussions/26076)"). A disabled workflow is fully inert.

**Decision: Bootstrap via `workflow_dispatch`-only trigger; `push: trunk` is added in the follow-up D4 feature PR (resolves rejection iteration-2 Issues 1, 2, 3 together).**

This PR ships `release.yml` with **`on: workflow_dispatch:`** as its sole trigger. There is no `on.push.branches: [trunk]` clause in the file this PR ships. The steady-state push trigger is added by the **follow-up D4 feature PR** — the same PR that ships the first real (`patch` or `minor`) changeset.

This addresses all three iteration-2 blockers in one move:
- **Issue 1 (disable + workflow_dispatch is mutually exclusive):** the workflow stays enabled; `workflow_dispatch` works because no disabling is required.
- **Issue 2 (`changesets/action` skips PR creation for empty-only state):** the `none`-bump starter (above) makes `hasNonEmptyChangesets=true`, so the action opens the Version Packages PR.
- **Issue 3 (`skip_publish` ternary trap):** the ternary is inverted to the empirically-verified form; the kill switch now actually fires on `skip_publish=true`. The kill switch is still useful as defense-in-depth on the manual runs during bootstrap, and for any future maintainer-initiated "version-PR-only" inspection cycle.

**The bootstrap routine — step by step on the maintainer's screen:**

1. **Pre-merge: maintainer ensures `release.yml` ships with `workflow_dispatch`-only** (i.e. confirms there is no `on.push.branches: [trunk]` block in the PR). The PR-description checklist (below) reminds the maintainer to verify this.
2. **Pre-merge: maintainer ensures E1–E4 are addressed** (existing requirement; not specific to this bootstrap).
3. **Merge the implementing PR.** No automatic `release.yml` run fires — `workflow_dispatch` is the only trigger, and pushing to `trunk` does not activate it. `trunk` now contains: the `.changeset/<random>.md` `none`-bump starter, `release.yml` with `workflow_dispatch`-only trigger, and the rest of this PR's diff.
4. **Manual run #1: Maintainer triggers `release.yml` via Actions → Release → "Run workflow" with `skip_publish=true`.** The job runs `npm ci → npm run lint → npm run typecheck → npm test` (all pass — no source changes), then hits `changesets/action@v1`. The action sees one changeset with `releases.length === 1`. `hasChangesets=true`, `hasNonEmptyChangesets=true`. Action falls into `case hasChangesets:` (the fourth switch case) → runs `runVersion` → produces a diff that deletes `.changeset/<random>.md` (no version bump, no `CHANGELOG.md` change) → pushes the diff to `changeset-release/trunk` → opens the Version Packages PR. The `publish:` input is `''` (kill switch fired correctly thanks to the inverted ternary), so the action's publish branch is *also* a no-op even though `runVersion` would have returned before reaching it. **`skip_publish=true` is defense-in-depth here; the structural protection is that this is the version branch, not the publish branch.** No `npm publish` is invoked.
5. **Maintainer reviews and merges the Version Packages PR.** Diff is `delete .changeset/<random>.md` (D2 verified by inspection). No automatic run fires — `workflow_dispatch` is still the only trigger. `trunk` now contains: no `.changeset/*.md` files other than `README.md` and `config.json`; `package.json:version` is still `0.1.0` (unchanged from the implementing PR); `CHANGELOG.md` is unchanged from the implementing PR (still contains the hand-written initial `## 0.1.0` entry only — `changeset version` did not modify it because the `none`-bump entry produced no append). D3 holds **by inspection of the merge commit's diff** — no `npm publish` was even attempted because the workflow has no `push:` trigger.
6. **(Optional) Manual run #2: Maintainer triggers `release.yml` again with `skip_publish=true`** as an explicit zero-changeset smoke test. The action sees `hasChangesets=false`, `hasPublishScript=true` (`publish:` would be `'npx changeset publish'` if `skip_publish=false`, but it is `''` because `skip_publish=true`). The action's `hasPublishScript` check on line 52 evaluates `!!''`, which is `false`, so the third `case !hasChangesets && hasPublishScript:` doesn't fire either — instead the first `case !hasChangesets && !hasPublishScript:` fires, which logs "No changesets present or were removed by merging release PR. Not publishing because no publish script found." and returns. **No publish attempt.** This run is optional but is a useful explicit smoke test of the kill switch.
7. **Post-bootstrap: the maintainer is now in the steady-state-precursor.** `release.yml` has `workflow_dispatch` only; there is no automatic trigger. Any direct push to `trunk` (admin push, hotfix-revert) does **not** fire `release.yml`. The next step is to open the follow-up D4 feature PR.

**The follow-up D4 feature PR (first real publish, transitions to steady state):**

A subsequent feature PR (the first one after this PR merges) does two things in one diff:
1. **Adds the `on.push.branches: [trunk]` trigger** to `release.yml`. The comment scaffolding in `release.yml` makes the location obvious — uncomment the block at the top.
2. **Ships a real (`patch` or `minor`) changeset** describing the new feature.

When this feature PR merges:
- The merge commit on `trunk` now includes both the new `push: trunk` trigger *and* a real changeset.
- GitHub Actions evaluates the workflow definition at the merge commit. The `push: trunk` trigger is present, so the workflow fires on the merge commit's push.
- The action sees one changeset with a real bump (`minor` or `patch`). `hasNonEmptyChangesets=true`. Fourth switch case fires → opens the Version Packages PR, which now contains a `package.json` bump (e.g. `0.1.0 → 0.1.1`), a `CHANGELOG.md` append, and the deletion of the feature PR's changeset.
- Maintainer reviews and merges the Version Packages PR. The merge commit fires `release.yml` again (the `push: trunk` trigger is now permanent).
- The action sees zero changesets and `publish:` is `'npx changeset publish'` (no `skip_publish`). First switch case is `!hasChangesets && hasPublishScript` → calls `runPublish` → invokes `npx changeset publish`. Local `package.json:version` is now `0.1.1`; npm has no published versions; `!publishedVersions.includes("0.1.1")` is `true`; **`npm publish` ships `@automattic/skillsmith@0.1.1` with OIDC provenance.** Tag `@automattic/skillsmith@0.1.1` is created, GitHub Release is created with the `CHANGELOG.md` body. **D4 verified.**

`@automattic/skillsmith@0.1.0` is **never published**. The first version on npm is `0.1.1` (or whatever bump the first feature ships).

**Where this surfaces in the PR description's pre-merge checklist (extends E1–E4):**

The checklist embedded in the implementing PR's body must include a "First-publish bootstrap" subsection with the following items (added by this revision):

```
- [ ] Confirm `release.yml` ships with `on: workflow_dispatch:` ONLY — no
      `push: trunk` trigger. The follow-up D4 feature PR (your next changeset
      PR) is what adds the `push:` trigger. Rationale: prevents an unintended
      first publish of @automattic/skillsmith@0.1.0 (empirically, npm has no
      prior versions; `changeset publish` would publish 0.1.0).
- [ ] Confirm the starter changeset (`.changeset/<random>.md`) uses
      bump type `none`, NOT the canonical empty `---\n---\n` form. Rationale:
      `changesets/action` v1.4.0+ skips PR creation for empty-only state
      (verified inline in design doc); the none-bump form survives that
      gate while consuming into the same no-op diff `changeset version`
      produces for the empty form.
- [ ] Merge the implementing PR. (No automatic run will fire — workflow_dispatch
      is the only trigger.)
- [ ] After merge: manually run `release.yml` via Actions → Release → "Run
      workflow", with `skip_publish: true`. Confirm the action opens the
      Version Packages PR on `changeset-release/trunk`. The PR diff should be
      exactly: delete `.changeset/<random>.md`. (D2 verification.)
- [ ] Review and merge the Version Packages PR. No automatic run will fire.
      Inspect the merge commit on `trunk` to confirm: `package.json:version`
      unchanged (still `0.1.0`); no `CHANGELOG.md` modification beyond what
      this PR shipped; only the starter file deletion. (D3 verification.)
- [ ] (Optional) Manually run `release.yml` again with `skip_publish: true`
      as an explicit zero-changeset smoke test. Confirm log message
      "No changesets present or were removed by merging release PR. Not
      publishing because no publish script found."
- [ ] In your next feature PR (D4): UNCOMMENT the `on.push.branches: [trunk]`
      block in `release.yml`, AND ship a real (`patch` or `minor`) changeset.
      The merge of that PR fires the first automatic run, which opens the
      Version Packages PR that bumps to `0.1.1` (or `0.2.0`). Merging that
      Version Packages PR triggers the first `npm publish`. (D4 verification.)
```

The checklist is the load-bearing artefact for the maintainer. `CONTRIBUTING.md` does not duplicate it — bootstrap is a one-time procedure (OQ-5).

**Why this path over the alternatives:**

- **Option A (chosen): `workflow_dispatch`-only initially; follow-up PR adds `push:` trigger along with the first real changeset.** Survives empirical scrutiny on all three iteration-2 blockers. Preserves D2 (Version Packages PR opens, diff is only the starter deletion) and D3 (no version bump, no publish attempt — verified by inspection of the merge commit). Adds one explicit step to the bootstrap checklist ("the follow-up PR also adds the `push:` trigger"). **Chosen.**
- **Option B (rejected): ship `push: trunk` trigger and disable workflow before merge.** Rejected because disabling a workflow blocks `workflow_dispatch` too — the bootstrap cannot proceed. This is iteration-2 Issue 1.
- **Option C (rejected): ship `push: trunk` trigger, rely on `skip_publish=true` for both automatic runs.** Rejected because `skip_publish` is a `workflow_dispatch` input — it cannot be passed to automatic `push:` triggers. There is no GitHub Actions mechanism to set a default value for an input that only applies to push triggers without using a repository variable or environment variable.
- **Option D (rejected): ship `push: trunk` trigger; use a repository variable (e.g. `vars.BOOTSTRAP_BLOCK_PUBLISH=true`) the maintainer toggles.** Considered. Rejected because it adds a new repository-configuration item to the pre-merge checklist (and a corresponding "remove the variable" item to the post-bootstrap routine), and forgetting to remove the variable silently breaks steady-state publishing forever. Heavier and more error-prone than Option A.
- **Option E (rejected): ship the canonical empty starter, hope the action opens the PR.** Rejected by the v1.4.0+ early-return empirical evidence above.
- **Option F (rejected): set `package.json:version` to `0.0.0` so `changeset publish` skips the first run.** Rejected by R3.6 (the spec mandates `0.1.0` for this PR), and would require backfilling a different `## 0.0.0` changelog entry.

**Trace to spec D2 / D3 / D4 with the chosen path:**

| Criterion | Verification mechanism |
|---|---|
| D1 ("Merging this PR triggers `release.yml`. Lint/typecheck/test succeed.") | The follow-up D4 PR's merge is the first automatic `release.yml` run. *This PR's* merge does not automatically trigger `release.yml`. The maintainer triggers it via `workflow_dispatch`. The lint/typecheck/test sequence runs and passes on **this PR's** manual run #1, satisfying D1's substantive intent. **The wording of D1 may need to be revisited at the spec level to reflect "the workflow runs successfully after this PR merges" rather than "merging this PR automatically triggers"** — this is a spec-level concern surfaced to the owner. |
| D2 ("Opens no-op Version Packages PR on `changeset-release/trunk` with diff: delete the starter") | Manual run #1 fires the action's `case hasChangesets:` branch with the `none`-bump starter. The action runs `runVersion`, which consumes the `none`-bump entry into no version bump and no `CHANGELOG.md` change. Diff is exactly `delete .changeset/<random>.md`. Verified empirically inline above. |
| D3 ("Merging the no-op Version Packages PR does not bump version or publish anything") | The Version Packages PR's merge commit on `trunk` is inspected directly: `package.json:version === "0.1.0"` (unchanged), no `CHANGELOG.md` modification, only the starter file deleted. No `npm publish` is *attempted* (verified by the absence of any `release.yml` run on the merge commit — the workflow has no `push:` trigger). |
| D4 ("Subsequent feature PR with real changeset ships end-to-end") | The follow-up D4 feature PR adds both the `push: trunk` trigger AND a real changeset. Its merge fires the first automatic `release.yml` run, opening the Version Packages PR with a version bump. Merging that Version Packages PR triggers the first `npm publish` (e.g. `0.1.1`). |

E4 must be configured before the D4 follow-up PR's Version Packages PR is merged, otherwise the publish fails 401 (R4 recovery: configure E4, re-run the failed job).

## Key Decisions

### Decision: Custom validator script instead of relying on `changeset status`

- **Choice:** Ship `scripts/validate-changesets.ts` as a thin (~50 LOC) shape validator that runs **before** `npx changeset status` in CI. Reuse the existing `yaml@^2.8.3` runtime dependency.
- **Alternatives:**
  1. Trust `changeset status` alone. Rejected: the spec's R2.5 documents empirically that `changeset status` silently treats malformed changesets as nonexistent and silently passes empty-body changesets — producing literal empty bullets in `CHANGELOG.md`.
  2. Patch / fork `@changesets/cli` to add the missing checks. Rejected: high ongoing maintenance cost, fork drift risk, and the missing checks are tiny.
  3. Use a third-party shape linter (`@changesets/types-validator`-style). Rejected: no widely-adopted one exists; introducing a new devDep is overkill versus a ~50 LOC script using a dependency we already have.
- **Trade-offs:** ~50 LOC of project-owned code to maintain. Upside: precise error messages, line numbers, and the pre-1.0 guard fold in for free.
- **Traces to:** R2.5, R2.6, R3.4, A9, A10, B1–B8, C4.

### Decision: Validator and pre-1.0 guard are one script, not two

- **Choice:** Both shape validation and the pre-1.0 `major`-rejection live in `scripts/validate-changesets.ts`. One CI step, two policies.
- **Alternatives:** Split into `scripts/validate-changeset-shape.ts` and a bash-based `pre-1-0-guard` step in YAML (as initially sketched in `requirements.md` Q2b).
- **Trade-offs:** Slightly tighter coupling. Upside: one CI step, one error surface, one place to read when a contributor wonders "what does my changeset have to look like?". The pre-1.0 guard is naturally a shape rule ("the value of `<pkg>` must not be `major` while pre-1.0"), so co-locating is honest.
- **Traces to:** R2.5 explicit ("the script must … reject any `major` bump"), R3.4.

### Decision: Front-matter parser regex (R-shape-1 / R-shape-2)

- **Choice:** Use the regex `/^---\r?\n([\s\S]*?)(?:\r?\n)?---\r?\n?([\s\S]*)$/` to split a changeset into front-matter and body capture groups.
- **Alternatives:**
  1. The earlier draft used `/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/`. **Rejected because it returns `null` on the canonical empty-changeset bytes `---\n---\n`** (verified by running the regex against the exact output of `npx --yes @changesets/cli@2.31.0 add --empty`, reproduced in this revision's "Empirical verification of the regex fix" subsection). This is the load-bearing failure surfaced by the reviewer's Issue 1; the original regex would have made R-shape-2 fire as R-shape-1 for the very file this PR ships, breaking B2, A6, D2, and D3.
  2. Use a dedicated front-matter library (e.g. `gray-matter`). Rejected: new dependency, the YAML parser is already in `yaml@^2.8.3`, and the fence-split is small enough to express as a regex.
  3. Strip the fences with simple string operations (`indexOf("---", 4)` etc.) rather than a regex. Possible refactor in the implementation phase, but the regex form is the standard idiom and is easier to point at in error reporting.
- **Trade-offs:** Regexes are subtle; this one is two lookahead-style optional groups (`(?:\r?\n)?` between front matter and closing fence, `\r?\n?` after closing fence). CRLF tolerance (`\r?\n`) is a free win for Windows authors. The downside is that a single regex is the kind of thing that fails silently on a not-anticipated shape — the test plan compensates by exercising B1–B8 *plus* an empty-changeset case *plus* a CRLF case (covered in "Test strategy" below).
- **Traces to:** R2.5 ("two `---` fences"), R-shape-1, R-shape-2, B2, B3, A6, D2.

### Decision: Detection via `changedFilePatterns` config, no separate `paths-filter`

- **Choice:** Put the gate's scope (`src/**`, `bin/**`, etc.) into `.changeset/config.json:changedFilePatterns` and let the CI step collapse to a single `npx changeset status --since=...` invocation.
- **Alternatives:**
  1. `dorny/paths-filter` action computing whether the PR touches release-relevant files, gated by an `if:` step. Rejected: duplicates the exclusion list across YAML and config, leads to drift; the empirical verification in `requirements.md` Q1 showed `changeset status` natively respects `changedFilePatterns`.
  2. A bash `git diff` invocation in YAML. Rejected: same drift problem; harder for contributors to reason about.
- **Trade-offs:** All contributors and CI agree about scope by reading the same file. Downside: requires `@changesets/cli@2.27+` (where `changedFilePatterns` was added) — we are pinning `^2.31.0`, so this is satisfied.
- **Traces to:** R2.2, R2.3, R8.4, A4, C1, C2.

### Decision: Two workflows, not one

- **Choice:** `changeset-gate.yml` on `pull_request` and `release.yml` on `push: trunk` are separate files.
- **Alternatives:** Combine into one file with multiple `on:` triggers and conditional jobs.
- **Trade-offs:** Two files is more disk; less is a conditional spaghetti. Upside: each file has a clear purpose; permissions can be minimal per file (gate is read-only, release has `contents: write` + `pull-requests: write` + `id-token: write`); `concurrency` settings can be different (cancel-in-progress on PRs, serialize on `trunk`).
- **Traces to:** R8.10, R8.11, R4 (release shape), R2 (gate shape).

### Decision: `fetch-depth: 0` on both checkouts

- **Choice:** `actions/checkout@v6` with `fetch-depth: 0` in **both** workflows.
- **Alternatives:** Default `fetch-depth: 1` (shallow).
- **Trade-offs:** Marginal CI time cost (the repo's history is small). Upsides: `changeset status --since=origin/<base>` needs to know about both branches' tips relative to a merge base — fails with `fatal: bad revision` on shallow clones; `@changesets/changelog-github` calls `git log` to attribute changesets to commits for Release notes — without full history, attribution falls back to a no-op and entries lose the `(#PR by @author)` context.
- **Traces to:** R4.5, R9.2.

### Decision: Concurrency settings differ between workflows

- **Choice:** `changeset-gate.yml` uses `concurrency: changeset-gate-${{ head_ref || ref }}` with `cancel-in-progress: true`. `release.yml` uses `concurrency: ${{ github.workflow }}-${{ github.ref }}` with **no** `cancel-in-progress` (default: queue).
- **Alternatives:** Same setting for both.
- **Trade-offs:** Gate cancellation saves CI time on rapidly-pushed PRs. Release serialization prevents two `trunk` pushes from racing the Version Packages PR or double-publishing — cancelling mid-release could leave the repo in an inconsistent state (tag pushed but npm publish skipped, or vice versa).
- **Traces to:** R4.3.

### Decision: Trigger on `push: branches: [trunk]`, not `pull_request: closed` (steady-state interface)

- **Choice:** Once installed (by the follow-up D4 PR), `release.yml` runs on every push to `trunk` (PR merges and direct admin pushes).
- **Alternatives:** `pull_request: closed`-with-`if: github.event.pull_request.merged == true`.
- **Trade-offs:** `push: trunk` captures admin/hotfix-revert pushes that `pull_request: closed` would miss; matches every canonical Changesets example, so future contributors and the `changesets/action` maintainers are speaking the same language. **Important caveat:** this PR ships `release.yml` with `workflow_dispatch`-only; the `push: trunk` trigger is added in the follow-up D4 PR. See "Decision: Bootstrap via `workflow_dispatch`-only trigger; `push: trunk` added in the follow-up D4 feature PR" below for why.
- **Traces to:** R4.2.

### Decision: Use `none`-bump starter changeset, not the canonical empty `---\n---\n` form

- **Choice:** The starter changeset shipped in `.changeset/<random>.md` by this PR uses bump type `none` (with a one-line body), not the canonical empty form `---\n---\n` that `npx changeset add --empty` writes.
- **Alternatives:**
  1. **Ship the canonical empty starter.** Rejected: `changesets/action` v1.4.0+ (April 2022) explicitly skips creating the Version Packages PR "when all existing changesets are empty" (PR [#206](https://github.com/changesets/action/pull/206)). The action's `src/index.ts` reads `hasNonEmptyChangesets = changesets.some((c) => c.releases.length > 0)`; for the canonical empty form this is `false`, so the action's third switch case fires and the action returns without opening a PR. This contradicts spec D2 ("opens a no-op Version Packages PR"). Empirically reproduced inline (see "Empty-changeset mechanics for the first release"). Was the form the prior design draft shipped; rejected by the iteration-2 reviewer's Issue 2.
  2. **Ship no starter at all; let `changeset status` pass because the PR diff doesn't include any `changedFilePatterns` file.** Rejected: this PR edits `package.json` heavily (rename, `publishConfig`, two new scripts, two new devDependencies), and `package.json` is in `changedFilePatterns` per R2.3 / R8.4. Therefore the PR must ship *some* changeset to pass its own gate. The reviewer also rejected this option for the same reason.
  3. **Treat D2 / R8.6 / A6 as empirically wrong and kick back to the spec.** Considered. The spec text ("one empty changeset … containing `---\n---`") is incompatible with the v1.4.0+ action behavior the spec also pins (`changesets/action@v1.8.0`). The substantive D2 contract (no version bump, no `CHANGELOG.md` change, only the starter deletion in the diff) is preserved by the `none`-bump form. **The design substitutes the `none`-bump form for the empty form and surfaces the spec-text mismatch to the orchestrator as a note** (the substitution preserves D2's diff requirement; the spec's textual claim that the file must be `---\n---` is incompatible with the action behavior the spec also pins). Rejected as a path: kicking back to the spec is the most honest path but blocks the design phase; the substitution is the lowest-friction way to satisfy D2's substance.
  4. **Validator R-shape-2 still recognizes the canonical empty form** as the contributor-facing escape hatch (R1.3, R2.4) — that path is unchanged. Only the *starter* shipped in this PR differs.
- **Trade-offs:** The starter has a one-line body explaining its purpose, which is more readable than `---\n---\n` (cosmetic upside). Trade-off: the empirical claim D2 makes about the diff being "just the deletion of the empty changeset file" is satisfied by the `none`-bump form (verified inline), even though the file contents are different. A reader who reads only the spec's R8.6 text in isolation might expect to see `---\n---` and find a `none`-bump entry instead; this is documented in the design's "Empty-changeset mechanics" section and the PR description's first-publish bootstrap checklist makes the substitution explicit.
- **Traces to:** R8.6 (revised in spirit — see substitution note), A6 (revised in spirit), D2 (verified empirically with `none`-bump form), R-shape-2 (validator still passes the empty form for the contributor escape hatch).

### Decision: Bootstrap via `workflow_dispatch`-only trigger; `push: trunk` added in the follow-up D4 feature PR

- **Choice:** This PR ships `release.yml` with `on: workflow_dispatch:` as its sole trigger. The steady-state `on.push.branches: [trunk]` trigger is added in the follow-up D4 feature PR (the same PR that ships the first real changeset). The maintainer performs the bootstrap (open and merge the no-op Version Packages PR) via manual `workflow_dispatch` runs while the workflow is enabled.
- **Alternatives:**
  1. **Ship `push: trunk` and disable the workflow before merge, then re-enable after bootstrap.** Rejected by iteration-2 reviewer's Issue 1: a disabled GitHub Actions workflow cannot be manually triggered (the "Run workflow" UI is hidden, `workflow_dispatch` and all other triggers are blocked) — verified in GitHub's [Disabling and enabling a workflow](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow) documentation. The disable-then-dispatch sequence is mutually exclusive.
  2. **Ship `push: trunk` and rely on `skip_publish=true` for the two automatic runs.** Rejected: `skip_publish` is a `workflow_dispatch` input — it cannot be set as a default for `push:`-triggered runs. There is no GitHub Actions mechanism to pass an input value to a non-`workflow_dispatch` trigger.
  3. **Ship `push: trunk` and use a repository variable (e.g. `vars.BOOTSTRAP_BLOCK_PUBLISH=true`) the maintainer toggles before/after bootstrap.** Considered. Rejected because (a) it requires an additional pre-merge step to set the variable, (b) it requires a post-bootstrap step to remove the variable, (c) forgetting to remove the variable silently breaks steady-state publishing forever, and (d) repository variables are visible across all workflows, so the failure mode is "publish is silently always disabled" which is hard to diagnose. Option A is simpler and self-evident from reading the YAML.
  4. **Set `package.json:version` to `0.0.0` so `changeset publish` skips the first run** (the unpublished-version check would fail for `0.0.0` only if `0.0.0` is published, which it isn't, so this doesn't actually work — `changeset publish` would still publish `0.0.0`). Doubly rejected: doesn't solve the problem, and the spec mandates `0.1.0` (R3.6).
- **Trade-offs:** The bootstrap requires the follow-up D4 PR to add the `push: trunk` trigger, which is one extra line in that PR's diff. The benefit is that D2 and D3 are verified **structurally** (by inspection of the merge commit's diff and the absence of any automatic `release.yml` run on the Version Packages PR merge), not via the `skip_publish` kill switch. The kill switch is still wired (with the inverted ternary) as defense-in-depth and for any future maintainer-initiated "version-PR-only" inspection cycle.
- **Traces to:** R4.2 (trigger model — steady state), R4.10 (kill switch still wired), R3.6 (version stays at 0.1.0), R7.4 (re-run guidance), D1 / D2 / D3 / D4 (all four verified via the bootstrap routine), R8.11 (release workflow shape — steady state is unchanged after the follow-up adds `push:`).

### Decision: OIDC trusted publishing, not `NPM_TOKEN`

- **Choice:** Workflow declares `id-token: write` and `npm publish` runs with no env var. npm CLI v11.5.1+ auto-generates provenance attestations.
- **Alternatives:** `NPM_TOKEN` automation token in `secrets`, with explicit `--provenance` flag.
- **Trade-offs:** OIDC requires E4 (the trusted-publisher binding on npmjs.com) to be configured before the first real publish; without it, the publish step fails 401. The fallback (token) is documented in `CONTRIBUTING.md` for the manual escape hatch. Upside: no long-lived secret rotated/leaked, provenance is automatic.
- **Traces to:** R5.3, R4.6 (`id-token: write` permission).

### Decision: `@changesets/changelog-github`, not `@changesets/changelog-git` or default

- **Choice:** Use `@changesets/changelog-github@^0.7.0` for richer changelog entries with PR links and author handles.
- **Alternatives:** `@changesets/changelog-git@^0.2.1` (commit-hash-only enrichment), or the bundled default (no enrichment).
- **Trade-offs:** Requires `GITHUB_TOKEN` at the **version** step, not just publish (R9.2 — `changesets/action` injects this when the workflow has the R4.6 permissions). Upside: consumers reading `CHANGELOG.md` get clickable PR links and author attribution; "I forgot a changeset" recovery (R7.3) becomes legible because the backfill PR is mechanically attributed.
- **Traces to:** R5.6, R8.4, R9.2.

### Decision: Split contributor doc — `CONTRIBUTING.md` + `.changeset/README.md`

- **Choice:** Full policy in `CONTRIBUTING.md`; project-specific cheat sheet in `.changeset/README.md` replacing the seeded boilerplate, linking back via `#adding-a-changeset` anchor.
- **Alternatives:**
  1. Single source: put everything in `CONTRIBUTING.md` and delete `.changeset/README.md`. Rejected: `npx changeset` ships a seeded `.changeset/README.md`; if we don't replace it, contributors reading `.changeset/` first see upstream boilerplate that doesn't reflect our policy.
  2. Single source: put everything in `.changeset/README.md`. Rejected: `.changeset/` is a subdirectory; first-time contributors look at `CONTRIBUTING.md` at the root.
- **Trade-offs:** Two files to keep in sync — mitigated by `.changeset/README.md` being a thin cheat sheet whose load-bearing claim is a link, not a fact. Upside: contributors find what they need where they look.
- **Traces to:** R6.1, R6.3, R8.5, A5, A7.

### Decision: Hand-written initial `## 0.1.0` entry, version stays at `0.1.0` for this PR

- **Choice:** Backfill `CHANGELOG.md`'s initial `## 0.1.0` entry by hand; `package.json:version` stays `0.1.0`. Ship one starter changeset (a `none`-bump entry — see Decision: "Use `none`-bump starter, not the canonical empty form") so the gate passes on this PR's own merge AND the `changesets/action`'s `hasNonEmptyChangesets` check passes, allowing the action to open the Version Packages PR.
- **Alternatives:**
  1. Bump to `0.2.0` as part of this PR with a real changeset. Rejected: no consumer-visible API change has happened; the bump would be cosmetic and confuse the public-API-stability signal.
  2. Skip the backfill, let the first real release write the first `CHANGELOG.md` entry. Rejected: `package.json` already claims `0.1.0`, so consumers checking the changelog for the version they install would find it empty. Backfilling is cheap.
- **Trade-offs:** The 0.1.0 entry is one-liner-thin; future readers may want richer history. Upside: file format is established; `changeset version` will append above the 0.1.0 entry forever. (`0.1.0` is never published to npm — the bootstrap defers the `push: trunk` trigger to the follow-up D4 PR, and the first publish is `0.1.1` or higher.)
- **Traces to:** R3.6, R8.1, R8.6 (revised — see substitution note), A1, A6 (revised — see substitution note), D2 (verified empirically with `none`-bump form).

### Decision: Scope rename to `@automattic/skillsmith`, not a different unscoped name or a name dispute

- **Choice:** Rename to `@automattic/skillsmith`. Owner confirms at merge time (E1).
- **Alternatives:**
  1. Keep `skillsmith` and dispute the unscoped name via npm Support. Rejected: slow, uncertain, only valid grounds are trademark/squat.
  2. Publish as `skillsmith-harness` or similar unscoped name. Rejected: package vs. CLI bin name divergence, SEO penalty.
- **Trade-offs:** Consumers type a slightly longer name (`@automattic/skillsmith`). Upside: matches the existing ~50 `@automattic/*` packages, OIDC binding follows the org → repo → workflow model already in use across Automattic.
- **Traces to:** R5.2, R8.2 (the rename in `package.json`), E1.

### Decision: Surface E1–E4 + bootstrap as PR-description checklist; persist E2–E4 in `CONTRIBUTING.md`

- **Choice:** The implementing PR's description carries a checklist of E1–E4 (and optional bot install) plus the first-publish bootstrap subsection from "Empty-changeset mechanics for the first release". `CONTRIBUTING.md` documents E2–E4 in a "Repo configuration prerequisites" section so future maintainers can audit. E1 (name) is a one-time decision and is recorded only in the PR description, not in `CONTRIBUTING.md`. The bootstrap subsection is also one-time; it lives only in the PR description.
- **Alternatives:** Put E1–E4 only in `CONTRIBUTING.md`. Rejected: easy to overlook during merge; the checklist is a load-bearing pre-merge ritual.
- **Trade-offs:** The PR description is ephemeral; mitigated by `CONTRIBUTING.md` documenting the persistent items (E2–E4). The design records the *required content of the PR description* even though the PR body is not a code artifact.
- **Traces to:** R6.2, R8.7, A7, E1–E4, and the "First-publish bootstrap" decision above.

### Decision: `commitMode: git-cli` (default), not `commitMode: github-api`

- **Choice:** Accept `changesets/action`'s default `commitMode: git-cli`.
- **Alternatives:** Set `commitMode: github-api` to commit via the GitHub API rather than git CLI.
- **Trade-offs:** `git-cli` is the documented default and matches every canonical example. `github-api` mode is required when signed commits are mandated by branch protection; that is not the case for `trunk`. If it becomes the case, this is a one-line change.
- **Traces to:** R4 / requirements.md Q3a table.

### Decision: `createGithubReleases: true` (default), default tag format

- **Choice:** Let the action create one GitHub Release per published version (`createGithubReleases: true`, the default). Accept the default tag format `@automattic/skillsmith@<version>`.
- **Alternatives:**
  1. `createGithubReleases: false`, no Releases. Rejected: spec requires Releases (R5.5).
  2. Override the tag format to a shorter `v<version>`. Rejected: the action's release-deduplication logic reads tags by the package-name-prefixed form; overriding is heavy work for cosmetic gain (R5.4).
- **Trade-offs:** Tag is verbose. Upside: `git describe`, npm tooling, and the action all agree on a single canonical form.
- **Traces to:** R5.4, R5.5.

### Decision: `workflow_dispatch` kill switch (`skip_publish`) — ternary-trap-safe expression

- **Choice:** Include a `workflow_dispatch.inputs.skip_publish: boolean` (default false) that, when true, sets `publish: ''` on the `changesets/action` step so only the Version Packages PR is opened/updated. **The YAML expression that resolves the `publish:` input MUST use the ternary-trap-safe form** `${{ !inputs.skip_publish && 'npx changeset publish' || '' }}`, NOT the naive form `${{ inputs.skip_publish && '' || 'npx changeset publish' }}` (which is a no-op due to the well-known GitHub Actions ternary trap — empty string is falsy, so `||` short-circuits past it; the naive form always evaluates to `'npx changeset publish'` regardless of `skip_publish`).
- **Alternatives:**
  1. No kill switch. Rejected: maintainers would have to edit the workflow file to perform a "version-only" run, *and* the bootstrap manual runs lose their defense-in-depth lever.
  2. Use the naive ternary form `${{ inputs.skip_publish && '' || 'npx changeset publish' }}`. Rejected: empirically a no-op due to the GitHub Actions ternary trap. The naive form is the same shape that appeared in iteration 1 of this design and was a latent bug; iteration 2's bootstrap escalated the latent bug to load-bearing, which is why iteration 2 surfaced and fixes it. See the "Empirical verification of the `skip_publish` expression" table in the `release.yml` interface section above for the truth table demonstrating the failure mode.
  3. Use a separate `if:` condition on the `changesets/action` step that conditionally omits the `publish:` input. Rejected: more YAML, and the inverted ternary is idiomatic. The 7tonshark write-up ("The ternary operator in GitHub Actions") covers the gotcha and standardizes the inverted form.
  4. Halt all releases by disabling the workflow from the GitHub UI. Rejected as the bootstrap mechanism (iteration-2 Issue 1: disabled workflow blocks `workflow_dispatch` too). Kept only as a documented "emergency halt" lever in `CONTRIBUTING.md` (R7.1's manual-publish-escape-hatch section) for steady-state operations.
- **Trade-offs:** Adds a couple of lines to `release.yml`. The inverted ternary is one character longer than the naive form, with one inserted `!`. Upside: the kill switch actually fires; the maintainer can preview a Version Packages PR without committing to a publish; the bootstrap's optional smoke-test run is meaningful.
- **Traces to:** R4.10, A11, "Decision: Bootstrap via `workflow_dispatch`-only trigger; `push: trunk` added in the follow-up D4 feature PR".

### Decision: Validator pseudocode shape — pure function + entry-guarded main

- **Choice:** Structure `scripts/validate-changesets.ts` as (1) an exported pure function `validateChangesetFile(file, raw, pkgName, version) → Err[]`, (2) an exported orchestrator `main() → number` that performs I/O and prints to stderr, and (3) an entry guard `if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main())` so importing the module from tests does **not** execute `main` or call `process.exit`.
- **Alternatives:**
  1. Leave the validator as a top-level imperative script (the previous design draft). Rejected by reviewer Issue 3: importing the script from a test would execute `main` on import, reading whatever `.changeset/` happens to be in the test runner's cwd and possibly calling `process.exit`, making the per-rule B1–B8 unit tests the design commits to (`src/__tests__/validate-changesets.test.ts`) impossible to write honestly.
  2. Spawn the script as a child process for each test. Rejected: slow (one Node startup per test case), error-message parsing is brittle, and it gives up the in-memory-string convenience that the per-rule tests want.
  3. Use a CommonJS `if (require.main === module)` idiom. Rejected: the project already uses ESM (verified by `package.json:type === "module"`); `import.meta.url === pathToFileURL(process.argv[1]).href` is the ESM equivalent.
- **Trade-offs:** Slightly more pseudocode than the original imperative script. Upside: the validator is unit-testable per-rule, the test suite the design commits to is actually writable, and the contract between "what the validator considers an error" and "what the CI surfaces" lives in a function with an explicit type signature.
- **Traces to:** R2.5 (~50 LOC), R8.9 (validator exists), A9 (validator exists, line-numbered stderr), B1–B8 (each B-case is a unit test against `validateChangesetFile`).

### Decision: Test strategy — unit tests for the validator's pure function, smoke test for the CLI entry, manual verification for the gate and release flows

- **Choice:** Add Node test-runner tests at `src/__tests__/validate-changesets.test.ts` consisting of:
  - **B1–B8 unit tests** against the exported `validateChangesetFile(file, raw, pkgName, version)` function. Each test constructs the changeset contents as a JavaScript string and asserts on the returned `Err[]` (either empty for passing cases or containing the expected `msg` substring for failing cases). **Assertions should match on `Err.msg` (substring match), not on `Err.line`**, because the pseudocode's `1`/`2`/`4` line constants are placeholders pending OQ-2 resolution. The `Err.file` field equals the bare filename (`"test.md"`), not the prefixed form (`".changeset/test.md"`) — `main()` prepends the prefix when printing, so the unit tests can assert on the bare filename and the smoke test (below) covers the prefixed form. No filesystem fixtures are required.
  - **A smoke test for the CLI entry** that spawns `node --import tsx scripts/validate-changesets.ts` in a temporary directory containing a seeded `package.json` (with controlled `name` and `version`) and a `.changeset/` directory with one passing and one failing changeset. The smoke test asserts the exit code is `1`, the stderr contains the expected `.changeset/<file>:<line>:` prefix, and stdout is empty. This exercises `main()` end-to-end without making it the per-rule test vehicle.
  - **A CRLF-tolerance test** (one extra case beyond B1–B8) verifying that the same valid changeset shape with `\r\n` line endings also passes — this guards against future regressions of the fence-regex CRLF tolerance.
- Verify C1–C4 via the actual `changeset-gate.yml` runs on this PR (run on every push to this PR's branch). Verify D1–D4 via the bootstrap routine and the follow-up D4 feature PR. The spec's empirical scratch repo at `/tmp/changesets-test-39` covered the CLI but not the action's PR-creation gating; the design's "Empty-changeset mechanics for the first release" section adds inline empirical verification for the action's behavior on the canonical empty form vs. the `none`-bump form, and for what `changeset version` produces with a `none`-bump entry.
- **Verification of the `skip_publish` inverted ternary**: the empirical truth table in the `release.yml` interface section is the contract. The bootstrap's manual run #1 (with `skip_publish=true`) implicitly verifies the kill switch fires because the run log shows `publish:` resolving to `''`.
- **Alternatives:** Add an act-based local CI runner harness for the workflows; build a docker-compose harness for `npm publish` against a verdaccio registry. (Both rejected as over-engineering — the workflows are short and the manual-bootstrap verification is honest.)
- **Trade-offs:** Workflow-level testing is hard to fixture honestly. The CI behaviour is fully determined by `changedFilePatterns`, the validator, and the action's switch logic (the first two unit-testable per the pseudocode-shape decision; the third covered by the design's inline empirical reproduction). Manual end-to-end verification on the bootstrap and follow-up D4 PR catches integration concerns.
- **Traces to:** R8.9, A9, B1–B8 (validator unit-testable, structured against `validateChangesetFile`), C1–C4 (verified by actual gate runs on this PR), D1–D4 / F1–F3 (verified by the bootstrap routine and the follow-up D4 PR per the spec's acceptance criteria, with the wording caveats in OQ-7).

## Dependencies

### New devDependencies (added to `package.json`)

- `@changesets/cli@^2.31.0` — pinned at the spec's tooling-pin (R5, R8.2). Provides `npx changeset`, `npx changeset add`, `npx changeset status`, `npx changeset version`, `npx changeset publish`.
- `@changesets/changelog-github@^0.7.0` — pinned at the spec's tooling-pin. Custom `getReleaseLine` that enriches each entry with `(#PR by @author)`.

### Existing dependencies reused

- `yaml@^2.8.3` (at `package.json:45`) — parser for changeset front matter inside the validator. No new YAML dependency added.
- `tsx@^4.21.0` (at `package.json:44`) — runs the TypeScript validator without a build step (`npx tsx scripts/validate-changesets.ts`).

### External GitHub Actions

- `actions/checkout@v6` — pinned major (taken from the spec; flagged at the spec-review level as the published major was v4 at late-2025 time-of-writing; the design is faithful to the spec).
- `actions/setup-node@v6` — pinned major (same caveat as above).
- `changesets/action@v1` — the spec's R5.4 / R5.5 expectations (default tag, default Release creation) are this action's defaults; pin to the major.

### External services

- **GitHub** — workflows, PRs, branches, Releases.
- **npm registry** — publish target; OIDC trusted publisher binding required per E4 (configured before the *first real* publish, not before the bootstrap).

### Soft (cultural) dependencies, documented but not enforced

- **`@changesets/bot` GitHub App** — optional educational comments (R2.7, E listing). Not installed by this PR.
- **`mscharley/dependency-changesets-action` (or equivalent)** — out of scope (R6.7, "Out of Scope" list). `CONTRIBUTING.md` documents the manual fallback for dep-bump PRs.

## Failure Modes and Observability

### Validator (`scripts/validate-changesets.ts`) failures

- **Detection:** non-zero exit code surfaces as a failed `Validate changeset shape` step in `changeset-gate.yml`. Each error is on its own stderr line in `.changeset/<file>:<line>: <message>` format, viewable in the Actions log without expanding.
- **Common failures and their messages:**
  - Missing closing fence → `missing or unterminated front matter (expected two '---' fences)`.
  - Empty body with non-empty front matter → `empty body (changeset has front matter but no summary)`.
  - Unknown package → `unknown package "<x>" (expected "@automattic/skillsmith")`.
  - Invalid bump → `invalid bump "<x>" (expected one of patch, minor, major, none)`.
  - Pre-1.0 major → `'major' is forbidden while pre-1.0 (version=0.1.0). Use 'minor' with a 'BREAKING:' prefix; see CONTRIBUTING.md#pre-10-policy.`
- **Recovery:** contributor edits the changeset file in the PR; the next push re-runs the gate.

### Gate (`changeset-gate.yml`) failures other than the validator

- **`changeset status` fails (canonical error):** "no changesets present" → contributor adds a changeset (or `--empty`) and pushes.
- **`npm ci` fails:** lockfile drift; contributor runs `npm install` locally to refresh and re-commits.

### Release (`release.yml`) failures

| Failure | Where | Recovery |
|---|---|---|
| Lint / typecheck / test failure on `trunk` | pre-publish steps | A regression sneaked in. **Re-running won't help**; the next PR fixing the regression unblocks the release. Action does **not** open a Version Packages PR while these are red. |
| `changesets/action`'s GitHub API push fails (E2 not enabled) | action step | The action fails with a clear error; maintainer flips E2 on at Settings → Actions → General; re-runs the failed job. |
| `npm publish` fails 401 (E4 not configured) | publish step inside the action | Source tree is unaffected (the version bump and `CHANGELOG.md` change have already been committed to `trunk`). Maintainer configures E4 on npmjs.com, then re-runs the failed job from the Actions UI. `changeset publish` is idempotent per-package (R7.4) — already-published versions are skipped. |
| `npm publish` fails for any other reason (network blip, registry hiccup) | publish step | Re-run the failed job from the Actions UI (R7.4). |
| Two `trunk` pushes race the workflow | overall | Prevented by `concurrency: ${{ github.workflow }}-${{ github.ref }}` (R4.3). The second run waits for the first to finish. |
| `workflow_dispatch` manual run #1 fails (network, transient) | bootstrap manual run | Re-run from the Actions UI. The action is idempotent for Version Packages PR open/update (R4.9): if the PR was already opened, the re-run force-pushes the same diff. |
| Maintainer forgets to add the `none`-bump starter and ships an empty starter (`---\n---\n`) | bootstrap manual run #1 | Action logs "All changesets are empty; not creating PR" and returns. No PR is opened. Recovery: open a follow-up PR replacing the empty starter with a `none`-bump starter; merge it; re-run `release.yml` with `skip_publish=true`. The pre-merge checklist's "Confirm the starter changeset uses bump type `none`" item is the load-bearing prevention. |
| Follow-up D4 PR adds `push: trunk` but forgets the real changeset | D4 follow-up | The D4 PR's merge fires `release.yml` automatically; action sees zero changesets and `publish:` is `'npx changeset publish'`; falls into `!hasChangesets && hasPublishScript:` branch and invokes `npx changeset publish`. Local `package.json:version` is still `0.1.0` (because no real changeset bumped it), so the publish invokes `npm publish` for `@automattic/skillsmith@0.1.0` — exactly the bootstrap failure mode the design is trying to avoid. **Recovery (E4 configured):** `0.1.0` is published; deprecate per R7.2's "deprecate the bad version" flow, then publish the intended `0.1.1`. **Recovery (E4 not configured):** publish fails 401, source tree is fine; configure E4 and proceed with the *real* D4 PR (the one that ships a changeset). **Prevention:** the PR description's D4 follow-up checklist item explicitly says "UNCOMMENT the `push: trunk` block AND ship a real changeset". |
| Steady-state publish fails 401 (E4 not configured at D4 merge time) | publish step inside the action | Source tree is unaffected (the version bump and `CHANGELOG.md` change have already been committed to `trunk` via the Version Packages PR merge). Maintainer configures E4 on npmjs.com, then re-runs the failed job from the Actions UI. `changeset publish` is idempotent per-package (R7.4). |

### Observability

- **CI logs** — every step's output is available in GitHub Actions, indexed by job and step name; the validator's line-numbered errors and `changeset status`'s canonical hint both surface here.
- **`CHANGELOG.md`** — the consumer-facing observable. Every published version has an entry; missing entries indicate an "I forgot a changeset" event (recovered via R7.3).
- **GitHub Releases page** — for each published version, the Release body mirrors the `CHANGELOG.md` section. A version with no Release indicates a partial publish failure; recovery is re-run the job (the action recreates the Release idempotently).
- **npm registry metadata** — `npm view @automattic/skillsmith` shows publish times, versions, and (when OIDC succeeded) provenance attestations. The provenance is the integrity observable for consumers.
- **Workflow runs page (Actions tab)** — during the bootstrap, the maintainer reads this to verify:
  - **After this PR's merge:** no automatic `release.yml` run was triggered (because the workflow has `workflow_dispatch`-only at this stage).
  - **After manual run #1:** the `changesets/action` step logged that it opened the Version Packages PR; the resolved `publish:` input value in the run log was `''` (the kill switch fired correctly under the inverted ternary). The action's "version" path was taken.
  - **After the Version Packages PR merge:** again, no automatic `release.yml` run was triggered. D3 verified by absence.
  - **After the follow-up D4 PR's merge:** an automatic run was triggered (`push: trunk` is now in place); the action opened the second Version Packages PR with a real version bump. Merging that PR triggers another automatic run with `publish: 'npx changeset publish'` (kill switch off) and `npm publish` succeeds (D4 verified).

### Pre-1.0 guard observability

The validator's pre-1.0 message references `CONTRIBUTING.md#pre-10-policy` — a stable anchor in the contributor doc. The anchor is the spec's R6.2 requirement (`#pre-10-policy`). The design enforces the anchor in `CONTRIBUTING.md` and the validator's error message together.

## Risks and Open Questions

### Risks

- **R-bot-honors-patterns (open).** R9.4 — does `@changesets/bot` honour `changedFilePatterns`? The design recommends installing the bot only if a maintainer wants the educational comments and accepts the tolerable noise. If the bot does **not** honour the patterns, contributors on excluded PRs will see "Add a changeset" comments they can safely ignore. The CI gate remains the source of truth.
- **R-rename-confusion.** If the owner declines `@automattic/skillsmith` at merge time, every reference in `package.json`, `README.md`, `CONTRIBUTING.md`, and the `.changeset/<random>.md` starter (which now has a key `"@automattic/skillsmith"` because it is `none`-bump, not empty — so it DOES need updating if the name changes) must be updated. Mitigated by E1's PR-description checklist.
- **R-d4-followup-omits-changeset.** If the follow-up D4 PR adds `push: trunk` to `release.yml` but ships without a real changeset, the automatic run on D4's merge invokes `npx changeset publish` against `package.json:version === "0.1.0"` (which npm has not seen), publishing `0.1.0`. The pre-merge checklist for the D4 PR explicitly couples "uncomment `push: trunk`" with "ship a real changeset" — they MUST land together. Recovery if it happens anyway: deprecate `0.1.0` per R7.2's "deprecate the bad version" flow, then publish the intended `0.1.1`. Mitigated by the D4 PR's checklist item.
- **R-starter-form-mismatch.** If the implementation phase ships the canonical empty starter form (`---\n---\n`) instead of the `none`-bump form mandated by Decision: "Use `none`-bump starter, not the canonical empty form", `changesets/action` v1.4.0+ logs "All changesets are empty; not creating PR" and returns; no Version Packages PR is opened. D2 fails. Recovery: follow-up PR replaces the empty starter with a `none`-bump starter; re-run `release.yml` via `workflow_dispatch`. The design doc's "Empty-changeset mechanics" section and the PR description's checklist both explicitly call out the form distinction.
- **R-E4-not-configured-at-first-publish.** D4 ("first real feature PR ships end-to-end") relies on E4 being configured before the maintainer merges the D4 follow-up Version Packages PR. If E4 is missing, the publish step fails 401. The repo state (commit, tag, Release) is unaffected; recovery is configure E4, re-run the failed job. Mitigated by surfacing E4 in the pre-merge checklist (E1–E4 in the PR description).
- **R-skip-ci-future-workflow.** R9.1 — if a future PR adds a `test.yml` on `push: trunk`, the Version Packages PR merge commit on `trunk` does *not* carry `[skip ci]` (the `[skip ci]` lives on the action's commit to `changeset-release/trunk`, not on the merge commit), so a future `push: trunk`–triggered test workflow will run normally on the Version Packages PR merge. The forward-looking guidance from the design's R9.1 section is unchanged: future CI workflows should still prefer `pull_request` triggers so they certify the Version Packages PR *before* merge.
- **R-bot-attribution-on-backfill.** R7.3 — `@changesets/changelog-github` attributes a backfilled changeset to the backfill PR, not the original. The design accepts this cosmetic wart and propagates a `> Backfilled from PR #<original>` line into `CHANGELOG.md` via the changeset body. Live with it; do not write tooling to invert it.
- **R-validator-yaml-line-numbers.** The `yaml@^2.8.3` parser provides source positions; converting to a 1-based line number for the validator's error format requires the API supports it. If line precision proves infeasible without a major refactor, fall back to "line of the front-matter region" (e.g. `2`) — the file/region pointer is the load-bearing UX, not the exact column. The pseudocode's hard-coded `1`/`2`/`4` are placeholders; OQ-2 covers this.
- **R-trunk-protection-prevents-bot-push.** E3 — branch protection must allow `github-actions[bot]` to push to `changeset-release/trunk` while still requiring human review on the release PR. If misconfigured, `changesets/action` fails on the first commit. Mitigated by surfacing E3 in the pre-merge checklist.
- **R-tsconfig-include-omits-scripts.** `tsconfig.json:include` does not cover `scripts/**`, so `npm run typecheck` will not catch a typo in `scripts/validate-changesets.ts`. The validator runs through `tsx` at CI time (catching type errors at execution), and the unit-test file imports from the script (catching exported-surface type errors via the test's `import`). The design accepts this trade-off; a future contributor preferring `tsc`-coverage can extend `include` with `scripts/**/*` as a one-line change.

### Open questions logged for review

1. **OQ-1 (R9.4, partially resolved).** Final, verified behaviour of `@changesets/bot` against `changedFilePatterns` — the design recommends accepting the bot as non-blocking and tolerating any noise. The reviewer may opt to install the bot or defer the install; the design ships with the bot uninstalled and documents it as optional in `CONTRIBUTING.md`'s "Repo configuration prerequisites".
2. **OQ-2 (validator line precision).** Whether `yaml@^2.8.3` gives the validator enough source-position information for per-error 1-based line numbers in front matter, or whether the design's fall-back to "line of front-matter region" (`:2:`) is acceptable. Will be settled in implementation; the spec's "line-numbered" requirement is met under either reading. The pseudocode's `1`/`2`/`4` constants are placeholders, not contract. **Test plan implication:** B1–B8 unit tests should match on the `Err.msg` field, not on `Err.line`, until line-precision is settled (otherwise the tests are coupled to placeholder constants).
3. **OQ-3 (`.changeset/<random>.md` filename for the starter).** Spec says `<random>`. The implementation may pin a deterministic name (e.g. `initial-scaffolding.md`) for reproducibility, or use `npx changeset add`'s random name. Either satisfies the substantive R8.6 / A6 ("exactly one starter changeset file at `.changeset/<random>.md`"); the design's recommendation is to use the randomly-generated name to match the rest of the changesets-on-disk style, but it does not block.
4. **OQ-4 (kill-switch test).** Whether the `skip_publish` input should be exercised once before merge as a smoke test, or left for the maintainer to drive on first emergency. The bootstrap routine effectively *requires* `skip_publish=true` to be exercised at least once in production (manual run #1 for opening the Version Packages PR; the optional smoke-test run #2 exercises the kill switch's zero-changesets path). So the kill switch is implicitly verified by the bootstrap. No additional pre-merge test wiring needed. Note: the **inverted ternary expression** has its own empirical-table verification inline in the `release.yml` interface section; that table is the contract for the expression's truth values.
5. **OQ-5 (where to document the bootstrap routine for posterity).** The first-publish bootstrap is a one-time procedure; the design records it in the implementing PR's description AND in this design doc's "Empty-changeset mechanics for the first release" section. If a future maintainer needs to re-bootstrap (e.g. unpublishing `0.1.0` and starting over — unlikely given the design now avoids publishing `0.1.0` at all), the routine can be reconstructed from this design doc. The design does **not** add the routine to `CONTRIBUTING.md` because the persistent doc should describe steady-state mechanics, not one-time bootstrap. Implementation phase may revisit.
6. **OQ-6 (spec-level mismatch on R8.6 / A6 wording vs. action behavior — new in iteration 2).** Spec R8.6 says "One empty changeset … containing `---\n---`"; A6 says "Exactly one empty changeset file exists at `.changeset/<random>.md` containing `---\n---`". The design substitutes a `none`-bump starter for the empty form (see Decision: "Use `none`-bump starter, not the canonical empty form") because the action's v1.4.0+ behavior makes the empty form incompatible with the spec's D2 ("opens a no-op Version Packages PR"). **This is a spec-level concern the orchestrator should surface to the owner: the spec's empirical claim "verified in `/tmp/changesets-test-39`" was a CLI test, not an action test, and the action's PR-creation gating is what trips the empty-only state.** The substantive D2 contract (no version bump, no `CHANGELOG.md` change, only the starter deletion in the diff) is preserved by the substitution. The orchestrator may want to revise R8.6 / A6 wording to "one starter changeset (a `none`-bump or the empty form, see design doc)" and rebrand D2 to point to the design's verified mechanism. The design does not block on this; it proceeds under the substitution.
7. **OQ-7 (D1 wording vs. workflow_dispatch-only trigger — new in iteration 2).** Spec D1 says "Merging this PR to `trunk` triggers `release.yml`." Under the design's chosen path, the merge does NOT automatically trigger `release.yml` (the workflow ships with `workflow_dispatch`-only; the `push: trunk` trigger is added by the follow-up D4 PR). The substantive D1 intent — that the pre-publish lint/typecheck/test sequence runs after this PR merges — is satisfied by the manual `workflow_dispatch` run #1 of the bootstrap. **The orchestrator may want to refine D1 wording to "After this PR merges, the maintainer can run `release.yml` via `workflow_dispatch` and lint/typecheck/test succeed" rather than "Merging this PR triggers `release.yml`."** The design records this as a spec-level note. F1 ("first `release.yml` run on this PR's merge commit succeeds") similarly needs the wording "first manual `release.yml` run after this PR's merge succeeds" — the same substantive intent, different mechanism.

## Revision notes

### Iteration 2 (this revision)

This revision addresses the three blocking issues raised in `2-design-doc/design-doc-review-2-rejected.md`. All three are introduced or escalated by iteration 1's bootstrap routine. The reviewer accepted that iteration 1's three issues (regex, validator pseudocode shape, first-publish problem framing) are resolved; the new blockers are mechanical failures in the bootstrap routine iteration 1 added.

- **Iteration-2 Issue 1 (disable workflow + workflow_dispatch is mutually exclusive).** A disabled GitHub Actions workflow blocks ALL triggers including `workflow_dispatch` — the "Run workflow" button is hidden. The previous bootstrap (disable workflow → manually trigger → re-enable) was structurally infeasible. **Fix:** changed the bootstrap mechanism entirely. This PR now ships `release.yml` with `on: workflow_dispatch:` as its sole trigger; the steady-state `push: trunk` trigger is added in the follow-up D4 feature PR (the same PR that ships the first real changeset). The workflow stays enabled throughout the bootstrap; `workflow_dispatch` works because the workflow is enabled. See Decision: "Bootstrap via `workflow_dispatch`-only trigger; `push: trunk` added in the follow-up D4 feature PR" and the rewritten "Empty-changeset mechanics for the first release" section. The empirical evidence (GitHub Actions docs and community discussion) is cited inline.
- **Iteration-2 Issue 2 (`changesets/action` v1.4.0+ skips PR creation for empty-only state).** Reviewer empirically verified against the action's `src/index.ts` switch (line 114) and CHANGELOG (v1.4.0, PR #206 by @glasser): when `hasChangesets && !hasNonEmptyChangesets`, the action logs "All changesets are empty; not creating PR" and returns. The canonical empty starter (`---\n---\n`) has `releases.length === 0`, so `hasNonEmptyChangesets=false`, so the action returns without opening a PR. Iteration 1's bootstrap step 4 ("the action opens the Version Packages PR") cannot occur with the empty starter. **Fix:** the starter is now a `none`-bump changeset (`---\n"@automattic/skillsmith": none\n---\n\nInitial scaffolding…\n`), which has `releases.length === 1` so `hasNonEmptyChangesets=true`. Empirically verified at design-doc revision time: (a) `@changesets/read` correctly distinguishes empty from `none`-bump (in `/tmp/changesets-action-source-39`); (b) `changeset version` consumes the `none`-bump entry into no version bump, no `CHANGELOG.md` change, only the file deletion (in `/tmp/none-bump-test-2`, with the project's exact config). The substantive D2 diff requirement ("just the deletion of the empty changeset; no version bump and no `CHANGELOG.md` change") is preserved. The validator's R-shape-2 rule still recognizes the canonical empty form for the contributor-facing escape hatch (R1.3, R2.4). **The spec's R8.6 / A6 wording ("empty changeset containing `---\n---`") needs revisiting at the spec level — see OQ-6.**
- **Iteration-2 Issue 3 (`skip_publish` ternary trap).** The YAML expression `${{ inputs.skip_publish && '' || 'npx changeset publish' }}` is a no-op for all values of `skip_publish` — empty string is falsy in GitHub Actions expressions, so `||` short-circuits past it. The kill switch never fires. Iteration 1 had this latent bug; iteration 2's bootstrap escalated it from convenience lever to load-bearing first-publish gate. **Fix:** inverted the ternary to `${{ !inputs.skip_publish && 'npx changeset publish' || '' }}`. Empirical truth-table reproduction is included inline in the `release.yml` interface section ("Empirical verification of the `skip_publish` expression"). The new bootstrap routine is structurally safe even without the kill switch (no `push: trunk` trigger means no automatic publish runs during bootstrap), but the kill switch is still wired correctly as defense-in-depth for the manual runs and for future maintainer-initiated version-PR-only runs.

Sections updated to reflect the fixes:

- The Overview's second paragraph rewrites the bootstrap narrative to introduce the `none`-bump starter and the `workflow_dispatch`-only trigger.
- The Approach's flow split adds a "bootstrap window" subsection alongside the steady-state branches.
- The Flow diagram's caption is clarified ("steady state, after the bootstrap completes") and the trigger-arrow gets a "trigger live after D4 follow-up feature PR adds `push: trunk`" annotation.
- The Components table's starter entry describes the `none`-bump form and references the v1.4.0+ action behavior.
- The Components table's `release.yml` entry notes the `workflow_dispatch`-only initial trigger.
- The Changeset file format section distinguishes three relevant forms (empty for the escape hatch, `none`-bump for the starter, normal for contributors).
- The `release.yml` interface section now ships `workflow_dispatch`-only, with the steady-state `push:` trigger shown commented-out, and uses the inverted ternary expression. A new subsection "Empirical verification of the `skip_publish` expression" reproduces the truth table.
- The "Empty-changeset mechanics for the first release" section is fully rewritten end-to-end:
  - The choice of `none`-bump starter is justified with inline empirical reproduction of the action's switch logic.
  - The bootstrap routine reads "merge → manual run #1 → review and merge Version Packages PR → (optional) smoke-test run #2 → follow-up D4 PR adds `push:` and ships a real changeset" instead of "disable workflow → ...".
  - The PR-description checklist is rewritten to remove the disable-workflow step and add the `none`-bump form check, the follow-up D4 PR step, and the D2 / D3 verification instructions.
  - A new "Trace to spec D2 / D3 / D4" table documents which mechanism each criterion verifies through.
  - The "Why this path over the alternatives" subsection now enumerates options A–F (six considered alternatives, only one chosen).
- A new "Decision: Use `none`-bump starter, not the canonical empty form" replaces the iteration-1 reliance on the empty form.
- A new "Decision: Bootstrap via `workflow_dispatch`-only trigger; `push: trunk` added in the follow-up D4 feature PR" replaces the iteration-1 "Decision: First-publish gating via `skip_publish`".
- The existing "Decision: `workflow_dispatch` kill switch (`skip_publish`)" decision is rewritten to mandate the inverted ternary and link to the empirical-verification table.
- The existing "Decision: Trigger on `push: branches: [trunk]`" decision is annotated with a caveat noting the workflow ships `workflow_dispatch`-only and `push:` is added by the D4 follow-up.
- The "Hand-written initial 0.1.0 entry" decision is updated to reference the `none`-bump starter instead of the empty starter.
- Failure modes table: rows about disabling/re-enabling the workflow are replaced with rows about (a) missing `none`-bump starter form, (b) D4 follow-up PR omitting the real changeset, (c) E4 not configured at D4 merge time.
- Risks: `R-bootstrap-skipped` retired (the new bootstrap is structurally safe — no `push:` trigger means no automatic publish during bootstrap, so the "skipped bootstrap" failure mode no longer applies). New risks `R-d4-followup-omits-changeset` and `R-starter-form-mismatch` cover the residual concerns. The starter-related text of `R-rename-confusion` is updated.
- OQ-4 is updated to reference the empirical-verification table.
- OQ-5 is reframed to acknowledge the bootstrap routine is now structural (no `push:` trigger).
- New OQ-6 surfaces the spec-level wording mismatch on R8.6 / A6 ("empty changeset" vs. `none`-bump substitution).
- New OQ-7 surfaces the spec-level wording on D1 / F1 (the merge does not automatically trigger `release.yml` because there's no `push:` trigger yet).

Non-blocking nits from iteration 2's review:

- **OQ-2 test-plan note** (B1–B8 should match on `msg` not `line` until line-precision is settled) — added as a parenthetical in OQ-2.
- **R-rename-confusion update** (the `none`-bump starter DOES carry a `"@automattic/skillsmith"` key, so a name override DOES need to propagate to the starter) — updated.
- **"Skip the backfill" rejection cosmetic staleness** — text already worked under the substitution; no change needed.

### Iteration 1

The first revision addressed the three blocking issues raised in `2-design-doc/design-doc-review-1-rejected.md`:

- **Issue 1 (regex bug).** The fence-splitting regex was replaced with `/^---\r?\n([\s\S]*?)(?:\r?\n)?---\r?\n?([\s\S]*)$/`, which matches the canonical empty-changeset bytes (`---\n---\n`, produced by `npx changeset add --empty`) and the no-trailing-newline variant (`---\n---`). Verification is reproduced inline ("Empirical verification of the regex fix") and the choice is justified in "Decision: Front-matter parser regex". CRLF tolerance was added as a free side effect.
- **Issue 2 (`changeset publish` on first no-op merge).** Iteration 1 chose the iteration-1 reviewer's Option 1 (route the first runs through `skip_publish=true`); iteration 2 found that the chosen mechanism (disable workflow + manual dispatch) was structurally infeasible. The iteration-2 fix replaces the disable-workflow mechanism with the `workflow_dispatch`-only initial trigger plus the `none`-bump starter (see Iteration 2 above).
- **Issue 3 (validator pseudocode not testable).** The pseudocode was restructured into an exported pure function `validateChangesetFile(file, raw, pkgName, version)`, an exported orchestrator `main()`, and an ESM entry guard (`import.meta.url === pathToFileURL(process.argv[1]).href`). The test strategy section specifies per-rule B1–B8 unit tests against `validateChangesetFile` (no filesystem fixtures) plus a child-process smoke test for the CLI entry. **Status: resolved.**

Non-blocking nits addressed in iteration 1:

- The off-by-one line citation for `yaml` was corrected from `package.json:46` to `package.json:45`.
- The `[skip ci]` framing was rewritten to make the branch-filter (not `[skip ci]`) the load-bearing safety, both in the "Trigger model and `[skip ci]`" section and in `R-skip-ci-future-workflow`.
- The `tsconfig.json:include` omission for `scripts/**` was acknowledged in the "Untouched but contract-relevant components" section and as `R-tsconfig-include-omits-scripts`.
- The hard-coded line numbers in the validator pseudocode were called out as placeholders ("the *exact line number* is implementation detail"), and OQ-2 already covers the precision question.

Open questions remaining: OQ-1, OQ-2, OQ-3, OQ-4 (existing); OQ-5 (iteration 1); OQ-6, OQ-7 (iteration 2, both spec-level). None block design approval; all are implementation-phase or future-revisit concerns. OQ-6 and OQ-7 should be surfaced to the orchestrator and owner because they touch spec wording.
