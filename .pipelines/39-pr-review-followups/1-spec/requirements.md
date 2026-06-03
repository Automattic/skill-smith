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

### Q2 — Exact wording / shape of skillsmith's rule (answered by researcher)

**Decision: shape (i) — a minimal, obligation-only bullet in `AGENTS.md` that DEFERS all
bump-type/semver detail to `CONTRIBUTING.md#adding-a-changeset`. Do NOT inline a semver
bump-type mapping.**

Both facts pre-confirmed by the spec-analyst were independently re-confirmed by the researcher:
- **`CONTRIBUTING.md` is the sole canonical policy home; there is NO README policy section.**
  README's only relevant content is `## Releases` (line 232, links to `CHANGELOG.md` + GitHub
  releases) and `## Contributing` (line 237, a one-liner deferring to
  `CONTRIBUTING.md#adding-a-changeset` at line 239). So radical-pipelines' "the README's
  changelog and versioning section" target does not exist here — the cross-reference must be
  `CONTRIBUTING.md` (anchor `#adding-a-changeset`).
- **`major` is hard-rejected pre-1.0.** `scripts/validate-changesets.ts:80,145-151` —
  `preRelease = version.startsWith("0.")`; a `major` bump then errors `'major' is forbidden
  while pre-1.0 (version=…). Use 'minor' with a 'BREAKING:' prefix; see
  CONTRIBUTING.md#pre-10-policy.` `package.json` is at `0.1.0`, so the guard is live. A verbatim
  "breaking change → major" clause would contradict `CONTRIBUTING.md` and instruct an agent to
  author a changeset the validator rejects.

Why shape (i), not an inlined mapping (shape ii):
1. **Drift/contradiction is real, not hypothetical.** skillsmith's bump rules are not the simple
   semver triad — the `### Bump types` table (CONTRIBUTING.md:42-46) has repo-specific triggers,
   and the pre-1.0 policy then overrides the whole "major" column to "minor + `BREAKING:`" while
   `0.x`. Any one-line mapping would be a lossy restatement already contradicted by the validator
   for the breaking case, and would need to change again at the 1.0 cutover. An obligation-only
   bullet has nothing to drift.
2. **"When a changeset is required" is path-scoped and nuanced** (CONTRIBUTING.md:20-39): carve-outs
   for docs/tests/refactors/`.pipelines/**`/`testing-project/`; partial-contract files
   (`examples/skillsmith.config.ts`, `README.md`); "new provider = minor." Can't be compressed
   without loss; pointing to the canonical list is the only non-lossy option.
3. **In-repo precedent already chose defer-don't-restate.** `.changeset/README.md` is the existing
   short pointer to the policy; it deliberately does NOT restate a bump mapping and says verbatim
   (line 5): "The full policy … lives in `../CONTRIBUTING.md#adding-a-changeset`. This README is a
   cheat sheet, not the source of truth." The new `AGENTS.md` bullet is the same kind of artifact
   and should follow the same pattern. (radical-pipelines could inline a mapping because it has no
   pre-1.0 carve-out and no local validator; skillsmith has both, so that precedent doesn't
   transfer.)

Wording constraints for the `AGENTS.md` bullet:
- **MUST** state the obligation imperatively: every release-relevant change records a committed
  `.changeset/*.md` that travels with the PR (consistent with CONTRIBUTING.md:16 framing).
- **MUST** cross-reference `CONTRIBUTING.md#adding-a-changeset` for the detail (same anchor used by
  README:239 and `.changeset/README.md`), which covers when required, the bump-type table, and the
  pre-1.0 rule.
- **MUST** be a single bullet in the same imperative list style as radical-pipelines' `AGENTS.md`
  (sibling to a "keep docs current" line if one is included), since `AGENTS.md` is small and
  always-loaded.
- **MUST NOT** inline any semver bump mapping (no "fix→patch / feature→minor / breaking→major").
- **MUST NOT** state or imply "breaking change → major" (contradicts pre-1.0 policy + validator).
- **MUST NOT** restate the "when required" path list or duplicate the bump-type table (drift risk).
- **MUST NOT** point to "the README" for the policy how-to (no such section exists).

### Q3 — Final scope of `AGENTS.md`: docs-bullet + pre-1.0 clause (answered by researcher)

**3a — Keep `AGENTS.md` changeset-only; do NOT add a docs-currency rule.** The researcher
checked all three candidate homes plus the README: skillsmith has **no** documented
"keep README/docs current" expectation anywhere in live policy. README has no such section;
`CONTRIBUTING.md` has none and in fact treats docs *more loosely* (line 31: documentation
prose-only edits need no changeset and "CI does not nag"); `.rp.md` is pipeline conventions only
(its lone "in sync" line is orchestrator↔Linear, unrelated) and is off-limits anyway. So
radical-pipelines' "keep README current" bullet (`AGENTS.md:7`) is a convention skillsmith has
**not** adopted. Decision:
- `AGENTS.md` contains **only** the changeset bullet, plus a minimal identity header (e.g. a
  `# Skillsmith` heading + one-sentence identity, mirroring radical-pipelines' 3-line header
  shape) so the file reads as coherent rather than an orphaned one-liner.
- Do **not** invent a docs-currency rule (out of scope per the prompt's "minimal and scoped to
  these three items"; would be an unreviewed new obligation that partially contradicts
  CONTRIBUTING.md:31). If the owner later wants one, that is a separate PR — listed as a **non-goal**
  here.

