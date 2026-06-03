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

**Severity (corrected & confirmed by researcher via the `×` error vs `!` warning glyphs):**

| File:line(s) | Rule | Count | Severity | Under changeset gate? |
|---|---|---|---|---|
| `src/progress/tracker.ts:358` | `lint/suspicious/noControlCharactersInRegex` | 1 | **error** | **Yes** — `src/**` (non-test) |
| `src/__tests__/progress-tracker.test.ts:141` (cols 31 & 43) | `lint/suspicious/noControlCharactersInRegex` | 2 | **error** | No — `!src/__tests__/**` excluded |
| `docs/styles.css:596, :605` | `lint/style/noDescendingSpecificity` | 2 | **warning** | No — `docs/**` excluded |
| `src/__tests__/progress-render.test.ts:64,67,150,295` | `lint/complexity/noAdjacentSpacesInRegex` | 4 | **warning** (FIXABLE, safe fix) | No — `!src/__tests__/**` excluded |

**Important corrections to my earlier draft:** (i) the CSS `noDescendingSpecificity` items are
**warnings**, not errors; (ii) the `progress-tracker.test.ts` control-char items are **errors**,
not warnings, and there are **2 on the single line 141** (cols 31 & 43 — two ESC escapes in
`/^\x1b\[(\d+)A\x1b\[0J/`). So the headline "3 errors + 6 warnings" = **3 errors, all
`noControlCharactersInRegex`** (1 in `tracker.ts` + 2 in `progress-tracker.test.ts`), and
**6 warnings** (4 adjacent-spaces + 2 descending-specificity).

**Only the 3 control-char ERRORS actually fail `biome lint` today** (exit 1). By default Biome's
exit code is driven by errors; the 6 warnings alone would not fail the run. See the "passes
cleanly" interpretation question below — the spec defaults to clearing **all 9** diagnostics.

Notable: the prompt framed the failures as in "`src/progress/*` and `docs/styles.css`", but in
reality two of the failing files are under `src/__tests__/**` (which the prompt omits entirely).
Only **one** non-test source failure exists: `src/progress/tracker.ts:358`
(`const ANSI_SGR = /\x1b\[[0-9;]*m/g;`). That is the only failing file under the changeset gate's
`changedFilePatterns` (`src/**` minus `src/__tests__/**`), so a source edit there needs its own
changeset.

### `biome lint` vs `biome check` — scope guard (researcher)

The gate is `npm run lint` = `biome lint .` (`package.json:28`, `release.yml:37`), which does NOT
run Biome's assist actions. `biome check .` reports **10 errors** instead of 3 because `check`
also runs `assist/source/organizeImports`, flagging unsorted imports across **6 unrelated files**
(`src/index.ts`, `src/runner.ts`, `src/pipeline/pipeline.ts`, `src/progress/index.ts`, + test
files). **Those are OUT OF SCOPE for Change #2.** The fix must NOT be performed via
`biome check --write` — that would reorder imports across 6 unrelated `src/**` files, balloon the
diff, and needlessly pull more files under the changeset gate. Scope strictly to `biome lint`.

### Per-failure detail (captured by reading the offending code)

There are three distinct failure classes, each needing a different fix posture:

1. **`noAdjacentSpacesInRegex` — 4 warnings, all in `src/__tests__/progress-render.test.ts`.**
   Multiple `assert.match(..., /…  /)` patterns with literal consecutive spaces (e.g.
   `/^scenarios  /`, `/^phases     /`, `/elapsed 16:48   done/`). Biome marks these **FIXABLE
   with a safe fix** — it rewrites e.g. `/^scenarios  /` → `/^scenarios {2}/` (quantifier).
   Purely mechanical; `biome lint --write` (`npm run lint:fix`) resolves them with no semantic
   change. Tests-only path → excluded from the changeset gate.

