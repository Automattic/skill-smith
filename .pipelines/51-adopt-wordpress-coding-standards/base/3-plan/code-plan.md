# Code Plan: Adopt WordPress coding standards in Biome formatting

## Overview

skillsmith formats its code with Biome 2.4.12, whose current configuration
(double quotes, no delimiter spacing, no explicit line/indent width) does not
match the WordPress JavaScript/TypeScript coding standard codified in
`@wordpress/prettier-config@4.48.1`. This plan adopts the WordPress *formatting*
standard (not its lint rules) by, in strict order: (1) pinning the build-time
devDependency `@biomejs/biome` to exact `2.5.0` and refreshing the root
lockfile for that one dependency; (2) rewriting `biome.json` to the decided
Config B that expresses the full WordPress style with stock Biome 2.5.0; (3)
fixing the one accessibility lint finding the upgrade newly raises on
`docs/index.html`; (4) running the one-shot whole-tree reformat
(`biome format --write .`, ~89 files) so the committed tree complies; and (5)
recording a `none`-bump changeset to clear the repo's changeset gate. The
ordering is load-bearing: the Biome version bump, the config rewrite, and the
a11y fix must all land **before** the whole-tree reformat so that the reformat
runs under the new binary and the new config, and so the final
verification (`biome format .`, `npm run lint`) lands on a tree that is already
compliant and green. There is no runtime code change and no new dependency
beyond the Biome bump.

### Authoritative design corrections (follow the design, not the superseded spec wording)

The design doc is the authoritative resolution-of-record on two points where
`1-spec/spec.md` was intentionally left unchanged. **This plan follows the
design on both:**

1. **Lockfiles are NOT reformatted.** Stock Biome hardcodes `package-lock.json`
   and `testing-project/package-lock.json` as protected files; it never formats
   them and this cannot be overridden. skillsmith adds **no** in-tree exclusion
   for them — the protection is Biome's own default. The spec's "lockfiles are
   reformatted" / "reformatted lockfile remains install-equivalent" wording
   (spec Req 5, Req 8, and their lockfile acceptance criteria) is superseded.
   **Kept guarantee:** `npm ci` (root and `testing-project/`) installs
   successfully against the **unchanged** lockfiles with no change to resolved
   dependency versions. The only lockfile delta in this work is npm's own
   refresh of the `@biomejs/biome` devDependency (Task 1).

2. **Multiline imports DO get an `es5` trailing comma.** Faithful WordPress
   `es5` (Biome `trailingCommas: "es5"`) adds a trailing comma to a multiline
   import; single-line imports that fit on one line get none. The spec Req 1
   wording "trailing commas ... not in ... imports" is superseded for `es5`.
   Treat a trailing comma on a multiline import as **correct**, not a defect.

## Tasks

### Task 1: Pin `@biomejs/biome` to exact `2.5.0` and refresh the root lockfile

- **Goal:** Upgrade the build-time formatter/linter toolchain to the version
  that supports `delimiterSpacing` and its per-language overrides, so the
  Config B rewrite (Task 2) and the reformat (Task 4) run under Biome 2.5.0.
- **Files to change:**
  - `package.json` (root) — `devDependencies["@biomejs/biome"]`
  - `package-lock.json` (root) — npm-refreshed for the new Biome version only
- **Changes:**
  - In `package.json`, change `devDependencies["@biomejs/biome"]` from
    `"2.4.12"` to exact `"2.5.0"` (no caret, no range — matches the repo's
    existing exact-pin style for this dependency).
  - Regenerate the root `package-lock.json` deliberately and in a targeted way
    (e.g. `npm install` after editing `package.json`, then confirm the diff is
    scoped) so that the only resolved-version delta is `@biomejs/biome` and its
    platform-specific optional deps. Do **not** pull unrelated dependency
    updates into the lockfile.
  - Do **not** touch `package.json` scripts; do **not** add any new dependency.
- **Depends on:** none
- **Traces to:** Spec Req 6; Spec acceptance "version ≥ 2.5.0"; Design "Approach"
  step 1, Design "Components → Modified (`package.json`, `package-lock.json`)",
  Design "Decision: Pin `@biomejs/biome` to exact `2.5.0`".
- **Acceptance:**
  - `package.json` declares `"@biomejs/biome": "2.5.0"` (exact, no caret/range).
  - The installed Biome reports a version of `2.5.0`
    (`npx @biomejs/biome --version` reports `2.5.0`).
  - `npm ci` at the repo root resolves and installs successfully against the
    refreshed `package-lock.json` and does not rewrite it.
  - The `package-lock.json` diff for this task changes only `@biomejs/biome`
    and its platform-specific optional dependency entries — no unrelated
    resolved-version changes.
  - `testing-project/package-lock.json` is unchanged by this task, and
    `npm --prefix testing-project ci` still installs successfully against it.

