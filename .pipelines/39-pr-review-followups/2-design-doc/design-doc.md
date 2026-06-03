# Design Doc: Changelog/versioning follow-ups from the PR #41 review

Turns the approved [`1-spec/spec.md`](../1-spec/spec.md) (19 acceptance criteria across three PR #41
review follow-ups) into a concrete, implementable plan. For each change this doc names the exact
files to create/edit, the precise content/structure, the trade-offs taken, and how the result is
verified against the spec's acceptance bar.

Empirical claims below were re-confirmed against the live worktree at
`/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning`
(branch `worktree-39-changelog-and-versioning` = open PR #41) while writing this doc: `biome lint .`
reports exactly 3 errors + 6 warnings; `biome format --write` on a copy of `.changeset/config.json`
produces tabs + a multi-line `changelog` array and is then idempotent.

## Design overview

| # | Change | Files touched | Hardness |
|---|---|---|---|
| 1 | Standing agent changeset rule | `AGENTS.md` (new), `CLAUDE.md` (new) | Authored content — judgment in wording, fully constrained by spec |
| 2 | `biome lint .` → zero diagnostics | `src/progress/tracker.ts`, `src/__tests__/progress-tracker.test.ts`, `src/__tests__/progress-render.test.ts`, `docs/styles.css` | Mechanical + one authored ignore reason |
| 3 | Align Changesets with Biome | `.changeset/config.json` | One hard testable change (reformat) + one owner-selectable flag (`prettier`) |

**Complete file manifest for the whole effort (AC19), exact and closed:**

- `AGENTS.md` — **new**
- `CLAUDE.md` — **new**
- `src/progress/tracker.ts` — edit (1 line added)
- `src/__tests__/progress-tracker.test.ts` — edit (1 line added)
- `src/__tests__/progress-render.test.ts` — edit (4 lines changed, via safe auto-fix)
- `docs/styles.css` — edit (two rules moved)
- `.changeset/config.json` — edit (reformat + 1 key)

No other file is created or modified. In particular **not** `.rp.md`, `CONTRIBUTING.md`, `README.md`,
`.github/workflows/release.yml`, `.changeset/initial-scaffolding.md`, and **no new `.changeset/*.md`**.
The Change 3 trade-off prose (AC16) lands in the **PR #41 description**, which is not a repo file and
so is not part of this manifest.

### Cross-cutting invariants (apply to every change below)

- **ZERO new changesets (AC17).** The branch already carries `.changeset/initial-scaffolding.md`
  (`none` bump). `changeset status` evaluates the gate **per-package**, so that one file already
  satisfies the `@automattic/skillsmith` gate for every release-relevant edit here — including the
  `src/progress/tracker.ts` edit (which matches `changedFilePatterns`'s `src/**`). The design adds
  **no** `.changeset/*.md` and does **not** edit `initial-scaffolding.md` (correct as-is). This is a
  design constraint, not a task: no step below produces a changeset.
- **Biome `lint`, never `check` (AC12, R2.3).** Every lint operation in Change 2 uses `biome lint`.
  `biome check --write` additionally runs `assist/source/organizeImports`, which would reorder
  imports across ~6 unrelated files and is out of scope.
- **One branch, no new PR.** All edits land on `worktree-39-changelog-and-versioning` (PR #41).

---

## Change 1 — Standing agent-facing changeset instruction

### Files

Two **new** repo-root files, siblings of `.rp.md`:

- `/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning/AGENTS.md`
- `/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning/CLAUDE.md`

### Exact content — `AGENTS.md`

```md
# Skillsmith

A scenario-based evaluation harness for coding agents, published as `@automattic/skillsmith`.

- Record a changeset for every release-relevant change: a committed `.changeset/*.md` that travels with the pull request. See [`CONTRIBUTING.md#adding-a-changeset`](CONTRIBUTING.md#adding-a-changeset) for when one is required, the bump-type table, and the pre-1.0 policy. While pre-1.0 (version `0.x`), record breaking changes as `minor` with a `BREAKING:` summary prefix — `major` is rejected pre-1.0 (see [`CONTRIBUTING.md#pre-10-policy`](CONTRIBUTING.md#pre-10-policy)).
```

The pre-1.0 sub-clause is the **trailing two sentences of the same bullet** (after the
`CONTRIBUTING.md#adding-a-changeset` cross-reference), not a second top-level bullet — satisfying
R1.6's "sub-clause of the changeset bullet."

### Structure decisions and why

- **Identity header (R1.4, AC1).** `# Skillsmith` + a one-sentence identity, mirroring
  radical-pipelines' short `AGENTS.md` header (`# Radical Pipelines` + one identity sentence). This
  stops the file reading as an orphaned one-liner. The identity sentence describes what skillsmith
  is and names the published package; this is descriptive, not a behavioral rule, so it does not
  violate R1.8 ("changeset-rule-only" governs *rules*, not the header). The wording is drawn from the
  repo's own self-description (`@automattic/skillsmith`, the evaluation-harness framing in
  `README.md`/`CONTRIBUTING.md`); the implementer may tighten it to match the README's exact tagline,
  but it must stay a single descriptive sentence.

- **Single imperative bullet (R1.5, AC3).** One `-` bullet, opening with the imperative verb
  "Record", in the same list style as radical-pipelines' `AGENTS.md`. It states the obligation
  (every release-relevant change records a committed `.changeset/*.md` that travels with the PR —
  the `CONTRIBUTING.md:16` framing) and immediately defers detail via the cross-reference. It does
  **not** restate the "when required" path list or the bump-type table — it points to them.

- **Cross-reference target = `CONTRIBUTING.md#adding-a-changeset` (R1.5).** This is the exact anchor
  `README.md:239` and `.changeset/README.md` already use, so all three pointers agree.
  `CONTRIBUTING.md#adding-a-changeset` is the GitHub auto-slug for the `## Adding a changeset`
  heading; `CONTRIBUTING.md#pre-10-policy` is the auto-slug for `### Pre-1.0 policy` (the dot in
  "1.0" is stripped) and matches the validator's message verbatim
  (`scripts/validate-changesets.ts` → "see CONTRIBUTING.md#pre-10-policy"). Links are written as
  relative Markdown links (`CONTRIBUTING.md#...`) since `AGENTS.md` sits at the repo root next to
  `CONTRIBUTING.md`; rendering as bare inline code (`` `CONTRIBUTING.md#adding-a-changeset` ``) is an
  acceptable equivalent — the spec requires the cross-reference and the anchor, not link syntax. The
  implementer should match whichever form `README.md`/`.changeset/README.md` use for visual
  consistency (those use Markdown links), so the Markdown-link form is the default here.

- **Pre-1.0 sub-clause, action-framed (R1.6, AC4).** Carries all four required elements in
  action-first order:
  - (a) condition — "While pre-1.0 (version `0.x`)";
  - (b) action — "record breaking changes as `minor` with a `BREAKING:` summary prefix";
  - (c) prohibition — "`major` is rejected pre-1.0";
  - (d) pointer — `CONTRIBUTING.md#pre-10-policy`.

  The literal token `BREAKING:` appears (AC4 requires it; it is load-bearing — it carries the break
  into `CHANGELOG.md`). The phrasing deliberately mirrors both enforcement points so it cannot drift
  in spirit: `CONTRIBUTING.md:50` ("write `minor` (never `major`) … prepend `BREAKING:` to the
  summary") and the validator message ("Use `'minor'` with a `'BREAKING:'` prefix"). It is action-
  first (do this) rather than prohibition-first (don't do that) — the action clause leads, the
  `major`-is-rejected fact follows as the reason.

### Exact content — `CLAUDE.md`

The file's **entire** contents are exactly the single line (no heading, no blank-line padding, no
trailing prose — AC2):

```
@AGENTS.md
```

### Why this two-file design (R1.1, R1.2, AC1, AC2)

Claude Code auto-loads `./CLAUDE.md` (or `./.claude/CLAUDE.md`), **not** `AGENTS.md`. Pi reads
`AGENTS.md` directly. So:

- A lone `AGENTS.md` → invisible to Claude Code.
- A lone `CLAUDE.md` → invisible to Pi.

The `@AGENTS.md` import in `CLAUDE.md` bridges the rule to Claude Code while `AGENTS.md` serves Pi —
the pair covers both radical-pipelines agent runtimes. The `@AGENTS.md` import (over a
`CLAUDE.md → AGENTS.md` symlink) is the portable, Windows-safe form radical-pipelines uses
verbatim, and matches the pattern its `README.md` codifies ("`CLAUDE.md` may be a thin pointer to
`AGENTS.md` … and should not duplicate shared `AGENTS.md` content").

### Why NOT `.rp.md` (R1.3, AC7) — a hard constraint, not a task

`.rp.md` is synced from the radical-pipelines upstream (the two most recent commits are
"Copy `.rp.md` from Radical Pipelines …"). A future re-sync would clobber any rule placed there. The
sync copies **only** `.rp.md`; `AGENTS.md` and `CLAUDE.md` are independent, repo-owned files the sync
never touches, so the chosen placement is re-sync-safe by construction. `.rp.md` is left **byte-for-
byte unchanged** by this work (verified by its absence from the AC19 manifest).

### Why we adapt radical-pipelines' shape but NOT its wording (R1.7, R1.8, AC5, AC6)

radical-pipelines' root `AGENTS.md` (verbatim from its live `trunk`) is a 3-line identity header
followed by two imperative bullets — a "keep the README up to date" bullet and a changeset bullet
that (i) inlines the semver triad including "breaking change → major", and (ii) points to "the
README's changelog and versioning section." We reuse only the **shape** (identity header + imperative
bullet[s], `CLAUDE.md` = `@AGENTS.md`) and deliberately diverge on content:

- **No "breaking change → major" mapping (R1.7, AC5).** skillsmith is `0.1.0` and its live validator
  (`scripts/validate-changesets.ts`) **hard-rejects `major` while `0.x`**. Telling an agent
  "breaking → major" would instruct it to author a changeset the gate rejects — an active
  contradiction. Our bullet inlines **no** semver mapping at all (no "fix→patch / feature→minor /
  breaking→major"); it defers the whole mapping to the `CONTRIBUTING.md` bump-type table and
  overrides the breaking case with the pre-1.0 sub-clause.
- **No "the README" pointer (R1.7, AC5).** skillsmith's `README.md` has **no** changelog/versioning
  how-to section (its only relevant content is `## Releases` linking `CHANGELOG.md`/GitHub releases,
  and a `## Contributing` one-liner that itself defers to `CONTRIBUTING.md#adding-a-changeset`). The
  policy home is `CONTRIBUTING.md`, so that is the only correct target.
- **No "keep README/docs current" rule (R1.8, AC6).** skillsmith has no such documented expectation
  anywhere in live policy; `CONTRIBUTING.md:31` in fact treats prose-only doc edits *more loosely*
  (no changeset, "CI does not nag"). Adding the rule would be an unreviewed new obligation and is an
  explicit Non-goal. `AGENTS.md` therefore contains **only** the identity header + the single
  changeset bullet (with its pre-1.0 sub-clause) — no other behavioral rule (AC6).

This defer-don't-restate posture also follows the in-repo precedent: `.changeset/README.md` is the
existing short pointer and deliberately does **not** restate a bump mapping ("This README is a cheat
sheet, not the source of truth"). The new `AGENTS.md` bullet is the same kind of artifact.

### Trade-offs (Change 1)

- **Markdown link vs. inline code for the cross-references.** Default to the same form
  `README.md`/`.changeset/README.md` use (Markdown links) for visual consistency. Bare inline-code
  anchors are an acceptable equivalent; the spec requires the anchor text, not the link syntax.
- **Pre-1.0 clause staleness at 1.0.** The clause is self-dating ("While pre-1.0"), so at the 1.0
  cutover it degrades to a harmless no-longer-applicable precondition — never a silent contradiction.
  Including it now is the better trade than omitting it (the pre-1.0 "no `major`" rule is the single
  most likely place an agent, primed by general semver, errs). Its eventual removal is a tracked 1.0-
  cutover cleanup item, **out of scope** here.

---

## Change 2 — `biome lint .` reports ZERO diagnostics

Acceptance bar (R2.1, AC8): `biome lint .` reports **0 errors AND 0 warnings** — not merely exit 0.
The 9 live diagnostics break into three classes, each with its own fix posture. Confirmed live while
writing this doc:

| File:line(s) | Rule | Count | Sev | Fix posture |
|---|---|---|---|---|
| `src/progress/tracker.ts:358` | `noControlCharactersInRegex` | 1 | error | per-line `biome-ignore` |
| `src/__tests__/progress-tracker.test.ts:141` (cols 31, 43) | `noControlCharactersInRegex` | 2 | error | per-line `biome-ignore` (one comment covers both) |
| `docs/styles.css:596, 605` | `noDescendingSpecificity` | 2 | warning | manual selector reorder |
| `src/__tests__/progress-render.test.ts:64,67,150,295` | `noAdjacentSpacesInRegex` | 4 | warning | safe auto-fix (`biome lint --write`) |

### 2a — `noControlCharactersInRegex` (3 errors): two per-line `biome-ignore`s

**Why an ignore, not a rewrite (R2.2a).** The flagged ESC byte (`0x1b`) is the *legitimate, necessary
content* — these regexes match real ANSI escape sequences (SGR colour codes, cursor-up + erase-
display). `noControlCharactersInRegex` detects the control **codepoint**, not the escape spelling, so
inside a regex *literal* every respelling (`\x1b`, the literal ESC char, `\u{1b}` with the `u` flag)
trips the rule. The only rule-passing alternative abandons the literal for a runtime
`new RegExp(...)` built from `String.fromCharCode(0x1b)` — and its natural variants trip *other* rules
(`new RegExp("\\x1b…")` → `useRegexLiterals`; `new RegExp(ESC + "…")` → `useTemplate`), leaving only
an awkward two-interpolation template that obscures the idiomatic ANSI pattern. A line-scoped
`biome-ignore` with a justification is the spec's explicitly permitted "rule genuinely inappropriate
for a specific location — narrowly justify and scope" carve-out, and is the recommended posture.

**Exact edits.** Two comments total, covering all three diagnostics — one per offending line (a line
cannot carry two separate `biome-ignore`s, and the test's two diagnostics share line 141).

`src/progress/tracker.ts` — insert directly above line 358:

```ts
// biome-ignore lint/suspicious/noControlCharactersInRegex: matches real ANSI SGR escape sequences; the ESC byte (0x1b) is the intended content used to strip colour codes when measuring printed width.
const ANSI_SGR = /\x1b\[[0-9;]*m/g;
```

`src/__tests__/progress-tracker.test.ts` — insert directly above line 141 (this single comment
suppresses both flagged escapes, cols 31 & 43):

```ts
// biome-ignore lint/suspicious/noControlCharactersInRegex: asserts a repaint starts with real ANSI cursor-up + erase-display escapes; the ESC byte (0x1b) is the intended content.
const match = second.match(/^\x1b\[(\d+)A\x1b\[0J/);
```

Each comment is on its **own line** immediately above the code line, in the exact form
`// biome-ignore lint/suspicious/noControlCharactersInRegex: <reason>`. The same technique is applied
to both lines. No whole-file ignore, no `biome.json` rule-level disable (AC9).

**Indentation caution.** `tracker.ts:358` is at module top level (no indent). `progress-tracker.test.ts:141`
sits inside a test body and is **tab-indented**; the `biome-ignore` comment must carry the **same
leading tab(s)** as line 141 so it reads as attached and matches the file's tab style (`biome.json`
`indentStyle: "tab"`). Insert the comment as a new line; do not alter line 141 itself.

**Owner-selectable alternative (recorded, not taken).** If the owner strongly prefers zero
suppressions, the runtime-`RegExp` form is available and verified clean for `tracker.ts`. The
recommendation — and this design's default — is the per-line ignore, on readability grounds, for both
source and test (`(A) ignore` vs `(B) rewrite` is the one genuine judgment call in Change 2).

### 2b — `noDescendingSpecificity` (2 warnings, `docs/styles.css`): reorder selectors

**Why rendering is provably preserved (R2.2b).** Biome flags a bare element selector appearing
*after* a higher-specificity selector for the same element. In both pairs the specificities are
**unequal** — `.terminal pre` and `.note-card code` are (0,1,1); bare `pre` and `code` are (0,0,1) —
so the cascade always picks the higher-specificity rule regardless of source order. Reordering cannot
change which declaration wins; this is a pure move with **no declaration changes**. The rule is **not**
auto-fixable — this is a manual edit. (The "equal-specificity could matter" case does not occur here.)

**Exact edits** (two cut-and-paste moves; declarations byte-identical):

1. Move the bare `pre {}` rule (currently lines 596–603):
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
   to sit **immediately before** `.terminal pre {` (currently line 300). After the move, source order
   is `pre {}` then `.terminal pre {}`.

2. Move the bare `code {}` rule (currently lines 605–607):
   ```css
   code {
       font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
   }
   ```
   to sit **immediately before** `.note-card code {` (currently line 429). After the move, source
   order is `code {}` then `.note-card code {}`.

Remove the two rules from their original location (lines 596–607, including the now-empty gap) so they
are not duplicated. Preserve the file's existing tab indentation inside each rule block (the CSS uses
tabs). Net file length is unchanged (pure move); `docs/**` is gate-exempt so no changeset is implicated.

> Editing note: line numbers above are pre-edit. Do edit #1 (the `pre` move near line 300) **before**
> #2, or recompute offsets — moving the `pre` block shifts every subsequent line. Equivalently, locate
> the targets by selector text (`.terminal pre {`, `.note-card code {`) rather than by absolute line.

### 2c — `noAdjacentSpacesInRegex` (4 warnings, `progress-render.test.ts`): safe auto-fix

**Why the auto-fix is safe (R2.2c).** Biome rewrites literal consecutive spaces in a regex literal to
an exact-count quantifier on a single space, which matches exactly that many spaces — semantically
identical, zero behavior change. The four exact transforms (confirmed live):

| Line | Before | After |
|---|---|---|
| 64 | `/^scenarios  /` | `/^scenarios {2}/` |
| 67 | `/^phases     /` | `/^phases {5}/` |
| 150 | `/elapsed 16:48   done/` | `/elapsed 16:48 {3}done/` |
| 295 | `/elapsed 1:23:07   done/` | `/elapsed 1:23:07 {3}done/` |

**How to apply.** Run the safe auto-fix **scoped to the one file**:

```sh
npx biome lint --write src/__tests__/progress-render.test.ts
```

Scoping to the file is the design's recommended form. `npm run lint:fix` (= `biome lint --write .`)
also works — without `--unsafe` it applies only safe fixes, so it will not touch the control-char
errors (no safe fix offered) and will not reorder imports (that is `check`/assist, not `lint`). Either
way, the resulting diff must touch **only** these 4 regex lines; review it to confirm (AC11, AC12).
The test suite must still pass — the assertions match the same strings.

### Ordering of the Change 2 steps

The three postures are independent and can be applied in any order, but the recommended sequence keeps
the diff easy to review:

1. Apply the two `biome-ignore` comments (2a) — manual edits.
2. Reorder the two CSS rules (2b) — manual edit.
3. Run the scoped `biome lint --write` (2c) — auto-fix; review its diff.
4. Run `biome lint .` and confirm **0 errors, 0 warnings** (AC8).

Crucially, **do not** run `biome check --write` at any point (AC12, R2.3) — it would reorder imports
across ~6 unrelated files via `organizeImports`, ballooning the diff and pulling more files under the
changeset gate. The enforced gate (`package.json:28` `lint`, `release.yml:37` `npm run lint`) is
`biome lint .`, which runs no assist actions.

### Changeset footprint (Change 2)

No new changeset (R2.4, AC17). The `src/progress/tracker.ts` edit matches `changedFilePatterns`
(`src/**`), but the existing `initial-scaffolding.md` (`none`) already satisfies the per-package gate.
The two test-file edits (`!src/__tests__/**`) and the `docs/styles.css` edit (`docs/**` not listed)
are gate-exempt regardless.

### Trade-offs (Change 2)

- **`(A)` per-line ignore vs `(B)` runtime-`RegExp` rewrite** for the control-char errors — the one
  genuine judgment call. Default `(A)` for readability; `(B)` recorded as an owner-selectable
  alternative (verified clean for `tracker.ts`).
- **Clearing all 9 vs. only the 3 errors.** The literal CI bar today is exit 0, and Biome's default
  exit is driven by errors only, so fixing just the 3 errors would green CI and the 6 warnings alone
  would not fail it. The spec target is nonetheless **zero diagnostics** (R2.1/AC8): "passes cleanly"
  reads as "reports nothing," and the marginal cost of the 6 warnings is trivial (4 safe auto-fix, 2
  rendering-neutral reorder). If the owner prefers the minimal exit-0 bar, that is their call — the
  default is zero diagnostics.

---

## Change 3 — Align Changesets' formatting with the Biome toolchain

### File

`/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning/.changeset/config.json`

Two independent edits to this one file: a **hard, testable** reformat (R3.2) and an
**owner-selectable** `prettier` flag (R3.1). No other file changes — in particular **no**
`release.yml` formatting step (R3.3).

### 3-i (hard, testable) — reformat `config.json` to Biome tab style (R3.2, AC14)

**How.** Run `biome format --write .changeset/config.json` and commit the result. Accept the **full**
Biome output — tabs **and** whatever shape Biome emits for the `changelog` array. Do **not**
hand-preserve the original inline array.

**Exact before → after** (verified live on a copy; idempotent — re-running Biome → "No fixes
applied"):

Before (2-space indent, inline `changelog` array):

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.4/schema.json",
  "changelog": ["@changesets/changelog-github", { "repo": "Automattic/skillsmith" }],
  "commit": false,
  ...
}
```

After (tabs; Biome expands the `changelog` array onto multiple lines but keeps the inner
`{ "repo": ... }` object inline):

```json
{
	"$schema": "https://unpkg.com/@changesets/config@3.1.4/schema.json",
	"changelog": [
		"@changesets/changelog-github",
		{ "repo": "Automattic/skillsmith" }
	],
	"commit": false,
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

**Why the full output, not a hand-preserved inline array.** The acceptance test (AC14) is
"`biome format .changeset/config.json` reports no changes." A hand-preserved inline `changelog` array
would fail that test because Biome insists on expanding it. Verified: the expanded result is valid
JSON (`JSON.parse` ✓), `changeset status` still reads it correctly (honours `changedFilePatterns`),
and Biome is idempotent on it. `.changeset/config.json` is empirically the **only** repo file failing
`biome format` today, so this also makes the whole repo `biome format`-clean. This fix is
**independent** of 3-ii — `config.json` is hand-maintained and never rewritten by `changeset version`.

### 3-ii (owner-selectable) — set `"prettier": false` (R3.1, AC13)

**The edit.** Add a top-level key to `config.json`:

```json
	"prettier": false,
```

Placement is anywhere at the top level (the schema types `prettier` as a top-level boolean,
`default: true`). Recommended: keep keys in their existing order and add `"prettier": false` in a
natural slot (e.g. just after `"commit": false`, grouping the two booleans), then re-run
`biome format --write` so the final file is Biome-clean **with** the new key present. **Apply the
reformat (3-i) and the `prettier` key together, then format once more, so the committed file passes
`biome format` (AC14) in its final state** — the order is: add the key → `biome format --write` →
commit.

**Why `false` is the recommended default — a deliberate decoupling trade-off, NOT a bug fix
(record as such).** With no `prettier` key, Changesets defaults it to `true`, and `prettier@2.8.8`
**is** resolvable transitively (via `@changesets/cli`), so the default *actually runs* Prettier over
the files the release flow rewrites. Setting `false` is the single switch that disables Prettier
across **both** Changesets paths that use it — `@changesets/apply-release-plan` (the `changeset
version` path) and `@changesets/write` (the `changeset add` path). (`@changesets/changelog-github`
has no Prettier dependency.) `false` is faithful to the governing intent ("no coupling to a formatter
the repo does not use") and removes the tacit dependence on an undeclared transitive Prettier.

The cost is **purely cosmetic** and must not be overstated:

- **`package.json` is unaffected** — `changeset version` preserves its existing **tabs** under both
  `prettier:true` and `prettier:false` (it sniffs the file's own indent via `detect-indent`, never
  routing `package.json` through Prettier). Biome reports "No fixes applied" either way. The feared
  "release flow rewrites `package.json` 2-space and fights Biome" does **not** reproduce.
- **`CHANGELOG.md` spacing only.** The exact before/after to record (minor-bump example):
  - `prettier: true` → `## 0.2.0`⟶blank⟶`### Minor Changes`⟶blank⟶`- <entry>` (normalized).
  - `prettier: false` → `## 0.2.0`⟶`### Minor Changes` (no blank line) then the entry with tighter
    spacing.
  Both are valid Markdown that render correctly, and **Biome cannot format `.md`** (Biome 2.4.x
  formats only JS/TS/JSX/TSX/JSON/JSONC/HTML/CSS/GraphQL), so there is no Prettier-vs-Biome fight over
  the changelog — Biome has zero opinion on it.
- **Consistency note.** `prettier: false` also means interactively-created `.changeset/*.md` files
  won't be Prettier-formatted — fine, since Biome doesn't format `.md` either, so they were never
  Biome-managed.

**Owner-selectable alternatives (state for the owner; recommendation remains `false`):**

- **(i) Keep `prettier: true` for normalized changelog spacing** — but the repo then tacitly relies on
  the transitive `prettier@2.8.8`; being honest about that means declaring Prettier as an explicit
  `devDependency`, which reintroduces a second formatter alongside Biome — exactly the dual-formatter
  coupling this change set out to remove.
- **(ii) `prettier: true` and do nothing** — status quo; the tacit undeclared-Prettier dependency the
  intent wants to avoid.

This trade-off (the `prettier` value, the exact `CHANGELOG.md` before/after, and the
`prettier: true` + explicit-devDependency alternative as owner-selectable) is documented in the
**PR #41 description** (AC16) — `config.json` is JSON with no prose slot, and `CONTRIBUTING.md`/
`README.md` are excluded by AC19.

### 3-iii — NO `biome format` post-step in the release flow (R3.3, AC15)

Do **not** add a formatting step to `.github/workflows/release.yml`. It would be a no-op:
`changeset version` already leaves `package.json` tab-indented and Biome-clean (via `detect-indent`),
and `CHANGELOG.md` is Markdown that Biome cannot format. `prettier: false` alone is sufficient.
`release.yml` is **not** in the AC19 manifest and is left unchanged.

### Changeset footprint (Change 3)

No new changeset (R3.4, AC17). `.changeset/config.json` is a gate-exempt path — `.changeset/**` is
not in `changedFilePatterns`.

### Trade-offs (Change 3)

- **`prettier: false` (default) vs. `true` + explicit devDependency vs. `true` + nothing** — see the
  three options above. Default `false` for the clean decoupling story; cost is cosmetic changelog
  spacing on a file Biome can't format anyway. Do not overstate harm: no Prettier-vs-Biome fight
  exists over `package.json` or `CHANGELOG.md`.
- **Full Biome output vs. hand-preserved inline array** — must take the full output, or AC14
  ("`biome format` reports no changes") fails. Not really a free choice; recorded so the implementer
  does not "tidy" the array back inline.

---

## Verification plan (maps design → acceptance criteria)

Run from the worktree root. All checks must pass before the work is considered done.

| Check | Command / inspection | ACs |
|---|---|---|
| `AGENTS.md` shape, single bullet, pre-1.0 sub-clause, no forbidden content | read the file | AC1, AC3, AC4, AC5, AC6 |
| `CLAUDE.md` is exactly `@AGENTS.md` | read the file (one line, nothing else) | AC2 |
| `.rp.md` unchanged | `git diff --quiet .rp.md` (no diff) | AC7 |
| Lint clean | `npx biome lint .` → **0 errors, 0 warnings** | AC8 |
| Control-char ignores correct & narrow | read `tracker.ts:358`, `progress-tracker.test.ts:141` — one per-line `biome-ignore` each, with reason; no file/rule disable | AC9 |
| CSS reorder rendering-neutral | read `docs/styles.css` — bare `pre`/`code` now precede `.terminal pre`/`.note-card code`; declarations unchanged | AC10 |
| Regex auto-fix correct | read the 4 lines in `progress-render.test.ts` (`/ {n}/` form); `npm test` passes | AC11 |
| Scope guard | `git diff --name-only` shows only the AC19 files; no import reorder | AC12, AC19 |
| `prettier: false` present | read `.changeset/config.json` (top-level key) | AC13 |
| config.json Biome-clean & valid | `npx biome format .changeset/config.json` → "No fixes applied"; `npx changeset status --since=origin/trunk` reads it | AC14 |
| No release-flow format step | `git diff --quiet .github/workflows/release.yml` (no diff) | AC15 |
| Trade-off documented | present in the PR #41 description | AC16 |
| ZERO new changesets | `git status` shows no new `.changeset/*.md`; `git diff --quiet .changeset/initial-scaffolding.md` | AC17 |
| Both CI gates green | `changeset-gate.yml` (validator + `changeset status --since=origin/trunk` exit 0) and `npm run lint` | AC18 |
| File manifest exact | `git diff --name-only` = exactly the 7 paths in the manifest | AC19 |

> Note on the lint gate's literal bar (AC8): `release.yml`'s `npm run lint` greens on exit 0, which
> Biome drives by errors only — so strictly the 3 errors are the CI-blocking ones. The design's
> target is the stronger **zero-diagnostics** bar; clearing the 6 warnings too is what makes the
> branch future-proof if CI later promotes warnings to errors.

## Non-goals (carried from the spec — explicitly NOT designed)

- A "keep README/docs current" rule in `AGENTS.md`.
- Reordering imports / running `biome check --write`.
- Adding a `biome format` step to `release.yml`.
- Making "lint clean" enforceable via warnings-as-errors in CI.
- A `CONTRIBUTING.md` note about `changeset version` needing a local `GITHUB_TOKEN`.
- Removing the pre-1.0 clause from `AGENTS.md` at the 1.0 cutover (tracked future cleanup).
- Adding any new changeset, or editing `.changeset/initial-scaffolding.md`.
- A new branch or PR — all work lands on `worktree-39-changelog-and-versioning` (PR #41).
