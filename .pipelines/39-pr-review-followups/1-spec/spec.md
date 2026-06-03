# Spec: Changelog/versioning follow-ups from the PR #41 review

## Overview

PR #41 ("Add a changelog and automate package version bumps", issue #39) introduced
Changesets-based changelog tracking and release automation for skillsmith: it renamed the
package to `@automattic/skillsmith` and added `.changeset/config.json`, a `changeset-gate.yml`
CI gate, a `release.yml` publish workflow, a `validate-changesets.ts` shape validator, and a
`CONTRIBUTING.md` policy.

A review of that PR — comparing it against the equivalent Changesets adoption in the
**radical-pipelines** repo — surfaced three follow-up improvements. The owner wants all three
implemented **on the existing PR #41 branch** so they ship as part of PR #41, not as a separate
PR. This spec covers those three follow-ups:

1. **Change 1** — Give the project's coding agents a standing, proactive instruction to record a
   changeset (today the only thing enforcing one is the reactive `changeset-gate.yml` CI check).
2. **Change 2** — Make `npm run lint` pass cleanly on the branch (it currently fails on pre-existing
   issues, which would block the first real release).
3. **Change 3** — Align Changesets' formatting behaviour with this repo's Biome-only toolchain.

This is a **follow-up to an already-open PR, not a rework** of it. Keep all changes minimal and
scoped strictly to these three items.

### Working context (already true; do not change)