2. **`noControlCharactersInRegex` — 3 ERRORS: 1 in `src/progress/tracker.ts`, 2 in
   `src/__tests__/progress-tracker.test.ts` (both on line 141).** These regexes match **real
   ANSI escape sequences** and the flagged control char is the ESC byte `\x1b` (0x1B), which is
   the legitimate, necessary content:
   - `src/progress/tracker.ts:358` — `const ANSI_SGR = /\x1b\[[0-9;]*m/g;` used by
     `visibleWidth()` (line 360-362) to strip SGR color codes when measuring printed width.
   - `src/__tests__/progress-tracker.test.ts:141` — `second.match(/^\x1b\[(\d+)A\x1b\[0J/)`
     asserting a repaint starts with cursor-up + erase-display escapes.
   The ESC byte is intrinsic to what these regexes do — you cannot match ANSI sequences without
   it. This is the prompt's explicit "a specific rule is genuinely inappropriate for a specific
   location" case. NOT auto-fixable (no safe fix offered). The fix posture is a judgment call
   (narrowly-scoped Biome suppression vs. a code rewrite that satisfies the rule) → researcher Q.

   **Empirical finding (spec-analyst, verified with the repo's Biome 2.4.12 on a scratch file):**
   `noControlCharactersInRegex` detects the control **codepoint**, not the escape notation. Inside
   a regex *literal*, ALL of `\x1b`, `` (the literal ESC), and `\u{1b}` (with the `u` flag)
   trip the rule. The ONLY representation that does not trip it is moving to a constructed
   `new RegExp(...)` built from a runtime string (e.g. `String.fromCharCode(0x1b)` /
   `String.fromCharCode(27)`). Consequence: approach (B) "swap the escape inside the literal" is
   not viable — any code rewrite that satisfies the rule must abandon the regex literal for an
   `new RegExp(...)` form, which costs readability. So the realistic options are (A) a
   narrowly-scoped `biome-ignore` with justification, or (B) the awkward `new RegExp(...)` form.

3. **`noDescendingSpecificity` — 2 WARNINGS in `docs/styles.css`.** Bare element selectors
   (`pre` at line 596, `code` at line 605) appear *after* higher-specificity selectors for the
   same elements (`.terminal pre` at 300, `.note-card code` at 429). Biome flags the descending
   specificity ordering. `docs/**` is excluded from the changeset gate (no changeset needed). Fix
   is a CSS edit; must preserve rendered styling (cascade correctness) → see Q4b.

### Q4 — Fix posture per failure class (answered by researcher, empirically)

**4a — `noControlCharactersInRegex` (3 errors): use approach (A) — narrowly-scoped
`biome-ignore`, NOT a rewrite.** Per-line
`// biome-ignore lint/suspicious/noControlCharactersInRegex: <reason>` on each of the 3
occurrences (the `tracker.ts:358` source regex and both ESC escapes on
`progress-tracker.test.ts:141`), justification along the lines of "matches real ANSI SGR / cursor
escape sequences; the ESC (0x1b) byte is the intended content." Rationale:
- The control char is the **legitimate, necessary content** (ANSI terminal handling). This is
  exactly the prompt's permitted "rule genuinely inappropriate for a specific location, narrowly
  justify and scope" carve-out. A line-scoped `biome-ignore` with a reason IS the narrow/justified
  form — NOT a blanket file-ignore or rule-disable (which the prompt forbids).
- Approach (B) is a verified **readability regression** and is only achievable via a constructed
  `new RegExp(...)`. Researcher independently confirmed my finding (codepoint detection) AND the
  additional pitfalls of the only rule-passing rewrite: `new RegExp("\\x1b\\[…")` (constant-string
  arg) trips `lint/complexity/useRegexLiterals`; `new RegExp(ESC + "…")` trips
  `lint/style/useTemplate`. The ONLY clean rewrite is
  `new RegExp(\`${ESC}\\[[0-9;]*m\`, "g")` with `const ESC = String.fromCharCode(0x1b)` — which
  obscures the idiomatic ANSI-SGR pattern and, for the test's inline assertion, replaces a clear
  literal with an awkward two-interpolation constructor.
- Apply ONE technique uniformly to all 3 occurrences.
- **(A)-vs-(B) is the one genuine judgment call in Change #2.** If the owner strongly prefers zero
  suppressions, the runtime-`RegExp` form is available and verified clean for `tracker.ts`, but
  researcher (and I) recommend (A) on readability grounds for both source and test.

**4b — `noDescendingSpecificity` (2 warnings, `docs/styles.css`): selector reorder; rendering is
preserved.** Move bare `pre {}` (596) to just before `.terminal pre {}` (300) and bare `code {}`
(605) to just before `.note-card code {}` (429). Researcher verified on a copy:
`noDescendingSpecificity` → 0, file length unchanged (11360 → 11360 bytes, pure move). Rendering
is provably preserved because in BOTH pairs the specificities are **unequal** (`.terminal pre` /
`.note-card code` = (0,1,1) vs bare `pre`/`code` = (0,0,1)); when specificities differ the cascade
picks the higher one regardless of source order, so the reorder cannot change which declaration
wins. The "equal-specificity could matter" case is not present. This rule is **not** auto-fixable
(`biome lint --write` won't touch it) → manual edit. `docs/**` is outside the changeset gate.

**4c — `noAdjacentSpacesInRegex` (4 warnings, `progress-render.test.ts`): `biome lint --write`,
zero behavior change.** Researcher verified on a copy: 4 → 0, "Fixed 1 file." Transform is the
documented safe fix (`/^scenarios  /` → `/^scenarios {2}/`, `/^phases     /` → `/^phases {5}/`,
`/elapsed 16:48   done/` → `/elapsed 16:48 {3}done/`, `/elapsed 1:23:07   done/` →
`/elapsed 1:23:07 {3}done/`). A `{n}` quantifier on a single space matches exactly n spaces —
semantically identical, assertions match the same strings; no manual judgment.
- Operational caution: `npm run lint:fix` = `biome lint --write .` runs over the whole repo. With
  `--write` (no `--unsafe`) it applies only SAFE fixes, so it won't touch the control-char errors
  (no fix) or reorder imports (assist/`check`, not `lint`). Still review the diff to confirm ONLY
  the 4 regex lines changed — or scope it: `biome lint --write src/__tests__/progress-render.test.ts`.

### Q5 — Changeset footprint + "passes cleanly" bar for Change #2 (answered by researcher)

**5a — The `tracker.ts` suppression carries an `--empty` changeset, NOT a `patch`** (this
**revises** the Q4 "patch" call). Empirically verified in a sandbox mirroring skillsmith (same
`package.json` + `.changeset/config.json`, real `@changesets/cli@2.31.0`, a `src/progress/tracker.ts`
edit, `--since=origin/trunk`): both gate steps pass with an empty changeset, and there is **no**
policy/gate contradiction.

| Condition | `validate-changesets.ts` (step 1) | `changeset status` (step 2) | Gate |
|---|---|---|---|
| No changeset | — | exit 1 ("packages changed but no changesets… run `changeset add --empty`") | FAILS |
| **Empty** (`---\n---`) | exit 0 (shape valid) | exit 0 ("NO packages to be bumped") | **PASSES** |
| Patch | exit 0 | exit 0 ("bumped at patch") | PASSES |

So both empty and patch satisfy the gate; the deciding factor is **policy**, and policy says
empty: CONTRIBUTING.md:97 — "A changeset for a refactor with **zero consumer-visible effect** is a
signal the contributor should have used `--empty` instead; flag it in review." A `biome-ignore`
comment on an internal ANSI regex changes no emitted code, no public type, no runtime behavior —
the textbook zero-consumer-visible-effect change (even less visible than CONTRIBUTING.md:74's
"cosmetic README edit" `--empty` archetype). A `patch` would manufacture a meaningless
`CHANGELOG.md` entry — noise in the artifact this whole feature exists to keep meaningful.
Verified inert at release time too: with the empty changeset present, `changeset version` exits 0,
leaves version `0.1.0` (no bump), deletes the consumed file, and writes no CHANGELOG entry.

- **Spec-wording caveat for the planner:** "use `--empty`" must mean the literal canonical
  two-fence file `npx changeset --empty` produces (`---\n---`, no front matter, no body). The
  validator's R-shape-2 (`validate-changesets.ts:95-99`) only treats *that exact* form as the valid
  escape; a file with front matter but an empty body is a *different* validator error
  (`:102-108`, line-4 "empty body"). So it is the empty file, not "no changeset" — it still lives
  at `.changeset/<name>.md` and travels with the PR.

**Corrected Change #2 changeset footprint — exactly one `--empty` changeset:**
- `src/progress/tracker.ts` (the control-char `biome-ignore` edit) → **one `--empty` changeset**.
- `src/__tests__/progress-tracker.test.ts`, `src/__tests__/progress-render.test.ts`,
  `docs/styles.css` → **no changeset** (tests excluded by `!src/__tests__/**`; docs not in
  `changedFilePatterns`).

**5b — "Passes cleanly" = ZERO diagnostics from `biome lint .`** (all 3 errors AND all 6 warnings
cleared), not merely exit 0.
- "Passes cleanly" reads as "reports nothing"; leaving 6 warnings is a half-fix the next
  contributor/pipeline re-encounters — the reactive-rediscovery cost this cleanup exists to remove.
- Marginal cost of clearing the warnings is trivial and already scoped (4 are a safe auto-fix;
  2 are a rendering-neutral CSS reorder).
- All-clean is future-proof: if CI later runs warnings-as-errors / Biome promotes these to errors,
  a "warnings-left" branch would suddenly fail.
- **Caveat on the literal CI bar (note in spec):** today the *enforced* bar is exit 0 —
  `release.yml:37` runs `npm run lint` and Biome's default exit is driven by **errors only**, so
  the 6 warnings alone would not fail CI; only the 3 control-char errors make it exit 1 now. So
  strictly, fixing just the 3 errors greens CI. The spec target is nonetheless **zero
  diagnostics** ("`biome lint .` reports 0 errors and 0 warnings"); if the owner prefers the
  minimal literal bar that's their call. (Making "clean" *enforceable* via warnings-as-errors in CI
  is a scope expansion beyond these three changes — noted, not required.)

**Change #2 is now fully specified.**

## Change 3 — Align Changesets' formatting with the Biome toolchain

### Grounding (captured by running `biome format` + reading `.changeset/`)

The change has two distinct sub-problems (from the prompt) plus one empirical unknown:

1. **`prettier` defaults to `true` — and Prettier IS resolvable (transitively), so the default
   actively reformats.** `.changeset/config.json` does not set the `prettier` option, so
   Changesets defaults it to `true`. **Premise correction (researcher, verified):** the prompt
   says the repo "has no Prettier installed," but `npm ls prettier` shows **`prettier@2.8.8`
   present transitively**, pulled in by `@changesets/cli@2.31.0` →
   `@changesets/apply-release-plan@7.1.1` / `@changesets/write@0.4.0` (at `node_modules/prettier`
   and `node_modules/.bin/prettier`). It is NOT a direct dependency (`package.json` has no
   `prettier`) and there is no Prettier config file. Consequence: because a real Prettier resolves,
   the release flow's `apply-release-plan` step **can and will actually run Prettier** over the
   files it rewrites (`package.json`, `CHANGELOG.md`) — it does NOT silently no-op for lack of
   Prettier. So the accurate framing is not "the default is harmless because Prettier is absent,"
   but "the `true` default actively reformats version-bearing files with Prettier (2-space, prose
   rewrap) and fights Biome's tabs afterwards." This strengthens the case for `prettier: false`;
   the actual consequence of leaving it `true` is the empirical target below. The repo formats
   with **Biome (tabs)**, the formatter it actually uses. Installed versions for the record:
   `@changesets/cli@2.31.0`, `@changesets/changelog-github@0.7.0`, `prettier@2.8.8` (transitive).

