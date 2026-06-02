# Prompt

Source: [Automattic/skillsmith#39](https://github.com/Automattic/skillsmith/issues/39) — _Add a changelog and automate package version bumps_

## Goal

The `skillsmith` package maintains a human-readable changelog of user-facing changes, and its `package.json` version is bumped consistently as changes are released.

## Constraints

- Use the [Changesets](https://github.com/changesets/changesets) library to manage the changelog and version bumps.