- **Branch:** all work lands on the existing `worktree-39-changelog-and-versioning` branch
  (= PR #41). Do NOT open a new branch or PR.
- **Worktree path:** `/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning`.
- **Formatter/linter:** Biome. `biome.json` sets `formatter.indentStyle = "tab"`,
  `javascript.formatter.quoteStyle = "double"`, linter `recommended: true`. Biome version in the
  repo is 2.4.x. There is **no direct Prettier dependency and no Prettier config**, but
  `prettier@2.8.8` IS present **transitively** via `@changesets/cli` (see Change 3).
- **Relevant `package.json` scripts:** `lint` = `biome lint .`, `lint:fix` = `biome lint --write .`,
  `format` = `biome format --write .`, `changeset` = `changeset`, `release` = `changeset publish`.
- **Package version is `0.1.0`** — the pre-1.0 validator guard in `scripts/validate-changesets.ts`
  is live (it hard-rejects `major` bumps while the version is `0.x`). This is why the `AGENTS.md`
  instruction must carry the pre-1.0 sub-clause (R1.6).
- **Canonical policy home:** `CONTRIBUTING.md` is the sole canonical versioning/changeset policy.
  There is **no policy section in `README.md`** — its only relevant content is `## Releases` (links
  to `CHANGELOG.md` + GitHub releases) and a `## Contributing` one-liner that defers to
  `CONTRIBUTING.md#adding-a-changeset`. Confirmed `CONTRIBUTING.md` anchors: `#adding-a-changeset`,
  `#bump-types`, `#pre-1.0-policy`.

### Cross-cutting constraint — ZERO new changesets (read before implementing)

This follow-up PR's total new-changeset footprint is **ZERO**. The branch already carries
`.changeset/initial-scaffolding.md` (a `none` bump), which the changeset gate evaluates
**per-package** — it already satisfies the gate for the whole `@automattic/skillsmith` package and
blankets every release-relevant edit in this work (including the `src/progress/tracker.ts` edit in
Change 2). This was proven on the real branch by a controlled test: with the `tracker.ts` edit
committed, the gate passes with `initial-scaffolding.md` present and fails only when it is removed.

Therefore the implementer **MUST NOT** add any new changeset, and **MUST NOT** edit
`.changeset/initial-scaffolding.md` (it is correct as-is). See AC17.

---

## Requirements

### Change 1 — Standing agent-facing instruction to record a changeset

**Problem.** The changeset policy lives only in `CONTRIBUTING.md`, which is human-facing. Most
changes in this repo are produced by radical-pipelines coding agents (Claude Code and/or Pi), which
read agent-instruction files, not `CONTRIBUTING.md`. The only thing enforcing a changeset today is
the `changeset-gate.yml` CI check — so a forgotten changeset is caught reactively (red gate + an
extra round-trip) instead of being added while the change is made.

**Solution — create two repo-root files** (alongside `.rp.md`):

- **R1.1 — `AGENTS.md`** holding the standing changeset instruction. Read directly by Pi.
- **R1.2 — `CLAUDE.md`** whose entire contents are exactly the import directive `@AGENTS.md`.

Both files are REQUIRED. Claude Code auto-loads `./CLAUDE.md` (or `./.claude/CLAUDE.md`), **not**
`AGENTS.md`; the `@AGENTS.md` import in `CLAUDE.md` is what makes the rule reach Claude Code agents.
Pi reads `AGENTS.md` directly. The pair therefore covers both radical-pipelines agent runtimes.
A lone `AGENTS.md` would be invisible to Claude Code; a lone `CLAUDE.md` would be invisible to Pi.

**R1.3 — Re-sync safety (constraint).** The rule MUST NOT be placed in `.rp.md`. `.rp.md` is synced
from the radical-pipelines upstream (recent commits "Copy `.rp.md` from Radical Pipelines …"), and a
re-sync would clobber it. The sync copies only `.rp.md`; `AGENTS.md` and `CLAUDE.md` are independent,
repo-owned files the sync does not touch, so placing the rule there is re-sync-safe. (This is already
satisfied by the chosen design; it is recorded as a hard constraint, not extra work.)

**R1.4 — `AGENTS.md` file shape.** It MUST read as a coherent standalone file: a minimal identity
header (a `# Skillsmith` heading + a one-sentence project identity, mirroring radical-pipelines'
short `AGENTS.md` header shape) followed by the changeset instruction. This avoids the file reading
as an orphaned one-liner.

**R1.5 — The changeset instruction MUST:**
- State the obligation **imperatively**: every release-relevant change records a committed
  `.changeset/*.md` that travels with the PR (consistent with the `CONTRIBUTING.md` framing that a
  changeset travels with the pull request).
- **Cross-reference `CONTRIBUTING.md#adding-a-changeset`** for the detail (when a changeset is
  required, the bump-type table, and the pre-1.0 policy). This is the same anchor `README.md` and
  `.changeset/README.md` already point to.
- Be a **single bullet** in the same imperative list style as radical-pipelines' `AGENTS.md`.

**R1.6 — The instruction MUST include a pre-1.0 sub-clause** (a sub-clause of the changeset bullet,
not a second top-level bullet), **action-framed (not a bare prohibition)**, carrying all four of:
  - (a) the condition — while pre-1.0 / version `0.x`;
  - (b) the action — use `minor` with a `BREAKING:` summary prefix;
  - (c) the fact that `major` is disallowed pre-1.0;
  - (d) a pointer to `CONTRIBUTING.md` (`#pre-1.0-policy` or `#adding-a-changeset`).

  This mirrors the canonical wording at both enforcement points so it cannot drift in spirit:
  `CONTRIBUTING.md` ("write `minor` (never `major`) … prepend `BREAKING:` to the summary") and the
  validator message in `scripts/validate-changesets.ts` ("`'major'` is forbidden while pre-1.0 …
  Use `'minor'` with a `'BREAKING:'` prefix"). The `BREAKING:` prefix is **load-bearing** — it
  carries the break into `CHANGELOG.md` — and MUST be named explicitly; a bare "never use `major`"
  would leave an agent liable to under-bump without the marker.

**R1.7 — The instruction MUST NOT:**
- Inline any semver bump-type mapping (no "fix→patch / feature→minor / breaking→major").
- State or imply "breaking change → major" — this contradicts the pre-1.0 policy and the live
  validator, which hard-rejects `major` while the version is `0.x` and would instruct an agent to
  author a changeset the gate rejects.
- Restate the "when a changeset is required" path list, or duplicate the bump-type table.
- Point to "the README" for the policy how-to. (radical-pipelines' bullet says "See the README's
  changelog and versioning section"; that section **does not exist** in skillsmith — the target must
  be `CONTRIBUTING.md#adding-a-changeset`.)

  Rationale for defer-don't-restate: skillsmith's bump rules are not the plain semver triad (the
  bump-type table has repo-specific triggers, and the pre-1.0 policy overrides the entire "major"
  column to "minor + `BREAKING:`" while `0.x`), and "when required" is path-scoped and nuanced with
  several carve-outs. Any inlined restatement would be lossy, already contradicted by the validator
  for the breaking case, and would need to change again at the 1.0 cutover. This also follows the
  in-repo precedent: `.changeset/README.md` is the existing short pointer and deliberately does NOT
  restate a bump mapping ("This README is a cheat sheet, not the source of truth").

**R1.8 — `AGENTS.md` is changeset-rule-only.** Do NOT add a "keep README/docs current" rule (the
one radical-pipelines' `AGENTS.md` carries) or any other behavioral rule. skillsmith has no such
existing documented expectation anywhere in live policy — `CONTRIBUTING.md` in fact treats
documentation-only edits more loosely (prose-only doc edits need no changeset). Adding one would be
an unreviewed new obligation and is out of scope (see Non-goals).

#### Precedent (radical-pipelines, for shape only — adapt, do not copy verbatim)

radical-pipelines' root `AGENTS.md` is a short identity header followed by an imperative bullet
list; its changeset bullet is the last item, and its `CLAUDE.md` is literally the one line
`@AGENTS.md`. Reuse that **shape**. Do NOT copy its wording, because radical-pipelines (a) points to
"the README" (skillsmith has no such section), (b) inlines a "breaking change → major" mapping
(forbidden for skillsmith pre-1.0), and (c) carries a "keep README current" bullet (out of scope for
skillsmith). skillsmith's bullet must instead defer to `CONTRIBUTING.md#adding-a-changeset` and carry
the action-framed pre-1.0 sub-clause.

---

### Change 2 — Make `npm run lint` pass cleanly on the branch

**Problem.** `release.yml` runs `npm run lint` (= `biome lint .`) before publishing. Lint currently
fails on pre-existing issues PR #41 did not touch, so the first real release would be blocked by a
red lint gate.

**Current diagnostics (empirically captured).** `biome lint .` reports **3 errors + 6 warnings**
across 4 files. All 3 errors are `noControlCharactersInRegex`; the 6 warnings are 4
`noAdjacentSpacesInRegex` + 2 `noDescendingSpecificity`:

| File:line(s) | Rule | Count | Severity | Under changeset gate? |
|---|---|---|---|---|
| `src/progress/tracker.ts:358` | `lint/suspicious/noControlCharactersInRegex` | 1 | **error** | Yes — `src/**` (non-test) |
| `src/__tests__/progress-tracker.test.ts:141` (cols 31 & 43) | `lint/suspicious/noControlCharactersInRegex` | 2 | **error** | No — `!src/__tests__/**` |
| `src/__tests__/progress-render.test.ts:64,67,150,295` | `lint/complexity/noAdjacentSpacesInRegex` | 4 | **warning** (safe fix) | No — `!src/__tests__/**` |
| `docs/styles.css:596,605` | `lint/style/noDescendingSpecificity` | 2 | **warning** | No — `docs/**` excluded |

Note: the prompt framed the failures as in "`src/progress/*` and `docs/styles.css`", but two of the
four failing files are actually under `src/__tests__/**`. Only **one** non-test source file fails:
`src/progress/tracker.ts:358`.

**R2.1 — Acceptance bar: `biome lint .` reports ZERO diagnostics** — 0 errors AND 0 warnings, not
merely exit 0. (See AC8 for the rationale and the literal-CI caveat.)

**R2.2 — Fix all 9 diagnostics at the source.** The prompt forbids blanket-disabling the linter or
whole-file ignores. Three distinct fix postures, one per failure class:

- **R2.2a — `noControlCharactersInRegex` (3 errors): narrowly-scoped per-line `biome-ignore`.**
  Add a per-line `// biome-ignore lint/suspicious/noControlCharactersInRegex: <reason>` directly
  above each of the 3 occurrences (the `tracker.ts:358` source regex and both ESC escapes on
  `progress-tracker.test.ts:141`). The justification states that the regexes match real ANSI escape
  sequences and the flagged ESC byte (`0x1b`) is the intended, necessary content (e.g. SGR colour
  codes / cursor-control escapes). Apply the **same** technique to all 3 occurrences.

  This is the prompt's explicitly permitted "a specific rule is genuinely inappropriate for a
  specific location — narrowly justify and scope" carve-out: a line-scoped ignore with a reason,
  **not** a file-level or rule-level disable. It is justified because the control char is the
  legitimate content (you cannot match ANSI sequences without the ESC byte), and because there is
  empirically no clean alternative — see the note below.

- **R2.2b — `noDescendingSpecificity` (2 warnings, `docs/styles.css:596,605`): reorder selectors.**
  Move the bare `pre {}` rule (line 596) to just before `.terminal pre {}` (line 300), and the bare
  `code {}` rule (line 605) to just before `.note-card code {}` (line 429). This is a pure move (no
  declaration changes). Rendering is **provably preserved**: in both pairs the specificities are
  unequal (`.terminal pre` / `.note-card code` = (0,1,1) vs bare `pre`/`code` = (0,0,1)), so the
  cascade picks the higher-specificity rule regardless of source order — reordering cannot change
  which declaration wins. This rule is **not** auto-fixable; it is a manual edit.

- **R2.2c — `noAdjacentSpacesInRegex` (4 warnings, `progress-render.test.ts:64,67,150,295`): use
  the safe auto-fix.** Run `biome lint --write` (ideally scoped to that file, e.g.
  `biome lint --write src/__tests__/progress-render.test.ts`). Biome rewrites literal consecutive
  spaces to an exact-count quantifier (e.g. `/^scenarios  /` → `/^scenarios {2}/`,
  `/^phases     /` → `/^phases {5}/`, `/elapsed 16:48   done/` → `/elapsed 16:48 {3}done/`). A `{n}`
  quantifier on a single space matches exactly n spaces — semantically identical, zero behavior
  change, the assertions still match the same strings.

**R2.3 — Scope guard: use `biome lint`, NOT `biome check`.** Do not run `biome check --write` to
"fix lint". `check` additionally runs `assist/source/organizeImports`, which would reorder imports
across ~6 unrelated files (`src/index.ts`, `src/runner.ts`, `src/pipeline/pipeline.ts`,
`src/progress/index.ts`, plus test files), ballooning the diff and needlessly pulling more files
under the changeset gate. Those import-sort findings are OUT OF SCOPE. The enforced gate is
`biome lint .` (in `package.json` and `release.yml`), which does not run assist actions.

  Operational caution for R2.2c: `npm run lint:fix` (= `biome lint --write .`) runs over the whole
  repo. Without `--unsafe` it applies only safe fixes, so it will not touch the control-char errors
  (no safe fix offered) or reorder imports (that is `check`, not `lint`). Still, review the diff to
  confirm only the 4 regex lines changed — or scope the command to the single test file.

**R2.4 — No changeset for Change 2.** Covered by the cross-cutting ZERO-changeset constraint (AC17):
the `src/progress/tracker.ts` edit matches `changedFilePatterns`, but the existing
`initial-scaffolding.md` (`none`) already satisfies the gate for the package; the test-file and
`docs/styles.css` edits are gate-exempt regardless. Do NOT author a new changeset for this work.

#### Empirical note on R2.2a (why the `biome-ignore`, not a rewrite)

`noControlCharactersInRegex` detects the control **codepoint**, not the escape notation. Inside a
regex *literal*, all of `\x1b`, the literal ESC char, and `\u{1b}` (with the `u` flag) trip the
rule — so there is no regex-literal respelling of ESC that satisfies it. The only rule-passing
rewrite abandons the literal for a runtime-constructed `new RegExp(...)` built from
`String.fromCharCode(0x1b)`; the obvious variants of that also trip *other* rules
(`new RegExp("\\x1b…")` → `useRegexLiterals`; `new RegExp(ESC + "…")` → `useTemplate`), leaving only
an awkward `new RegExp(\`${ESC}\\[…\`, "g")` template form that obscures the idiomatic ANSI pattern
and replaces the clear test assertion with a two-interpolation constructor — a readability
regression. The line-scoped `biome-ignore` is therefore the recommended posture for both the source
regex and the test. This `(A) ignore` vs `(B) runtime-RegExp rewrite` choice is **the one genuine
judgment call in Change 2**; if the owner strongly prefers zero suppressions, the runtime-`RegExp`
form is available and verified clean for `tracker.ts`, but the recommendation is the ignore.

---

### Change 3 — Align Changesets' formatting with the Biome toolchain

**Problem.** `.changeset/config.json` does not set the `prettier` option, so Changesets defaults it
to `true`, while this repo formats with **Biome** (tabs). Separately, the committed
`.changeset/config.json` itself uses 2-space indentation, fighting Biome's tab style.

**Empirical findings that reframe the prompt's premise** (verified by running real `changeset
version` on sandboxes seeded with skillsmith's actual `package.json` / `CHANGELOG.md` /
`.changeset/config.json` and the installed `@changesets/cli@2.31.0`):

- Prettier IS resolvable transitively (`prettier@2.8.8` via `@changesets/cli`), so the `true`
  default does **actually run** Prettier over the files the release flow rewrites — it does not
  silently no-op for lack of Prettier. But:
- `changeset version` does **NOT** mangle `package.json` indentation — it preserves the existing
  **tabs** under BOTH `prettier:true` and `prettier:false` (it sniffs the file's own indent via
  `detect-indent`, never routing `package.json` through Prettier). Biome reports "No fixes applied"
  on the result either way. So the feared "release flow rewrites `package.json` 2-space and fights
  Biome" does NOT reproduce.
- For `CHANGELOG.md`, `prettier:true` produces slightly *cleaner* spacing (`## 0.2.0`⏎⏎`### Minor
  Changes`⏎⏎`- entry`) than `prettier:false` (`## 0.2.0`⏎`### Minor Changes` with no blank line, and
  tighter spacing). Both are valid Markdown.
- **Biome cannot format Markdown** (Biome 2.4.x formats only JS/TS/JSX/TSX/JSON/JSONC/HTML/CSS/
  GraphQL), so there is **no possible Prettier-vs-Biome fight over `CHANGELOG.md`** — Biome has zero
  opinion on `.md`.

Consequently Change 3 has one **hard, testable** sub-requirement (config.json formatting) and one
**owner-selectable tradeoff** (the `prettier` flag value), plus a confirmation that no release-flow
post-step is needed.

**R3.1 — Set `"prettier": false`** as a top-level key in `.changeset/config.json`. This is the
correct schema key (the referenced `@changesets/config@3.1.4` schema types `prettier` as a top-level
boolean, default `true`) and the **single** switch that disables Prettier across both Changesets
paths that use it — `@changesets/apply-release-plan` (the `changeset version` path) and
`@changesets/write` (the `changeset add` path). (`@changesets/changelog-github` has no Prettier
dependency.)

- **This is the recommended DEFAULT, and a deliberate decoupling tradeoff — NOT a clear bug fix.**
  Record it as such. It is faithful to the prompt's governing intent ("no coupling to a formatter the
  repo does not use") and removes the tacit dependence on the undeclared transitive `prettier@2.8.8`.
  The cost is purely cosmetic: with Prettier off, the generated `CHANGELOG.md` entry has slightly
  tighter, non-normalized spacing — still valid Markdown that renders correctly, and on a file Biome
  cannot format anyway.
- **Exact `CHANGELOG.md` before/after to record** (minor bump example): `prettier:true` →
  `## 0.2.0`⏎⏎`### Minor Changes`⏎⏎`- <entry>`; `prettier:false` → `## 0.2.0`⏎`### Minor Changes`
  (no blank line) then the entry with tighter spacing.
- **The `prettier` value is owner-selectable.** Alternatives to state explicitly for the owner:
  (i) keep `prettier: true` for the normalized changelog spacing — but the repo then tacitly relies
  on the transitive Prettier, and being honest about that means declaring Prettier as an explicit
  `devDependency`, which reintroduces a second formatter alongside Biome (the dual-formatter coupling
  this change set out to remove); (ii) `prettier: true` and do nothing (status quo — the tacit
  undeclared dependency the prompt wants to avoid). The recommendation remains `prettier: false`.
- Consistency note: `prettier: false` also means interactively-created `.changeset/*.md` files won't
  be Prettier-formatted — fine, since Biome doesn't format `.md` either, so they were never
  Biome-managed.

**R3.2 — Re-format the committed `.changeset/config.json` to Biome style** by running
`biome format --write .changeset/config.json` and committing the result. Accept the **full** Biome
output — tabs **plus** whatever shape Biome emits for the `changelog` array (Biome expands it onto
multiple lines). Do NOT hand-preserve the inline array. Verified: the result is valid JSON,
changesets reads it correctly (`changeset status` still honors `changedFilePatterns`), and Biome is
idempotent on it (re-running → "No fixes applied"). `.changeset/config.json` was empirically the
**only** file in the repo failing `biome format`, so this also makes the whole repo `biome format`-
clean. This fix is **independent** of R3.1 — config.json is hand-maintained and never rewritten by
`changeset version`.

**R3.3 — No `biome format` post-step in the release flow.** Do NOT add a formatting step to
`release.yml`. It would be a no-op: `changeset version` already leaves `package.json` tab-indented
and Biome-clean (via `detect-indent`), and `CHANGELOG.md` is Markdown that Biome cannot format.
`prettier: false` alone is sufficient.

**R3.4 — No changeset for Change 3.** `.changeset/config.json` is a gate-exempt path
(`.changeset/**` is not in `changedFilePatterns`). Covered by the cross-cutting ZERO-changeset
constraint (AC17).

---

## Out of scope / Non-goals

- **A "keep README/docs current" rule in `AGENTS.md`.** skillsmith has no such existing policy;
  adding one would be an unreviewed new obligation that partially contradicts `CONTRIBUTING.md`'s
  looser stance on docs-only edits. If wanted later, it is a separate PR.
- **Reordering imports / running `biome check --write`** (see R2.3) — the `organizeImports` findings
  across ~6 unrelated files are out of scope.
- **Adding a `biome format` step to the release flow** (`release.yml`) — see R3.3; it would be a
  no-op.
- **Making "lint clean" enforceable via warnings-as-errors in CI** — a scope expansion beyond these
  three changes. (Today CI's enforced bar is errors-only / exit 0; see AC8.)
- **A `CONTRIBUTING.md` note about `changeset version` needing a local `GITHUB_TOKEN`.** Real finding
  (`@changesets/changelog-github` errors offline without a token; CI is unaffected because
  `release.yml` passes `GITHUB_TOKEN`), but out of scope for these three changes.
- **Removing the pre-1.0 clause from `AGENTS.md` at the eventual 1.0 cutover** — noted as a future
  cleanup item to track alongside the other pre-1.0 cleanup points (the validator guard,
  `CONTRIBUTING.md`'s pre-1.0 policy section), but not part of this work. The clause degrades
  gracefully (it is self-dating: "while pre-1.0"), so omitting this now is safe.
- **Adding any new changeset, or editing `.changeset/initial-scaffolding.md`** (see AC17).
- **A new branch or PR** — all work lands on `worktree-39-changelog-and-versioning` (PR #41).

---

## Acceptance criteria

Each criterion is independently checkable. AC1-7 cover Change 1, AC8-12 Change 2, AC13-16 Change 3,
AC17-19 are cross-cutting.

### Change 1

1. A root `AGENTS.md` exists (sibling to `.rp.md`) containing a minimal identity header
   (`# Skillsmith` heading + one-sentence identity) followed by the changeset instruction. The file
   reads as a coherent standalone file, not an orphaned one-liner.
2. A root `CLAUDE.md` exists whose **entire** contents are exactly `@AGENTS.md` (the import
   directive) — nothing else.
3. The changeset instruction in `AGENTS.md` states imperatively that every release-relevant change
   records a committed `.changeset/*.md` that travels with the PR, and cross-references
   `CONTRIBUTING.md#adding-a-changeset` for the detail. It is shaped as a single bullet in an
   imperative list style.
4. The instruction includes an action-framed pre-1.0 sub-clause carrying all four of: (a) condition
   "while pre-1.0 / `0.x`"; (b) action "use `minor` with a `BREAKING:` summary prefix"; (c) "`major`
   is disallowed pre-1.0"; (d) a pointer to `CONTRIBUTING.md`. The literal token `BREAKING:` appears.
5. The instruction does **not**: inline any semver bump mapping; contain the words "breaking" mapped
   to "major" (i.e. no "breaking change → major"); restate the "when required" path list; duplicate
   the bump-type table; or reference "the README" as the policy how-to source.
6. `AGENTS.md` contains **only** the identity header + the single changeset bullet (with its pre-1.0
   sub-clause). It contains no "keep README/docs current" rule and no other behavioral rule.
7. The changeset rule is **not** present in `.rp.md` (`.rp.md` is unchanged by this work).

### Change 2

8. **`npm run lint` (= `biome lint .`) reports ZERO diagnostics** — 0 errors and 0 warnings (verified
   by running it; output reports no errors and no warnings). Rationale: "passes cleanly" reads as
   "reports nothing"; leaving the 6 warnings is a half-fix the next contributor/pipeline re-discovers,
   and the marginal cost of clearing them is trivial (4 are a safe auto-fix, 2 are a rendering-neutral
   reorder). *Caveat (not a relaxation of this AC):* the literal CI bar today is exit 0, and Biome's
   default exit is driven by errors only — so the 6 warnings alone would not fail CI and fixing just
   the 3 errors would green CI. The spec target is nonetheless zero diagnostics; if the owner prefers
   the minimal exit-0 bar, that is their call.
9. The 3 `noControlCharactersInRegex` errors are fixed with a narrowly-scoped per-line
   `// biome-ignore lint/suspicious/noControlCharactersInRegex: <reason>` on each of the 3
   occurrences (`src/progress/tracker.ts:358`, and `src/__tests__/progress-tracker.test.ts:141` cols
   31 & 43), each with a justification referencing the ANSI ESC `0x1b` byte as the intended content.
   The same technique is applied to all 3. No whole-file ignore and no rule-level disable is used.
   *(If the owner instead elects the runtime-`RegExp` rewrite, that satisfies "fix at source" too —
   but the default and recommendation is the per-line ignore.)*
10. The 2 `noDescendingSpecificity` warnings in `docs/styles.css` are fixed by reordering selectors
    (bare `pre {}` moved before `.terminal pre {}`; bare `code {}` moved before `.note-card code {}`),
    with declarations unchanged. The reorder is rendering-neutral (unequal specificities). The file's
    visual styling is unchanged.
11. The 4 `noAdjacentSpacesInRegex` warnings in `src/__tests__/progress-render.test.ts` are fixed via
    Biome's safe auto-fix (`/  /` → `/ {2}/` form). The test suite still passes (assertions match the
    same strings; zero behavior change).
12. **Scope guard:** the fix was performed with `biome lint`, not `biome check --write`. No imports
    were reordered; no files other than those listed in AC19 were changed. (Verify the diff touches
    only `src/progress/tracker.ts`, `src/__tests__/progress-tracker.test.ts`,
    `src/__tests__/progress-render.test.ts`, and `docs/styles.css` for Change 2.)

### Change 3

13. `.changeset/config.json` has a top-level `"prettier": false` key.
14. `biome format .changeset/config.json` **reports no changes** (the file is committed in full Biome
    style — tabs and the Biome-emitted `changelog`-array shape). The file remains valid JSON and is
    read correctly by `changeset status`.
15. `release.yml` has **no** added `biome format` (or other formatting) step relative to its current
    state — the only release-flow-relevant change for Change 3 is the `prettier: false` flag in
    `.changeset/config.json`.
16. The Change 3 tradeoff is documented (in the implementation's PR description and/or the change
    itself as appropriate): `prettier: false` is the recommended default and a deliberate decoupling
    tradeoff, the exact `CHANGELOG.md` before/after spacing is recorded, and the `prettier: true` +
    explicit-devDependency alternative is stated as owner-selectable.

### Cross-cutting

17. **ZERO new changesets.** No new `.changeset/*.md` file is added by this work, and
    `.changeset/initial-scaffolding.md` is unchanged. Verified: the `changeset-gate.yml` checks pass
    on the branch — both `validate-changesets.ts` (shape valid) and `changeset status
    --since=origin/trunk` (exit 0) — relying solely on the pre-existing `initial-scaffolding.md`
    (`none`) changeset.
18. **Both existing CI gates are green on the branch:** `changeset-gate.yml` (per AC17) and the lint
    gate (`npm run lint`, per AC8 — this is the gate currently red; this work turns it green).
19. **Changes are minimal and scoped.** The complete set of new/edited files across the entire effort
    is exactly: `AGENTS.md` (new), `CLAUDE.md` (new), `src/progress/tracker.ts`,
    `src/__tests__/progress-tracker.test.ts`, `src/__tests__/progress-render.test.ts`,
    `docs/styles.css`, and `.changeset/config.json`. No other files are created or modified (in
    particular: not `.rp.md`, not `CONTRIBUTING.md`, not `README.md`, not `release.yml`, not
    `.changeset/initial-scaffolding.md`, and no new changeset file).