### Task 2: Rewrite `biome.json` to Config B (WordPress style)

- **Goal:** Express the full WordPress formatting standard as a faithful mirror
  of `@wordpress/prettier-config@4.48.1` using stock Biome 2.5.0, and re-pin the
  `$schema` to the installed version so the config validates without warnings.
- **Files to change:**
  - `biome.json`
- **Changes:** Replace the current `biome.json` with exactly the following
  Config B (the committed file contains no comments):

  ```json
  {
  	"$schema": "https://biomejs.dev/schemas/2.5.0/schema.json",
  	"vcs": {
  		"enabled": true,
  		"clientKind": "git",
  		"useIgnoreFile": true
  	},
  	"files": {
  		"ignoreUnknown": false
  	},
  	"formatter": {
  		"enabled": true,
  		"indentStyle": "tab",
  		"indentWidth": 4,
  		"lineWidth": 80
  	},
  	"linter": {
  		"enabled": true,
  		"rules": {
  			"recommended": true
  		}
  	},
  	"javascript": {
  		"formatter": {
  			"quoteStyle": "single",
  			"trailingCommas": "es5",
  			"semicolons": "always",
  			"arrowParentheses": "always",
  			"delimiterSpacing": true
  		}
  	},
  	"assist": {
  		"enabled": true,
  		"actions": {
  			"source": {
  				"organizeImports": "on"
  			}
  		}
  	}
  }
  ```

  Specific deltas from the current file:
  - `$schema`: `.../2.4.12/schema.json` → `.../2.5.0/schema.json`.
  - `formatter`: add `"indentWidth": 4` and `"lineWidth": 80` (keep
    `"indentStyle": "tab"`).
  - `javascript.formatter`: change `"quoteStyle": "double"` → `"single"`, and
    add `"trailingCommas": "es5"`, `"semicolons": "always"`,
    `"arrowParentheses": "always"`, `"delimiterSpacing": true`.
  - Do **NOT** add a `json.formatter` block (Biome's JSON default already
    matches WordPress: object braces spaced, array brackets tight, tab indent —
    and `delimiterSpacing` scoped to `javascript.formatter` never leaks into
    JSON).
  - Do **NOT** add a `css.formatter` block (Biome's CSS default already matches
    WordPress: tight parentheses, double quotes).
  - Do **NOT** set `javascript.formatter.bracketSpacing` (default `true` is
    already faithful; it is a separate setting from `delimiterSpacing`).
  - Do **NOT** touch the `linter`, `assist`, `vcs`, or `files` blocks beyond
    what is shown (in particular, keep `linter.rules.recommended: true` exactly
    as-is; do **not** migrate it to the `preset` form).
- **Depends on:** Task 1 (the `2.5.0` keys/schema only validate cleanly under
  the installed Biome 2.5.0; under 2.4.12 the `delimiterSpacing` key is
  rejected).
- **Traces to:** Spec Req 1, 2, 3, 6; Spec acceptance "Toolchain and
  configuration" and "Formatter output (WordPress style)"; Design "Interfaces
  and Data Flow → Target `biome.json` (Config B)", Design "Decision: Config B
  (JS-scoped delimiter spacing)", Design "Decision: Re-pin `$schema` to 2.5.0;
  do NOT migrate `linter.rules.recommended`".
- **Acceptance:**
  - `biome.json` matches Config B above byte-for-byte in its key set and values
    (single quotes, `trailingCommas: es5`, `semicolons: always`,
    `arrowParentheses: always`, `delimiterSpacing: true`; `indentStyle: tab`,
    `indentWidth: 4`, `lineWidth: 80`; `$schema` pinned to `2.5.0`).
  - No `json.formatter` and no `css.formatter` block is present.
  - The `linter`, `assist`, `vcs`, and `files` blocks are unchanged from the
    pre-task file except the `$schema` line.
  - Biome loads the config with no unknown-key error and no `$schema`
    version-mismatch warning (e.g. `biome lint .` / `biome format .` load the
    config cleanly; the `recommended` deprecation, if any, is info-level only
    and does not change the exit code).
  - With this config, formatting a JS/TS sample yields WordPress style:
    parentheses and array brackets carry inner spaces (`fn( a, b )`,
    `[ 1, 2 ]`), strings use single quotes, object braces stay spaced
    (`{ a: 1 }`), arrow parameters are parenthesized, semicolons present, and
    trailing commas appear in multiline arrays/objects and multiline imports but
    not in function parameter/argument lists.
  - Formatting a JSON sample keeps object braces spaced (`{ "a": 1 }`) and array
    brackets tight (`[1, 2, 3]`) with tab indentation; formatting a CSS sample
    keeps double quotes and tight parentheses (`rgb(0, 0, 0, 0.5)`).

