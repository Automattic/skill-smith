# Design Doc: Changelog and Versioning

Issue: [Automattic/skillsmith#39](https://github.com/Automattic/skillsmith/issues/39) — _Add a changelog and automate package version bumps_

Inputs read: `1-spec/spec.md`, `1-spec/requirements.md`, the repository tree at `worktree-39-changelog-and-versioning`.

## Overview

Skillsmith today is published locally as `skillsmith@0.1.0` with no `CHANGELOG.md`, no `.github/workflows/`, and no publish configuration. The spec (R1–R9) requires a contributor-mediated, mechanically enforced changelog pipeline backed by the [Changesets](https://github.com/changesets/changesets) library, terminating in an automated `npm publish` of `@automattic/skillsmith` with a tag, GitHub Release, and OIDC-signed provenance.

This design realizes that pipeline as **two GitHub Actions workflows** (`changeset-gate.yml` for PRs, `release.yml` for `trunk` pushes), **one custom validator** (`scripts/validate-changesets.ts`) that closes the gaps `changeset status` silently leaks, **one `.changeset/` directory** with project configuration and a project-specific README, **one rename** in `package.json` to a scoped name, and **two human-facing documents** (`CHANGELOG.md` with the initial 0.1.0 entry, `CONTRIBUTING.md` with the full policy). The pre-merge maintainer checklist (E1–E4) is surfaced in the PR description and persisted into `CONTRIBUTING.md` for ongoing auditability.

## Approach

The end-to-end flow has two halves connected by `trunk`:

1. **PR side (the gate).** Every PR to `trunk` runs a single CI job that runs the custom validator first, then `npx changeset status --since=origin/<base>`. The validator catches shape errors; `changeset status` catches "missing changeset for a release-relevant diff". The exclusion list is data in `.changeset/config.json:changedFilePatterns`, not workflow YAML — so contributors and CI agree about the gate's coverage by reading the same source.
2. **Trunk side (the release).** Every push to `trunk` (PR merge or admin push) runs a release workflow that runs lint/typecheck/test as a pre-flight, then hands off to `changesets/action@v1`. The action's two modes are: (a) if pending changesets exist, open/update a "Version Packages" PR on `changeset-release/trunk` that, when merged, applies the version bump and `CHANGELOG.md` append, then publishes; (b) if nothing is pending, no-op. Publish is done with OIDC trusted publishing (no `NPM_TOKEN`).

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
                       └──────────┬───────────────┬───────┘
                                  │               │
                  changesets pending           no changesets pending
                                  │               │
                                  ▼               ▼
                ┌─────────────────────────┐   ┌────────────────────┐
                │ Open or update          │   │  no-op (exit 0)    │
                │ "Version Packages" PR   │   └────────────────────┘
                │ on changeset-release/   │
                │ trunk                   │
                └────────────┬────────────┘
                             │ maintainer merges Version Packages PR
                             ▼ push to trunk
                ┌─────────────────────────────────────────┐
                │       release.yml fires again            │
                │                                          │
                │   changesets/action sees no .md files,   │
                │   so the "publish" path runs:            │
                │   - bump package.json, append CHANGELOG  │
                │   - git push to trunk                    │
                │   - npm publish (OIDC, provenance)       │
                │   - create tag @automattic/              │
                │     skillsmith@<version>                 │
                │   - create matching GitHub Release       │
                └─────────────────────────────────────────┘
```

The publish step is reached only after a maintainer merges the Version Packages PR — there is no path where the action publishes from a normal feature merge to `trunk`.

## Components

### New components (delivered by this PR)

| Component | Path | Purpose |
|---|---|---|
| Initial changelog | `CHANGELOG.md` | Hand-written `## 0.1.0` entry; future entries appended above by `changeset version`. (R8.1, R3.6, A1) |
| Changesets config | `.changeset/config.json` | The single source of truth for the gate scope and release behaviour. (R8.4, A4) |
| Changesets README | `.changeset/README.md` | Project-specific cheat sheet, replacing the seeded boilerplate. (R8.5, R6.3, A5) |
| Empty starter changeset | `.changeset/<random>.md` (`---\n---`) | Lets the gate pass on this PR's merge and gives `release.yml` something to consume into a no-op Version Packages PR. (R8.6, A6, D2) |
| Validator script | `scripts/validate-changesets.ts` | Shape validation + pre-1.0 guard; the **first** step of `changeset-gate.yml`. (R8.9, R2.5, A9, B1–B8) |
| Gate workflow | `.github/workflows/changeset-gate.yml` | Single-job PR workflow: validator then `changeset status`. (R8.10, A10, C1–C4) |
| Release workflow | `.github/workflows/release.yml` | `push: trunk` workflow: lint/typecheck/test, then `changesets/action@v1`. (R8.11, A11, D1–D4) |
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
- `src/__tests__/**` — explicitly excluded from `changedFilePatterns` via `!src/__tests__/**` so a test-only PR does not trigger the gate.
- `examples/skillsmith.config.ts` — consumer-facing reference; inside `changedFilePatterns`. R1.4 calls out the edge case.
- `yaml@2.8.3` (existing dependency at `package.json:46`) — the validator parses front matter with this; no new YAML dependency is introduced.
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

- **Empty changeset.** Exact bytes `---\n---\n` (no front matter, no body). Consumed and deleted by `changeset version` without bumping anything. The validator (R2.5) explicitly recognises this case.
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

**Input** (read from the filesystem at the repo root):

- `package.json` — for `name` (`PKG_NAME`) and `version` (`PRE_1_0` flag derived from `String(version).startsWith("0.")`).
- `.changeset/*.md` — every Markdown file in `.changeset/` except `README.md`.

**Per-file parser model.** A file is split into a front-matter block and a body by the regex `/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/`. The capture groups are `fmRaw` and `body`. Front matter is then parsed with `parseYaml` from `yaml@2.8.3` and expected to be a flat string→string map (`Record<string, string>`).

**Output**: line-numbered errors written to **stderr** (one per error), exit code `1` if any errors were recorded, `0` otherwise. "Line-numbered" means each error has the form `<.changeset/file.md>:<lineNumber>: <message>` where `lineNumber` is the 1-based offset of the offending construct (1 for the file-level fence error; for invalid bump entries, the line of the YAML key as reported by the YAML parser's source positions when available, otherwise `1` for the front-matter region as a whole).

**Exit codes**: `0` clean, `1` any validation error. No other codes used. Stdout is unused (kept clean for piping into other tools).

### Validation rules mapped to acceptance criteria

| Rule | Trigger | Maps to |
|---|---|---|
| R-shape-1 | Two `---` fences with parseable YAML between them is required; missing closing fence or unparseable YAML between them fails. | B3, R2.5 bullet 1 |
| R-shape-2 | Empty changeset (`---\n---` with no front matter and no body, i.e. `fmRaw.trim() === ""` and `body.trim() === ""`) passes. | B2, R2.5 bullet 2 |
| R-shape-3 | Otherwise body must be non-empty (`body.trim() !== ""`). | B6, R2.5 bullet 3 |
| R-pkg | Every front-matter key must equal `PKG_NAME` (i.e. `@automattic/skillsmith`). | B5, R2.5 bullet 4 |
| R-bump | Every front-matter value must be one of `patch | minor | major | none`. | B4, R2.5 bullet 5 |
| R-pre-1.0 | If `PRE_1_0` and value is `major`, fail with `'major' is forbidden while pre-1.0 (version=<x>). Use 'minor' with a 'BREAKING:' prefix; see CONTRIBUTING.md#pre-10-policy.` | B7, R2.5 last bullet, folds in R3.4 |
| R-exit | Exit `0` clean, `1` on any error. | B8 |
| R-pass | A well-formed changeset with `name=PKG_NAME`, `bump∈{patch,minor,none}` (or `bump=major` when post-1.0), and non-empty body passes. | B1 |

### Validator pseudocode (illustrative, not production code)

```ts
import { readFileSync, readdirSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const PKG_NAME: string = pkg.name;
const PRE_1_0 = String(pkg.version).startsWith("0.");
const VALID = new Set(["patch", "minor", "major", "none"]);

type Err = { file: string; line: number; msg: string };
const errors: Err[] = [];

const files = readdirSync(".changeset")
  .filter((n) => n.endsWith(".md") && n !== "README.md");

for (const f of files) {
  const raw = readFileSync(`.changeset/${f}`, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) {
    errors.push({ file: f, line: 1, msg: "missing or unterminated front matter (expected two '---' fences)" });
    continue;
  }
  const [, fmRaw, body] = m;
  const empty = fmRaw.trim() === "" && body.trim() === "";
  if (empty) continue;
  if (body.trim() === "") {
    errors.push({ file: f, line: 4, msg: "empty body (changeset has front matter but no summary)" });
  }
  let fm: Record<string, string>;
  try {
    fm = parseYaml(fmRaw) as Record<string, string>;
  } catch (e) {
    errors.push({ file: f, line: 2, msg: `YAML parse error: ${(e as Error).message}` });
    continue;
  }
  for (const [name, bump] of Object.entries(fm)) {
    if (name !== PKG_NAME) {
      errors.push({ file: f, line: 2, msg: `unknown package "${name}" (expected "${PKG_NAME}")` });
    }
    if (!VALID.has(bump)) {
      errors.push({ file: f, line: 2, msg: `invalid bump "${bump}" (expected one of ${[...VALID].join(", ")})` });
    } else if (PRE_1_0 && bump === "major") {
      errors.push({
        file: f,
        line: 2,
        msg: `'major' is forbidden while pre-1.0 (version=${pkg.version}). Use 'minor' with a 'BREAKING:' prefix; see CONTRIBUTING.md#pre-10-policy.`,
      });
    }
  }
}

