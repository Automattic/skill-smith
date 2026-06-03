# Code review — APPROVED (batch, iteration 1)

Adversarial batch review of the full set of 6 completed code tasks (T1–T6) for
`39-pr-review-followups`, Code phase. Reviewed `git diff f1a050d..HEAD` (DIFF BASE `f1a050d`,
HEAD `e0b18d1`) against `1-spec/spec.md` (19 ACs), `2-design-doc/design-doc.md`, and
`3-plan/code-plan.md`.

**Verdict: APPROVED.** All 19 acceptance criteria independently verified by inspecting the code
**and re-running every check** (prior agent reports were not trusted). The cumulative repo change is
exactly the 7 files mandated by AC19; everything else in the diff is `.pipelines/**` bookkeeping plus
T6's deliverable at `4-code/pr-description-note.md`.

## Re-run command results (all from the worktree root)

- `npx biome lint .` → `Checked 96 files. No fixes applied.`, exit 0. JSON reporter:
  `errors:0, warnings:0, infos:0`, `diagnostics.length === 0`. Proven non-vacuous: a throwaway bad
  regex file made the same reporter print `Found 2 warnings`, so the clean result is real.
- `npm test` → exit 0; `# tests 149 / # pass 147 / # fail 0 / # skipped 2` (the 2 skips are
  pre-existing and unrelated).
- `npx biome format .changeset/config.json` → `Checked 1 file. No fixes applied.`, exit 0.
- `npx changeset status --since=origin/trunk` → exit 0 (NO packages to be bumped at patch/minor/major).
- `npx tsx scripts/validate-changesets.ts` → exit 0 (shape valid).
- `npx tsc --noEmit` → exit 0 (the two `biome-ignore` comments compile cleanly).
- `git diff --name-only f1a050d..HEAD -- . ':(exclude).pipelines/**'` → exactly the 7 manifest files;
  exact set-match confirmed; working tree clean.

## AC-by-AC verification

### Change 1 (AC1–AC7) — T1
- **AC1** ✓ `AGENTS.md` = `# Skillsmith` header + one-sentence identity naming `@automattic/skillsmith`.
- **AC2** ✓ `CLAUDE.md` is exactly `@AGENTS.md\n` (`od -c`: 11 bytes, single line, nothing else). The
  lone trailing newline is standard POSIX text convention, not extra prose.
- **AC3** ✓ Single imperative bullet ("Record…"), states the committed `.changeset/*.md` travels with
  the PR, cross-references `CONTRIBUTING.md#adding-a-changeset`.
- **AC4** ✓ Action-framed pre-1.0 sub-clause within the same bullet, all four elements present:
  (a) "While pre-1.0 (version `0.x`)"; (b) "record breaking changes as `minor` with a `BREAKING:`
  summary prefix"; (c) "`major` is rejected pre-1.0"; (d) pointer `CONTRIBUTING.md#pre-10-policy`.
  Literal token `BREAKING:` present.
- **AC5** ✓ No inlined semver mapping, no "breaking → major" (it frames `major` as *rejected*, the
  opposite of the forbidden mapping), no "when required" path-list restatement (it *points* to it),
  no bump-type table duplication, no "the README" pointer.
- **AC6** ✓ Exactly one list bullet (`grep -c '^- '` = 1); identity header + that single changeset
  bullet only; no "keep README/docs current" rule, no other behavioral rule.
- **AC7** ✓ `.rp.md` unchanged (`git diff --quiet f1a050d..HEAD -- .rp.md`).
- Anchors confirmed: `## Adding a changeset` (→ `#adding-a-changeset`) and `### Pre-1.0 policy`
  (→ `#pre-10-policy`) exist in `CONTRIBUTING.md`; `#pre-10-policy` matches
  `scripts/validate-changesets.ts:149` verbatim.