**3b — Include the pre-1.0 clause, action-framed, as a sub-clause of the changeset bullet (not a
second bullet).** Staleness at 1.0 is acceptable and the better trade.
- **Framing: action-first, not bare prohibition.** Semantic content the clause MUST carry:
  (a) condition = while pre-1.0 / version `0.x`; (b) action = use `minor` with a `BREAKING:`
  summary prefix; (c) the fact that `major` is disallowed; (d) pointer to `CONTRIBUTING.md`
  (`#pre-1.0-policy` or `#adding-a-changeset`). This mirrors the canonical wording in BOTH
  enforcement points (CONTRIBUTING.md:50 "write `minor` (never `major`) … prepend `BREAKING:`";
  validator message `validate-changesets.ts:149` "Use 'minor' with a 'BREAKING:' prefix"), so it
  won't drift in spirit. The `BREAKING:` prefix is load-bearing (it carries the break into
  `CHANGELOG.md`) and MUST be included — a bare "never use `major`" would leave an agent liable to
  under-bump without the marker. The clause MUST NOT restate the full bump table or the semver-§4
  rationale (that stays in CONTRIBUTING.md).
- **Why include it despite 1.0 staleness:** it degrades *gracefully* — it is self-dating ("while
  pre-1.0"), so post-1.0 it reads as a no-longer-applicable precondition, not wrong advice (unlike
  a Q2-style inlined mapping, which would read as actively wrong). The pre-1.0 rule is already a
  tracked multi-file 1.0-cutover chore (validator guard `:80`, CONTRIBUTING.md:48-50,
  `.changeset/README.md`); this clause is a co-located fourth ~one-line edit. Its only failure mode
  is becoming a no-op at a deliberate cutover ("staleness"), never a silent contradiction
  ("drift"). Cost of omitting it: the pre-1.0 "no `major`" rule is the single most likely place an
  agent — primed by general semver and by radical-pipelines' own "breaking → major" precedent —
  errs, and erring produces a hard `changeset-gate` rejection (the reactive round-trip this whole
  change exists to prevent).
- **Follow-up:** the spec should list "remove the pre-1.0 clause from `AGENTS.md`" alongside the
  existing pre-1.0 cleanup items so it isn't orphaned at the 1.0 cutover.

**Change #1 is now fully specified.**

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

### Per-failure detail (captured by reading the offending code)

There are three distinct failure classes, each needing a different fix posture:

1. **`noAdjacentSpacesInRegex` — 4 warnings, all in `src/__tests__/progress-render.test.ts`.**
   Multiple `assert.match(..., /…  /)` patterns with literal consecutive spaces (e.g.
   `/^scenarios  /`, `/^phases     /`, `/elapsed 16:48   done/`). Biome marks these **FIXABLE
   with a safe fix** — it rewrites e.g. `/^scenarios  /` → `/^scenarios {2}/` (quantifier).
   Purely mechanical; `biome lint --write` (`npm run lint:fix`) resolves them with no semantic
   change. Tests-only path → excluded from the changeset gate.

2. **`noControlCharactersInRegex` — 1 error in `src/progress/tracker.ts`, 2 warnings in
   `src/__tests__/progress-tracker.test.ts`.** These regexes match **real ANSI escape
   sequences** and the flagged control char is the ESC byte `\x1b` (0x1B), which is the
   legitimate, necessary content:
   - `src/progress/tracker.ts:358` — `const ANSI_SGR = /\x1b\[[0-9;]*m/g;` used by
     `visibleWidth()` (line 360-362) to strip SGR color codes when measuring printed width.
   - `src/__tests__/progress-tracker.test.ts:141` — `second.match(/^\x1b\[(\d+)A\x1b\[0J/)`
     asserting a repaint starts with cursor-up + erase-display escapes.
   The ESC byte is intrinsic to what these regexes do — you cannot match ANSI sequences without
   it. This is the prompt's explicit "a specific rule is genuinely inappropriate for a specific
   location" case. NOT auto-fixable (no safe fix offered). The fix posture is a judgment call
   (narrowly-scoped Biome suppression vs. a code rewrite that satisfies the rule) → researcher Q.

3. **`noDescendingSpecificity` — 2 errors in `docs/styles.css`.** Bare element selectors
   (`pre` at line 596, `code` at line 605) appear *after* higher-specificity selectors for the
   same elements (`.terminal pre` at 300, `.note-card code` at 429). Biome flags the descending
   specificity ordering. `docs/**` is excluded from the changeset gate (no changeset needed). Fix
   is a CSS edit; must preserve rendered styling (cascade correctness) → researcher Q on approach.

### Open requirements questions for Change #2 (to be answered via researcher)

- Fix approach for the `noControlCharactersInRegex` ANSI regexes (source + test): narrowly-scoped
  `biome-ignore` suppression with justification, vs. a rule-satisfying code rewrite. Whichever is
  chosen must apply equally to the legitimate uses and must not be a blanket/file-level disable.
- Whether editing `src/progress/tracker.ts` (under the changeset gate) requires a changeset, and
  if so whether it is an **empty** changeset (lint-only, zero consumer-visible behavior change —
  CONTRIBUTING.md says zero-effect changes use `--empty`) or a versioned `patch`.
- Fix approach for `docs/styles.css` descending specificity (reorder vs. other) while preserving
  the rendered cascade.

## Change 3 — Align Changesets' formatting with the Biome toolchain

_Open questions and answers recorded here._