if (errors.length) {
  for (const e of errors) process.stderr.write(`.changeset/${e.file}:${e.line}: ${e.msg}\n`);
  process.exit(1);
}
```

The shipped script will be ~50 lines following the spec target. It is invoked from CI as `npx tsx scripts/validate-changesets.ts`; `tsx` is already a runtime dependency (`package.json:44`) so this requires no toolchain change.

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
- `npx changeset publish` — runs `changesets/action`'s publish path when the no-changesets-pending mode fires after a Version Packages PR merge.
- `workflow_dispatch.inputs.skip_publish` — kill switch (R4.10). When set, the action opens/updates the Version Packages PR but does not publish; the maintainer can inspect the PR and then re-run `release.yml` without the input to publish.
- `GITHUB_TOKEN` is passed via `env:` for `@changesets/changelog-github`'s PR/author enrichment at the version step (R9.2). The token is provided by `actions/checkout`'s default; the explicit pass-through is documented for clarity.

### Trigger model and `[skip ci]` (resolves R9.1)

`changesets/action` writes its "Version Packages" commit with `[skip ci]` in the message ([changesets/action#198](https://github.com/changesets/action/issues/198)) to avoid re-triggering the same workflow. For skillsmith today:

- **`release.yml`** trigger is `push: trunk`. The action's `[skip ci]` commit message **prevents `release.yml` from firing on its own version commit**, which is the desired behaviour: we already saw the commit; we don't want a re-entrant loop.
- **`changeset-gate.yml`** trigger is `pull_request`, not `push`. `[skip ci]` in a `pull_request` event has **no effect** — GitHub honours `[skip ci]` only on `push` (and `schedule`). The Version Packages PR is opened by the action; its branch is `changeset-release/trunk`. When the maintainer opens that PR, the gate workflow runs on it normally. This is fine and desired: the gate should run on the Version Packages PR like any other.
- **The Version Packages PR will fail the gate** unless it carries a changeset entry — but by construction it carries the changeset files that `changeset version` is about to consume (until the maintainer merges, the `.changeset/*.md` files are present on the release branch). So `changeset status` exits 0 because the changesets exist; the validator passes because they are well-formed (they were validated when their authors landed). Once merged, the changesets are deleted as part of the merge commit on `trunk`, which is when `release.yml` runs in its publish branch.

**Verdict on R9.1:** the present single-workflow model is `[skip ci]`-safe. The design records a forward-looking note: **if a future PR adds a separate `test.yml` triggered on `push: trunk`**, that workflow will need to either (a) trigger on `pull_request` and accept the natural skip on direct `trunk` pushes, or (b) accept `[skip ci]` on the Version Packages commit and rely on the Version Packages PR's own gate run to certify quality, or (c) override the action's `commit` input to remove `[skip ci]`. The recommended path is (a): make additional CI workflows trigger on `pull_request`, leaving `push: trunk` to release-only workflows.

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

The validator (`scripts/validate-changesets.ts`) reads `PKG_NAME` from `package.json:name` at runtime, so a rename does not require editing the validator. The `.changeset/config.json:changelog`'s `repo: "Automattic/skillsmith"` setting refers to the **GitHub repo path**, not the npm name, and stays the same regardless of E1's outcome. **The only places a name override propagates are: `package.json:name`, `.changeset/<random>.md` front matter keys (the empty starter has no key, so it is name-agnostic), and any reference in `README.md` / `CONTRIBUTING.md` prose.**

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

This PR ships one empty changeset (`.changeset/<random>.md` containing exactly `---\n---`, no trailing content). The filename is generated by `npx changeset add --empty` (random word combination); for reproducibility, the implementation phase may choose a deterministic name like `.changeset/initial-empty.md`. The validator (R-shape-2) explicitly recognises this case.

**Flow on this PR's merge to trunk:**

1. `release.yml` fires (push to trunk).
2. `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` all pass (no source changes).
3. `changesets/action@v1` runs. It sees one `.changeset/*.md` file (the empty one) and one `README.md`. It excludes `README.md` and processes the empty changeset.
4. The empty changeset produces no version bump and no `CHANGELOG.md` change. The action's "version" phase produces a diff that is **only the deletion of the empty changeset file**.
5. The action opens (or updates) the **Version Packages PR** on `changeset-release/trunk` with that diff.
6. A maintainer reviews and merges the Version Packages PR. This is the no-op merge — D2 verifies the diff is `delete .changeset/<random>.md` only.
7. The merge pushes to `trunk`, firing `release.yml` again. Now there are no `.changeset/*.md` files. The action's "publish" path runs: it sees no pending changes (`changeset publish` finds nothing newer than what npm has), and **does nothing**. No version bump, no npm publish, no tag, no Release. D3 verifies this.

This matches D2 ("no-op Version Packages PR with just the empty-changeset deletion") and D3 ("merging the no-op PR does not bump version or publish anything"). It also empirically matches the spec's verified scratch repo at `/tmp/changesets-test-39`.

**The first real publish (D4) happens on the *next* feature PR after this one merges.** That PR ships a real (`patch` or `minor`) changeset; on merge to `trunk`, the action opens a Version Packages PR that bumps `package.json:version` to `0.1.1` or `0.2.0` and appends to `CHANGELOG.md`. When the maintainer merges that PR, the publish path runs against the bumped commit and `npm publish` succeeds (OIDC, provenance) given E4 is configured.

## Key Decisions

### Decision: Custom validator script instead of relying on `changeset status`

- **Choice:** Ship `scripts/validate-changesets.ts` as a thin (~50 LOC) shape validator that runs **before** `npx changeset status` in CI. Reuse the existing `yaml@2.8.3` runtime dependency.
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

### Decision: OIDC trusted publishing, not `NPM_TOKEN`

- **Choice:** Workflow declares `id-token: write` and `npm publish` runs with no env var. npm CLI v11.5.1+ auto-generates provenance attestations.
- **Alternatives:** `NPM_TOKEN` automation token in `secrets`, with explicit `--provenance` flag.
- **Trade-offs:** OIDC requires E4 (the trusted-publisher binding on npmjs.com) to be configured before the first publish; without it, the publish step fails 401. The fallback (token) is documented in `CONTRIBUTING.md` for the manual escape hatch. Upside: no long-lived secret rotated/leaked, provenance is automatic.
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
- **Trade-offs:** The 0.1.0 entry is one-liner-thin; future readers may want richer history. Upside: file format is established; `changeset version` will append above the 0.1.0 entry forever.
- **Traces to:** R3.6, R8.1, R8.6, A1, A6, D2.

### Decision: Scope rename to `@automattic/skillsmith`, not a different unscoped name or a name dispute

- **Choice:** Rename to `@automattic/skillsmith`. Owner confirms at merge time (E1).
- **Alternatives:**
  1. Keep `skillsmith` and dispute the unscoped name via npm Support. Rejected: slow, uncertain, only valid grounds are trademark/squat.
  2. Publish as `skillsmith-harness` or similar unscoped name. Rejected: package vs. CLI bin name divergence, SEO penalty.
- **Trade-offs:** Consumers type a slightly longer name (`@automattic/skillsmith`). Upside: matches the existing ~50 `@automattic/*` packages, OIDC binding follows the org → repo → workflow model already in use across Automattic.
- **Traces to:** R5.2, R8.2 (the rename in `package.json`), E1.

### Decision: Surface E1–E4 as PR-description checklist; persist E2–E4 in `CONTRIBUTING.md`

- **Choice:** The implementing PR's description carries a checklist of E1–E4 (and optional bot install). `CONTRIBUTING.md` documents E2–E4 in a "Repo configuration prerequisites" section so future maintainers can audit. E1 (name) is a one-time decision and is recorded only in the PR description, not in `CONTRIBUTING.md`.
- **Alternatives:** Put E1–E4 only in `CONTRIBUTING.md`. Rejected: easy to overlook during merge; the checklist is a load-bearing pre-merge ritual.
- **Trade-offs:** The PR description is ephemeral; mitigated by `CONTRIBUTING.md` documenting the persistent items (E2–E4). The design records the *required content of the PR description* even though the PR body is not a code artifact.
- **Traces to:** R6.2, R8.7, A7, E1–E4.

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
  1. No kill switch. Rejected: maintainers would have to edit the workflow file to perform a "version-only" run.
  2. Halt all releases by disabling the workflow from the GitHub UI. Kept as the higher-level "stop everything" mechanism; documented in `CONTRIBUTING.md`, complements the kill switch.
- **Trade-offs:** Adds a couple of lines to `release.yml`. Upside: maintainer can preview a Version Packages PR without committing to a publish.
- **Traces to:** R4.10, A11.

### Decision: Test strategy — unit tests for the validator, manual verification for the gate and release flows

- **Choice:** Add Node test-runner tests at `src/__tests__/validate-changesets.test.ts` (one per B1–B8 case, plus a smoke test that drives the validator over a fixtures directory). Verify C1–C4 and D1–D4 via the actual GitHub Actions runs on the first real PR after merge (with the spec's empirical scratch repo at `/tmp/changesets-test-39` as a reference).
- **Alternatives:** Add an act-based local CI runner harness for the workflows; build a docker-compose harness for `npm publish` against a verdaccio registry.
- **Trade-offs:** Workflow-level testing is hard to fixture honestly. The CI behaviour is fully determined by `changedFilePatterns` and the validator (both unit-testable); manual end-to-end verification on the first feature PR catches integration concerns.
- **Traces to:** R8.9, A9, B1–B8 (validator unit-testable), C1–C4 / D1–D4 / F1–F3 (verified post-merge per the spec's acceptance criteria).

## Dependencies

### New devDependencies (added to `package.json`)

- `@changesets/cli@^2.31.0` — pinned at the spec's tooling-pin (R5, R8.2). Provides `npx changeset`, `npx changeset add`, `npx changeset status`, `npx changeset version`, `npx changeset publish`.
- `@changesets/changelog-github@^0.7.0` — pinned at the spec's tooling-pin. Custom `getReleaseLine` that enriches each entry with `(#PR by @author)`.

### Existing dependencies reused

- `yaml@^2.8.3` (at `package.json:46`) — parser for changeset front matter inside the validator. No new YAML dependency added.
- `tsx@^4.21.0` (at `package.json:44`) — runs the TypeScript validator without a build step (`npx tsx scripts/validate-changesets.ts`).

### External GitHub Actions

- `actions/checkout@v6` — pinned major. `fetch-depth: 0` in both workflows.
- `actions/setup-node@v6` — pinned major. `node-version: 22`, `cache: npm`.
- `changesets/action@v1` — the spec's R5.4 / R5.5 expectations (default tag, default Release creation) are this action's defaults; pin to the major.

### External services

- **GitHub** — workflows, PRs, branches, Releases.
- **npm registry** — publish target; OIDC trusted publisher binding required per E4.

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

### Observability

- **CI logs** — every step's output is available in GitHub Actions, indexed by job and step name; the validator's line-numbered errors and `changeset status`'s canonical hint both surface here.
- **`CHANGELOG.md`** — the consumer-facing observable. Every published version has an entry; missing entries indicate an "I forgot a changeset" event (recovered via R7.3).
- **GitHub Releases page** — for each published version, the Release body mirrors the `CHANGELOG.md` section. A version with no Release indicates a partial publish failure; recovery is re-run the job (the action recreates the Release idempotently).
- **npm registry metadata** — `npm view @automattic/skillsmith` shows publish times, versions, and (when OIDC succeeded) provenance attestations. The provenance is the integrity observable for consumers.

### Pre-1.0 guard observability

The validator's pre-1.0 message references `CONTRIBUTING.md#pre-10-policy` — a stable anchor in the contributor doc. The anchor is the spec's R6.2 requirement (`#pre-10-policy`). The design enforces the anchor in `CONTRIBUTING.md` and the validator's error message together.

## Risks and Open Questions

### Risks

- **R-bot-honors-patterns (open).** R9.4 — does `@changesets/bot` honour `changedFilePatterns`? The design recommends installing the bot only if a maintainer wants the educational comments and accepts the tolerable noise. If the bot does **not** honour the patterns, contributors on excluded PRs will see "Add a changeset" comments they can safely ignore. The CI gate remains the source of truth.
- **R-rename-confusion.** If the owner declines `@automattic/skillsmith` at merge time, every reference in `package.json`, `README.md`, `CONTRIBUTING.md`, and `.changeset/<random>.md` front matter (the empty starter has no key, so it is unaffected) must be updated. Mitigated by E1's PR-description checklist.
- **R-E4-not-configured-at-first-publish.** D4 ("first real feature PR ships end-to-end") relies on E4 being configured before the maintainer merges the first non-empty Version Packages PR. If E4 is missing, publish fails 401. The repo state (commit, tag, Release) is unaffected; recovery is configure E4, re-run the failed job. Mitigated by surfacing E4 in the pre-merge checklist (E1–E4 in the PR description).
- **R-skip-ci-future-workflow.** R9.1 — if a future PR adds a `test.yml` on `push: trunk`, `[skip ci]` in the Version Packages commit will skip it, leaving the version-bump commit untested by that workflow. Mitigated by recommending future CI workflows trigger on `pull_request` (verified by the Version Packages PR's own gate run before merge).
- **R-bot-attribution-on-backfill.** R7.3 — `@changesets/changelog-github` attributes a backfilled changeset to the backfill PR, not the original. The design accepts this cosmetic wart and propagates a `> Backfilled from PR #<original>` line into `CHANGELOG.md` via the changeset body. Live with it; do not write tooling to invert it.
- **R-validator-yaml-line-numbers.** The `yaml@2.8.3` parser provides source positions; converting to a 1-based line number for the validator's error format requires the API supports it. If line precision proves infeasible without a major refactor, fall back to "line of the front-matter region" (e.g. `2`) — the file/region pointer is the load-bearing UX, not the exact column.
- **R-trunk-protection-prevents-bot-push.** E3 — branch protection must allow `github-actions[bot]` to push to `changeset-release/trunk` while still requiring human review on the release PR. If misconfigured, `changesets/action` fails on the first commit. Mitigated by surfacing E3 in the pre-merge checklist.

### Open questions logged for review

1. **OQ-1 (R9.4, partially resolved).** Final, verified behaviour of `@changesets/bot` against `changedFilePatterns` — the design recommends accepting the bot as non-blocking and tolerating any noise. The reviewer may opt to install the bot or defer the install; the design ships with the bot uninstalled and documents it as optional in `CONTRIBUTING.md`'s "Repo configuration prerequisites".
2. **OQ-2 (validator line precision).** Whether `yaml@2.8.3` gives the validator enough source-position information for per-error 1-based line numbers in front matter, or whether the design's fall-back to "line of front-matter region" (`:2:`) is acceptable. Will be settled in implementation; the spec's "line-numbered" requirement is met under either reading.
3. **OQ-3 (`.changeset/<random>.md` filename for the empty starter).** Spec says `<random>`. The implementation may pin a deterministic name (e.g. `initial-empty.md`) for reproducibility, or use `npx changeset add --empty`'s random name. Either satisfies R8.6 / A6 ("exactly one empty changeset file at `.changeset/<random>.md`"); the design's recommendation is to use the randomly-generated name to match the rest of the changesets-on-disk style, but it does not block.
4. **OQ-4 (kill-switch test).** Whether the `skip_publish` input should be exercised once before merge as a smoke test, or left for the maintainer to drive on first emergency. Design defers to maintainer judgement; no test wiring needed.
