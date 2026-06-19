# Spec: Adopt WordPress coding standards in Biome formatting

## Overview

skillsmith formats its code with Biome, but its current formatting (double quotes, no delimiter spacing, no explicit line width) does not match the WordPress coding standard the project wants to follow. The WordPress JS/TS style is codified in `@wordpress/prettier-config` (tabs at width 4, single quotes, 80-column wrap, ES5 trailing commas, and — the headline trait — spaces inside parentheses and brackets such as `array( 1, 2 )` and `[ 1, 2 ]`). That last trait historically required the `wp-prettier` fork; Biome 2.5's new `delimiterSpacing` formatter option now reproduces it with stock tooling, making faithful WordPress-style formatting achievable in skillsmith for the first time.

This feature fully adopts the WordPress formatting standard in skillsmith: the formatting configuration is updated to express the complete WordPress style faithfully (including the per-file-type nuances WordPress requires), the entire formattable tree is reformatted to comply, and the toolchain is upgraded to the Biome version that supports the required options — all without changing program behavior or leaving any existing check failing. The scope is the *formatting* layer only; WordPress *lint* rules are not adopted. There is no official `@wordpress/biome-config` package (verified June 2026), so the WordPress standard is expressed directly in skillsmith's Biome configuration as a faithful mirror of `@wordpress/prettier-config@4.48.1`.

## Requirements

The authoritative source of truth for "WordPress style" is `@wordpress/prettier-config@4.48.1`, reproduced with stock Biome (version ≥ 2.5.0, no `wp-prettier` fork). Requirements describe observable outcomes — what a reader could verify by running the formatter/linter or inspecting the formatted code — not configuration mechanics.

1. **JavaScript/TypeScript files (`.ts`, `.js`, `.mjs`) are formatted to the full WordPress style.** Observable traits:
   - indentation with **tabs**, rendered at **width 4**;
   - a target **line width of 80** columns;
   - **single quotes** for string literals (the repo currently uses double quotes);
   - **trailing commas where ES5 allows them** (arrays and object literals) but **not** in function parameters, function arguments, or imports;
   - **semicolons** present;
   - arrow-function parameters **always parenthesized** (`(x) => x`);
   - spaces inside object-literal braces (`{ a: 1 }`);
   - **spaces inside parentheses and array brackets** — the headline WordPress trait — so calls and arrays read as `fn( a, b )` and `[ 1, 2 ]`.

2. **Delimiter spacing (spaces inside parentheses/brackets) is applied to JS/TS/MJS only — never to JSON.** JSON files match WordPress's Prettier-for-JSON output exactly: tab indentation, **object braces spaced** (`{ "a": 1 }`), but **array brackets NOT spaced** (`[1, 2, 3]`). This is a faithfulness requirement: a single global delimiter-spacing setting would wrongly add inner spaces to JSON arrays, diverging from WordPress, so JSON must be exempted from the parentheses/bracket spacing.

3. **CSS files match WordPress's stylesheet style:** **double quotes** for strings and **no spaces inside parentheses** (e.g. `rgb(0, 0, 0, 0.5)`, not `rgb( 0, 0, 0, 0.5 )`). This mirrors WordPress's CSS overrides (`singleQuote: false`, `parenSpacing: false`) and applies to the repo's CSS (currently the single file `docs/styles.css`).

4. **The committed tree is brought into compliance, not just the configuration.** After the change, running the formatter in write mode over the formattable files produces no edits, because every file Biome formats has already been reformatted to WordPress style as part of this work. "Fully adopts" means the committed code is in WordPress style — not merely that the configuration is capable of producing it.

5. **All files within Biome's formatting reach are reformatted — generated and fixture files included.** Biome respects `.gitignore` (so `node_modules/`, `dist/`, `build/`, `coverage/`, etc. remain untouched), but tracked, non-ignored files that Biome formats — including `package-lock.json`, `testing-project/package-lock.json`, files under `testing-project/`, and files under `docs/` — are reformatted to the standard rather than carved out. Uniform adoption across the tracked formattable surface is required; no in-tree exclusions are introduced to spare generated or fixture files from formatting. Reformatting these generated files must not break them: in particular, after the reformat each `package-lock.json` remains a valid lockfile that installs the same dependency tree — `npm ci` resolves and installs successfully with no change to resolved versions.

