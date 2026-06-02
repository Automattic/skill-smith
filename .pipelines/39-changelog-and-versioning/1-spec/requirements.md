# Requirements — Changelog and Versioning

Issue: [Automattic/skillsmith#39](https://github.com/Automattic/skillsmith/issues/39) — _Add a changelog and automate package version bumps_

## Source request

> The `skillsmith` package maintains a human-readable changelog of user-facing changes, and its `package.json` version is bumped consistently as changes are released.
>
> Constraint: Use the [Changesets](https://github.com/changesets/changesets) library to manage the changelog and version bumps.

## Repository context

- Single-package repository (`package.json` at the worktree root, current version `0.1.0`, name `skillsmith`).
- Repo: `Automattic/skillsmith`. Default branch: `trunk`.
- No `.github/workflows/` directory exists today. No `CHANGELOG.md` exists today.
- No npm publishing configured today (no `publishConfig`, package is GPL-3.0 and not listed as `private`).
- Scripts in `package.json`: `lint`, `lint:fix`, `format`, `typecheck`, `test`, `smoke` — no `release`/`version` scripts yet.
- Package manager: `npm` (per `package-lock.json`).

## Confirmed facts about the package surface (research findings)

These are grounded in the code as of the head of `worktree-39-changelog-and-versioning` and are the basis for scoping changeset requirements.

- **Public API entry** is `src/index.ts:1` — it re-exports `DEFAULT_PATHS`, `defineConfig`, ~22 type names from `src/config/types.ts`, `Provider`/`ProviderId` from `src/providers/types`, `RunOptions` and `run` from `src/runner`.
- **CLI entry** is `bin/skillsmith.mjs:14-39` (modes/flags).
- **Hook contract** is `Hooks` (`src/config/types.ts:256-287`), `SkillsmithConfigInput` (`src/config/types.ts:99-106`), and `AfterAllScenariosHookFn` (`src/config/types.ts:234-236`) — these are implemented by consumers.
- **Report/disk-layout contract** is documented in `README.md:99-112` (directory tree) and `README.md:139-165` (`report.json` shape).
- **Provider registry** lives in `src/providers/` (anthropic-api, openai-api, claude-code, codex, gemini-api); `ProviderId` is in the public re-export set.
- **Examples** (`examples/skillsmith.config.ts`) are consumer-facing reference code.
- **Not shipped / not contract:** `docs/index.html`, `docs/styles.css`, `testing-project/`, `src/__tests__/`, `biome.json`, `tsconfig.json`, `.github/**`, `.changeset/**`, `.gitignore`, `.env.example`, `.rp.md`, `.pipelines/**`, `LICENSE`, `package-lock.json`.
- **npm history:** `skillsmith` is published at `0.0.1` on npm; source is `0.1.0`; no git tags, no GitHub releases — this is greenfield release automation.
- **Tooling versions** (confirmed latest on npm at research time): `@changesets/cli` 2.31.0, `@changesets/changelog-github` 0.7.0, `@changesets/changelog-git` 0.2.1, `changesets/action` v1.8.0 (released 2026-05-07).

## Q1 — Scope of changelog entries

### Decision

- **Required to ship a changeset** (any of the following touched by the PR):
  - (a) CLI behaviour or flag changes (`bin/skillsmith.mjs`).
  - (b) Hook contract / `defineConfig` schema changes (the public types in `src/config/types.ts`, the `defineConfig` signature, the lifecycle order).
  - (c) Report JSON / on-disk run-layout changes (the shape and field names in `report.json`, `run.json`, the directory tree).
  - (d) Provider support — added/removed providers or provider options (anything that widens/narrows `ProviderId` or the per-provider option types).
  - (e) Bug fixes to any of (a)-(d) — **patch**.
  - (f) Dependency bumps **only when** behaviour, peer ranges, or engines change. Behaviour-equivalent bumps don't need a changeset.
- **No changeset required** (and a CI gate should not nag for):
  - (g) Documentation/README prose-only changes — but note: when a code change updates the contract documented in README, the changeset comes from the *code* change.
  - (h) Internal refactors, type-only internal changes that don't reach the public re-exports, tests, lint/format config, CI config, lockfile maintenance, repo metadata.
  - Pipeline artefacts (`.rp.md`, `.pipelines/**`), `LICENSE` typo fixes, `package-lock.json`-only changes, the `testing-project/` fixture, the `docs/` landing page.
- **Empty-changeset escape hatch:** for PRs that *touch* release-relevant paths but intentionally do not warrant a release entry, use `changeset add --empty` (writes a YAML file containing just `---\n---`, consumed and deleted by `changeset version` without bumping). This is the canonical way to silence both the CI gate and the @changesets/bot — verified empirically.
- **Edge cases captured:**
  - `examples/skillsmith.config.ts` is consumer-facing reference code: a change there that exercises new public API is a (b)-style change and needs a changeset.
  - Adding a new provider (widening `ProviderId`) is **minor**, even though exhaustive switches in consumer code would need updates — consumers are responsible for the `never` case.
  - `README.md` mixes prose (g) and contract (a/b/c). For now we gate on the whole `README.md` and rely on `--empty` for cosmetic edits, rather than splitting the file. Revisit if friction shows.

### CI enforcement

- **Yes, fail the PR** when a changeset is missing for a PR that touches release-relevant code paths.
- **Detection:** done by Changesets itself via the `changedFilePatterns` option in `.changeset/config.json` — no separate `paths-filter`-style step needed. Empirically verified (see Q2): with `changedFilePatterns` set, `changeset status --since=<base>` exits 0 for diffs that match only excluded paths, and exits 1 with the canonical hint when relevant paths are touched without a changeset.
  - **`changedFilePatterns` (proposed):**
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
  - **Effect:** anything not matched (`docs/**`, `testing-project/**`, `.github/**`, `.changeset/**`, `biome.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `.rp.md`, `.pipelines/**`, `LICENSE`, `package-lock.json`) is implicitly excluded and won't trigger the gate.
  - **CI step** collapses to one command: `npx changeset status --since=origin/${{ github.event.pull_request.base.ref }}`. The exclusion list is data in `.changeset/config.json`, not workflow YAML.
- **Empty-changeset escape** (`changeset add --empty`) remains for PRs that touch release-relevant paths but legitimately don't warrant a release entry.
- **@changesets/bot** (the GitHub App) is added on top for educational PR comments; it is non-blocking by design and complements (does not replace) the CI gate. **Open question for design phase:** verify whether the bot still comments when `changedFilePatterns` excludes the PR's diff — if it does, the noise is tolerable since the bot is non-blocking.
- A single source-of-truth document (a "Versioning" section in `CONTRIBUTING.md`, or a top-level `CHANGESET.md`) describes the policy above for contributors.

### Sources

- Public surface: `src/index.ts:1`, `src/config/types.ts:99-287`, `bin/skillsmith.mjs:14-39`, `README.md:99-165`.
- Changesets adding-a-changeset: https://github.com/changesets/changesets/blob/main/docs/adding-a-changeset.md
- Changesets automating: https://github.com/changesets/changesets/blob/main/docs/automating-changesets.md
- Changesets CLI options (incl. `--empty`, `status --since`): https://github.com/changesets/changesets/blob/main/docs/command-line-options.md
- changesets/action: https://github.com/changesets/action
- @changesets/bot: https://github.com/changesets/bot
- Semver 0.x rationale: https://semver.org/#spec-item-4

## Q2 — Bump-type policy and pre-1.0 semver

### Q2a — Bump-type → semver mapping (steady state, post-1.0)

| Bump | Triggers |
|---|---|
| **patch** | Bug fix to existing CLI / hook / report / provider behaviour. Behaviour-equivalent dep bump. Improved error messages. Perf-only changes. **Loosening** the `engines.node` floor (widens what's accepted; not breaking). Default-value change with identical observable behaviour. Security fix that doesn't require consumer code change. |
| **minor** | Additive new CLI flag with sensible default. New optional hook. New optional `defineConfig` / `selfImprovement` field. New optional `report.json` field. New provider. New provider option. New exported symbol. Widened type union. New deprecation warning on an existing API. New (additive) field on `IterationInfo` / hook context structs that the harness passes *into* hooks. |
| **major** | Removed / renamed / semantically-changed CLI flag. Removed hook or required-changed hook arg. Removed / renamed / required-changed `defineConfig` or `selfImprovement` field. Removed / renamed `report.json` field, **or a same-named field whose semantics shifted** (e.g. `inputTokens` redefined from "gross" to "new only"). Removed provider. **Raised** `engines.node` minimum (e.g. `>=20.17` → `>=22`). Peer / runtime dep major bump that ripples. Default-behaviour change visible to existing configs (e.g. `selfImprovement.maxIterations` default changed from 3 → 5). Lifecycle-order change between hooks. Removal of a previously-deprecated API. Narrowed public type. |

Notes:

- **`engines.node` direction matters:** raising the floor = major; lowering or removing = at most minor (usually patch).
- **Hook context structs are bi-directional contract:** removing/renaming a field on `IterationInfo`, `RunContext`, or any other struct the harness passes into a hook is **major**; adding is **minor**.
- **Same-named field with shifted semantics is major** (a rename in everything but the symbol).
- **`examples/skillsmith.config.ts` follows the API:** if a change there exercises a new public API surface, it's the *underlying* API change that drives the changeset.
- **Security fixes are patch by default** but escalate if they require consumer code changes.

### Q2b — Pre-1.0 policy

**Decision: while `package.json:version` starts with `0.`, contributors write `minor` (never `major`) for breaking changes.**

Justification:

- Aligns with [semver §4](https://semver.org/#spec-item-4): "Major version zero (0.y.z) is for initial development. Anything MAY change at any time. The public API SHOULD NOT be considered stable." A `minor` bump in 0.x is the canonical signal for breaks, per the standard.
- **Empirically necessary:** with default Changesets config on `0.1.0`, a `major` changeset jumps the package straight to **`1.0.0`** (verified in `/tmp/changesets-test-39`). There is no built-in opt-out: the canonical config schema (`changelog`, `fixed`, `linked`, `commit`, `prettier`, `privatePackages`, `access`, `baseBranch`, `changedFilePatterns`, `ignore`, `updateInternalDependencies`, `bumpVersionsWithWorkspaceProtocolOnly`, `snapshot`) has no bump-type constraint. The custom `getReleaseLine` callback can't intercept the bump type either — the release plan is computed before the changelog plugin runs.
- **Upstream isn't fixing this generally.** Open issue [changesets/changesets#1887](https://github.com/changesets/changesets/issues/1887) tracks the 0.x problem; the attached unmerged PR [#1936](https://github.com/changesets/changesets/pull/1936) only addresses the peer-dep edge case.
- **`fixed`/`linked` are monorepo-only** (arrays of package-name groups). Single-package repo gets nothing from them.

#### Convention

In `CONTRIBUTING.md` / `CHANGESET.md`:

> While `package.json:version` starts with `0.`, breaking changes are recorded as a **`minor`** bump, not `major`. Document the break with a `BREAKING:` prefix or a `> Breaking change:` blockquote in the changeset summary. Per semver §4, 0.x is initial development and anything may change.

#### Enforcement (mechanical guard)

A small CI step rejects PRs whose `.changeset/*.md` front matter contains `: major` while the package is pre-1.0. Sketch:

```bash
ver=$(node -p "require('./package.json').version")
case "$ver" in
  0.*) ;;
  *) echo "Not pre-1.0; skipping major-changeset guard."; exit 0 ;;
esac
bad=$(grep -lE '^[^#]*: *major *$' .changeset/*.md 2>/dev/null | grep -v README.md || true)
if [ -n "$bad" ]; then
  echo "Pre-1.0 policy: 'major' bumps are not allowed while $ver. Use 'minor' and document the break."
  echo "Offending files:"; echo "$bad"
  exit 1
fi
```

Exact regex/multi-package handling is a design-phase detail; the concept is sound.

#### Trigger to switch to steady-state (cut 1.0.0)

A deliberate maintainer action, with checklist criteria documented in `CONTRIBUTING.md`. Suggested wording:

> Cut **1.0.0** when (and only when): (a) the public API surface in `src/index.ts` has been stable across two consecutive minor releases with no breaking changes; (b) the `Hooks` contract has not changed in a breaking way for one release cycle; (c) at least one downstream consumer outside Automattic is in active use, or a maintainer explicitly declares the API ready. Cutting 1.0.0 is a deliberate act: remove the pre-1.0 guard, hand-write the 1.0.0 CHANGELOG entry summarizing the breaks accumulated through 0.x, set `package.json.version`, tag.

### Q2c — Starting line for this PR

- **`package.json` stays at `0.1.0`** for the changelog-and-versioning PR. The PR ships tooling (`.github/**`, `.changeset/**`, `CONTRIBUTING.md`, `CHANGELOG.md`, devDependency additions) — none of it changes the public API. Per the Q1 cut that's category (h). **Use an empty changeset** (`changeset add --empty`) so the very same CI gate that this PR introduces will pass on this PR.
- **Backfill an initial `## 0.1.0` entry in `CHANGELOG.md`** by hand as part of this PR. One-liner: e.g. *"Initial release. Skill testing harness + self-improvement loop."*. Reasoning: `package.json` already claims `0.1.0`, so the changelog should too; the entry is written once and never touched; future `changeset version` runs append above it (the file format is stable).
- **First real bump** comes from the next feature PR. Whatever that change is determines the next semver line per Q2a/Q2b.

### Sources

- Changesets config schema (canonical): https://raw.githubusercontent.com/changesets/changesets/main/packages/config/schema.json
- Changesets config docs: https://github.com/changesets/changesets/blob/main/docs/config-file-options.md
- Changesets changelog customization (no bump-type interception): https://github.com/changesets/changesets/blob/main/docs/modifying-changelog-format.md
- 0.x peer-dep bug: https://github.com/changesets/changesets/issues/1887
- Attached unmerged fix: https://github.com/changesets/changesets/pull/1936
- Semver 0.x clause: https://semver.org/#spec-item-4
- Skillsmith source anchors: `src/providers/types.ts:36-41`, `src/config/self-improvement.ts:17-25`, `src/config/types.ts:144-287`, `bin/skillsmith.mjs:14-39`, `README.md:139-165, 213-224`
- Empirical scratch repo: `/tmp/changesets-test-39` — `0.1.0 + major → 1.0.0`; `0.1.0 + minor → 0.2.0`; `0.1.0 + patch → 0.1.1`; `changeset status --since=main` exits 1 on a feature branch without a changeset; empty-changeset on disk is just `---\n---`.

## Open requirements (running record)

_(further topics populated as Q&A proceeds)_
