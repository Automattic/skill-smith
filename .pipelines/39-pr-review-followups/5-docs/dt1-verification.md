# DT1 — Verification of shipped `AGENTS.md` + `CLAUDE.md`

**Verdict: PASS.** All 7 checks hold. No repo file was created or modified by this task.

This is a documentation-quality gate over the Change-1 Code-phase artifacts (`AGENTS.md`,
`CLAUDE.md` at repo root). The content is contract-fixed by code-plan T1 / the design doc;
DT1 verifies it communicates correctly for its dual audience and that its cross-references
resolve — it authors nothing.

## Artifacts verified (committed state, working tree clean)

- `AGENTS.md` (3 non-empty lines: `# Skillsmith` header, identity sentence, one changeset bullet).
- `CLAUDE.md` (single line `@AGENTS.md`).
- Cross-reference targets (read-only): `CONTRIBUTING.md`, `scripts/validate-changesets.ts`,
  `README.md`, `.changeset/README.md`.

`git status --porcelain` was empty before verification, so the reads above reflect the
**committed** state, not an uncommitted draft.

## Checklist results

### 1. `AGENTS.md` reads as a coherent standalone doc (AC1) — PASS
- Line 1: `# Skillsmith` identity header.
- Line 3: one descriptive identity sentence naming the published package —
  "A scenario-based evaluation harness for coding agents, published as `@automattic/skillsmith`."
- Line 5: the single changeset bullet.
- Mirrors the radical-pipelines short-`AGENTS.md` shape (identity header + one sentence). It is
  **not** an orphaned one-liner — the header + identity sentence give a human at the repo root
  context, and Pi reading it directly gets a self-contained obligation.

### 2. Changeset instruction correctly framed for an agent (AC3) — PASS
- A single imperative bullet: "**Record** a changeset for every release-relevant change …".
- States the committed artifact travels with the PR: "a committed `.changeset/*.md` that travels
  with the pull request."
- **Defers detail** rather than inlining it: "See `CONTRIBUTING.md#adding-a-changeset` for when
  one is required, the bump-type table, and the pre-1.0 policy." The "when required" list and the
  bump-type table are pointed to, not restated.

### 3. Pre-1.0 sub-clause communicates all four elements, action-framed, in the SAME bullet (AC4) — PASS
All four elements appear as the trailing sentences of the one bullet (not a second top-level bullet):
- (a) **condition**: "While pre-1.0 (version `0.x`), …".
- (b) **action**: "record breaking changes as `minor` with a `BREAKING:` summary prefix".
- (c) **major rejected**: "`major` is rejected pre-1.0".
- (d) **pointer**: "(see `CONTRIBUTING.md#pre-10-policy`)".
- The **literal token `BREAKING:`** is present (load-bearing — it carries the break into
  `CHANGELOG.md`).

### 4. No forbidden / audience-wrong content (AC5, AC6) — PASS
The file is exactly **identity header + the one bullet** — 3 non-empty lines, exactly **1**
top-level bullet (`grep -c '^- '` = 1). Verified absent:
- **No inlined semver bump mapping** — no "fix→patch / feature→minor / breaking→major", no `→`
  arrow. (A broad regex flagged the bullet on a "breaking … major" co-occurrence; the actual text
  is the *opposite* mapping — "record breaking changes as `minor` … `major` is rejected pre-1.0" —
  i.e. the required AC4 content, not a forbidden breaking→major rule.)
- **No "breaking change → major" wording** — it states the inverse (breaking → `minor`, `major`
  rejected).
- **No restated "when required" path list** — a regex flagged "for **when** one is **required**",
  which is a *deferral pointer* into `CONTRIBUTING.md`, not a restated list.
- **No duplicated bump-type table** — pointed to, not inlined.
- **No "the README" pointer-as-policy** (`grep -ic readme` = 0).
- **No "keep README/docs current" rule** (`grep -ic 'keep…current|up-to-date'` = 0).
- **No other behavioral rule** — only the one changeset obligation.

### 5. Cross-references actually resolve (cross-file doc-quality check) — PASS
- `#adding-a-changeset` → `## Adding a changeset` at `CONTRIBUTING.md:18` — exists. ✓
- `#pre-10-policy` → `### Pre-1.0 policy` at `CONTRIBUTING.md:48` — exists. ✓
- **Slug derivation**: GitHub auto-slugs `Pre-1.0 policy` by lowercasing, dropping non-alphanumerics
  (the `.` in `1.0` is stripped), and replacing spaces with hyphens → `pre-10-policy`. Matches the
  link.
- **Validator slug match**: `scripts/validate-changesets.ts:149` emits
  `… see CONTRIBUTING.md#pre-10-policy.` — byte-identical anchor to `AGENTS.md`'s link. ✓
- **Link form consistent with the repo's other citations**: `README.md:239` uses
  `[Adding a changeset](./CONTRIBUTING.md#adding-a-changeset)` and `.changeset/README.md:5,10` use
  `[`../CONTRIBUTING.md#adding-a-changeset`](../CONTRIBUTING.md#adding-a-changeset)`. `AGENTS.md`
  uses the same Markdown-link form (``[`CONTRIBUTING.md#adding-a-changeset`](CONTRIBUTING.md#adding-a-changeset)``);
  the repo-root-relative target (no `./` / `../` prefix) is correct for a file at the repo root. ✓

### 6. `CLAUDE.md` is exactly `@AGENTS.md` (AC2) — PASS
- `wc -lc` = 1 line, 11 bytes (`@AGENTS.md` = 10 chars + one trailing newline).
- `cat -e` → `@AGENTS.md$` — a single line, one line-ending, no heading, no blank-line padding,
  no trailing prose. The `@AGENTS.md` import is the only bridge that delivers the rule to Claude
  Code (which auto-loads `./CLAUDE.md`, not `AGENTS.md`); it is intact.

### 7. `.rp.md` untouched (AC7) — PASS
- `git diff --quiet -- .rp.md` exits 0 (clean). The rule was **not** placed in `.rp.md` (the
  re-sync-clobber hazard); `.rp.md` is byte-unchanged.

## Manifest discipline (AC19) — confirmed
`git diff --name-only f1a050d..HEAD -- . ':(exclude).pipelines/**'` lists exactly the 7 Code-phase
manifest files (`.changeset/config.json`, `AGENTS.md`, `CLAUDE.md`, `docs/styles.css`,
`src/__tests__/progress-render.test.ts`, `src/__tests__/progress-tracker.test.ts`,
`src/progress/tracker.ts`). DT1 created/modified **no** repo file — only this pipeline artifact
under `.pipelines/`.

## Conclusion
**PASS** on all 7 checks. `AGENTS.md` reads as coherent, correctly-targeted documentation for its
dual audience (Pi reads it directly; a human at the repo root sees a self-contained doc), `CLAUDE.md`
is exactly the `@AGENTS.md` import that delivers the rule to Claude Code, every cross-reference
resolves against the live `CONTRIBUTING.md` and matches the validator's emitted slug, and `.rp.md`
is untouched. No blocker. No repo file authored or modified.
