# Code Plan: Changelog/versioning follow-ups from the PR #41 review

Turns the approved [`2-design-doc/design-doc.md`](../2-design-doc/design-doc.md) (itself derived from
[`1-spec/spec.md`](../1-spec/spec.md), 19 acceptance criteria) into an ordered set of
independently-implementable tasks. Each task is a self-contained block with **Goal / Files / Changes
/ Depends on / Traces to / Acceptance**. The Code phase dispatches one fresh code-writer per task, in
order; the tasks share **one working tree** on the existing `worktree-39-changelog-and-versioning`
branch (= open PR #41).

All paths are absolute, rooted at the worktree:
`/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning`.

## Cross-cutting constraints (apply to EVERY task — read before implementing)

These are invariants, not tasks. No task may violate them.

- **ZERO new changesets (AC17).** No task adds any `.changeset/*.md` file, and **no task edits**
  `.changeset/initial-scaffolding.md` (it is correct as-is). The branch already carries
  `initial-scaffolding.md` (`none` bump), which `changeset status` evaluates **per-package** and which
  already satisfies the `@automattic/skillsmith` gate for every release-relevant edit here (including
  the `src/progress/tracker.ts` edit). Do not author a changeset for any task.
- **Biome `lint`, never `check` (AC12, R2.3).** Every lint operation uses `biome lint`. Do **NOT** run
  `biome check --write` at any point — it additionally runs `assist/source/organizeImports`, which
  reorders imports across ~6 unrelated files (`src/index.ts`, `src/runner.ts`,
  `src/pipeline/pipeline.ts`, `src/progress/index.ts`, plus test files), ballooning the diff and
  pulling more files under the changeset gate. Those import-sort findings are OUT OF SCOPE.
- **One branch, no new PR.** Every task lands on `worktree-39-changelog-and-versioning` (PR #41). Do
  not create a branch or PR.
- **Closed file manifest (AC19).** The complete set of new/edited files across ALL tasks is exactly
  these 7 — no task may touch any other file:
  - `AGENTS.md` (new)
  - `CLAUDE.md` (new)
  - `src/progress/tracker.ts`
  - `src/__tests__/progress-tracker.test.ts`
  - `src/__tests__/progress-render.test.ts`
  - `docs/styles.css`
  - `.changeset/config.json`

  In particular **not** `.rp.md`, `CONTRIBUTING.md`, `README.md`,
  `.github/workflows/release.yml`, or `.changeset/initial-scaffolding.md`.
- **AC16 trade-off prose** lives in the **PR #41 description**, not a repo file. It is **not** a code
  task — it is the responsibility of whoever updates the PR description (Docs phase / team lead). Task 6
  records the exact text to paste, but writes no repo file for it.

## Task overview

| Task | Goal | Files | Depends on |
|---|---|---|---|
| 1 | Create `AGENTS.md` + `CLAUDE.md` (standing changeset rule) | `AGENTS.md` (new), `CLAUDE.md` (new) | — |
| 2 | Suppress `noControlCharactersInRegex` (3 errors) via 2 per-line `biome-ignore`s | `src/progress/tracker.ts`, `src/__tests__/progress-tracker.test.ts` | — |
| 3 | Reorder CSS selectors (`pre` move first, then `code`) for `noDescendingSpecificity` | `docs/styles.css` | — |
| 4 | Safe auto-fix `noAdjacentSpacesInRegex` (4 warnings); confirm `biome lint .` ZERO diagnostics | `src/__tests__/progress-render.test.ts` | 2, 3 |
| 5 | Reformat `.changeset/config.json` to Biome tabs + set `"prettier": false` | `.changeset/config.json` | — |
| 6 | Record AC16 trade-off note for the PR description (no repo file) | — (PR description) | 5 |

Tasks 1, 2, 3, 5 are mutually independent. Task 4 must run **after** 2 and 3 because its terminal
acceptance check is the repo-wide `biome lint .` ZERO-diagnostics bar (AC8), which only holds once 2
and 3 have cleared their diagnostics. Task 6 follows 5 (it documents the `prettier: false` decision).
The recommended dispatch order is 1 → 2 → 3 → 4 → 5 → 6.

---

## Task 1 — Create `AGENTS.md` and `CLAUDE.md` (standing agent changeset rule)

**Goal.** Give the project's coding agents (Pi reads `AGENTS.md`; Claude Code auto-loads `CLAUDE.md`)
a standing, proactive instruction to record a changeset, so a forgotten changeset is prevented at
authoring time rather than caught reactively by the `changeset-gate.yml` CI check. (Change 1.)

**Files.**
- `/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning/AGENTS.md` — **new**
- `/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning/CLAUDE.md` — **new**

**Changes.**

1. Create `AGENTS.md` with **exactly** this content (from the design doc, §"Exact content — `AGENTS.md`"):

   ```md
   # Skillsmith

   A scenario-based evaluation harness for coding agents, published as `@automattic/skillsmith`.

   - Record a changeset for every release-relevant change: a committed `.changeset/*.md` that travels with the pull request. See [`CONTRIBUTING.md#adding-a-changeset`](CONTRIBUTING.md#adding-a-changeset) for when one is required, the bump-type table, and the pre-1.0 policy. While pre-1.0 (version `0.x`), record breaking changes as `minor` with a `BREAKING:` summary prefix — `major` is rejected pre-1.0 (see [`CONTRIBUTING.md#pre-10-policy`](CONTRIBUTING.md#pre-10-policy)).
   ```

   Structure requirements this content satisfies (do not deviate):
   - **Identity header** = `# Skillsmith` heading + one descriptive sentence naming the published
     package. Descriptive, not a behavioral rule (so it does not violate the "changeset-rule-only"
     constraint). Reads as a coherent standalone file, not an orphaned one-liner. (R1.4, AC1.)
   - **Single imperative bullet** opening with the verb "Record", in the same imperative-list style as
     radical-pipelines' `AGENTS.md`. (R1.5, AC3.)
   - States the obligation: every release-relevant change records a committed `.changeset/*.md` that
     **travels with the pull request**, and **cross-references `CONTRIBUTING.md#adding-a-changeset`**
     for the detail (when required, bump-type table, pre-1.0 policy). (R1.5, AC3.)
   - **Pre-1.0 sub-clause** = the trailing two sentences of the **same bullet** (not a second
     top-level bullet), action-framed, carrying all four required elements: (a) condition "while
     pre-1.0 (version `0.x`)"; (b) action "record breaking changes as `minor` with a `BREAKING:`
     summary prefix"; (c) prohibition "`major` is rejected pre-1.0"; (d) pointer
     `CONTRIBUTING.md#pre-10-policy`. The literal token `BREAKING:` appears. (R1.6, AC4.)
   - Cross-reference links use the **Markdown-link form** (matching `README.md` / `.changeset/README.md`)
     with anchors `#adding-a-changeset` and `#pre-10-policy` (GitHub auto-slugs; the dot in "1.0" is
     stripped — `#pre-10-policy` matches the validator message verbatim).

   Forbidden in `AGENTS.md` (R1.7, R1.8, AC5, AC6): no inlined semver bump mapping (no
   "fix→patch / feature→minor / breaking→major"); no "breaking change → major" wording; no restatement
   of the "when required" path list; no duplication of the bump-type table; no "the README" pointer as
   the policy how-to; no "keep README/docs current" rule; no other behavioral rule beyond the single
   changeset bullet. The file is identity header + that one bullet, nothing else.

2. Create `CLAUDE.md` whose **entire** contents are exactly the single line below — no heading, no
   blank-line padding, no trailing prose (AC2):

   ```
   @AGENTS.md
   ```

   Rationale: Claude Code auto-loads `./CLAUDE.md`, not `AGENTS.md`; the `@AGENTS.md` import bridges
   the rule to Claude Code while `AGENTS.md` serves Pi. (R1.1, R1.2.)

**Depends on.** None.

**Traces to.** AC1, AC2, AC3, AC4, AC5, AC6 (+ AC7: `.rp.md` is untouched — do not create or edit it).
Requirements R1.1, R1.2, R1.3, R1.4, R1.5, R1.6, R1.7, R1.8.

**Acceptance.**
- `AGENTS.md` exists at repo root (sibling to `.rp.md`) with the exact content above; reads as a
  coherent standalone file with identity header + exactly one changeset bullet carrying the pre-1.0
  sub-clause; contains none of the forbidden content (AC1, AC3, AC4, AC5, AC6). The literal token
  `BREAKING:` is present (AC4).
- `CLAUDE.md` exists at repo root and its entire contents are exactly `@AGENTS.md` (verify it is a
  single line, nothing else) (AC2).
- `.rp.md` is unchanged — `git diff --quiet -- .rp.md` returns clean (AC7). Do not touch it.
- Manifest discipline: only `AGENTS.md` and `CLAUDE.md` are created by this task.

---

## Task 2 — Suppress `noControlCharactersInRegex` with two per-line `biome-ignore`s

**Goal.** Clear the 3 `noControlCharactersInRegex` **errors** (the CI-blocking ones) at the source
via narrowly-scoped per-line ignores — the spec's recommended posture and default — without any
file-level or rule-level disable. (Change 2, posture 2a.)

**Files.**
- `/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning/src/progress/tracker.ts`
- `/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning/src/__tests__/progress-tracker.test.ts`

**Changes.** Two comments total, one per offending line (a line cannot carry two separate
`biome-ignore`s, and the test's two diagnostics — cols 31 & 43 — share line 141, so one comment above
it suppresses both).

1. `src/progress/tracker.ts` — line 358 is currently (module top level, no indentation):

   ```ts
   const ANSI_SGR = /\x1b\[[0-9;]*m/g;
   ```

   Insert a new line **directly above** it (no leading indentation, matching line 358):

   ```ts
   // biome-ignore lint/suspicious/noControlCharactersInRegex: matches real ANSI SGR escape sequences; the ESC byte (0x1b) is the intended content used to strip colour codes when measuring printed width.
   ```

   Do not alter line 358 itself.

2. `src/__tests__/progress-tracker.test.ts` — line 141 is currently (inside a test body,
   **tab-indented** with one leading tab):

   ```ts
   	const match = second.match(/^\x1b\[(\d+)A\x1b\[0J/);
   ```

   Insert a new line **directly above** it, carrying the **same single leading tab** as line 141 (so
   the comment reads as attached and matches the file's tab style — `biome.json` `indentStyle: "tab"`):

   ```ts
   	// biome-ignore lint/suspicious/noControlCharactersInRegex: asserts a repaint starts with real ANSI cursor-up + erase-display escapes; the ESC byte (0x1b) is the intended content.
   ```

   Do not alter line 141 itself.

Each comment is on its own line, immediately above the code line, in the exact form
`// biome-ignore lint/suspicious/noControlCharactersInRegex: <reason>`. No whole-file ignore; no
`biome.json` rule-level disable.

> Do NOT attempt a regex rewrite. `noControlCharactersInRegex` detects the control **codepoint**, so
> every regex-literal respelling of ESC (`\x1b`, literal ESC, `\u{1b}`) still trips it; the only
> rule-passing rewrite abandons the literal for a `new RegExp(...)` form that trips other rules and
> regresses readability. The per-line ignore is the spec's chosen default. (The runtime-`RegExp`
> rewrite is an owner-selectable alternative the spec records but does **not** take here.)

**Depends on.** None.

**Traces to.** AC9 (+ contributes to AC8, AC12, AC19). Requirements R2.2a.

**Acceptance.**
- `src/progress/tracker.ts` has exactly one new `// biome-ignore lint/suspicious/noControlCharactersInRegex: …`
  comment directly above the (unchanged) line `const ANSI_SGR = /\x1b\[[0-9;]*m/g;`, with a reason
  referencing the ANSI ESC `0x1b` byte (AC9).
- `src/__tests__/progress-tracker.test.ts` has exactly one new such comment directly above the
  (unchanged) `const match = second.match(/^\x1b\[(\d+)A\x1b\[0J/);` line, tab-indented to match, with
  a reason referencing the ESC `0x1b` byte (AC9).
- No whole-file ignore and no rule-level disable anywhere (AC9).
- Scoped verification: `npx biome lint src/progress/tracker.ts src/__tests__/progress-tracker.test.ts`
  reports **no `noControlCharactersInRegex` diagnostics** for these two files. (The repo-wide
  ZERO-diagnostics bar is asserted in Task 4.)
- Only these two files are touched; line 358 / line 141 themselves are unchanged.

---

## Task 3 — Reorder CSS selectors in `docs/styles.css` (`noDescendingSpecificity`)

**Goal.** Clear the 2 `noDescendingSpecificity` **warnings** by moving each bare element selector to
sit before its higher-specificity counterpart — a pure, rendering-neutral move (no declaration
changes). (Change 2, posture 2b.)

**Files.**
- `/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning/docs/styles.css`

**Changes.** Two cut-and-paste moves; declaration bodies stay byte-identical. The file uses **tab**
indentation inside rule blocks — preserve it.

**IMPORTANT — do move #1 (the `pre` move) FIRST, then #2.** Moving the `pre` block shifts every
subsequent line number, so pre-edit line numbers for #2 would be wrong if #1 is done first only by
line number. Safest: locate targets by **selector text** (`.terminal pre {`, `.note-card code {`,
the bare `pre {`, the bare `code {`), not by absolute line.

1. **Move the bare `pre {}` rule** (pre-edit lines 596–603):

   ```css
   pre {
   	margin: 0;
   	padding: 20px;
   	overflow-x: auto;
   	color: #d1fae5;
   	font-size: 0.92rem;
   	line-height: 1.65;
   }
   ```

   to sit **immediately before** the `.terminal pre {` rule (pre-edit line 300). After the move,
   source order is bare `pre {}` then `.terminal pre {}`. Remove it from its original location (do not
   duplicate); collapse the now-empty gap so there is exactly one blank line between adjacent rules,
   matching the file's existing spacing.

2. **Move the bare `code {}` rule** (originally lines 605–607):

   ```css
   code {
   	font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
   }
   ```

   to sit **immediately before** the `.note-card code {` rule (pre-edit line 429). After the move,
   source order is bare `code {}` then `.note-card code {}`. Remove it from its original location (do
   not duplicate); collapse the empty gap to one blank line.

Net file length is unchanged (pure move). Rendering is provably preserved: `.terminal pre` /
`.note-card code` have specificity (0,1,1) vs bare `pre`/`code` at (0,0,1) — unequal, so the cascade
picks the higher-specificity rule regardless of source order. This rule is **not** auto-fixable; it is
a manual edit. Do **not** run `biome lint --write` for this (that fixes only the regex warnings).

**Depends on.** None.

**Traces to.** AC10 (+ contributes to AC8, AC12, AC19). Requirements R2.2b.

**Acceptance.**
- In `docs/styles.css`, the bare `pre {}` rule now appears **before** `.terminal pre {}`, and the bare
  `code {}` rule now appears **before** `.note-card code {}`; both moved blocks have byte-identical
  declarations to before; no other declarations changed (AC10).
- Scoped verification: `npx biome lint docs/styles.css` reports **no `noDescendingSpecificity`
  diagnostics** for the file.
- Only `docs/styles.css` is touched. (`docs/**` is gate-exempt — no changeset implicated.)

---

## Task 4 — Safe auto-fix `noAdjacentSpacesInRegex`, then confirm repo-wide ZERO diagnostics

**Goal.** Clear the 4 `noAdjacentSpacesInRegex` **warnings** via Biome's safe auto-fix, then assert
the terminal acceptance bar for Change 2: `biome lint .` reports **0 errors AND 0 warnings** across
the whole repo. (Change 2, posture 2c + final verification.)

**Files.**
- `/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning/src/__tests__/progress-render.test.ts`

**Changes.**

1. Run the safe auto-fix **scoped to the single file** (this is the design's recommended form):

   ```sh
   npx biome lint --write src/__tests__/progress-render.test.ts
   ```

   Biome rewrites literal consecutive spaces to an exact-count quantifier on a single space. The four
   expected transforms (verified live):

   | Line | Before | After |
   |---|---|---|
   | 64 | `/^scenarios  /` | `/^scenarios {2}/` |
   | 67 | `/^phases     /` | `/^phases {5}/` |
   | 150 | `/elapsed 16:48   done/` | `/elapsed 16:48 {3}done/` |
   | 295 | `/elapsed 1:23:07   done/` | `/elapsed 1:23:07 {3}done/` |

   A `{n}` quantifier on a single space matches exactly n spaces — semantically identical, zero
   behavior change. **Review the resulting diff:** it must touch **only** these 4 regex lines. Do NOT
   use `--unsafe`, and do NOT run `biome check` (AC12, R2.3). (`npm run lint:fix` = `biome lint --write .`
   would also apply only these safe fixes, but the scoped form keeps the diff unambiguous.)

**Depends on.** Tasks 2 and 3 (its terminal check is the repo-wide ZERO-diagnostics bar, which holds
only once the control-char errors and CSS warnings are cleared).

**Traces to.** AC11 + AC8 + AC12 (scope guard) + AC18 (lint gate green). Requirements R2.1, R2.2c,
R2.3.

**Acceptance.**
- The 4 lines in `src/__tests__/progress-render.test.ts` are in the `/ {n}/` form exactly as the table
  above; no other lines in the file changed (AC11).
- The test suite still passes: `npm test` is green (assertions match the same strings; zero behavior
  change) (AC11).
- **Terminal bar (AC8):** `npx biome lint .` reports **0 errors and 0 warnings** (verify the output
  reports no errors AND no warnings, not merely exit 0). This is the Change 2 acceptance gate and the
  point at which the previously-red lint gate (AC18) turns green.
- **Scope guard (AC12):** `git diff --name-only` shows **no** imports reordered and **no** files
  outside the AC19 manifest changed; for Change 2 specifically the only changed files are
  `src/progress/tracker.ts`, `src/__tests__/progress-tracker.test.ts`,
  `src/__tests__/progress-render.test.ts`, and `docs/styles.css`. The fix was done with `biome lint`,
  never `biome check`.

---

## Task 5 — Reformat `.changeset/config.json` to Biome tabs and set `"prettier": false`

**Goal.** Align Changesets' formatting with the Biome-only toolchain: (i) reformat the hand-maintained
`.changeset/config.json` to Biome tab style so the whole repo passes `biome format` (hard, testable),
and (ii) set `"prettier": false` to decouple Changesets from the undeclared transitive `prettier@2.8.8`
(owner-selectable default). (Change 3, 3-i + 3-ii.)

**Files.**
- `/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning/.changeset/config.json`

**Changes.** Two independent edits to this one file. The reliable sequence (so the **final** committed
file passes `biome format`) is: **add the `prettier` key → `biome format --write` → commit.**

1. **Add the `"prettier": false` top-level key** (R3.1, AC13). Place it in a natural slot keeping the
   existing key order — recommended: just after `"commit": false,` (grouping the two booleans):

   ```json
   	"prettier": false,
   ```

   This is the single switch that disables Prettier across both Changesets paths that use it
   (`@changesets/apply-release-plan` for `changeset version`, and `@changesets/write` for
   `changeset add`). The schema (`@changesets/config@3.1.4`) types `prettier` as a top-level boolean
   (default `true`).

2. **Reformat to Biome tab style** by running:

   ```sh
   npx biome format --write .changeset/config.json
   ```

   Accept the **full** Biome output — tabs **plus** Biome's expansion of the `changelog` array onto
   multiple lines (keeping the inner `{ "repo": ... }` object inline). Do **NOT** hand-preserve the
   original inline array; a hand-preserved inline array would fail AC14 because Biome insists on
   expanding it. The expected final file (verified live, idempotent):

   ```json
   {
   	"$schema": "https://unpkg.com/@changesets/config@3.1.4/schema.json",
   	"changelog": [
   		"@changesets/changelog-github",
   		{ "repo": "Automattic/skillsmith" }
   	],
   	"commit": false,
   	"prettier": false,
   	"fixed": [],
   	"linked": [],
   	"access": "public",
   	"baseBranch": "trunk",
   	"updateInternalDependencies": "patch",
   	"ignore": [],
   	"changedFilePatterns": [
   		"src/**",
   		"bin/**",
   		"package.json",
   		"examples/**",
   		"README.md",
   		"!src/__tests__/**"
   	]
   }
   ```

   (The exact placement of `"prettier": false` among the top-level keys is free — anywhere top-level is
   valid; the block above shows the recommended slot after `"commit": false`. What matters for AC14 is
   that the committed file is fully Biome-clean.)

Do **NOT** add any `biome format` (or other formatting) step to `.github/workflows/release.yml`
(R3.3, AC15) — it would be a no-op (`changeset version` preserves `package.json` tabs via
`detect-indent`; `CHANGELOG.md` is Markdown that Biome cannot format). This fix is independent of the
`prettier` flag — `config.json` is hand-maintained and never rewritten by `changeset version`.

**Depends on.** None.

**Traces to.** AC13, AC14, AC15 (no release-flow format step). Requirements R3.1, R3.2, R3.3, R3.4.

**Acceptance.**
- `.changeset/config.json` has a top-level `"prettier": false` key (AC13).
- `npx biome format .changeset/config.json` **reports "No fixes applied" / no changes** — the file is
  committed in full Biome style (tabs + expanded `changelog` array) (AC14).
- The file remains valid JSON and is read correctly by Changesets:
  `npx changeset status --since=origin/trunk` exits 0 and still honors `changedFilePatterns` (AC14,
  AC17/AC18). (This relies solely on the pre-existing `initial-scaffolding.md`; no new changeset.)
- `.github/workflows/release.yml` is unchanged — `git diff --quiet -- .github/workflows/release.yml`
  is clean (AC15).
- Only `.changeset/config.json` is touched; `.changeset/initial-scaffolding.md` is unchanged and no
  new `.changeset/*.md` exists (AC17).

---

## Task 6 — Record the Change 3 trade-off note for the PR #41 description (no repo file)

**Goal.** Capture the AC16 trade-off prose so it can be pasted into the **PR #41 description** by
whoever updates it (Docs phase / team lead). This task writes **no repo file** — `.changeset/config.json`
is JSON with no prose slot, and `CONTRIBUTING.md` / `README.md` are excluded by AC19. Its output is the
text block below, surfaced for the PR description.

**Files.** None (PR #41 description only — not a repo file, not in the AC19 manifest).

**Changes.** Provide this text for the PR #41 description (record verbatim; trim to house style if
needed but keep all three elements — recommendation, exact before/after, owner-selectable alternative):

> **Changesets formatting (`prettier: false`) — a deliberate decoupling trade-off, not a bug fix.**
> `.changeset/config.json` now sets `"prettier": false`. This is the **recommended default**: it is
> the single switch that disables Prettier across both Changesets paths that use it
> (`changeset version` and `changeset add`), removing this repo's tacit dependence on the undeclared
> transitive `prettier@2.8.8` (pulled in via `@changesets/cli`) so the changelog tooling no longer
> couples to a formatter the Biome-only toolchain does not use.
>
> The cost is **purely cosmetic** — `CHANGELOG.md` spacing only, on a file Biome cannot format anyway
> (Biome 2.4.x does not format Markdown). Exact before/after for a minor bump:
> - `prettier: true` → `## 0.2.0` · blank line · `### Minor Changes` · blank line · `- <entry>` (normalized).
> - `prettier: false` → `## 0.2.0` · `### Minor Changes` (no blank line) then the entry with tighter spacing.
>
> Both render correctly. `package.json` is unaffected either way (`changeset version` preserves its
> tabs via `detect-indent`).
>
> **Owner-selectable alternative:** keep `prettier: true` for normalized changelog spacing — but then
> the repo should honestly declare Prettier as an explicit `devDependency`, which reintroduces a second
> formatter alongside Biome (the dual-formatter coupling this change set out to remove). Recommendation
> remains `prettier: false`.

**Depends on.** Task 5 (documents the decision made there).

**Traces to.** AC16.

**Acceptance.**
- The trade-off note (recommendation + exact `CHANGELOG.md` before/after + the `prettier: true` +
  explicit-devDependency owner-selectable alternative) is recorded for the PR #41 description (AC16).
- **No repo file is created or modified by this task** (manifest discipline — AC19).

---

## Final verification (run after all tasks; maps to acceptance criteria)

Run from the worktree root. All must pass before the effort is considered done.

| Check | Command / inspection | ACs |
|---|---|---|
| `AGENTS.md` shape, single bullet, pre-1.0 sub-clause, no forbidden content | read the file | AC1, AC3, AC4, AC5, AC6 |
| `CLAUDE.md` is exactly `@AGENTS.md` | read the file (one line, nothing else) | AC2 |
| `.rp.md` unchanged | `git diff --quiet -- .rp.md` (clean) | AC7 |
| Lint clean | `npx biome lint .` → **0 errors, 0 warnings** | AC8 |
| Control-char ignores correct & narrow | read `tracker.ts:358` & `progress-tracker.test.ts:141` — one per-line `biome-ignore` each, with reason; no file/rule disable | AC9 |
| CSS reorder rendering-neutral | read `docs/styles.css` — bare `pre`/`code` now precede `.terminal pre`/`.note-card code`; declarations unchanged | AC10 |
| Regex auto-fix correct | read the 4 lines in `progress-render.test.ts` (`/ {n}/` form); `npm test` passes | AC11 |
| Scope guard | `git diff --name-only` shows only the AC19 files; no import reorder; `biome lint` (not `check`) used | AC12 |
| `prettier: false` present | read `.changeset/config.json` (top-level key) | AC13 |
| config.json Biome-clean & valid | `npx biome format .changeset/config.json` → "No fixes applied"; `npx changeset status --since=origin/trunk` reads it | AC14 |
| No release-flow format step | `git diff --quiet -- .github/workflows/release.yml` (clean) | AC15 |
| Trade-off documented | present in the PR #41 description (Task 6 text) | AC16 |
| ZERO new changesets | `git status` shows no new `.changeset/*.md`; `git diff --quiet -- .changeset/initial-scaffolding.md` | AC17 |
| Both CI gates green | `changeset-gate.yml` (validator + `changeset status --since=origin/trunk` exit 0) and `npm run lint` (zero diagnostics) | AC18 |
| File manifest exact | `git diff --name-only` (+ untracked `AGENTS.md`, `CLAUDE.md`) = exactly the 7 manifest paths | AC19 |