6. **The formatting toolchain supports the required options.** `@biomejs/biome` is upgraded from `2.4.12` to a version that supports `delimiterSpacing` and its per-language overrides (**Biome ≥ 2.5.0**; 2.5.0 is the only published 2.5.x as of June 2026), and the `biome.json` `$schema` reference is updated to match the installed version, so the configuration validates with no unknown-key error and no schema-mismatch warning.

7. **Formatting compliance is verifiable, not merely available.** Verification is done with the already-installed Biome's verify mode — running `biome format .` **without** `--write` reports diffs and exits non-zero on any unformatted file, and exits zero when the tree complies. This is the check; **no new artifact is required** (no new npm script, no new CI workflow). Adoption is therefore mechanically checkable against the committed tree using tooling that already ships in the repo. Introducing a *new gating CI workflow* to run this check on every pull request is out of scope (see Out of Scope), and adding a dedicated `format:check` npm script is optional convenience, not a requirement.

8. **Existing behavior is preserved across the reformat.** The reformat is mechanical: it changes only formatting tokens — whitespace and indentation, quote characters (in JS/TS/MJS and CSS), trailing-comma tokens, and delimiter spacing — and never the meaning of the code or data. For the repo's own source files, `tsc --noEmit` (`npm run typecheck`) and the test suite (`npm test`) pass unchanged. For the reformatted `testing-project/` source — which the repo's `typecheck`/`test` do not exercise — the fixture config and its import graph still load (verifiable via `npm --prefix testing-project run check:config`, which imports `testing-project/skillsmith.config.ts` through its real import graph). For data/generated files (the tracked JSON files and lockfiles), reformatting alters layout only and preserves their content semantics — in particular, a reformatted `package-lock.json` remains a valid, install-equivalent lockfile (see Requirement 5). Every reformatted surface thus carries an observable guarantee that its behavior is unchanged.

9. **The version bump must not leave any existing check failing — specifically, `npm run lint` exits zero after the change.** Upgrading Biome to ≥ 2.5.0 newly raises an accessibility lint finding (`lint/a11y/useAriaPropsSupportedByRole`) on `docs/index.html` under the existing recommended-rules configuration, turning `npm run lint` from exit 0 (under 2.4.12) to exit 1 (under 2.5.0). Because `npm run lint` runs in CI and in the documented local checks, the required observable outcome is that **`npm run lint` exits zero after the change**. (How that is achieved — fixing the HTML, scoping/disabling the rule, or excluding the file from linting — is a design/code decision, not a spec decision.)

10. **File types Biome does not format are not reformatted.** Markdown (`.md`), YAML (`.yaml`/`.yml`), and HTML (`.html`) are outside Biome's formatter and are not reformatted by this change (HTML may still be subject to Biome's linter — see requirement 9). No requirement targets the formatting of these file types.

## Out of Scope

- **WordPress *lint* rules** — the `@wordpress/eslint-plugin` ruleset (naming conventions, i18n rules, React/Hooks rules, jsx-a11y, JSDoc requirements, dependency-group import ordering, `no-unsafe-wp-apis`, etc.). These are a separate layer from formatting, are not expressible as Biome formatter settings, and are not what this feature targets. skillsmith's existing Biome `linter` configuration stays as-is, apart from any change needed solely to satisfy requirement 9.
- **A new gating CI workflow for formatting.** Requirement 7 requires that formatting be *verifiable* and that the check *pass*; it does not require adding a new pull-request-gating workflow that runs the formatting check on every PR. Wiring formatting enforcement into CI as a new required gate is a separate convention and is out of scope.
- **Formatting of Markdown, YAML, and HTML** — Biome does not format these file types; their formatting is unchanged.
- **JSX-specific formatting fidelity as an observable outcome.** The repo contains no `.tsx`/JSX files, so JSX-only WordPress settings (e.g. multiline JSX bracket placement) have no effect on current code. Configuring them for fidelity is acceptable but is not a testable outcome here.
- **Repackaging / changing published package contents** (e.g. introducing a `files` field or `.npmignore`). `@biomejs/biome` is a build-time-only devDependency and is not shipped to consumers; the published-package surface is unrelated to this change.
- **Changeset mechanics.** The reformat necessarily touches `src/**`, `bin/**`, and `package.json`, so the repo's changeset gate (`changeset-gate.yml`) will mechanically require a changeset even though this change warrants no version bump (it is lint/format config plus a behaviour-equivalent build-time devDependency bump). Satisfying that gate is a landing-process detail deferred to later phases; the research recommends a `none`-bump changeset (precedent: `.changeset/initial-scaffolding.md`). The spec does not prescribe the changeset wording or mechanics, but the PR is expected to satisfy the required changeset gate (see Acceptance Criteria).