### Task 3: Add `role="img"` to the hero visual in `docs/index.html`

- **Goal:** Resolve the `lint/a11y/useAriaPropsSupportedByRole` finding that
  Biome 2.5.0 newly raises on `docs/index.html` (HTML support for this rule is
  new in 2.5.0), so `npm run lint` exits zero after the upgrade. This is a hand
  edit to HTML, which Biome does not format, so it is independent of the
  reformat.
- **Files to change:**
  - `docs/index.html`
- **Changes:**
  - On line 83, add the attribute `role="img"` to the `<div class="visual" ...>`
    element so it reads:
    `<div class="visual" role="img" aria-label="Skillsmith run preview">`.
  - Make no other change to the HTML (no other attributes, no reformatting; do
    not edit `linter` config and do not add a `biome-ignore` suppression — the
    fix is the `role="img"` attribute only).
- **Depends on:** Task 1 (the finding only appears under Biome 2.5.0). May be
  done before or after Task 2, but MUST precede Task 5 (final lint
  verification). Sequenced here so it lands before the reformat.
- **Traces to:** Spec Req 9; Spec acceptance "`npm run lint` exits zero"; Design
  "Approach" step 4, Design "Components → Modified (`docs/index.html`)", Design
  "Decision: Fix the a11y finding with `role=\"img\"` in HTML".
- **Acceptance:**
  - `docs/index.html` line 83 is
    `<div class="visual" role="img" aria-label="Skillsmith run preview">`.
  - `npm run lint` (`biome lint .`) exits zero — the
    `useAriaPropsSupportedByRole` finding on `docs/index.html` no longer fails
    the run, and no new finding (e.g. `useSemanticElements`) is introduced.
  - No change is made to the `linter` block of `biome.json` and no
    `biome-ignore` comment is added.

### Task 4: Reformat the whole tree to WordPress style

- **Goal:** Bring the committed tree into compliance with Config B by running
  the one-shot mechanical reformat, so the formatter produces no further edits
  and the verify check passes.
- **Files to change:** The ~89 tracked, non-`.gitignore`d, formattable files
  that `biome format --write .` rewrites under Config B. Verified blast radius
  (Biome 2.5.0, Config B): "Formatted 95 files, Fixed 89" — 74 `.ts`, 14
  `.mjs`, 1 `.css`, and **zero** JSON. By directory: `src/**` ×68,
  `testing-project/**` ×17, `bin/skillsmith.mjs` ×1, `docs/styles.css` ×1,
  `examples/skillsmith.config.ts` ×1, `scripts/validate-changesets.ts` ×1.
- **Changes:**
  - Run `biome format --write .` once from the repo root (under Biome 2.5.0,
    with Config B in place). This is a purely mechanical reformat: it changes
    only whitespace, indentation, quote characters (double → single in
    JS/TS/MJS; CSS strings stay double-quoted), trailing-comma tokens, and
    delimiter spacing. It must not change program or data semantics.
  - Do **NOT** add any `files.includes`/ignore exclusion. Rely on stock Biome:
    it honors `.gitignore` (so `node_modules/`, `dist/`, `build/`, `coverage/`
    stay untouched) and its hardcoded protected-file list (so
    `package-lock.json` and `testing-project/package-lock.json` are left
    unchanged — see "Authoritative design corrections" above).
  - Do **NOT** force-format the lockfiles via any off-tool mechanism.
  - Commit exactly what `biome format --write .` produces — make no manual
    formatting edits on top of it.
- **Depends on:** Task 1 (reformat must run under Biome 2.5.0), Task 2 (reformat
  must use Config B), and Task 3 (so the a11y edit is not entangled with the
  large reformat diff). This task MUST run after all three.
- **Traces to:** Spec Req 1, 2, 3, 4, 5, 8, 10; Spec acceptance "Tree compliance
  and verification", "Formatter output (WordPress style)", "Unaffected file
  types"; Design "Approach" step 3, Design "Components → Modified (the ~89
  formattable source files)", Design "Decision: Whole-tree reformat with NO
  in-tree exclusions; do NOT force-format lockfiles"; Design Correction 1 and
  Correction 2.
