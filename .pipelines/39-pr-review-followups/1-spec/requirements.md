# Requirements: Changelog/versioning follow-ups from the PR #41 review

Source prompt: [`0-prompt/prompt.md`](../0-prompt/prompt.md). Three follow-up improvements
surfaced by a review of PR #41 (issue #39), all to land on the existing
`worktree-39-changelog-and-versioning` branch so they ship as part of PR #41.

This document is built iteratively through Q&A with the `researcher`. Each answered
question is recorded below under its change. The `## Consolidated Requirements` section at
the end is the authoritative numbered list.

## Grounding facts established before Q&A

Captured by reading the repo at
`/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning`:

- No `AGENTS.md` or `CLAUDE.md` exists anywhere in the repo (only `.rp.md` at root). `.rp.md`
  is synced from the radical-pipelines upstream (recent commits "Copy `.rp.md` from Radical
  Pipelines …"), so the changeset rule must not live there.
- `biome.json`: `formatter.indentStyle = "tab"`, `javascript.formatter.quoteStyle = "double"`,
  linter `recommended: true`. No Prettier is installed.
- `package.json` scripts: `lint` = `biome lint .`, `lint:fix` = `biome lint --write .`,
  `format` = `biome format --write .`, `changeset` = `changeset`, `release` = `changeset publish`.
- `.changeset/config.json` is committed with 2-space indentation and has no `prettier` key
  (so Changesets defaults `prettier` to `true`). Its `changedFilePatterns` include `src/**`,
  `bin/**`, `package.json`, `examples/**`, `README.md`, and excludes `src/__tests__/**`.
- `CONTRIBUTING.md` already documents the full versioning/changeset policy (when a changeset is
  required, bump types, pre-1.0 policy, summary conventions, release flow).

## Change 1 — Standing agent-facing instruction to record a changeset

### Q1 — Where should the agent-facing changeset rule live? (answered by researcher)

**Decision: create a project-root `AGENTS.md` (holds the rule) AND a thin project-root
`CLAUDE.md` whose entire contents are `@AGENTS.md` (imports it).** Both at repo root, alongside
`.rp.md`:
- `…/AGENTS.md` — holds the changeset rule.
- `…/CLAUDE.md` — contents exactly `@AGENTS.md`.

Why both files (not just one):
- **Claude Code does NOT auto-load `AGENTS.md`.** Per the Claude Code memory docs, Claude Code
  auto-loads `./CLAUDE.md` (or `./.claude/CLAUDE.md`), not `AGENTS.md`; the documented bridge is
  a `CLAUDE.md` that imports `AGENTS.md` via `@AGENTS.md`. A bare `AGENTS.md` alone would be
  invisible to Claude Code agents — so the thin `CLAUDE.md` is **not optional**.
- **Pi reads `AGENTS.md` directly** as the tool-agnostic cross-agent standard.
- skillsmith's coding agents are radical-pipelines agents (Claude Code and/or Pi), so only the
  `AGENTS.md` + thin `CLAUDE.md` pair covers both runtimes.

Why this is re-sync-safe: the `.rp.md` sync copies **only** `.rp.md` (commits `fce8c4e`,
`d1d019f` "Copy `.rp.md` from Radical Pipelines …"). `AGENTS.md` and `CLAUDE.md` are independent,
repo-owned files the sync does not touch, so an upstream `.rp.md` re-sync cannot clobber them.

radical-pipelines precedent (verbatim, from live `trunk`): the rule is the last bullet of an
8-line root `AGENTS.md`, sitting right after a "keep README current" bullet:
> Whenever a change is made to this repository, a changeset must be recorded: a committed
> `.changeset/*.md` that declares the change and its bump type, travelling with the pull request.
> Choose the bump type by semver — behavior-preserving fix → patch; backward-compatible feature →
> minor; breaking change → major. See the README's changelog and versioning section for how to
> author one.

radical-pipelines `CLAUDE.md` is literally one line: `@AGENTS.md`. Its `README.md:163` codifies
the pattern: "Shared cross-agent project instructions should live in `AGENTS.md`. `CLAUDE.md` may
be a thin pointer to `AGENTS.md` … and should not duplicate shared `AGENTS.md` content into
`CLAUDE.md`."

Caveat from researcher: the pinned plugin-cache copy of radical-pipelines `AGENTS.md`
(`~/.claude/plugins/cache/.../0.1.0/AGENTS.md`) is OLDER and lacks the changeset bullet; live
GitHub `trunk` and the local checkout at `/Users/santosguillamot/Desktop/Code/radical-pipelines`
both have it. Live repo is authoritative.

Rejected alternatives: rule only in `CLAUDE.md` (Pi wouldn't read it); rule only in `AGENTS.md`
(Claude Code wouldn't read it); a `CLAUDE.md → AGENTS.md` symlink instead of the `@AGENTS.md`
import (works, but the import is the more portable/Windows-safe form radical-pipelines uses).

### Q2 — Exact wording of skillsmith's rule (in progress; two facts pre-confirmed)

Independently confirmed by the spec-analyst while the wording question is outstanding:
- **Cross-reference target is `CONTRIBUTING.md`, not the README.** The README's only
  changelog/version content is a 2-line `## Releases` section pointing to `CHANGELOG.md` and the
  GitHub releases page, plus a `## Contributing` section that defers to
  `CONTRIBUTING.md#adding-a-changeset` (`README.md:232-239`). There is no parallel policy in the
  README. `CONTRIBUTING.md` is the single canonical home for the changeset/versioning policy.
- **`major` is rejected pre-1.0 by the validator.** `scripts/validate-changesets.ts:145-151`:
  when `package.json:version` starts with `"0."`, a `major` bump errors with
  `'major' is forbidden while pre-1.0 (version=…). Use 'minor' with a 'BREAKING:' prefix; see
  CONTRIBUTING.md#pre-10-policy.` So radical-pipelines' verbatim "breaking change → major"
  mapping would tell an agent to do something this repo's own validator rejects. The wording must
  not reproduce that mapping unqualified.

_Researcher's wording recommendation pending; recorded when it arrives._

## Change 2 — Make `npm run lint` pass on the branch

### Grounding: the actual lint failures (captured by running `npm run lint`)

`npm run lint` (= `biome lint .`) currently reports **3 errors + 6 warnings**, failing the
gate. Exact breakdown by file and rule:

| File | Rule | Count | Severity | Under changeset gate? |
|---|---|---|---|---|
| `docs/styles.css` | `lint/style/noDescendingSpecificity` | 2 | error | No — `docs/**` excluded |
| `src/__tests__/progress-render.test.ts` | `lint/complexity/noAdjacentSpacesInRegex` | 4 | warning (FIXABLE, safe fix) | No — `!src/__tests__/**` excluded |
| `src/__tests__/progress-tracker.test.ts` | `lint/suspicious/noControlCharactersInRegex` | 2 | warning | No — `!src/__tests__/**` excluded |
| `src/progress/tracker.ts` | `lint/suspicious/noControlCharactersInRegex` | 1 | error | **Yes** — `src/**` (non-test) |

Notable: the prompt framed the failures as in "`src/progress/*` and `docs/styles.css`", but in
reality most of the `src` failures are under `src/__tests__/**`. Only **one** non-test source
failure exists: `src/progress/tracker.ts:358` — `const ANSI_SGR = /\x1b\[[0-9;]*m/g;` flagged by
`noControlCharactersInRegex` (the literal ESC `\x1b` control char in the ANSI-stripping regex).

This is the only failing file that falls under the changeset gate's `changedFilePatterns`
(`src/**` minus `src/__tests__/**`), so a source edit there likely needs its own changeset.

_Open questions and answers recorded here._

## Change 3 — Align Changesets' formatting with the Biome toolchain

_Open questions and answers recorded here._
