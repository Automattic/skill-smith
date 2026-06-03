# Contributing

This file is the contributor and maintainer reference for skillsmith. For an overview of what the project is and how it runs, see [`README.md`](./README.md); the source layout follows the `src/`, `bin/`, and `examples/` directories described there.

## Running tests and checks locally

Run these before pushing a PR. Each maps to a script in [`package.json`](./package.json):

- `npm run lint` — Biome lint over the repo.
- `npm run typecheck` — `tsc --noEmit` against the project's `tsconfig.json`.
- `npm test` — Node test runner over `src/__tests__/*.test.ts`.
- `npm run smoke` — runs `bin/skillsmith.mjs` end-to-end against the working directory.

## Versioning policy

The package is published as `@automattic/skillsmith` and versioned with [Changesets](https://github.com/changesets/changesets). The contract is short: every PR that affects consumers carries a small `.changeset/*.md` file describing the change; on merge to `trunk`, automation opens a "Version Packages" PR that, when a maintainer merges it, bumps `package.json:version`, appends to `CHANGELOG.md`, tags the commit, creates a GitHub Release, and publishes to npm.

## Adding a changeset

### When a changeset is required

A PR must include a changeset when any of the following are touched:

- CLI behaviour or flag changes (`bin/skillsmith.mjs`).
- Hook contract or `defineConfig` schema changes — public types in `src/config/types.ts`, the `defineConfig` signature, or the hook lifecycle order.
- Report-JSON or on-disk run-layout changes — field names or shape of `report.json` / `run.json`, or the documented directory tree.
- Provider support — added or removed providers, or changes to per-provider option types (anything that widens or narrows `ProviderId`).
- Bug fixes affecting any of the above — recorded as `patch`.
- Dependency bumps **only** when behaviour, peer ranges, or `engines` change. Behaviour-equivalent bumps do not require a changeset.

A PR does NOT need a changeset (and CI does not nag) for: documentation prose-only edits, internal refactors, internal-type changes that do not reach the public re-exports, tests, lint/format config, CI config, lockfile maintenance, repo metadata, pipeline artefacts (`.rp.md`, `.pipelines/**`), `LICENSE` typo fixes, `package-lock.json`-only changes, the `testing-project/` fixture, and the `docs/` landing page.

Edge cases worth pinning:

- `examples/skillsmith.config.ts` is consumer-facing reference code. A change there that exercises a new public API is a hook-contract change and requires a changeset.
- Adding a new provider (widening `ProviderId`) is a **minor** bump even though exhaustive switches in consumer code would need updates — consumers are responsible for the `never` case.
- `README.md` mixes prose and contract. The gate fires on the whole file; cosmetic prose-only edits use the empty-changeset escape below.
- Tests-only changes (`src/__tests__/**`) do not require a changeset; the gate excludes that path explicitly.

### Bump types

| Bump | Triggers |
|---|---|
| **patch** | Bug fix to existing CLI / hook / report / provider behaviour. Behaviour-equivalent dep bump. Improved error messages. Perf-only changes. **Loosening** the `engines.node` floor. Default-value change with identical observable behaviour. Security fix that does not require consumer code changes. |
| **minor** | Additive new CLI flag with sensible default. New optional hook. New optional `defineConfig` / `selfImprovement` field. New optional `report.json` field. New provider. New provider option. New exported symbol. Widened type union. New deprecation warning on an existing API. New additive field on hook context structs (`IterationInfo`, `RunContext`, etc.) the harness passes *into* hooks. |
| **major** | Removed/renamed/semantically-changed CLI flag. Removed hook or required-changed hook arg. Removed/renamed/required-changed `defineConfig` or `selfImprovement` field. Removed/renamed `report.json` field, **or a same-named field whose semantics shifted** (e.g. `inputTokens` redefined from "gross" to "new only"). Removed provider. **Raised** `engines.node` minimum. Peer or runtime dep major bump that ripples. Default-behaviour change visible to existing configs. Lifecycle-order change between hooks. Removal of a previously-deprecated API. Narrowed public type. |

### Pre-1.0 policy

While `package.json:version` starts with `0.`, write `minor` (never `major`) for breaking changes and prepend `BREAKING:` to the summary. The local validator rejects `major` bumps with a message pointing back here. The rule aligns with [semver §4](https://semver.org/#spec-item-4), and avoids the default Changesets behaviour that jumps a `0.x` package straight to `1.0.0` with no built-in opt-out.

Cutting `1.0.0` is a deliberate maintainer action: the public API surface in `src/index.ts` must have been stable across two consecutive minor releases with no breaking changes; the `Hooks` contract must not have changed in a breaking way for one release cycle; and at least one downstream consumer outside Automattic must be in active use (or a maintainer must explicitly declare the API ready). The cut removes the pre-1.0 guard, hand-writes the `1.0.0` `CHANGELOG.md` entry summarizing accumulated breaks, sets `package.json:version`, and tags.

### How to add a changeset — interactive or direct-write

Both paths are first-class. Interactive prompting is friendliest the first time; direct file authoring is the standard for repeat contributors and AI-assisted PRs.

**Interactive.** Run `npx changeset` at the repo root. The CLI prompts for the affected package, the bump type, and the summary, then writes the file under `.changeset/`. Interactive entry is awkward for multi-line summaries ([changesets#346](https://github.com/changesets/changesets/issues/346)) — prefer direct-write when the summary needs more than one line.

**Direct-write.** Create a file at `.changeset/<short-name>.md` with this shape:

```md
---
"@automattic/skillsmith": minor
---

Add `--scope failed-pairs` CLI flag to control re-evaluation scope.
```

The front-matter key must equal `package.json:name`; the value must be one of `patch`, `minor`, `major`, or `none`; the body must be non-empty. The validator enforces all three.

### Empty changesets

For a PR that touches release-relevant paths but legitimately warrants no release entry — for example, a cosmetic README edit — use the empty-changeset escape:

```sh
npx changeset --empty
```

This writes a file with no front matter and no body (just `---\n---` on disk). `changeset version` consumes and deletes the file without bumping anything; the CI gate still passes because the changeset exists.

### Summary format conventions

- Imperative present: "Add ...", "Fix ...", "Remove ...".
- No conventional-commits prefixes (no `feat:`, `fix:`, `perf:`, `chore:`, `refactor:`). The bump type already encodes the category.
- `BREAKING:` prefix is required for pre-1.0 breaks. A second `Migration:` line is encouraged but not required for non-trivial breaks.
- Aim for ~120 characters per summary line. Multi-line bodies are allowed; prefer splitting into multiple changesets so each bump becomes its own scannable bullet.
- Do not hand-write PR or author references. `@changesets/changelog-github` appends `(#PR by @author)` automatically. Linking a related but separate issue from the body is fine.

### Consumer-perspective writing guidance

The audience for every entry is the consumer running `npm install -D @automattic/skillsmith`. Write each summary in their terms:

- Type-only changes still get changesets, written in consumer-impact terms — e.g. "Narrow `Hooks.afterScenario` parameter type to require a `Scenario`-shaped argument. Callers passing untyped objects will see a TypeScript error."
- Bug fixes a user may not have observed still get changesets, written in symptom terms — e.g. "Fix race condition where two concurrent `run()` calls would corrupt the `report.json` aggregate."
- `examples/skillsmith.config.ts` updates describe the *new public API* the example demonstrates, not "update example".
- A changeset for a refactor with zero consumer-visible effect is a signal the contributor should have used `--empty` instead; flag it in review.

### What this looks like in `CHANGELOG.md`

`@changesets/changelog-github` enriches every entry with the originating PR and author. A future stretch of the changelog reads:

```md
# @automattic/skillsmith

## 0.2.0

### Minor Changes

- abc1234: Add `--scope failed-pairs` CLI flag to control re-evaluation scope. (#42 by @author)

### Patch Changes

- def5678: Fix race condition where two concurrent `run()` calls would corrupt the `report.json` aggregate. (#41 by @another-author)
```

## Release process

Releases ride [`.github/workflows/release.yml`](./.github/workflows/release.yml). The steady-state flow is:

1. A PR with a real changeset merges to `trunk`.
2. The workflow opens (or updates) a "Version Packages" PR on `changeset-release/trunk`. The PR diff is the `package.json:version` bump, the `CHANGELOG.md` append, and the deletion of the consumed changesets.
3. A maintainer reviews and merges the Version Packages PR.
4. The same workflow runs again, sees no pending changesets, and invokes `npx changeset publish` — tagging the commit `@automattic/skillsmith@<version>`, creating the matching GitHub Release with the changelog body, and publishing to npm with OIDC-signed provenance.

Until the first real feature changeset ships, `release.yml` runs under `workflow_dispatch` only; the steady-state `push: [trunk]` trigger is added by the same PR that introduces the first non-`none` changeset.

## Manual publish escape hatch

Emergency only. The OIDC-signed automated pipeline is the standard path; manual publishes do not produce npm provenance attestations.

```sh
git checkout trunk && git pull --ff-only
npm ci
npx changeset version            # inspect with `git status` / `git diff`;
                                 # `git restore .` to abort
git commit -am "Version Packages" && git push origin trunk
npm publish --access public      # `~/.npmrc` auth or `--otp=<code>` for 2FA
gh release create @automattic/skillsmith@<version> --notes-file CHANGELOG.md
```

Auth is the maintainer's personal automation token in `~/.npmrc` or an interactive 2FA OTP via `--otp=<code>`. OIDC trusted publishing is workflow-only.

## Rollback and bad-publish procedure

Follow these in order. Stop as soon as the situation is resolved.

1. **Cut a fix release.** Open a PR with the revert or fix and a `patch` changeset describing what broke; merge through the normal release flow. This is almost always the right answer.
2. **Deprecate the bad version.** `npm deprecate @automattic/skillsmith@<version> "Withdrawn — contained <bug>. Use <fixed-version> or later."` Requires npm auth on the maintainer's machine (OIDC is workflow-only).
3. **Edit the GitHub Release** for the bad version. Mark it as a pre-release and prepend a `**WITHDRAWN — see [next-version](link)**` note to the body. Do not delete the Release; the tag must stay reachable.
4. **Unpublish only as a last resort.** Allowed within 72 hours, with no known consumers, only when the version is dangerous (leaked secret, malware, PII). Burns the version number forever.
5. **`latest` dist-tag rescue** when a clean fix release cannot ship quickly: `npm dist-tag add @automattic/skillsmith@<previous-good-version> latest`.

## "I forgot a changeset" recovery

Open a new PR against `trunk` that adds only the missing changeset. Write the summary as if it had been in the original PR. Include `> Backfilled from PR #<original-PR>` at the bottom of the changeset body so reviewers can trace the lineage.

Known cosmetic wart: `@changesets/changelog-github` will attribute the entry to the backfill PR, not the original. Propagating the `> Backfilled from PR #<original>` line into the changeset body keeps the original PR discoverable from `CHANGELOG.md`.

## Re-running a failed release

`changeset publish` is idempotent at the per-package level — it calls `infoAllow404(packageJson)` against npm and skips any version already published. When a release run fails partway (network blip, transient registry error, npm trusted-publisher misconfiguration), re-run the failed job from the Actions UI rather than publishing by hand.

## Pre-release dry-run

Before a real publish, two local checks are cheap:

- **Version dry-run.** `npx changeset version` rewrites `package.json:version` and `CHANGELOG.md` in your working tree. Inspect with `git status` and `git diff`, then `git restore .` to abort. Nothing is pushed.
- **Publish dry-run.** `npm publish --dry-run --access public` runs the full pack pipeline without uploading. It fails if the version already exists on npm — a useful sanity check before merging the Version Packages PR.

## Dependency-bump PRs

Renovate / Dependabot PRs follow the same rules as any other PR: they need a changeset when the bump affects behaviour, peer ranges, or `engines.node` (per the categories above). Behaviour-equivalent bumps don't. A maintainer merging a bot PR should add the changeset to the bot's branch before merging — `npx changeset` works against any branch. Wiring an auto-bot to write changesets is out of scope here and tracked as a follow-up.

## Repo configuration prerequisites

Three repo-level settings must be in place for `release.yml` to succeed. Audit these when the workflow starts misbehaving, and re-verify them when repo-level settings change.

- **Allow GitHub Actions to create and approve pull requests.** Settings → Actions → General → Workflow permissions. The action opens the Version Packages PR with the `github-actions[bot]` identity; without this setting it cannot. Off by default in some Automattic-managed repos.
- **Branch protection on `trunk`.** The `github-actions[bot]` must be allowed to push to the `changeset-release/trunk` release branch while human review remains required on the Version Packages PR. Self-approval must remain prohibited.
- **npm trusted-publisher binding.** Configured on `npmjs.com` for the `@automattic` org, the `skillsmith` repo, the `release.yml` workflow, and the `npm publish` action (the explicit-action selection is mandatory for trusted publishers created after 2026-05-20). Requires a maintainer with `@automattic` npm-org admin rights. If this is missing, `npm publish` fails 401 but the source tree, tag, and Version Packages PR are unaffected — configure the binding, then re-run the failed job.

Optionally, the [`@changesets/bot` GitHub App](https://github.com/apps/changeset-bot) can be installed to post educational reminder comments on PRs. It is non-blocking and complementary to the CI gate; the gate (`changeset-gate.yml`) remains the source of truth for whether a PR needs a changeset.
