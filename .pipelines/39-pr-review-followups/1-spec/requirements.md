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

### Grounding: the radical-pipelines precedent (pending researcher confirmation)

Read from the local radical-pipelines clone (`/Users/santosguillamot/Desktop/Code/radical-pipelines`):

- `AGENTS.md` (NOT synced from anywhere — repo-specific) holds the rule as a bullet:
  > Whenever a change is made to this repository, a changeset must be recorded: a committed
  > `.changeset/*.md` that declares the change and its bump type, travelling with the pull
  > request. Choose the bump type by semver — behavior-preserving fix → patch;
  > backward-compatible feature → minor; breaking change → major. See the README's changelog
  > and versioning section for how to author one.
- `CLAUDE.md` contains only `@AGENTS.md` (an import directive so Claude Code reads `AGENTS.md`).
- `.rp.md` is the synced "project conventions for every agentic coding tool" file and points
  agents to tool-specific `.rp.md` files; it does NOT hold the changeset rule.

Implication for skillsmith: the precedent home is a root `AGENTS.md` (with `CLAUDE.md`
→ `@AGENTS.md`), which an upstream `.rp.md` re-sync will not touch. Researcher to confirm
that skillsmith's agents actually read `AGENTS.md` / `CLAUDE.md`.

_Open questions and answers recorded here (researcher Q&A)._

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
