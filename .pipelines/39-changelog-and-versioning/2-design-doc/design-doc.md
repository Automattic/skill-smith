# Design Doc: Changelog and Versioning

Issue: [Automattic/skillsmith#39](https://github.com/Automattic/skillsmith/issues/39) — _Add a changelog and automate package version bumps_

Inputs read: `1-spec/spec.md`, `1-spec/requirements.md`, the repository tree at `worktree-39-changelog-and-versioning`, and the rejection notes in `2-design-doc/design-doc-review-1-rejected.md` (Issues 1–3 are addressed inline; see "Revision notes" at the end).

## Overview

Skillsmith today is published locally as `skillsmith@0.1.0` with no `CHANGELOG.md`, no `.github/workflows/`, and no publish configuration. The spec (R1–R9) requires a contributor-mediated, mechanically enforced changelog pipeline backed by the [Changesets](https://github.com/changesets/changesets) library, terminating in an automated `npm publish` of `@automattic/skillsmith` with a tag, GitHub Release, and OIDC-signed provenance.

This design realizes that pipeline as **two GitHub Actions workflows** (`changeset-gate.yml` for PRs, `release.yml` for `trunk` pushes), **one custom validator** (`scripts/validate-changesets.ts`) that closes the gaps `changeset status` silently leaks, **one `.changeset/` directory** with project configuration and a project-specific README, **one rename** in `package.json` to a scoped name, and **two human-facing documents** (`CHANGELOG.md` with the initial 0.1.0 entry, `CONTRIBUTING.md` with the full policy). The pre-merge maintainer checklist (E1–E4) is surfaced in the PR description and persisted into `CONTRIBUTING.md` for ongoing auditability. The implementing PR's own merge and the immediately-following no-op Version Packages PR merge are routed through the `workflow_dispatch.skip_publish` kill switch so the first `npm publish` is deliberate, not a side effect of the empty-changeset escape.

## Approach

The end-to-end flow has two halves connected by `trunk`:

1. **PR side (the gate).** Every PR to `trunk` runs a single CI job that runs the custom validator first, then `npx changeset status --since=origin/<base>`. The validator catches shape errors; `changeset status` catches "missing changeset for a release-relevant diff". The exclusion list is data in `.changeset/config.json:changedFilePatterns`, not workflow YAML — so contributors and CI agree about the gate's coverage by reading the same source.
2. **Trunk side (the release).** Every push to `trunk` (PR merge or admin push) runs a release workflow that runs lint/typecheck/test as a pre-flight, then hands off to `changesets/action@v1`. The action's two modes are: (a) if pending changesets exist, open/update a "Version Packages" PR on `changeset-release/trunk` that, when merged, applies the version bump and `CHANGELOG.md` append, then publishes; (b) if nothing is pending, no-op for the source tree — but the `changesets/action` `publish:` step still runs and would attempt a fresh `npm publish` on the *first* such "no-op" merge because npm has no prior versions of `@automattic/skillsmith` (see Issue 2 resolution below). This design routes the first no-op cycle through the kill switch to prevent that.

A maintainer's everyday view is: "open a feature PR, write a changeset, get it merged. The Version Packages PR appears on `trunk`. Merge it when ready to ship." Cadence is cultural (R5b in `requirements.md`); the design enforces only mechanical correctness.

### Flow diagram

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
                       │      (suppressed when            │
                       │       skip_publish=true)         │
                       └──────────┬───────────────┬───────┘
                                  │               │
                  changesets pending           no changesets pending
                                  │               │
                                  ▼               ▼
                ┌─────────────────────────┐   ┌──────────────────────────────────┐
                │ Open or update          │   │  If publish step active:         │
                │ "Version Packages" PR   │   │   changeset publish runs.        │
                │ on changeset-release/   │   │   Compares package.json:version  │
                │ trunk                   │   │   to npm's published versions.   │
                └────────────┬────────────┘   │   Publishes anything new.        │
                             │ maintainer     │  If suppressed (skip_publish):   │
                             │ merges Version │   no-op, no npm publish.         │
                             │ Packages PR    └──────────────────────────────────┘
                             ▼ push to trunk
                ┌─────────────────────────────────────────┐
                │       release.yml fires again            │
                │                                          │
                │   changesets/action sees no .md files,   │
                │   so the "publish" branch runs:          │
                │   - bump package.json, append CHANGELOG  │
                │     (only if a real changeset was        │
                │      consumed by changeset version)      │
                │   - git push to trunk                    │
                │   - npm publish (OIDC, provenance)       │
                │     IFF publish step active AND          │
                │     a not-yet-published version exists   │
                │   - create tag @automattic/              │
                │     skillsmith@<version>                 │
                │   - create matching GitHub Release       │
                └─────────────────────────────────────────┘
```

The publish step is reached only when the workflow runs without `skip_publish=true` and `changeset publish` finds a not-yet-published version on npm. For the *very first* publish — driven by the empty-changeset shipped in this PR — the design explicitly suppresses publishing on both `release.yml` runs (the implementing PR's merge and the no-op Version Packages PR merge) via `workflow_dispatch.skip_publish=true`; see "Empty-changeset mechanics for the first release (R8.6, R2.4, D2)" below.

## Components

### New components (delivered by this PR)

| Component | Path | Purpose |
|---|---|---|
| Initial changelog | `CHANGELOG.md` | Hand-written `## 0.1.0` entry; future entries appended above by `changeset version`. (R8.1, R3.6, A1) |
| Changesets config | `.changeset/config.json` | The single source of truth for the gate scope and release behaviour. (R8.4, A4) |
| Changesets README | `.changeset/README.md` | Project-specific cheat sheet, replacing the seeded boilerplate. (R8.5, R6.3, A5) |
| Empty starter changeset | `.changeset/<random>.md` (`---\n---`) | Lets the gate pass on this PR's merge and gives `release.yml` something to consume into a no-op Version Packages PR. (R8.6, A6, D2) |
| Validator script | `scripts/validate-changesets.ts` | Shape validation + pre-1.0 guard; the **first** step of `changeset-gate.yml`. Factored into pure `validateChangesetFile` plus an entry-guarded `main` so per-rule unit tests can import without executing the script. (R8.9, R2.5, A9, B1–B8) |
| Validator unit tests | `src/__tests__/validate-changesets.test.ts` | Per-rule unit tests (one per B1–B8) plus a fixtures-directory smoke test. Imports `validateChangesetFile` from the validator script. |
| Gate workflow | `.github/workflows/changeset-gate.yml` | Single-job PR workflow: validator then `changeset status`. (R8.10, A10, C1–C4) |
| Release workflow | `.github/workflows/release.yml` | `push: trunk` workflow: lint/typecheck/test, then `changesets/action@v1`. `workflow_dispatch.skip_publish` kill switch suppresses publish. (R8.11, A11, D1–D4) |
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

Where `<bump>` is one of `patch | minor | major | none` and `<body>` is free-form Markdown. The author SHA-based filename is generated by `npx changeset` (or chosen by the contributor when authoring directly). Two special cases:

- **Empty changeset.** Exact bytes `---\n---\n` (no front matter, no body) — i.e. what `npx changeset add --empty` writes. Consumed and deleted by `changeset version` without bumping anything. The validator (R2.5) explicitly recognises this case.
- **`none` bump.** Allowed per the `changeset` schema (recorded in `CHANGELOG.md` but produces no version bump). The validator allows it; the spec does not require contributors to use it, but the validator must not reject it.

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
  push:
    branches: [trunk]
  workflow_dispatch:
    inputs:
      skip_publish:
        description: "Run Version PR step only; don't publish"
        type: boolean
        default: false
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
          publish: ${{ inputs.skip_publish && '' || 'npx changeset publish' }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Notes:
- `on.push.branches: [trunk]` — captures both PR merges and direct admin pushes (R4.2).
- `concurrency: ${{ github.workflow }}-${{ github.ref }}` — no `cancel-in-progress`; serialize Release runs on `trunk` so two simultaneous merges cannot race the publish step or double-create the Version Packages PR (R4.3).
- Permissions are the exact three from R4.6 — no more, no less.
- `actions/checkout@v6` with `fetch-depth: 0` so `@changesets/changelog-github` can resolve PR metadata via `git log` (R4.5, R9.2).
- Lint → typecheck → test → action: pre-publish quality gate (R4.4, "Pattern A").
- `npx changeset publish` — runs `changesets/action`'s publish path; on a `push: trunk` event (the default case) the publish step is active. **Important:** on this PR's automatic `push: trunk` runs, `changeset publish` *will* attempt to publish `@automattic/skillsmith@0.1.0` because npm has no prior versions — see "Empty-changeset mechanics for the first release" below for why the design routes the first two `release.yml` runs through `workflow_dispatch.skip_publish=true` instead of the automatic `push` trigger.
- `workflow_dispatch.inputs.skip_publish` — kill switch (R4.10). When set, the action opens/updates the Version Packages PR but does not publish; the maintainer can inspect the PR and then re-run `release.yml` without the input to publish. **This is also the mechanism the design uses for the first two release runs (this PR's merge and the no-op Version Packages PR merge) to prevent an unintended first publish of `0.1.0` — see Decision: "First-publish gating via `skip_publish`".**
- `GITHUB_TOKEN` is passed via `env:` for `@changesets/changelog-github`'s PR/author enrichment at the version step (R9.2). The token is provided by `actions/checkout`'s default; the explicit pass-through is documented for clarity.

### Trigger model and `[skip ci]` (resolves R9.1)

`changesets/action` writes its "Version Packages" commit with `[skip ci]` in the message ([changesets/action#198](https://github.com/changesets/action/issues/198)) to avoid re-triggering the same workflow. For skillsmith today:

- **`release.yml`** trigger is `push: trunk`. The Version Packages commit lands on the `changeset-release/trunk` branch (which `release.yml` does not watch), so the `[skip ci]` flag is not the load-bearing safety here — the **branch filter** is. Once the Version Packages PR is merged into `trunk`, the merge commit on `trunk` *does* fire `release.yml`, and on that run the action sees zero `.changeset/*.md` files and the "publish" branch decides whether to invoke `npm publish` based on `package.json:version` vs. npm's published-versions list. `[skip ci]` plays no role at that point.
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

The validator (`scripts/validate-changesets.ts`) reads `PKG_NAME` from `package.json:name` at runtime (inside `main()`), so a rename does not require editing the validator. The `validateChangesetFile` function takes `pkgName` as a parameter, so unit tests can simulate any name. The `.changeset/config.json:changelog`'s `repo: "Automattic/skillsmith"` setting refers to the **GitHub repo path**, not the npm name, and stays the same regardless of E1's outcome. **The only places a name override propagates are: `package.json:name`, `.changeset/<random>.md` front matter keys (the empty starter has no key, so it is name-agnostic), and any reference in `README.md` / `CONTRIBUTING.md` prose.**

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

This PR ships one empty changeset (`.changeset/<random>.md` containing exactly `---\n---\n`, the bytes `npx changeset add --empty` writes). The filename is generated by `npx changeset add --empty` (random word combination); for reproducibility, the implementation phase may choose a deterministic name like `.changeset/initial-empty.md`. The validator (R-shape-2) explicitly recognises this case.

**The first-publish problem.** Re-reading `@changesets/cli@2.31.0`'s `publishPackages.ts` (referenced by the spec at R7.4): `changeset publish` compares the local `package.json:version` to the set of versions already on npm via `infoAllow404(packageJson)`. For `@automattic/skillsmith` today, `npm view @automattic/skillsmith` returns 404 (verified in `spec.md:20` and `requirements.md:172`), i.e. zero published versions. So the check `!publishedVersions.includes("0.1.0")` is `true`, and `changeset publish` will run `npm publish` for `@automattic/skillsmith@0.1.0`.

This means an *unmodified* `release.yml` running on this PR's merge would attempt to publish `@automattic/skillsmith@0.1.0` to npm during what was advertised as a "no-op" sequence. Depending on the configuration state at that moment, the outcome is one of:

- E4 is already configured → `0.1.0` is silently published as a side effect of merging the implementing PR. D3 ("merging the no-op PR does not publish anything") would then be wrong as stated, and `0.1.0` would be the first public version even though no real changeset has been written.
- E4 is not yet configured → publish fails 401. The source tree is fine, but the maintainer now has to triage a "wait, why did the workflow try to publish on the no-op merge?" surprise.

The empirical scratch repo at `/tmp/changesets-test-39` (cited in `requirements.md:162` and `spec.md` D2) verified the `changeset version` half of this flow (`0.1.0 + empty → no bump`, "action does nothing when zero non-README changesets exist"), but it was a *private* package, so it did not exercise the `publishPackages.ts` npm-info lookup against a registry that has no published versions. The publish-branch behaviour is therefore not covered by the existing empirical verification — the design must address it explicitly.

**Decision: first-publish gating via `skip_publish` (resolves rejection Issue 2).** Both `release.yml` runs in the bootstrap sequence — the implementing PR's `push: trunk` run and the no-op Version Packages PR merge's `push: trunk` run — must be neutralised so that the first `npm publish` only happens when a maintainer deliberately ships a real changeset.

The cleanest mechanism the design already has is the `workflow_dispatch.inputs.skip_publish` kill switch (R4.10). The design extends its use:

1. **Before merging the implementing PR**, the maintainer disables `release.yml`'s automatic `push: trunk` trigger for the bootstrap window, or merges with the awareness that the automatic run will fail (E4 unconfigured) or publish (E4 configured) on its own. The chosen path — codified in the PR description's pre-merge checklist below — is to **disable the workflow before merge, complete the bootstrap via `workflow_dispatch` with `skip_publish=true`, then re-enable**.
2. After the implementing PR's merge, the maintainer manually runs `release.yml` via `workflow_dispatch` with `skip_publish=true`. The action opens the no-op Version Packages PR. The publish step is suppressed (the `publish:` input is set to the empty string), so `changeset publish` never runs and no npm round-trip happens.
3. The maintainer reviews and merges the no-op Version Packages PR. The merge commit on `trunk` would automatically fire `release.yml` *if the workflow is enabled* — so the workflow stays disabled during this second run as well. The maintainer manually re-runs `release.yml` via `workflow_dispatch` with `skip_publish=true`. The action sees no `.changeset/*.md` files, hits its "publish" branch, but the suppressed `publish:` input means `changeset publish` never runs. No publish, no tag, no Release. D3 holds.
4. After this second run, the maintainer re-enables `release.yml`'s automatic trigger. The repository is now in the steady-state where every `push: trunk` runs the full release path. The first real feature PR (D4) lands a real changeset, the resulting Version Packages PR bumps to `0.1.1` (or `0.2.0`), and on merge `release.yml` runs *without* `skip_publish` — `changeset publish` then finds `0.1.1` is not on npm and publishes it. **This is the first deliberate publish.**

**Where this surfaces in the PR description's pre-merge checklist (extends E1–E4):**

The checklist embedded in the implementing PR's body must include a "First-publish bootstrap" subsection with the following items (added by this revision):

```
- [ ] **Before merge:** Disable `release.yml` (Actions tab → Release → "..." menu → Disable workflow).
      Rationale: prevents the automatic `push: trunk` trigger from attempting an
      unintended first publish of @automattic/skillsmith@0.1.0 (empirically, npm
      has no prior versions; `changeset publish` would publish 0.1.0).
- [ ] After merge: manually run `release.yml` via the Actions → Release → "Run workflow"
      UI, with `skip_publish: true`. Confirm the action opens the no-op Version
      Packages PR on `changeset-release/trunk`.
- [ ] Review and merge the no-op Version Packages PR.
- [ ] After the Version Packages PR merge: manually run `release.yml` again with
      `skip_publish: true`. Confirm no `npm publish` occurs. (D3 verification.)
- [ ] Re-enable `release.yml`. From this point on, real feature PRs flow through
      the normal release path; the first feature merge that ships a real
      changeset triggers the first publish (D4).
```

**Flow on this PR's merge to trunk (revised step-by-step):**

1. *Pre-merge:* Maintainer disables `release.yml`. Maintainer merges the implementing PR. The automatic `push: trunk` trigger fires but the workflow is disabled and does nothing.
2. *Manual run #1:* Maintainer triggers `release.yml` via `workflow_dispatch` with `skip_publish=true`. The job runs `npm ci → npm run lint → npm run typecheck → npm test` (all pass — no source changes), then hits `changesets/action@v1`.
3. The action sees one `.changeset/*.md` file (the empty one). The `publish` input is the empty string (suppressed by `skip_publish=true`), so the action skips its publish branch entirely. The action's version branch consumes the empty changeset, produces no version bump and no `CHANGELOG.md` change, and pushes a diff to `changeset-release/trunk` that is *only the deletion of the empty changeset file*.
4. The action opens (or updates) the **Version Packages PR** on `changeset-release/trunk` with that diff.
5. A maintainer reviews and merges the Version Packages PR. This is the no-op merge — D2 verifies the diff is `delete .changeset/<random>.md` only. The automatic `push: trunk` trigger fires but the workflow is still disabled.
6. *Manual run #2:* Maintainer triggers `release.yml` again via `workflow_dispatch` with `skip_publish=true`. The action sees no `.changeset/*.md` files; it hits its "publish" branch, but with `publish:` set to the empty string, `changeset publish` never runs. **No version bump, no npm publish, no tag, no Release.** D3 verifies this.
7. *Post-bootstrap:* Maintainer re-enables `release.yml`. The repository is now in steady-state.

This matches D2 ("no-op Version Packages PR with just the empty-changeset deletion") and D3 ("merging the no-op PR does not bump version or publish anything") — the revision threads D3 explicitly through the `skip_publish` kill switch rather than relying on the (empirically wrong) assumption that `changeset publish` would no-op against an unpublished package.

**The first real publish (D4) happens on the *next* feature PR after this bootstrap completes.** That PR ships a real (`patch` or `minor`) changeset; on merge to `trunk`, the *enabled* `release.yml` workflow opens a Version Packages PR that bumps `package.json:version` to `0.1.1` or `0.2.0` and appends to `CHANGELOG.md`. When the maintainer merges that PR, `release.yml` runs *without* `skip_publish` (the automatic `push: trunk` trigger fires it). `changeset publish` finds `0.1.1` is not on npm and publishes it. **This is the first deliberate publish.** E4 must be configured before that point or the publish fails 401 (recovery: configure E4, re-run the failed job).

**Why this path over the alternatives in the rejection's Issue 2 suggestions:**

- **Option 1 (`skip_publish` for the no-op merge, chosen).** Preserves D3 as the spec literally states it ("merging the no-op PR does not bump version or publish anything"), keeps the implementing PR diff identical to the spec's contract, and uses a kill switch that already exists in the design. The cost is a four-step manual bootstrap routine surfaced in the PR description, which the maintainer was going to perform end-to-end anyway. **Chosen.**
- Option 2 (accept the first publish on the no-op merge). Would require revising D3, which is a spec-level change; the spec is the contract, and the design phase cannot rewrite it. Rejected.
- Option 3 (set `package.json:version` to `0.0.0`). Rejected by R3.6 (the spec mandates `0.1.0` for this PR), and would require backfilling a different `## 0.0.0` changelog entry. Rejected.

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

### Decision: Trigger on `push: branches: [trunk]`, not `pull_request: closed`

- **Choice:** `release.yml` runs on every push to `trunk` (PR merges and direct admin pushes).
- **Alternatives:** `pull_request: closed`-with-`if: github.event.pull_request.merged == true`.
- **Trade-offs:** `push: trunk` captures admin/hotfix-revert pushes that `pull_request: closed` would miss; matches every canonical Changesets example, so future contributors and the `changesets/action` maintainers are speaking the same language.
- **Traces to:** R4.2.

### Decision: First-publish gating via `skip_publish`

- **Choice:** The implementing PR's merge and the immediately-following no-op Version Packages PR merge are both routed through `release.yml`'s `workflow_dispatch` trigger with `skip_publish=true`. The automatic `push: trunk` trigger is disabled for the bootstrap window. After the no-op cycle completes, the workflow is re-enabled and steady-state begins.
- **Alternatives:**
  1. Accept the first publish on the no-op merge as the intended outcome. Rejected: D3 explicitly says "merging the no-op PR does not publish anything"; this would silently change the contract and ship `0.1.0` to npm on what was advertised as a no-op. Also requires E4 to be configured before the bootstrap merges, which is plausible but moves the failure mode (401) to a worse surprise surface.
  2. Set `package.json:version` to `0.0.0` so `changeset publish` skips the first round. Rejected by R3.6 (the spec mandates `0.1.0` for this PR).
  3. Patch the validator/action to add a "treat 0.1.0 as already published" shim. Rejected: invasive, surprising, and the existing kill switch already provides the lever.
  4. Use `npm dist-tag` magic to mark `0.1.0` as "withdrawn" pre-publish. Rejected: requires publishing first, which is what we're trying to avoid.
- **Trade-offs:** The bootstrap requires a four-step manual checklist (disable workflow, run with `skip_publish=true`, merge no-op, re-run with `skip_publish=true`, re-enable workflow). The maintainer was performing the no-op cycle manually anyway; this adds three "Run workflow"/toggle clicks. The benefit is D3 holds literally as stated, the contract is intact, and the implementer has a clear, documented runbook surfaced in the PR description.
- **Traces to:** R4.10 (kill switch exists), R3.6 (version stays at 0.1.0), R7.4 (re-run guidance), D3 (no publish on no-op merge), E4 (the OIDC binding is the gate for the *real* first publish, not the bootstrap).

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

- **Choice:** Backfill `CHANGELOG.md`'s initial `## 0.1.0` entry by hand; `package.json:version` stays `0.1.0`. Ship one empty changeset so the gate passes on this PR's own merge.
- **Alternatives:**
  1. Bump to `0.2.0` as part of this PR with a real changeset. Rejected: no consumer-visible API change has happened; the bump would be cosmetic and confuse the public-API-stability signal.
  2. Skip the backfill, let the first real release write the first `CHANGELOG.md` entry. Rejected: `package.json` already claims `0.1.0`, so consumers checking the changelog for the version they install would find it empty. Backfilling is cheap.
- **Trade-offs:** The 0.1.0 entry is one-liner-thin; future readers may want richer history. Upside: file format is established; `changeset version` will append above the 0.1.0 entry forever. (The first-publish bootstrap above ensures `0.1.0` is not published to npm as a side effect of the empty-changeset cycle.)
- **Traces to:** R3.6, R8.1, R8.6, A1, A6, D2.

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

### Decision: `workflow_dispatch` kill switch (`skip_publish`)

- **Choice:** Include a `workflow_dispatch.inputs.skip_publish: boolean` (default false) that, when true, sets `publish: ''` on the `changesets/action` step so only the Version Packages PR is opened/updated.
- **Alternatives:**
  1. No kill switch. Rejected: maintainers would have to edit the workflow file to perform a "version-only" run, *and* the first-publish bootstrap (above) would have no clean lever.
  2. Halt all releases by disabling the workflow from the GitHub UI. Kept as the higher-level "stop everything" mechanism; documented in `CONTRIBUTING.md`, complements the kill switch and is itself part of the bootstrap routine.
- **Trade-offs:** Adds a couple of lines to `release.yml`. Upside: maintainer can preview a Version Packages PR without committing to a publish; bootstrap routine uses the same mechanism.
- **Traces to:** R4.10, A11, "First-publish gating via `skip_publish`" decision.

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
  - **B1–B8 unit tests** against the exported `validateChangesetFile(file, raw, pkgName, version)` function. Each test constructs the changeset contents as a JavaScript string and asserts on the returned `Err[]` (either empty for passing cases or containing the expected `msg` substring for failing cases). No filesystem fixtures are required.
  - **A smoke test for the CLI entry** that spawns `node --import tsx scripts/validate-changesets.ts` in a temporary directory containing a seeded `package.json` (with controlled `name` and `version`) and a `.changeset/` directory with one passing and one failing changeset. The smoke test asserts the exit code is `1`, the stderr contains the expected `.changeset/<file>:<line>:` prefix, and stdout is empty. This exercises `main()` end-to-end without making it the per-rule test vehicle.
  - **A CRLF-tolerance test** (one extra case beyond B1–B8) verifying that the same valid changeset shape with `\r\n` line endings also passes — this guards against future regressions of the fence-regex CRLF tolerance.
- Verify C1–C4 and D1–D4 via the actual GitHub Actions runs on this PR's merge (D2/D3 via the bootstrap routine described above) and the first real feature PR after the bootstrap (D4), with the spec's empirical scratch repo at `/tmp/changesets-test-39` as a reference.
- **Alternatives:** Add an act-based local CI runner harness for the workflows; build a docker-compose harness for `npm publish` against a verdaccio registry.
- **Trade-offs:** Workflow-level testing is hard to fixture honestly. The CI behaviour is fully determined by `changedFilePatterns` and the validator (both unit-testable, given the pseudocode-shape decision above); manual end-to-end verification on the bootstrap and first feature PR catches integration concerns.
- **Traces to:** R8.9, A9, B1–B8 (validator unit-testable, structured against `validateChangesetFile`), C1–C4 / D1–D4 / F1–F3 (verified post-merge per the spec's acceptance criteria).

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
| Workflow disabled during bootstrap | overall | Intentional. The maintainer follows the PR description's first-publish bootstrap checklist: manual `workflow_dispatch` runs with `skip_publish=true` until the no-op cycle completes; then re-enable. |
| Bootstrap step skipped, automatic `push: trunk` fires while workflow enabled | overall | Either `0.1.0` is unintentionally published (E4 configured) or the publish fails 401 (E4 not configured). Recovery for the former: deprecate `0.1.0` per R7.2's "deprecate the bad version" flow, then publish a real `0.1.1`. Recovery for the latter: configure E4 (or proceed with the bootstrap re-runs from a known-good state). The PR description's checklist is the load-bearing prevention. |

### Observability

- **CI logs** — every step's output is available in GitHub Actions, indexed by job and step name; the validator's line-numbered errors and `changeset status`'s canonical hint both surface here.
- **`CHANGELOG.md`** — the consumer-facing observable. Every published version has an entry; missing entries indicate an "I forgot a changeset" event (recovered via R7.3).
- **GitHub Releases page** — for each published version, the Release body mirrors the `CHANGELOG.md` section. A version with no Release indicates a partial publish failure; recovery is re-run the job (the action recreates the Release idempotently).
- **npm registry metadata** — `npm view @automattic/skillsmith` shows publish times, versions, and (when OIDC succeeded) provenance attestations. The provenance is the integrity observable for consumers.
- **Workflow runs page (Actions tab)** — during the bootstrap window, the maintainer reads this to verify `skip_publish=true` was honoured (the `changesets/action` step's `publish:` resolved to the empty string, visible in the run log).

### Pre-1.0 guard observability

The validator's pre-1.0 message references `CONTRIBUTING.md#pre-10-policy` — a stable anchor in the contributor doc. The anchor is the spec's R6.2 requirement (`#pre-10-policy`). The design enforces the anchor in `CONTRIBUTING.md` and the validator's error message together.

## Risks and Open Questions

### Risks

- **R-bot-honors-patterns (open).** R9.4 — does `@changesets/bot` honour `changedFilePatterns`? The design recommends installing the bot only if a maintainer wants the educational comments and accepts the tolerable noise. If the bot does **not** honour the patterns, contributors on excluded PRs will see "Add a changeset" comments they can safely ignore. The CI gate remains the source of truth.
- **R-rename-confusion.** If the owner declines `@automattic/skillsmith` at merge time, every reference in `package.json`, `README.md`, `CONTRIBUTING.md`, and `.changeset/<random>.md` front matter (the empty starter has no key, so it is unaffected) must be updated. Mitigated by E1's PR-description checklist.
- **R-bootstrap-skipped.** If the maintainer merges the implementing PR without following the first-publish bootstrap checklist (the workflow is enabled, the automatic `push: trunk` trigger fires), one of two things happens: (a) E4 is already configured → `@automattic/skillsmith@0.1.0` is published silently as a side effect of the empty-changeset cycle, contradicting D3; (b) E4 is not configured → the publish step fails 401. Mitigated by surfacing the bootstrap as the most prominent section of the PR description, ahead of E1–E4.
- **R-E4-not-configured-at-first-publish.** D4 ("first real feature PR ships end-to-end") relies on E4 being configured before the maintainer merges the first non-empty Version Packages PR. If E4 is missing, publish fails 401. The repo state (commit, tag, Release) is unaffected; recovery is configure E4, re-run the failed job. Mitigated by surfacing E4 in the pre-merge checklist (E1–E4 in the PR description).
- **R-skip-ci-future-workflow.** R9.1 — if a future PR adds a `test.yml` on `push: trunk`, the Version Packages PR merge commit on `trunk` does *not* carry `[skip ci]` (the `[skip ci]` lives on the action's commit to `changeset-release/trunk`, not on the merge commit), so a future `push: trunk`–triggered test workflow will run normally on the Version Packages PR merge. The forward-looking guidance from the design's R9.1 section is unchanged: future CI workflows should still prefer `pull_request` triggers so they certify the Version Packages PR *before* merge.
- **R-bot-attribution-on-backfill.** R7.3 — `@changesets/changelog-github` attributes a backfilled changeset to the backfill PR, not the original. The design accepts this cosmetic wart and propagates a `> Backfilled from PR #<original>` line into `CHANGELOG.md` via the changeset body. Live with it; do not write tooling to invert it.
- **R-validator-yaml-line-numbers.** The `yaml@^2.8.3` parser provides source positions; converting to a 1-based line number for the validator's error format requires the API supports it. If line precision proves infeasible without a major refactor, fall back to "line of the front-matter region" (e.g. `2`) — the file/region pointer is the load-bearing UX, not the exact column. The pseudocode's hard-coded `1`/`2`/`4` are placeholders; OQ-2 covers this.
- **R-trunk-protection-prevents-bot-push.** E3 — branch protection must allow `github-actions[bot]` to push to `changeset-release/trunk` while still requiring human review on the release PR. If misconfigured, `changesets/action` fails on the first commit. Mitigated by surfacing E3 in the pre-merge checklist.
- **R-tsconfig-include-omits-scripts.** `tsconfig.json:include` does not cover `scripts/**`, so `npm run typecheck` will not catch a typo in `scripts/validate-changesets.ts`. The validator runs through `tsx` at CI time (catching type errors at execution), and the unit-test file imports from the script (catching exported-surface type errors via the test's `import`). The design accepts this trade-off; a future contributor preferring `tsc`-coverage can extend `include` with `scripts/**/*` as a one-line change.

### Open questions logged for review

1. **OQ-1 (R9.4, partially resolved).** Final, verified behaviour of `@changesets/bot` against `changedFilePatterns` — the design recommends accepting the bot as non-blocking and tolerating any noise. The reviewer may opt to install the bot or defer the install; the design ships with the bot uninstalled and documents it as optional in `CONTRIBUTING.md`'s "Repo configuration prerequisites".
2. **OQ-2 (validator line precision).** Whether `yaml@^2.8.3` gives the validator enough source-position information for per-error 1-based line numbers in front matter, or whether the design's fall-back to "line of front-matter region" (`:2:`) is acceptable. Will be settled in implementation; the spec's "line-numbered" requirement is met under either reading. The pseudocode's `1`/`2`/`4` constants are placeholders, not contract.
3. **OQ-3 (`.changeset/<random>.md` filename for the empty starter).** Spec says `<random>`. The implementation may pin a deterministic name (e.g. `initial-empty.md`) for reproducibility, or use `npx changeset add --empty`'s random name. Either satisfies R8.6 / A6 ("exactly one empty changeset file at `.changeset/<random>.md`"); the design's recommendation is to use the randomly-generated name to match the rest of the changesets-on-disk style, but it does not block.
4. **OQ-4 (kill-switch test).** Whether the `skip_publish` input should be exercised once before merge as a smoke test, or left for the maintainer to drive on first emergency. The first-publish bootstrap routine effectively *requires* `skip_publish=true` to be exercised twice in production, so it is implicitly tested by the bootstrap itself. No additional pre-merge test wiring needed.
5. **OQ-5 (where to document the bootstrap routine for posterity).** The first-publish bootstrap is a one-time procedure; the design records it only in the implementing PR's description. If a future maintainer needs to re-bootstrap (e.g. unpublishing `0.1.0` and starting over), the routine can be reconstructed from the design doc (this document) or from the PR description's history. The design does **not** add it to `CONTRIBUTING.md` because the persistent doc should describe steady-state mechanics, not bootstrap. Implementation phase may revisit.

## Revision notes (this iteration)

This revision addresses the three blocking issues raised in `2-design-doc/design-doc-review-1-rejected.md`:

- **Issue 1 (regex bug).** The fence-splitting regex is replaced with `/^---\r?\n([\s\S]*?)(?:\r?\n)?---\r?\n?([\s\S]*)$/`, which matches the canonical empty-changeset bytes (`---\n---\n`, produced by `npx changeset add --empty`) and the no-trailing-newline variant (`---\n---`). Verification is reproduced inline ("Empirical verification of the regex fix") and the choice is justified in "Decision: Front-matter parser regex". R-shape-2 in the validation table now references the empirical verification. CRLF tolerance is added as a free side effect.
- **Issue 2 (`changeset publish` on first no-op merge).** The design picks the reviewer's suggested Option 1: the implementing PR's merge and the no-op Version Packages PR merge are both routed through `workflow_dispatch` with `skip_publish=true`, with `release.yml`'s automatic `push: trunk` trigger disabled during the bootstrap window. The new "Decision: First-publish gating via `skip_publish`" formalises the choice; the "Empty-changeset mechanics for the first release" section is fully rewritten to use the bootstrap routine; the PR description's pre-merge checklist gains a "First-publish bootstrap" subsection; the `R-bootstrap-skipped` risk is added.
- **Issue 3 (validator pseudocode not testable).** The pseudocode is restructured into an exported pure function `validateChangesetFile(file, raw, pkgName, version)`, an exported orchestrator `main()`, and an ESM entry guard (`import.meta.url === pathToFileURL(process.argv[1]).href`). The test strategy section is rewritten to specify per-rule B1–B8 unit tests against `validateChangesetFile` (no filesystem fixtures) plus a child-process smoke test for the CLI entry. The new "Decision: Validator pseudocode shape — pure function + entry-guarded main" formalises the choice.

Non-blocking nits addressed:

- The off-by-one line citation for `yaml` is corrected from `package.json:46` to `package.json:45`.
- The `[skip ci]` framing is rewritten to make the branch-filter (not `[skip ci]`) the load-bearing safety, both in the "Trigger model and `[skip ci]`" section and in `R-skip-ci-future-workflow`.
- The `tsconfig.json:include` omission for `scripts/**` is acknowledged in the "Untouched but contract-relevant components" section and as `R-tsconfig-include-omits-scripts`.
- The hard-coded line numbers in the validator pseudocode are explicitly called out as placeholders ("the *exact line number* is implementation detail"), and OQ-2 already covers the precision question.

Open questions remaining: OQ-1, OQ-2, OQ-3, OQ-4 (existing); OQ-5 (new — where to persist the bootstrap runbook). None block design approval; all are implementation-phase or future-revisit concerns.