## Acceptance Criteria

Formatter output (WordPress style):

- Given a `.ts`/`.js`/`.mjs` file with a function call or array literal, when it is formatted, then parentheses and brackets contain inner spaces (`fn( a, b )`, `[ 1, 2 ]`), strings use single quotes, indentation is tabs, lines target 80 columns, object literals keep spaced braces (`{ a: 1 }`), arrow parameters are parenthesized, semicolons are present, and trailing commas appear in multiline arrays/objects but not in function parameter/argument/import lists.
- Given a `.json` file, when it is formatted, then object braces are spaced (`{ "a": 1 }`) and array brackets are NOT spaced (`[1, 2, 3]`), with tab indentation.
- Given a `.css` file (e.g. `docs/styles.css`), when it is formatted, then strings use double quotes and parentheses contain no inner spaces (`rgb(0, 0, 0, 0.5)`).
- Given the absence of `.tsx`/JSX files, when the configuration is applied, then no JSX-only formatting trait changes any existing file.

Tree compliance and verification:

- Given the committed repository after this change, when `biome format --write .` is run, then it makes no edits (every formattable file already complies).
- Given the committed repository after this change, when `biome format .` is run (Biome's verify mode, no `--write`), then it reports no changes and exits zero.
- Given a deliberately mis-formatted in-scope file (e.g. parentheses spacing removed from a `.ts` file), when `biome format .` is run (no `--write`), then it exits non-zero.
- Given the set of tracked, non-`.gitignore`d files that Biome formats, when formatting is applied, then `package-lock.json`, `testing-project/package-lock.json`, files under `testing-project/`, and files under `docs/` are reformatted to the standard (no in-tree exclusions spare them); and given `.gitignore`d paths (`node_modules/`, `dist/`, `build/`, `coverage/`, etc.), when formatting is applied, then they remain untouched.
- Given the reformatted repository, when `npm ci` is run, then it resolves and installs successfully against the reformatted `package-lock.json` with no change to resolved dependency versions (the reformatted lockfile remains install-equivalent).

Toolchain and configuration:

- Given the upgraded toolchain, when `@biomejs/biome --version` (or equivalent) is checked, then it reports a version ≥ 2.5.0.
- Given the updated `biome.json`, when Biome loads it, then the configuration validates with no unknown-key error and no `$schema` version-mismatch warning.

Behavior and check preservation:

- Given the reformatted tree, when `npm run typecheck` is run, then it passes (exit zero).
- Given the reformatted tree, when `npm test` is run, then it passes with the same results as before the change.
- Given the reformatted tree, when `npm --prefix testing-project run check:config` is run, then it succeeds — the reformatted `testing-project/` config and its import graph still load with no config-load or import regression. (This is the observable behavior-preservation guarantee for the reformatted `testing-project/` source, which the repo's own `typecheck`/`test` do not exercise.)
- Given the upgraded Biome and the reformatted tree, when `npm run lint` is run, then it exits zero (the new `useAriaPropsSupportedByRole` finding on `docs/index.html` no longer fails the lint run).
- Given the PR for this change (which touches `src/**`, `bin/**`, and `package.json`), when the repo's changeset gate (`changeset-gate.yml`) runs, then it passes (the specific changeset mechanics are deferred to later phases — see Out of Scope).

Unaffected file types:

- Given the change, when Markdown (`.md`), YAML (`.yaml`/`.yml`), and HTML (`.html`) files are inspected, then their formatting is unchanged by this feature.