### Change 2 (AC8–AC12, AC18) — T2, T3, T4
- **AC8** ✓ `biome lint .` reports zero diagnostics (0 errors AND 0 warnings), repo-wide.
- **AC9** ✓ Two per-line `// biome-ignore lint/suspicious/noControlCharactersInRegex: <reason>`
  comments — one above the unchanged `tracker.ts:358` `const ANSI_SGR = /\x1b\[[0-9;]*m/g;` (no
  indent), one above the unchanged `progress-tracker.test.ts:141` `second.match(/^\x1b\[(\d+)A\x1b\[0J/)`
  (one leading tab, matching the line); the single test comment covers both flagged escapes (cols
  31 & 43). Each reason names the ESC `0x1b` byte. No whole-file ignore; `biome.json` is unchanged
  (no rule-level disable).
- **AC10** ✓ Pure CSS move: bare `pre {}` now precedes `.terminal pre {}` (lines 300 < 309), bare
  `code {}` precedes `.note-card code {}` (lines 438 < 442); one occurrence of each rule (no
  duplication); the moved `pre` block is byte-identical pre/post (shasum match). Rendering-neutral —
  `.terminal pre`/`.note-card code` (0,1,1) vs bare `pre`/`code` (0,0,1) are unequal specificities,
  so source order cannot change the cascade.
- **AC11** ✓ Exactly the 4 expected `/  /` → `/ {n}/` transforms (lines 64,67,150,295), no other
  lines in the file changed; test suite green.
- **AC12** ✓ Scope guard holds: no import-line additions/removals anywhere in the diff (so
  `biome check`/`organizeImports` was NOT used — `biome lint` was); the only src/docs changes are the
  four Change-2 files.
- **AC18 (lint gate)** ✓ The previously-red `npm run lint` gate is now green (exit 0, zero
  diagnostics).

### Change 3 (AC13–AC16) — T5, T6
- **AC13** ✓ `.changeset/config.json` has top-level `"prettier": false` (boolean).
- **AC14** ✓ `biome format .changeset/config.json` → "No fixes applied"; file is full Biome style
  (tabs + expanded multi-line `changelog` array, inner `{ "repo": ... }` inline); valid JSON;
  `changeset status` reads it and still honors `changedFilePatterns`.
- **AC15** ✓ `.github/workflows/release.yml` unchanged (`git diff --quiet`).
- **AC16** ✓ The tradeoff note at `4-code/pr-description-note.md` carries all three required elements
  and is accurate vs the shipped config: (1) recommendation + "deliberate decoupling trade-off, not a
  bug fix"; (2) exact `CHANGELOG.md` before/after (`prettier:true` → `## 0.2.0` / blank /
  `### Minor Changes` / blank / `- <entry>`; `prettier:false` → `## 0.2.0` / `### Minor Changes` no
  blank line, tighter spacing); (3) owner-selectable alternative (`prettier:true` + explicit Prettier
  devDependency), recommendation remains `false`.

### Cross-cutting (AC17, AC19)
- **AC17** ✓ Zero new `.changeset/*.md` (`--diff-filter=A` on `.changeset/*.md` is empty);
  `.changeset/initial-scaffolding.md` unchanged and still the `none` bump; validator + `changeset
  status` both exit 0 relying solely on the pre-existing changeset.
- **AC18 (changeset gate)** ✓ Both gate steps green (validator exit 0; status exit 0).
- **AC19** ✓ Cumulative repo manifest is EXACTLY the 7 files: `AGENTS.md`, `CLAUDE.md`,
  `src/progress/tracker.ts`, `src/__tests__/progress-tracker.test.ts`,
  `src/__tests__/progress-render.test.ts`, `docs/styles.css`, `.changeset/config.json`. Confirmed by
  exact set comparison; not `.rp.md`/`CONTRIBUTING.md`/`README.md`/`release.yml`/`initial-scaffolding.md`.

## Notes
- No defects found. No rework required for any task.
- AC16's prose is a pipeline deliverable (`4-code/pr-description-note.md`) destined for the PR #41
  description; it is correctly NOT a repo file (consistent with AC19) — the Docs phase / team lead
  pastes it into the PR body.