- **Acceptance:**
  - After the reformat, `biome format --write .` makes no further edits (the
    reformat is idempotent).
  - `biome format .` (verify mode, no `--write`) reports no changes and exits
    zero.
  - Deliberately mis-formatting an in-scope file (e.g. removing parentheses
    spacing from a `.ts` file) makes `biome format .` exit non-zero (negative
    control); reverting restores exit zero.
  - The reformatted JS/TS/MJS files exhibit WordPress style: inner-spaced
    parentheses and brackets, single quotes, tab indentation, 80-column wrap
    target, spaced object braces, parenthesized arrow params, semicolons
    present, ES5 trailing commas (including on multiline imports, not on
    function params/args).
  - `docs/styles.css` retains double-quoted strings and tight parentheses
    (`rgb(0, 0, 0, 0.5)`); no JSON file is changed by the reformat.
  - `package-lock.json` and `testing-project/package-lock.json` are NOT changed
    by the reformat (no Biome diff applied to them); no in-tree exclusion was
    added to achieve this.
  - `.gitignore`d paths (`node_modules/`, `dist/`, `build/`, `coverage/`) are
    untouched.
  - Markdown (`.md`), YAML (`.yaml`/`.yml`), and HTML (`.html`) files are not
    reformatted by this task (HTML's only change is the Task 3 edit).
  - Behavior is preserved across the reformat: `npm run typecheck` exits zero;
    `npm test` passes with the same results as before the change;
    `npm --prefix testing-project run check:config` succeeds (the reformatted
    `testing-project/` config and its import graph still load); `npm ci` (root)
    installs successfully against the unchanged root lockfile with no
    resolved-version change beyond the Task 1 Biome bump; and
    `npm --prefix testing-project ci` installs successfully against the unchanged
    `testing-project/package-lock.json`.

### Task 5: Add a `none`-bump changeset and verify all guardrails

- **Goal:** Clear the repo's changeset gate (which mechanically fires because
  the change touches `src/**`, `bin/**`, and `package.json`) with a `none`-bump
  changeset, and confirm the full set of project guardrails passes on the final
  reformatted tree.
- **Files to change:**
  - A new `.changeset/<descriptive-name>.md` file (e.g.
    `.changeset/wordpress-coding-standards.md`).
- **Changes:**
  - Create a new changeset file with front matter declaring a `none` bump for
    the package and a non-empty body, following the precedent of
    `.changeset/initial-scaffolding.md`. The file must:
    - start with the front-matter fence `---` as its very first line;
    - contain the entry `"@automattic/skillsmith": none`;
    - have a non-empty body summarizing the change (adopt WordPress formatting
      via Biome 2.5.0 `delimiterSpacing`; config + mechanical reformat + a11y
      fix; no consumer-visible change / no version bump).
    Example shape:

    ```md
    ---
    "@automattic/skillsmith": none
    ---

    Adopt WordPress coding standards in Biome formatting: bump @biomejs/biome to
    2.5.0, express the WordPress style in biome.json (delimiterSpacing, single
    quotes, es5 trailing commas, tab width 4, 80-column wrap), reformat the tree,
    and fix one docs a11y lint finding. Build-time tooling only; no
    consumer-visible change.
    ```
  - This changeset file is itself a `.md` file, so Biome does not format it; it
    does not need to (and will not) be touched by the reformat.
- **Depends on:** Task 4 (the changeset and the full-guardrail verification run
  against the final reformatted tree). MUST be the last task.
- **Traces to:** Spec Req 7; Spec "Out of Scope (changeset mechanics)"; Spec
  acceptance "changeset gate passes" and the behavior/check-preservation
  criteria; Design "Approach" step 5, Design "Components → Modified (a new
  `.changeset/*.md`)", Design "Decision: Verify via existing `biome format .`;
  clear the gate with a `none`-bump changeset".
- **Acceptance:**
  - A new `.changeset/*.md` exists declaring `"@automattic/skillsmith": none`
    with a non-empty body and a leading `---` fence.
  - `npx tsx scripts/validate-changesets.ts` exits zero (the new changeset is
    valid: recognized `none` bump, correct package name, non-empty body).
  - `npx changeset status --since=origin/trunk` reports a changeset is present
    (the changeset gate is satisfied).
  - On the final tree, all project guardrails pass:
    - `npm run typecheck` exits zero;
    - `npm run lint` exits zero;
    - `npm test` passes with the same results as before the change;
    - `npm --prefix testing-project run check:config` exits zero;
    - `biome format .` (verify mode) exits zero (no diffs).
  - No new npm script (e.g. `format:check`) and no new CI workflow are added.
