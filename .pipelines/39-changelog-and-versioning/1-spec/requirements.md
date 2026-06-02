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
- **Detection:** path globs, not pure reviewer judgement.
  - **Release-relevant** (gate runs): `src/**`, `bin/**`, `package.json`, `examples/**`, `README.md`.
  - **Skip the gate** (no nag): `docs/**`, `testing-project/**`, `src/__tests__/**`, `.github/**`, `.changeset/**`, `biome.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `.rp.md`, `.pipelines/**`, `LICENSE`, `package-lock.json`.
  - Implementation: a `paths-filter`-style step (e.g. `dorny/paths-filter` or `tj-actions/changed-files`) upstream of `npx changeset status --since=origin/${{ github.event.pull_request.base.ref }}`.
  - `npx changeset status --since=...` exits non-zero with the canonical hint when no changeset is present on a branch that has changed files — verified empirically.
- **@changesets/bot** (the GitHub App) is added on top for educational PR comments; it is non-blocking by design and complements (does not replace) the CI gate.
- A single source-of-truth document (a "Versioning" section in `CONTRIBUTING.md`, or a top-level `CHANGESET.md`) describes the policy above for contributors.

### Sources

- Public surface: `src/index.ts:1`, `src/config/types.ts:99-287`, `bin/skillsmith.mjs:14-39`, `README.md:99-165`.
- Changesets adding-a-changeset: https://github.com/changesets/changesets/blob/main/docs/adding-a-changeset.md
- Changesets automating: https://github.com/changesets/changesets/blob/main/docs/automating-changesets.md
- Changesets CLI options (incl. `--empty`, `status --since`): https://github.com/changesets/changesets/blob/main/docs/command-line-options.md
- changesets/action: https://github.com/changesets/action
- @changesets/bot: https://github.com/changesets/bot
- Semver 0.x rationale: https://semver.org/#spec-item-4

## Open requirements (running record)

_(further topics populated as Q&A proceeds)_
