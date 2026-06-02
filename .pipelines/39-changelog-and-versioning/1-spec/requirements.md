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

## Open requirements (running record)

Each topic below collects the question asked, the researcher's answer, and the resulting confirmed requirement.

_(populated as Q&A proceeds)_