2. **The committed `config.json` is not Biome-formatted.** Verified empirically:
   `npx biome format .` reports **`.changeset/config.json` as the ONLY file in the repo failing
   format** ("Checked 95 files … Found 1 error"). It uses **2-space** indentation; Biome
   (`indentStyle: "tab"`) would rewrite it to **tabs**. (Biome would ALSO structurally expand the
   `changelog` array onto multiple lines — see the open question on whether the spec requires full
   Biome formatting or just the tab/indent fix.) `.changeset/` is NOT gitignored
   (`.gitignore` excludes only `node_modules/`, `dist/`, `.claude/`, etc.), so it is squarely in
   Biome's purview and currently fights `npm run format`.

3. **Empirical question (researcher running the runtime test):** does `changeset version`
   preserve the repo's established formatting when it rewrites `package.json` and creates/appends
   `CHANGELOG.md`? `package.json` is currently **tab-indented** (Biome style) and `CHANGELOG.md`
   is plain markdown — these are the files `changeset version` rewrites. Test must measure both
   `prettier: true` (default) and `prettier: false`, and whether `biome format` then wants to
   re-touch the output.

   **Code-level finding (spec-analyst, read from `node_modules/@changesets/apply-release-plan`;
   to be CONFIRMED by the researcher's runtime test):** the two files are handled by DIFFERENT
   writers, which refines the prompt's framing:
   - **`package.json` does NOT go through Prettier at all.** The package writer is a plain
     `JSON.stringify(pkgJson, null, indent)` where `indent = detectIndent(existing).indent || "  "`
     (`changesets-apply-release-plan.cjs.js:482-484`). It uses **`detect-indent`** on the existing
     file, so it **preserves the file's current tabs** regardless of the `prettier` setting
     (falling back to 2-space only if no indent is detected). So Prettier's `true` default likely
     does NOT reformat `package.json` away from tabs — contrary to the prompt's worry.
   - **`CHANGELOG.md` IS the file Prettier touches.** It is written via
     `writeFormattedMarkdownFile`, which uses a `prettierInstance` only when `config.prettier !==
     false` (`:372,510-513`); with `prettier: false` the instance is `undefined` and the markdown
     is written **raw**. So the real Prettier coupling is on the changelog markdown, not the
     package manifest.
   If the runtime test confirms this, the accurate problem statement is: leaving `prettier: true`
   couples **`CHANGELOG.md`** formatting to a transitive Prettier the repo doesn't manage; setting
   `prettier: false` removes that coupling and writes raw markdown (which Biome's formatter then
   governs like any other repo file). `package.json` keeps tabs either way. The researcher's test
   should verify this observed behavior and check whether `biome format` wants to re-touch the
   resulting `CHANGELOG.md` / `package.json`.

Other `.changeset/` contents: `README.md` (the changesets-init cheat sheet) and
`initial-scaffolding.md` (a `none`-bump starter changeset — consistent with the bootstrap PR).

### Open requirements questions for Change #3 (to be answered via researcher)

- **3-i (prettier option):** Set `prettier: false` in `.changeset/config.json`. **Pre-confirmed
  by spec-analyst (read-only):** the `@changesets/config` schema the file references defines
  `prettier` as a top-level boolean, `default: true`, described "When false, Changesets won't
  format with Prettier" (`node_modules/@changesets/config/schema.json`). `@changesets/write` and
  `@changesets/apply-release-plan` both consult `config.prettier`; `@changesets/changelog-github`
  has **no** Prettier reference — so `config.prettier` is the single switch (no separate coupling
  to sever). Researcher to confirm `@changesets/cli@2.31.0` honours it at runtime.
- **3-ii (config.json formatting):** Reformat the committed `config.json` to Biome style (tabs).
  Open sub-question: should the spec require **full** `biome format` output (which also expands the
  `changelog` array across lines), or only the indentation change (tabs) while keeping the current
  line structure? Whichever, the file must stop failing `biome format` so it doesn't fight the
  toolchain.
- **3-iii (changeset version behaviour — empirical):** What does `changeset version` actually do to
  the formatting of `package.json` and `CHANGELOG.md`? Does setting `prettier: false` change that?
  If `changeset version` writes non-Biome formatting, what's the minimal way to keep the generated
  files in the repo's style (e.g., running `biome format --write` as a post-step, or accepting the
  one-time reformat)? Verify empirically.
