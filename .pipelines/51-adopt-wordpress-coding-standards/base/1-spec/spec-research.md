# Spec Research

## Rough Idea

> Source: GitHub issue [#51](https://github.com/Automattic/skillsmith/issues/51).

### Goal

skillsmith's code formatting **fully adopts WordPress coding standards** — including spaces inside delimiters/parentheses (`array( 1, 2 )`, `[ 1, 2 ]`), enabled by Biome's new `delimiterSpacing` option. This is the complete WordPress style (tabs, single quotes, trailing commas, CSS overrides, etc.), not only the delimiter spacing.

### Context

- Prompted by Biome v2.5's new `delimiterSpacing` formatter option: https://biomejs.dev/blog/biome-v2-5/#new-delimiterspacing-formatter-option
- WordPress's JS standard is codified in `@wordpress/prettier-config`. Its WordPress-only setting `parenSpacing: true` (spaces inside parentheses) historically required the `wp-prettier` fork; Biome's `delimiterSpacing: true` is the stock equivalent that finally makes full WordPress-style formatting achievable with stock Biome.
- No official `@wordpress/biome-config` package exists (checked June 2026), so the WordPress standard has to be expressed as a Biome config mirroring `@wordpress/prettier-config`.
- skillsmith already uses Biome (`2.4.12`).

### Assumptions / directions to explore (OPEN — confirm or overturn with evidence)

- Translating `@wordpress/prettier-config` to Biome likely entails: `delimiterSpacing: true`, single quotes (skillsmith currently uses double), tabs with width 4, line width 80, `es5` trailing commas, plus the CSS overrides (single quotes off, delimiter spacing off). The exact mapping is for later phases to verify.
- `delimiterSpacing` requires Biome ≥ 2.5, so this likely entails bumping `@biomejs/biome` (currently `2.4.12`) and the `biome.json` `$schema` pin.

### Current state (observed by spec-analyst)

`biome.json` today:
- `$schema` pinned to `2.4.12`
- `formatter.indentStyle: "tab"` (no `indentWidth`, no `lineWidth`)
- `javascript.formatter.quoteStyle: "double"`
- linter recommended rules on; assist `organizeImports: on`
- vcs enabled, uses git ignore file

`package.json`:
- `@biomejs/biome` devDependency pinned to `2.4.12`
- scripts: `lint` (`biome lint .`), `lint:fix` (`biome lint --write .`), `format` (`biome format --write .`); no combined check or CI-style verify script visible here
- This repo records a changeset for every release-relevant change (pre-1.0 policy).

## Q&A

### Q1: What is the authoritative, complete set of JS/TS formatting rules in `@wordpress/prettier-config`, and which are stock Prettier vs. the WordPress-only fork setting(s)?

**A:** Inspected published `@wordpress/prettier-config@4.48.1` (latest), `package/lib/index.js` verbatim. The complete JS/TS rule set, with exact values:

| Prettier option | Value | Observable meaning |
|---|---|---|
| `useTabs` | `true` | Indent with tabs |
| `tabWidth` | `4` | A tab renders as 4 columns |
| `printWidth` | `80` | Wrap target at 80 columns |
| `singleQuote` | `true` | Single quotes for JS/TS strings |
| `trailingComma` | `'es5'` | Trailing commas where ES5 allows (arrays, objects) but **not** in function params/args/imports |
| `bracketSameLine` | `false` | Multiline JSX `>` on its own line |
| `bracketSpacing` | `true` | Spaces inside object braces: `{ foo }` |
| `semi` | `true` | Semicolons required |
| `arrowParens` | `'always'` | Always parenthesize arrow params: `(x) => x` |

CSS override block: `*.{css,sass,scss}` → `singleQuote: false` (double quotes in stylesheets) and `parenSpacing: false`.

**Reasoning / key nuance:** All nine options above are **stock Prettier**. The **only** wp-prettier-fork-specific setting is **`parenSpacing`**, injected conditionally (`parenSpacing: true` for JS, `false` for CSS) **only when the installed prettier is literally `wp-prettier`**. With stock Prettier it is never set. `parenSpacing: true` is what produces spaces-inside-parens/brackets (`array( 1, 2 )`, `[ 1, 2 ]`) — the behavior the intent says Biome's `delimiterSpacing: true` replicates with stock tooling. `bracketSpacing: true` (object braces `{ foo }`) is separate and already stock; it covers braces, not parens/brackets.

**Sources:** `@wordpress/prettier-config@4.48.1` tarball `package/lib/index.js` (read verbatim); `npm view @wordpress/prettier-config version` → `4.48.1`.

### Q2: Is the scope the WordPress *formatting* layer only, or does "fully adopts" also pull in WordPress *lint* rules (`@wordpress/eslint-plugin`)? Does adopting WP formatting require touching skillsmith's linter config?

**A:** Scope = **formatting layer only** (the `@wordpress/prettier-config` equivalent). WordPress's lint ruleset (`@wordpress/eslint-plugin`) is a separate package/layer, is not what the intent's evidence points at, and is not adoptable via Biome. The two are fully independent in Biome — adopting WP formatting requires **zero changes to skillsmith's `linter` block** (currently `linter.rules.recommended: true`, which stays as-is).

**Reasoning:** Intent anchors entirely on the *formatter* layer — prompted by Biome's `delimiterSpacing` formatter option, defines the standard as `@wordpress/prettier-config` + `parenSpacing`, and the exploration list is all formatter settings. "Fully adopts ... the complete WordPress style ... not only the delimiter spacing" contrasts *all of the prettier-config formatting* against *just delimiter spacing* — not formatting-vs-linting. In Biome, `formatter` and `linter` are independent subsystems; changing formatter settings has no effect on linting. WordPress itself treats the two as separable (eslint-plugin offers a `recommended-with-formatting` preset that replaces Prettier). Lint-only parts of the WP standard (naming conventions, i18n rules like `valid-sprintf`/`i18n-text-domain`, React/Hooks, jsx-a11y, JSDoc, `dependency-group` import ordering, `no-unsafe-wp-apis`) are **out of scope** — none are expressible as Biome formatter settings and most have no Biome equivalent.

**Sources:** intent.md lines 8, 12–14, 21; skillsmith `biome.json` lines 11–25; `@wordpress/eslint-plugin` README (github.com/WordPress/gutenberg/tree/trunk/packages/eslint-plugin); Biome configuration reference (biomejs.dev/reference/configuration/). All fetched/inspected this session by researcher.

### Q3: Which of skillsmith's file types does Biome 2.5 actually format, and how does the global `delimiterSpacing: true` land on JSON and CSS? Does WordPress style apply inner spaces to JSON arrays?

**A (verified via Biome 2.5.0 + Prettier 3.8.4 + `@wordpress/prettier-config@4.48.1` sandbox experiments):**

*Which file types Biome's formatter touches:*

| Extension | Biome 2.5 formats it? |
|---|---|
| `.ts`, `.js`, `.mjs` | **Yes** |
| `.json` | **Yes** |
| `.css` | **Yes** |
| `.html` | **No** (HTML formatter not enabled in 2.5.0 stable) |
| `.md` | **No** |
| `.yaml` / `.yml` | **No** |

So WordPress formatting via Biome can only ever affect **`.ts`, `.js`, `.mjs`, `.json`, `.css`** in this repo. The bulk of the tree (108 `.md`, 23 `.yaml`/`.yml`, 1 `.html`) is **out of Biome's reach entirely** — untouched regardless of config.

*delimiterSpacing cross-cutting effects (measured):*
- `formatter.delimiterSpacing` is **global**; JSON and CSS inherit it unless overridden per language.
- Global `true`, JSON inherits → JSON arrays become `[ 1, 2, 3 ]` and objects `{ "b": ... }`. **This diverges from WordPress.**
- `json.formatter.delimiterSpacing: false` → `{ "b": [1, 2, 3] }` (objects keep brace spaces, arrays tight) — **matches Prettier+WP exactly**.
- Global `true`, CSS inherits → CSS function parens get spaces: `rgb( 1, 2, 3 )`. Not desired.
- `css.formatter.delimiterSpacing: false` → `rgb(0, 0, 0, 0.5)` (tight parens, normal comma spacing) — matches WP `parenSpacing: false` for stylesheets.

*WordPress/Prettier JSON output (measured with WP prettier-config):* tabs, **objects get inner brace spaces** (`{ "b": ... }`), **arrays do NOT** (`[1, 2, 3]`). So matching WordPress means JSON arrays have **no** inner spaces. Biome's *default* JSON output and the `json.formatter.delimiterSpacing: false` override both reproduce this exactly.

*CSS quote style:* Biome's CSS default is already `"double"`, which equals WP's `singleQuote: false`. So `css.formatter.quoteStyle: "double"` is faithful but **redundant** (matches default). The `css.formatter.delimiterSpacing: false` override **is required** to counter the global `true`.

**Key implication (critical requirement):** A naive single global `delimiterSpacing: true` would silently diverge from WordPress for **JSON arrays** and **CSS parens**. Faithfulness to WordPress requires per-language overrides that turn delimiter spacing **off for JSON and CSS** while leaving it **on for JS/TS/MJS**.

**Sources (this session, researcher):** Biome 2.5.0 sandbox experiments (config/output pairs above); Prettier 3.8.4 + `@wordpress/prettier-config@4.48.1` JSON experiment; `git ls-files` extension counts.

### Q4: Do repo norms imply formatting should be *enforced* (failing check) or merely *available*? What's the Biome verify mechanism? Does reformatting risk breaking tests/tooling?

**A:**

*Repo norms:* Formatting is currently **available but not enforced**. `CONTRIBUTING.md` "Running tests and checks locally" lists `lint`, `typecheck`, `test`, `smoke`, config-load — but **not** `format`, and there is no `format:check`. `format` = `biome format --write .` (write-only); `lint` = `biome lint .` (verify-only). CI: `changeset-gate.yml` (only PR-triggered workflow) runs only changeset validation; `release.yml` runs lint/typecheck/test (not format) and is `workflow_dispatch`-only today. **No formatting check fires anywhere.** No PR template; `AGENTS.md`/`README.md` say nothing about formatting. → The repo norm is "format is a write-command, not a gate." Adding CI enforcement of formatting would be a **new** convention, not one repo norms already imply — so it's an explicit in/out scope decision for the spec.

*Verify mechanism (confirmed exists):* `biome format <paths>` **without `--write`** is verify-only: reports diffs and **exits non-zero** on unformatted files (live: "Found 70 errors" / exit 1; exit 0 when clean). `biome check` (format+lint+import sort) and `biome ci` also exist.

*Reformat risk — LOW / effectively none:*
- No snapshot/golden-file framework. `node:test` + `node:assert` only. `renderSnapshot` hits are runtime progress-bar strings from in-memory objects, independent of source quoting/indent.
- No byte-exact comparisons of source code; no quote-character assertions; no `.replace` on formatting.
- `readFileSync` usages read **runtime-generated** `report.json`/`run.json`, not committed source — reformatting can't affect them. No committed JSON fixtures compared byte-for-byte.
- Quote-style flip (double→single) is semantically inert for TS; `tsc --noEmit` unaffected by quotes/indent/trailing commas.
- Biome doesn't touch `.md`/`.yaml`/`.html`, so changesets, workflows, and `docs/index.html` are untouched.

*Measured blast radius (live, WP config on real repo, Biome 2.5.0):* **21 distinct files** would be rewritten (`src/**/*.ts`, `bin/skillsmith.mjs`, test files, `docs/styles.css`). Mechanical diff, no behavioral change.

*Altitude recommendation:* Floor grounded in repo norms = "all in-scope files formatted to WP style; formatter in verify mode reports no changes." CI enforcement is a reasonable but **new** convention → explicit scope decision.

**Sources (this session, researcher):** `CONTRIBUTING.md` 5–13, 19–40; `package.json` 27–36; `AGENTS.md`; both `.github/workflows/*.yml`; `src/__tests__/` audit; Biome 2.5.0 `format --help`/`check --help`, live exit codes, 21-file blast-radius measurement.

### Q5: Is the Biome version bump (2.4.12 → 2.5.x) genuinely required, and does the bump itself introduce non-WordPress behavioral changes the spec must acknowledge?

**A:**

*Version requirement (confirmed):* `delimiterSpacing` was **added in Biome 2.5.0** (changelog + v2.5 blog). 2.4.12 binary **rejects** `delimiterSpacing` (`× Found an unknown key 'delimiterSpacing'`) — verified live. The per-language overrides (`json.formatter.delimiterSpacing`, `css.formatter.delimiterSpacing`) also exist from 2.5.0. So the capability requirement is exactly **"Biome ≥ 2.5.0."** 2.5.0 is the only published 2.5.x as of June 2026 (`npm dist-tags latest` = 2.5.0). Picking the exact pin is design's call.

*Non-WordPress side effects the bump drags in (3 verified items — ran 2.5.0 against the UNCHANGED repo + existing `biome.json`):*

- **(a) NEW LINT ERROR — breaks `npm run lint`.** `biome lint .` is exit 0 under 2.4.12 but **exit 1 under 2.5.0**: `lint/a11y/useAriaPropsSupportedByRole` at `docs/index.html:83` ("aria-label not supported by this element" — an `aria-label` on a roleless `<div class="visual">`). Cause: 2.5.0 lints HTML under `recommended` where 2.4.12 did not. `docs/index.html` is not git-ignored, so it's in scope. **`npm run lint` runs in `release.yml` CI and in CONTRIBUTING's local checks — a bare bump makes lint fail until resolved** (fix the HTML, disable the rule, or exclude `docs/` from linting). This is a non-WordPress decision the bump forces; the spec must surface it.
- **(b) CONFIG DEPRECATION.** `linter.rules.recommended` (exactly what skillsmith uses) is **deprecated in 2.5.0** (info-level: "use `preset` instead"); still works, `biome migrate` rewrites it. Worth acknowledging.
- **(c) `$schema` mismatch info** — resolved by bumping the `$schema` pin to match (already in the intent's assumption). Not a behavioral risk.

*Cleared (no impact):* No change to existing formatter defaults (`delimiterSpacing` defaults `false`, opt-in only). No new lint findings on skillsmith's TS/JS/CSS/JSON (the only new finding was the HTML a11y one; 2.5.0's promoted rules are mostly HTML/Vue/a11y/CSS-class). `organizeImports: "on"` behavior unchanged. Breaking rule renames in 2.5.0 don't affect skillsmith (config only sets `recommended: true`).

**Sources (this session, researcher):** Biome changelog (biomejs.dev/internals/changelog/); v2.5 blog (biomejs.dev/blog/biome-v2-5/); `npm view @biomejs/biome dist-tags`/`versions`; live 2.4.12 rejection of `delimiterSpacing`; live 2.5.0-vs-2.4.12 `biome lint .` exit codes + full error text at `docs/index.html:83`; deprecation + `$schema` mismatch messages.

### Q6 (researcher follow-up, unprompted): Will the changeset gate block this PR even though no version bump is warranted?

**A:** Yes — mechanically. The change needs no *version* changeset (format/lint config + behaviour-equivalent devDependency bump; see CONTRIBUTING), but the PR touches `src/**`, `bin/**`, and `package.json`, all in the changeset gate's `changedFilePatterns`. So `changeset-gate.yml` will demand a changeset. **Resolution: add a `none`-bump changeset** (precedent: `.changeset/initial-scaffolding.md`), satisfying the gate while recording no version bump.

**Sources:** `CONTRIBUTING.md` changeset rules; `.changeset/initial-scaffolding.md` (precedent); `changeset-gate.yml` patterns. (researcher, this session.)

## Research

### Repo file-type inventory (observed by spec-analyst, `git ls-files`)

- `.md` ×108, `.ts` ×74, `.yaml` ×20, `.mjs` ×14, `.json` ×8, `.yml` ×3, `.png` ×2, `.html` ×1, `.css` ×1, plus `.gitignore`, `.example`, `LICENSE`.
- Top-level dirs: `assets/`, `bin/`, `docs/`, `examples/`, `scripts/`, `src/`, `testing-project/`.
- Implication: skillsmith ships mostly TS + MJS + JSON. There is exactly **one** `.css` file and **one** `.html` file. The intent's "CSS overrides" therefore applies to a very small surface — worth confirming whether CSS is in scope and where that single file lives.
- The single CSS/HTML files are `docs/styles.css` and `docs/index.html` (a docs site). Scope question: are these in the formatter's surface, and does the WordPress CSS override matter for them?

### Enforcement / CI surface (observed by spec-analyst)

- npm scripts: `lint` = `biome lint .`; `lint:fix` = `biome lint --write .`; `format` = `biome format --write .`; `typecheck` = `tsc --noEmit`; `test` = node test runner; `smoke`; `changeset`; `release`.
- **There is no `format:check` / verify-only formatting script**, and **no combined `check`**. `format` only *writes*; it does not fail on unformatted code.
- CI workflows present: `.github/workflows/release.yml`, `.github/workflows/changeset-gate.yml`, `.github/dependabot.yml`. No general PR/test CI workflow.
- `release.yml` runs `npm run lint`, `npm run typecheck`, `npm test` — but **NOT** any formatting check. So formatting is currently **not enforced** anywhere in CI.
- Implication for success criteria: "adopt the standard" could mean only "config + reformatted files," or could additionally mean "formatting is verified/enforced." This needs an explicit scope decision (see Q on enforcement).
- `changeset-gate.yml` is the only PR-triggered workflow (validates changesets); it does not run lint/format/test. `release.yml` is currently `workflow_dispatch`-only.

### Files Biome would touch / churn considerations (observed by spec-analyst)

- No `.editorconfig`. JSON files already use **tab** indentation (e.g. `package.json`), consistent with Biome's tab default.
- `biome.json` sets `vcs.useIgnoreFile: true`, so Biome respects `.gitignore` (which excludes `node_modules/`, `dist/`, `build/`, `coverage/`, `.claude/`, etc.).
- **Tracked but NOT gitignored:** `package-lock.json` (3571 lines, auto-generated), `testing-project/package-lock.json`, and other `testing-project/` files. Adopting a global formatter would reformat these too. Open scope question: should auto-generated lockfiles and/or `testing-project/` fixtures be in or out of the formatting surface (churn vs. uniformity)?

### Reformat-risk: tests/fixtures (preliminary, spec-analyst)

- 20 test files under `src/__tests__/`. ~240 `assert.equal/strictEqual/deepEqual` calls.
- "snapshot" references in `src/pipeline/testing-agent.ts` are **runtime workspace snapshots**, not test golden files. No `toMatchSnapshot`/`.snap` Jest-style snapshots found.
- Test **fixtures** live under `src/__tests__/fixtures/` (e.g. `fixtures/proj1`, `fixtures/skills`, `fixtures/loop-project`) and are read as data. Risk only if a test asserts exact byte content of a fixture *source file* that the formatter would touch. Researcher asked to assess this depth (Q4.3).

### Current quote usage / JSX presence (observed by spec-analyst)

- `src/**/*.ts` is overwhelmingly **double-quoted** (~2265 double-quoted vs ~36 single-quoted string literals, rough grep). So the double→single quote flip is the single most visible JS change a developer would notice.
- **No `.tsx`/JSX files** in the repo (`git ls-files '*.tsx'` → 0). Therefore the JSX-only WP settings (`bracketSameLine: false`) have **no observable effect** here; they can be configured for fidelity but are not testable against current code.

### Packaging / changeset considerations (observed by spec-analyst)

- `package.json` has no `files` field and no `.npmignore`. `@biomejs/biome` is a **devDependency** (build-time tool, not shipped to consumers). `docs/` is a docs site (repo tooling), not library runtime code, but it is tracked and in Biome's surface.
- `CONTRIBUTING.md` "Adding a changeset": a PR does **NOT** need a changeset for "**lint/format config, CI config**", "**lockfile maintenance**", "`testing-project/` fixture", "the `docs/` landing page", or `package-lock.json`-only changes. Dependency bumps need a changeset **only** when behaviour, peer ranges, or `engines` change — "behaviour-equivalent bumps do not require a changeset."
- Implication: this work (formatter/lint config + reformatting + a build-time-only Biome devDependency bump that doesn't change consumer behaviour) is, by skillsmith's own policy, **likely changeset-exempt**. Final call belongs to later phases, but the spec can note this so a changeset isn't forced unnecessarily.

## Consolidated Requirements

Each requirement is phrased as an observable outcome (what one could verify by running the formatter/linter or inspecting the formatted code), not as an implementation choice. The "source of truth" for WordPress style is `@wordpress/prettier-config@4.48.1` (Q1), reproduced with **stock Biome ≥ 2.5.0** (no `wp-prettier` fork).

### Premise confirmation

- Both of the intent's open assumptions are **confirmed by evidence**: (a) translating `@wordpress/prettier-config` to Biome entails delimiter spacing on for JS, single quotes, tabs width 4, line width 80, es5 trailing commas, plus CSS handling (Q1, Q3); (b) `delimiterSpacing` requires Biome ≥ 2.5.0, so a `@biomejs/biome` bump (from 2.4.12) and `$schema` re-pin are required (Q5). No premise is overturned; no blocker.

### Functional requirements — formatter output (the WordPress formatting standard)

1. **JavaScript/TypeScript files (`.ts`, `.js`, `.mjs`) are formatted to the full WordPress style**, observable as: indentation with **tabs** rendered at **width 4**; a target **line width of 80** columns; **single quotes** for string literals (currently double); **trailing commas where ES5 allows** (arrays and object literals) but **not** in function parameters/arguments/imports; **semicolons** present; arrow-function parameters **always parenthesized** (`(x) => x`); spaces inside object-literal braces (`{ a: 1 }`); and — the headline change — **spaces inside parentheses and array brackets** via Biome's `delimiterSpacing`, so `array( 1, 2 )` and `[ 1, 2 ]`.
2. **The WordPress delimiter-spacing style applies to JS/TS/MJS only.** **JSON** files match WordPress's Prettier-for-JSON output exactly: tabs, **object braces spaced** (`{ "a": 1 }`) but **array brackets NOT spaced** (`[1, 2, 3]`). I.e. the global delimiter-spacing must be turned **off for JSON**, or JSON would diverge from WordPress (Q3). This is a faithfulness requirement, not a nicety.
3. **CSS files match WordPress's stylesheet style:** **double quotes** (Biome's default, equals WP `singleQuote: false`) and **no delimiter spacing inside parentheses** (`rgb(0, 0, 0, 0.5)`, not `rgb( 0, 0, 0 )`) — i.e. delimiter spacing turned **off for CSS**, matching WP `parenSpacing: false`. Applies to the repo's one CSS file, `docs/styles.css` (Q3).
4. **The existing tree is brought into compliance**, not just the config: after adopting the standard, running the formatter over the in-scope files produces **no further changes** (the ~21 currently-divergent files — across `src/**/*.ts`, `bin/skillsmith.mjs`, test files, and `docs/styles.css` — are reformatted as part of this work) (Q4). "Fully adopts" means the committed code is in WordPress style, not merely that the config could produce it.
5. **`@biomejs/biome` is upgraded to a version that supports the required options (≥ 2.5.0)**, and the `biome.json` `$schema` pin is updated to match the installed version, so the config validates without an unknown-key error or schema-mismatch warning (Q5). 2.5.0 is the only published 2.5.x as of June 2026; the exact pin is a later-phase choice.
6. **Existing behavior is preserved across the reformat:** `tsc --noEmit` (`npm run typecheck`) and the test suite (`npm test`) pass unchanged — the reformat is mechanical (whitespace/quote/comma tokens only) and introduces no behavioral change (Q4).
7. **File types Biome does not format are unaffected:** Markdown (`.md`), YAML (`.yaml`/`.yml`), and HTML (`.html`) are outside Biome's formatter and are **not** reformatted by this change (Q3). No requirement targets their formatting.

### Constraint / side-effect requirement forced by the version bump

8. **The Biome 2.4.12 → ≥2.5.0 bump must not leave `npm run lint` failing.** With the existing `linter.rules.recommended: true` config, 2.5.0 newly raises `lint/a11y/useAriaPropsSupportedByRole` on `docs/index.html:83` (exit 0 → exit 1), and `npm run lint` runs in CI (`release.yml`) and in CONTRIBUTING's local checks. The observable outcome required: **`npm run lint` exits 0 after the change.** *(How this is achieved — fix the HTML, disable/scope the rule, or exclude `docs/` from linting — is a design/code decision; see Open scope decision (b).)* (Q5)

### Open scope decisions to be resolved (surfaced, not silently decided)

These are in/out-of-scope judgment calls for the owner/spec, each grounded in evidence above. They do not block requirements; they bound them.

- **(a) Formatting enforcement (verify check).** Repo norm today is "format is a write-only convenience, not a gate"; no formatting check fires anywhere (Q4). Decision: does adopting the standard also introduce a **verify-only check** (e.g. a `format:check` script / CI step that fails on unformatted code), or is the standard merely *available*? Adding enforcement is a **new** convention. *Recommendation:* at minimum guarantee "formatter in verify mode reports no changes on the committed tree" as an acceptance check; full CI enforcement is optional and owner's call.
- **(b) The `docs/index.html` a11y lint error (Req. 8).** The required outcome (`npm run lint` exits 0) is fixed; the **means** is an open decision deferred to design/code.
- **(c) Formatting surface for generated/fixture files.** `package-lock.json` (and `testing-project/` files) are tracked, not git-ignored, and would be reformatted by a global formatter (Q3/Q4 churn note). Decision: are auto-generated lockfiles and/or the `testing-project/` fixture **in or out** of the formatting surface? CONTRIBUTING treats lockfile/`testing-project`/`docs` changes as changeset-exempt, which suggests they're low-stakes either way.

### Out of scope

- **WordPress *lint* rules** (`@wordpress/eslint-plugin`: naming conventions, i18n rules, React/Hooks, jsx-a11y, JSDoc, dependency-group import ordering, `no-unsafe-wp-apis`, etc.). These are a separate layer, not expressible as Biome formatter settings, and not what the intent targets (Q2). skillsmith's existing Biome **`linter` block stays as-is** apart from whatever is needed to satisfy Req. 8.
- **Formatting of Markdown, YAML, and HTML** — Biome does not format them (Q3).
- **JSX-specific formatting fidelity** as an *observable* outcome — there are no `.tsx`/JSX files, so `bracketSameLine` has no effect on current code (it may be configured for fidelity but is not testable here).
- **Repackaging / `npm publish` contents** (no `files` field / `.npmignore`) — unrelated to this change.

### Notes for later phases

- **Changeset: no version bump needed, but the gate fires.** By `CONTRIBUTING.md`, this change needs no *version* changeset — "lint/format config", "CI config", "lockfile maintenance", `testing-project/`, and the `docs/` landing page are changeset-exempt, and a behaviour-equivalent **devDependency** bump (Biome is build-time only) does not require one. **However**, the PR will touch `src/**`, `bin/**`, and `package.json`, which are in the changeset gate's `changedFilePatterns`, so the gate (`changeset-gate.yml`) will mechanically demand a changeset. Resolution (per researcher): add a **`none`-bump changeset** (precedent: `.changeset/initial-scaffolding.md`), which satisfies the gate while recording no version bump. Final wording is later-phase, but plan for a `none` changeset so the PR gate passes.
- **Config mechanics** (exact `biome.json` keys, per-language override blocks, script names, CI wiring) are **design/plan phase** work, not spec.
