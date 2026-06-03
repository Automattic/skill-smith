# Spec — Changelog and Versioning

Issue: [Automattic/skillsmith#39](https://github.com/Automattic/skillsmith/issues/39) — _Add a changelog and automate package version bumps_

## Overview

The `skillsmith` package publishes a human-readable `CHANGELOG.md` of user-facing changes and bumps `package.json:version` consistently as those changes are released. The mechanism is the [Changesets](https://github.com/changesets/changesets) library: contributors add a small per-PR changeset file; on merge to `trunk` an automation opens a "Version Packages" PR that, when a maintainer merges it, applies the version bump, updates `CHANGELOG.md`, tags the commit, creates a GitHub Release, and publishes to npm.

Outcome:

- A consumer running `npm install -D <package>` can read `CHANGELOG.md` (or the matching GitHub Release notes) and know exactly what changed between any two versions of the package they consume.
- A contributor opening a PR that touches release-relevant code is mechanically reminded to add a changeset, and shape errors in that changeset are caught in CI rather than at publish time.
- A maintainer merging a Version Packages PR can rely on the workflow to bump `package.json`, append to `CHANGELOG.md`, tag the commit, create a GitHub Release, and publish to npm without further manual steps.

## Context (assumed, with one owner-level decision)

- Single-package repository. `package.json` at the worktree root, currently `name: "skillsmith"`, `version: "0.1.0"`, license `GPL-3.0`.
- Repo: `Automattic/skillsmith`. Default branch: `trunk`.
- Package manager: `npm` (per `package-lock.json`). Today there is no `.github/workflows/` directory, no `CHANGELOG.md`, no `publishConfig`, and no `release`/`version` scripts in `package.json`.
- **The unscoped npm name `skillsmith` is not owned by Automattic.** Empirically (`npm view skillsmith`) it is held by `jonschlinkert <github@sellside.com>` at version `0.0.1`, MIT-licensed — an unrelated package. The spec assumes a rename to **`@automattic/skillsmith`** (the recommended path; the scope is empirically available — `npm view @automattic/skillsmith` returns 404 — and ~50 existing `@automattic/*` packages confirm the org → publish-rights binding). **This is an owner-level decision** and is the first item in the pre-merge checklist below.
- Tooling pinned versions (latest at research time): `@changesets/cli` 2.31.0, `@changesets/changelog-github` 0.7.0, `changesets/action` v1.8.0.

## Requirements

Requirements are grouped by area. Each requirement is testable.

### R1. Changeset coverage policy (when a PR must ship a changeset)

R1.1. A PR **must** include a changeset when any of the following are touched:
- (a) CLI behaviour or flag changes (`bin/skillsmith.mjs`).
- (b) Hook contract / `defineConfig` schema changes — the public types in `src/config/types.ts`, the `defineConfig` signature, or the hook lifecycle order.
- (c) Report-JSON or on-disk run-layout changes — field names or shape of `report.json` / `run.json`, or the documented directory tree.
- (d) Provider support — added or removed providers, or changes to per-provider option types (anything that widens or narrows `ProviderId`).
- (e) Bug fixes affecting (a)–(d) — recorded as `patch`.
- (f) Dependency bumps **only** when behaviour, peer ranges, or `engines` change. Behaviour-equivalent bumps do not require a changeset.

R1.2. A PR **does not** need a changeset (and CI must not nag) for:
- (g) Documentation/README prose-only changes. (When a code change updates the documented contract, the changeset accompanies the code change, not the doc edit.)
- (h) Internal refactors, internal type-only changes that do not reach the public re-exports, tests, lint/format config, CI config, lockfile maintenance, repo metadata, pipeline artefacts (`.rp.md`, `.pipelines/**`), `LICENSE` typo fixes, `package-lock.json`-only changes, the `testing-project/` fixture, and the `docs/` landing page.

R1.3. **Empty-changeset escape hatch.** For a PR that touches release-relevant paths but legitimately does not warrant a release entry, contributors run `npx changeset add --empty`. This writes a file containing just `---\n---`, which `changeset version` consumes and deletes without bumping anything.

R1.4. **Edge-case rulings** that must be reflected in contributor documentation:
- `examples/skillsmith.config.ts` is consumer-facing reference code. A change there that exercises a new public API is a (b)-style change requiring a changeset.
- Adding a new provider (widening `ProviderId`) is a **minor** bump, even though exhaustive switches in consumer code would need updates — consumers are responsible for the `never` case.
- `README.md` mixes prose and contract. The gate fires on the whole file; cosmetic prose-only edits rely on the empty-changeset escape.

### R2. CI gate (detection and enforcement)

R2.1. A required CI check **fails** the PR when a changeset is missing for a diff that touches release-relevant paths.

R2.2. Detection is performed by Changesets itself via the `changedFilePatterns` option in `.changeset/config.json`. **There is no separate `paths-filter`-style step** — the gate collapses to a single command, `npx changeset status --since=<base>`. The exclusion list lives as data in `.changeset/config.json`, not in workflow YAML.

R2.3. The pattern set must be:

```json
[
  "src/**",
  "bin/**",
  "package.json",
  "examples/**",
  "README.md",
  "!src/__tests__/**"
]
```

Anything not matched (`docs/**`, `testing-project/**`, `.github/**`, `.changeset/**`, `biome.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `.rp.md`, `.pipelines/**`, `LICENSE`, `package-lock.json`) is implicitly excluded and must not trigger the gate.

R2.4. **The empty-changeset escape (R1.3) remains operative.** A PR that adds an empty changeset must pass the gate even when it touches release-relevant paths.

R2.5. **Shape validation must be performed by a custom script, not by `changeset status`.** `changeset status` silently treats malformed changesets as nonexistent — verified empirically for: missing closing `---` fence, invalid bump type, package name not in workspace, no front matter at all (all surface the same misleading "no changesets found" message); and an empty-body changeset slips through both `status` and `version` and produces a literal empty bullet in `CHANGELOG.md`. Therefore the project must ship **`scripts/validate-changesets.ts`** (~50 lines, using the existing `yaml@2.8.3` dependency at `package.json:46` — no new deps). The script must:

- For each `.changeset/*.md` (skip `README.md`):
  - require two `---` fences with parseable YAML between them;
  - allow the empty-changeset case (`---\n---` with no front matter and no body);
  - otherwise require a non-empty body;
  - require every front-matter key to equal `package.json:name`;
  - require every front-matter value to be in `{patch, minor, major, none}`.
- While `package.json:version` starts with `0.`, reject any `major` bump with a clear error pointing at the pre-1.0 section of `CONTRIBUTING.md` (this folds in R3.4).
- Print line-numbered errors to stderr and exit non-zero on any failure.

R2.6. The CI changeset job must run `scripts/validate-changesets.ts` **first**, then `npx changeset status --since=<base>`. Both must pass for the gate to be green.

R2.7. (Optional, non-blocking.) The `@changesets/bot` GitHub App may be installed for educational PR comments. It is complementary — it does not replace the CI gate.

### R3. Bump-type and pre-1.0 semver policy

R3.1. Post-1.0 steady-state bump-type → semver mapping (this table is contract; contributor docs must reproduce it verbatim):

| Bump | Triggers |
|---|---|
| **patch** | Bug fix to existing CLI / hook / report / provider behaviour. Behaviour-equivalent dep bump. Improved error messages. Perf-only changes. **Loosening** the `engines.node` floor. Default-value change with identical observable behaviour. Security fix that does not require consumer code changes. |
| **minor** | Additive new CLI flag with sensible default. New optional hook. New optional `defineConfig` / `selfImprovement` field. New optional `report.json` field. New provider. New provider option. New exported symbol. Widened type union. New deprecation warning on an existing API. New additive field on hook context structs (`IterationInfo`, `RunContext`, etc.) the harness passes *into* hooks. |
| **major** | Removed/renamed/semantically-changed CLI flag. Removed hook or required-changed hook arg. Removed/renamed/required-changed `defineConfig` or `selfImprovement` field. Removed/renamed `report.json` field, **or a same-named field whose semantics shifted** (e.g. `inputTokens` redefined from "gross" to "new only"). Removed provider. **Raised** `engines.node` minimum. Peer or runtime dep major bump that ripples. Default-behaviour change visible to existing configs. Lifecycle-order change between hooks. Removal of a previously-deprecated API. Narrowed public type. |

R3.2. Direction of `engines.node` matters: raising the floor is **major**; lowering or removing is at most **minor** (usually **patch**).

R3.3. Hook context structs (`IterationInfo`, `RunContext`, any other struct the harness passes *into* a hook) are bidirectional contract: adding a field is **minor**, removing/renaming a field is **major**. A same-named field whose semantics shifted is **major** (a rename in everything but the symbol).

R3.4. **Pre-1.0 policy.** While `package.json:version` starts with `0.`, contributors **must write `minor` (never `major`) for breaking changes** and document the break with a `BREAKING:` prefix in the changeset summary. Rationale: aligns with [semver §4](https://semver.org/#spec-item-4); and empirically a `major` changeset with the canonical Changesets configuration on `0.x` jumps the package straight to `1.0.0` with no built-in opt-out (verified against `@changesets/cli` 2.31.0 in `/tmp/changesets-test-39`; tracked upstream as [changesets/changesets#1887](https://github.com/changesets/changesets/issues/1887)).

R3.5. **Cutting 1.0.0** is a deliberate maintainer action with the following criteria documented in `CONTRIBUTING.md`: (a) the public API surface in `src/index.ts` has been stable across two consecutive minor releases with no breaking changes; (b) the `Hooks` contract has not changed in a breaking way for one release cycle; (c) at least one downstream consumer outside Automattic is in active use, or a maintainer explicitly declares the API ready. Cutting 1.0.0 removes the pre-1.0 guard, hand-writes the 1.0.0 `CHANGELOG.md` entry summarizing accumulated breaks, sets `package.json.version`, and tags.

R3.6. The `package.json` version **stays at `0.1.0` for this PR**, and an initial `## 0.1.0` entry must be hand-written in `CHANGELOG.md` (one-liner: e.g. *"Initial release. Skill testing harness + self-improvement loop."*). Justification: `package.json` already claims `0.1.0`, and the file format `changeset version` maintains is append-above-the-top, so the backfilled entry will sit safely below future ones.

### R4. Release workflow

R4.1. **Workflow shape: `changesets/action` "Version Packages" PR pattern.** On every push to `trunk`, the action checks for pending changesets; if any exist, it opens (or updates) a PR titled "Version Packages" on a release branch named `changeset-release/trunk`. Merging that PR triggers tag, GitHub Release, and npm publish in the same workflow.

R4.2. **Trigger:** `on: push: branches: [trunk]` (not `pull_request: closed` — push captures every path to `trunk` including direct admin pushes for hotfix-reverts, and matches every canonical Changesets example).

R4.3. **Concurrency guard required:** `concurrency: ${{ github.workflow }}-${{ github.ref }}` to prevent two simultaneous merges racing the Version Packages PR or double-publishing.

R4.4. **Pre-publish checks must run sequentially in the same job before publish** (Pattern A): `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` → `changesets/action@v1` with `publish: npx changeset publish`. Cost: ~30s extra CI per release; value: never ship a broken publish because of a flaky dep or post-merge regression.

R4.5. **`actions/checkout` must use `fetch-depth: 0`.** The action calls `git log` to attribute changesets to commits for release notes; without full history those notes lose context.

R4.6. **Minimum required workflow permissions** (must be exactly this — no `packages: write`, no `issues: write`):
```yaml
permissions:
  contents: write       # commit version bump, create tags, create GitHub Releases
  pull-requests: write  # create/update the Version Packages PR
  id-token: write       # npm OIDC trusted publishing
```

R4.7. **Branch model: single-track from `trunk`.** No maintenance or release branches. Pre-1.0 by R3.4 there is no parallel-major scenario by construction. Post-1.0 prerelease branches are deferred.

R4.8. **`baseBranch` in `.changeset/config.json` must be `"trunk"`** (matches the workflow trigger; `changeset init` defaults to `"main"`, so an explicit override is required).

R4.9. The action **must only open/update the Version Packages PR when at least one non-README `.changeset/*.md` exists**, and when an open Version Packages PR already exists and a new changeset lands, the action must force-push the release branch and regenerate the PR body and `CHANGELOG.md` (default behaviour of `changesets/action` v1.8.0 — must not be disabled).

R4.10. A `workflow_dispatch` kill-switch input (e.g. `skip_publish: boolean`) **should** be present so a maintainer can manually run the workflow in "version-PR-only" mode without publishing.

### R5. Publishing target

R5.1. **Tag + GitHub Release + npm publish.** All three are produced by the release workflow.

R5.2. **Package name: `@automattic/skillsmith`** (subject to the owner-level confirmation in the pre-merge checklist below). `package.json` must include `"publishConfig": { "access": "public" }`, and `.changeset/config.json` must include `"access": "public"`.

R5.3. **Authentication: npm Trusted Publishing (OIDC).** The workflow publishes with no `NPM_TOKEN` env var; npm CLI v11.5.1+ auto-generates provenance attestations. The `NPM_TOKEN` automation-token + explicit `--provenance` flag is documented as a fallback only.

R5.4. **Tag format: `@automattic/skillsmith@<version>`** (the action default). Do not override.

R5.5. **`createGithubReleases: true`** (the action default). Release notes are auto-populated from the matching `CHANGELOG.md` section.

R5.6. **`@changesets/changelog-github` v0.7.0** must be used as the changelog plugin (enriches each entry with PR links and author handles):
```json
"changelog": ["@changesets/changelog-github", { "repo": "Automattic/skillsmith" }]
```

### R6. Contributor authoring UX and documentation

R6.1. **Policy documentation must split between `CONTRIBUTING.md` (full policy) and `.changeset/README.md` (project-specific cheat sheet replacing the Changesets-seeded boilerplate).**

R6.2. **`CONTRIBUTING.md` must include:**
- Intro / link to `README.md` and to the project layout.
- Running tests and checks locally.
- An "Adding a changeset" section pinned at the anchor **`#adding-a-changeset`** that covers:
  - When a changeset is required (R1.1/R1.2/R1.3, with the edge cases from R1.4).
  - Bump-type table from R3.1.
  - Pre-1.0 policy from R3.4 (anchor `#pre-10-policy` — referenced by the validator error message).
  - How to add a changeset — both interactive (`npx changeset`) and direct-file authoring, **documented with equal billing** (interactive is awkward for multi-line summaries — [changesets#346](https://github.com/changesets/changesets/issues/346) — so direct-write is the standard for repeat contributors and AI-assisted PRs; interactive is suggested for first-time contributors).
  - Empty changesets (`npx changeset --empty`), with the on-disk file format (`---\n---`).
  - Changeset summary format conventions from R6.4.
  - Consumer-perspective writing guidance from R6.5.
  - A worked example of what `CHANGELOG.md` looks like to consumers (with `@changesets/changelog-github` enrichment).
- Release process: cross-link to `.github/workflows/release.yml`, with the manual escape hatch from R7.1 and the rollback procedure from R7.2.
- "I forgot a changeset" recovery procedure (R7.3).
- "Repo configuration prerequisites" section documenting the persistent prerequisites (items 2, 3, 4 of the pre-merge checklist), so future maintainers can audit them.

R6.3. **`.changeset/README.md` must replace the Changesets-seeded boilerplate** with content that:
- Briefly explains the folder.
- Links to `../CONTRIBUTING.md#adding-a-changeset`.
- Shows a quick-start (`npx changeset`, `npx changeset --empty`).
- Shows the anatomy of a changeset (front matter + body example).

R6.4. **Changeset summary format conventions:**
- Voice/tense: **imperative present** ("Add ...", "Fix ...", "Remove ...").
- **No conventional-commits prefixes** (no `feat:`, `fix:`, `perf:`, `chore:`, `refactor:`). Bump type already encodes category.
- **`BREAKING:` prefix is required for pre-1.0 breaks.** A second `Migration:` line is encouraged for non-trivial breaks but not strictly required.
- Soft cap ~120 chars per summary line (not CI-enforced). Multi-line bodies allowed; prefer splitting into multiple changesets so each bump is its own scannable bullet.
- **No manual PR/author references.** `@changesets/changelog-github` auto-appends `(#PR, by @author)`. Linking a related but separate issue in the body is acceptable.

R6.5. **Consumer-perspective writing guidance** (audience: consumers running `npm install -D @automattic/skillsmith`):
- Type-only changes still get changesets, written in consumer-impact terms (e.g. "Narrow `Hooks.afterScenario` parameter type to require a `Scenario`-shaped argument. Callers passing untyped objects will see a TypeScript error.").
- Bug fixes a user may not have observed still get changesets, written in symptom terms (e.g. "Fix race condition where two concurrent `run()` calls would corrupt the `report.json` aggregate.").
- `examples/skillsmith.config.ts` updates: the changeset describes the *new public API* the example demonstrates, not "update example".
- A changeset for a refactor with zero consumer-visible effect is a signal the contributor should have used `--empty`; flag in review.

R6.6. **`README.md` updates (~10 lines total):**
- A new `## Installation` subsection: `npm install -D @automattic/skillsmith`, plus `Requires Node.js ≥ 20.17.`
- A new `## Releases` section linking to `CHANGELOG.md` and the GitHub Releases page.
- A new `## Contributing` section linking to `CONTRIBUTING.md`.
- No other release/contributor content in `README.md`.

R6.7. **Dependency-bump PRs (Renovate / Dependabot):** `CONTRIBUTING.md` must state that dep-bump PRs require a changeset like any other PR, and that a maintainer merging a bot PR should add the changeset to the bot's branch before merging (`npx changeset` works against any branch). Wiring an auto-bot (e.g. `mscharley/dependency-changesets-action`) is out of scope for #39 and tracked as a follow-up. **`package.json` must remain inside `changedFilePatterns`** — dep bumps with real consumer impact must trigger the gate.

### R7. Safety nets and recovery

R7.1. **Manual publish escape hatch.** `CONTRIBUTING.md` must document the emergency-only manual publish procedure (`git pull --ff-only` on `trunk` → `npm ci` → `npx changeset version` → inspect/`git restore .` to abort → commit, push, `npm publish --access public`, `gh release create`). It must note:
- Auth: maintainer's personal automation token in `~/.npmrc` or interactive 2FA OTP (`npm publish --otp=<code>`).
- Trade-off: manual publish does **not** produce npm provenance attestations (provenance requires OIDC + GitHub Actions). Acceptable for emergency-only.

R7.2. **Rollback / bad-publish procedure.** `CONTRIBUTING.md` must document, in this order:
1. **Cut a fix release** — PR with the revert/fix and a `patch` changeset describing what broke; merge through the normal release flow.
2. **Deprecate the bad version**: `npm deprecate @automattic/skillsmith@<version> "Withdrawn — contained <bug>. Use <fixed-version> or later."` (requires npm auth on the maintainer's machine — OIDC is workflow-only).
3. **Edit the GitHub Release** for the bad version: mark pre-release; prepend "**WITHDRAWN — see [next-version](link)**". Do not delete the Release.
4. **Unpublish only as last resort** — within 72 hours, no known consumers, version is dangerous (leaked secret, malware, PII). Burns the version number forever.
5. **`latest` dist-tag rescue** when a clean fix release can't ship quickly: `npm dist-tag add @automattic/skillsmith@<previous-good-version> latest`.

R7.3. **"I forgot a changeset" recovery.** `CONTRIBUTING.md` must document: open a new PR against `trunk` that adds only the missing changeset; write the summary as if it had been in the original PR; include a `> Backfilled from PR #<original-PR>` line at the bottom of the body so reviewers can trace the lineage. Note the known cosmetic wart: `@changesets/changelog-github` attributes the entry to the backfill PR, not the original; the `> Backfilled from PR #<original>` line is propagated into `CHANGELOG.md` to keep the original discoverable.

R7.4. **Re-running a failed release.** `CONTRIBUTING.md` must state that `changeset publish` is idempotent at the per-package level (verified in changesets source: `publishPackages.ts` calls `infoAllow404(packageJson)` then skips versions already published on npm). The safe action when a release run fails partway is to re-run the failed job from the Actions UI, not to publish manually.

R7.5. **Pre-release verification (dry-run).** `CONTRIBUTING.md` must document:
- Local version dry-run: `npx changeset version` → inspect with `git status` / `git diff` → `git restore .` to abort.
- Local publish dry-run: `npm publish --dry-run --access public` (fails if the version already exists on npm — a useful sanity check).

### R8. Files delivered by this PR

The PR for #39 must add or modify exactly the following set:

R8.1. **`CHANGELOG.md`** at the repo root, with a hand-written `## 0.1.0` initial entry (R3.6).

R8.2. **`package.json`** changes:
- `name`: `@automattic/skillsmith` (subject to owner confirmation per the pre-merge checklist).
- `publishConfig: { access: "public" }`.
- New devDependencies: `@changesets/cli ^2.31.0`, `@changesets/changelog-github ^0.7.0`.
- New scripts: `"changeset": "changeset"`, `"release": "changeset publish"`.
- `repository.url` and `homepage` unchanged — still point at `Automattic/skillsmith`.

R8.3. **`package-lock.json`** updated for the new devDependencies.

R8.4. **`.changeset/config.json`** with:
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

R8.5. **`.changeset/README.md`** replaced with the project-specific cheat sheet per R6.3.

R8.6. **One empty changeset** at `.changeset/<random>.md` containing `---\n---`, so the gate passes on this PR's merge (R3.6, R2.4).

R8.7. **`CONTRIBUTING.md`** containing all sections required by R6.2 (target ~150 lines; prose drafting happens in the design / docs phases, not in the spec).

R8.8. **`README.md`** with the three new sections from R6.6 (~10 lines added in total).

R8.9. **`scripts/validate-changesets.ts`** implementing the shape validator + pre-1.0 guard per R2.5.

R8.10. **`.github/workflows/changeset-gate.yml`** (or an added job in an existing CI workflow) that runs `scripts/validate-changesets.ts` then `npx changeset status --since=origin/${{ github.event.pull_request.base.ref }}`.

R8.11. **`.github/workflows/release.yml`** matching R4 — `on: push: branches: [trunk]`; concurrency guard; minimum permissions per R4.6; `actions/checkout@v6` with `fetch-depth: 0`; `actions/setup-node@v6` with Node 22 and `cache: npm`; lint/typecheck/test before `changesets/action@v1` with `publish: npx changeset publish`; `workflow_dispatch` kill-switch input per R4.10.

### R9. Out-of-spec / forward-looking notes the design must surface

R9.1. **`changesets/action` includes `[skip ci]` in its "Version Packages" commit** ([changesets/action#198](https://github.com/changesets/action/issues/198)). For skillsmith today with a single workflow this is fine; the design must confirm any future test/lint workflow trigger model does not conflict with `[skip ci]`.

R9.2. **`@changesets/changelog-github` needs `GITHUB_TOKEN` for the version step** (not just publish) to fetch PR/author metadata. `changesets/action` injects this automatically when the permissions in R4.6 are present.

R9.3. **Custom dist-tag re-publish edge case** ([changesets/changesets#1285](https://github.com/changesets/changesets/issues/1285)): with non-`latest` dist tags, the npm-info check can be empty and `publish` re-tries. Skillsmith uses `latest`, so this does not apply — flag for design-doc completeness only.

R9.4. **`@changesets/bot` interaction with `changedFilePatterns`** is an unverified open question: confirm during design whether the bot still posts educational comments when `changedFilePatterns` excludes a PR's diff. The bot is non-blocking either way, so any noise is tolerable.

## Out of Scope

The following are explicitly **not** delivered by #39:

- **Renovate / Dependabot configuration.** Skillsmith has neither today. A future PR may add one; the manual fallback for dep-bump changesets is documented in `CONTRIBUTING.md` (R6.7).
- **`mscharley/dependency-changesets-action` (or equivalent) wiring.** Tracked as a follow-up for when a dep-bot is added.
- **`@changesets/bot` install** (the GitHub App posting educational PR comments) is optional and may be installed separately by a maintainer; it is not part of this PR's deliverables. If installed, it is non-blocking and complementary to the CI gate.
- **1.0.0 cut procedure refinements.** The criteria in R3.5 are stated; the actual cut is a future maintainer action with its own PR.
- **Prerelease branches and the `changeset pre` command.** Single-track from `trunk` only, per R4.7.
- **A scheduled "Version Packages PR aging" reminder workflow.** Deferred to design-doc / follow-up.
- **Splitting `README.md`** so prose-only edits bypass the gate. The empty-changeset escape is the present answer; revisit only if friction shows.
- **CI-enforced summary length / linting beyond shape.** The 120-char cap and conventions in R6.4 are soft, documented in `CONTRIBUTING.md`, not enforced by `scripts/validate-changesets.ts`.
- **Custom tag format.** The action's default `@automattic/skillsmith@<version>` is accepted (R5.4).
- **Disputing the unscoped `skillsmith` name with npm Support.** The accepted path is the scope rename to `@automattic/skillsmith`.

## Acceptance Criteria

A reviewer can verify the PR is complete by checking these conditions.

### A. Files exist and are well-formed

A1. `CHANGELOG.md` exists at the repo root with a `## 0.1.0` entry summarizing the initial release.

A2. `package.json`:
- `name` is `@automattic/skillsmith`.
- `publishConfig.access` is `"public"`.
- `devDependencies` contains `@changesets/cli ^2.31.0` and `@changesets/changelog-github ^0.7.0`.
- `scripts` contains `"changeset": "changeset"` and `"release": "changeset publish"`.
- `repository.url` and `homepage` still point at `Automattic/skillsmith`.

A3. `package-lock.json` reflects the new devDependencies (regenerated by `npm install`).

A4. `.changeset/config.json` exists with the exact fields and `changedFilePatterns` array in R8.4. `baseBranch` is `"trunk"`. `access` is `"public"`. The `changelog` field uses `@changesets/changelog-github` with `repo: "Automattic/skillsmith"`.

A5. `.changeset/README.md` is the project-specific cheat sheet (R6.3), not the upstream-seeded boilerplate, and links to `../CONTRIBUTING.md#adding-a-changeset`.

A6. Exactly one empty changeset file exists at `.changeset/<random>.md` containing `---\n---`.

A7. `CONTRIBUTING.md` exists with sections covering: versioning policy, the bump-type table (verbatim from R3.1), the pre-1.0 policy (anchor `#pre-10-policy` matching the validator error), how to add a changeset (interactive and direct-write, equal billing), empty changesets, summary format conventions (R6.4), consumer-perspective writing guidance (R6.5), release process with the `release.yml` cross-link, the manual publish escape hatch (R7.1), the rollback procedure (R7.2), the "I forgot a changeset" recovery (R7.3), the re-run guidance (R7.4), the pre-release dry-run guidance (R7.5), and the repo configuration prerequisites section documenting items 2/3/4 of the pre-merge checklist. The `#adding-a-changeset` anchor is pinned and used by `.changeset/README.md`.

A8. `README.md` contains a `## Installation` subsection (with `npm install -D @automattic/skillsmith` and the Node ≥ 20.17 line), a `## Releases` section linking to `CHANGELOG.md` and the GitHub Releases page, and a `## Contributing` section linking to `CONTRIBUTING.md`. No other release/contributor content is added.

A9. `scripts/validate-changesets.ts` exists, uses the existing `yaml@2.8.3` dependency, and prints line-numbered errors to stderr.

A10. `.github/workflows/changeset-gate.yml` (or the equivalent job) runs `scripts/validate-changesets.ts` first, then `npx changeset status --since=origin/${{ github.event.pull_request.base.ref }}`.

A11. `.github/workflows/release.yml` matches R4 / R8.11 — correct trigger, concurrency guard, exactly the three permissions in R4.6, `fetch-depth: 0`, the lint/typecheck/test sequence before `changesets/action@v1`, and the `workflow_dispatch` kill-switch input.

### B. Behaviour the validator must enforce (testable directly against `scripts/validate-changesets.ts`)

B1. A valid changeset (`@automattic/skillsmith: minor`, non-empty body, matching package name, valid bump type) passes.

B2. An empty changeset (`---\n---`, no front matter, no body) passes.

B3. A missing closing `---` fence fails with a line-numbered error.

B4. An invalid bump type (e.g. `superminor`) fails.

B5. A package name not equal to `package.json:name` fails.

B6. An empty-body changeset with non-empty front matter fails.

B7. While `package.json:version` starts with `0.`, any `major` bump fails with a message referencing `CONTRIBUTING.md#pre-10-policy`.

B8. The script exits zero when no errors are detected, non-zero otherwise.

### C. Behaviour the CI changeset gate must exhibit on a real PR

C1. A PR diff that touches only paths outside `changedFilePatterns` (e.g. `docs/**`, `.github/**`, `.pipelines/**`, `LICENSE`, `package-lock.json` alone) passes the gate without a changeset.

C2. A PR diff that touches `src/**`, `bin/**`, `package.json`, `examples/**`, or `README.md` and includes **no** changeset fails the gate with `changeset status`'s canonical "missing changeset" error.

C3. The same PR with one **empty** changeset (`---\n---`) passes the gate.

C4. The same PR with one shape-malformed changeset (any of B3–B6 cases) fails the gate at the **validator step**, before `changeset status` runs.

### D. End-to-end release behaviour (post-merge)

D1. Merging this PR to `trunk` triggers `release.yml`. The pre-publish steps (lint/typecheck/test) succeed.

D2. `changesets/action@v1` sees one changeset (the empty one) and opens a no-op Version Packages PR on branch `changeset-release/trunk`. The PR diff is just the deletion of the empty changeset; no version bump and no `CHANGELOG.md` change (empirically verified in `/tmp/changesets-test-39`).

D3. Merging the no-op Version Packages PR does **not** bump `package.json.version` and does **not** publish anything.

D4. A subsequent feature PR that adds a real (`minor` or `patch`) changeset, when merged, causes the action to open a Version Packages PR that bumps `package.json.version`, appends to `CHANGELOG.md`, and on merge triggers `npm publish`. The publish is signed via OIDC, attaches provenance, and creates the matching GitHub Release with the changelog body. Verified manually with one end-to-end cycle.

### E. Maintainer / operational pre-merge checklist (owner-level actions, not code deliverables)

These four items are owner-level operational actions that must be resolved before the release workflow can succeed in production. They do **not** ship as files in this PR. The PR description must surface them as a pre-merge checklist; `CONTRIBUTING.md` (R6.2 "Repo configuration prerequisites") documents items E2–E4 for ongoing auditability.

E1. **Package-name confirmation.** Maintainer confirms `@automattic/skillsmith` (the spec's working assumption) is the chosen npm name. The unscoped `skillsmith` is owned by an unrelated party (`jonschlinkert <github@sellside.com>`, MIT, `0.0.1`); the recommended path is the scope rename, but the decision is owner-level. If a different name is chosen, every reference to `@automattic/skillsmith` in `package.json`, `.changeset/config.json`, `README.md`, `CONTRIBUTING.md`, and `scripts/validate-changesets.ts` must be updated before merge.

E2. **"Allow GitHub Actions to create and approve pull requests"** is enabled at Repo Settings → Actions → General → Workflow permissions. This is off by default in some Automattic-managed repos. Verified before first release attempt.

E3. **Branch protection on `trunk`** allows `github-actions[bot]` to push to `changeset-release/trunk` while still requiring human review on the release PR. Self-approval is prohibited. The current `Automattic/skillsmith` branch-protection rules must be audited against this model.

E4. **npm trusted-publisher binding** is configured on `npmjs.com` for: org `Automattic`, repo `skillsmith`, workflow file `release.yml`, allowed action `npm publish` (the explicit-action selection is mandatory for trusted publishers created after 2026-05-20). Requires a maintainer with `@automattic` npm-org admin rights. Must be in place before the first publish run; otherwise the publish step fails with a 401 and only the npm publish is skipped — the source tree and Version Packages PR are unaffected.

(Optional) `@changesets/bot` GitHub App installed on the repo — not required, complementary to the CI gate, may be added later.

### F. Post-merge verification

F1. The first `release.yml` run on this PR's merge commit succeeds (opens the no-op Version Packages PR per D2).

F2. Merging the no-op Version Packages PR results in no version bump and no npm publish (D3).

F3. The first real feature PR after launch ships a release end-to-end successfully — `npm publish` succeeds, the GitHub Release is created with the changelog body, and the tag `@automattic/skillsmith@<version>` is pushed (D4).
