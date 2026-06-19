# Design Doc: Adopt WordPress coding standards in Biome formatting

## Overview

skillsmith formats its code with Biome, but the current configuration (double
quotes, no delimiter spacing, no explicit line width or indent width) does not
match the WordPress JavaScript/TypeScript coding standard the project wants to
follow. That standard is codified in `@wordpress/prettier-config@4.48.1` — tabs
rendered at width 4, single quotes, an 80-column wrap target, ES5 trailing
commas, semicolons, always-parenthesized arrow parameters, and the headline
trait: spaces inside parentheses and brackets (`fn( a, b )`, `[ 1, 2 ]`). That
last trait historically required the `wp-prettier` fork; Biome 2.5.0's new
`delimiterSpacing` formatter option reproduces it with stock tooling, making a
faithful WordPress style achievable in skillsmith for the first time.

This change adopts the WordPress *formatting* standard (not its lint rules) by:
(1) upgrading the build-time devDependency `@biomejs/biome` from `2.4.12` to
exact `2.5.0`; (2) editing `biome.json` to express the full WordPress style as a
faithful mirror of `@wordpress/prettier-config@4.48.1` using stock Biome
(no `@wordpress/biome-config` package exists — verified June 2026); (3) running
`biome format --write .` once to bring the entire formattable tree (~89 files)
into compliance; (4) fixing one accessibility lint finding in `docs/index.html`
that the Biome upgrade newly raises, so `npm run lint` stays green; and (5)
recording a `none`-bump changeset to clear the repo's changeset gate. The change
introduces no runtime code, no new dependency beyond the Biome bump, and no new
CI workflow or npm script. Compliance is self-verifying through the
already-shipped `biome format .` (verify mode) and the existing typecheck, test,
lint, `check:config`, and `npm ci` checks.

## Spec corrections / resolution-of-record (AUTHORITATIVE)

The spec phase uncovered two clauses in `1-spec/spec.md` that conflict with how
stock Biome 2.5.0 actually behaves (both verified with live experiments). The
owner's decision is to **leave `1-spec/spec.md` unchanged** and make **this
design the authoritative resolution-of-record** on these two points. Downstream
phases (plan, code, docs) MUST follow the design here, not the superseded spec
clauses. A reviewer reading only `spec.md` would otherwise (a) expect a
reformatted lockfile that never appears, and (b) flag a correct multiline-import
trailing comma as a defect.

### Correction 1 — Lockfiles are outside Biome's formatting reach (corrects Req 5, Req 8, and their lockfile acceptance criteria)

Stock Biome hardcodes `package-lock.json`, `testing-project/package-lock.json`
(and `npm-shrinkwrap.json`, `yarn.lock`, `composer.lock`) as **protected files**:
it never formats them, emits no diagnostics for them, and this cannot be
overridden by any config option or CLI flag (verified; `files.includes` does not
un-protect them; biomejs/biome #1668, #6764). Protected-file behavior is Biome's
own default, **independent of `.gitignore`** (the lockfiles are not git-ignored).

Consequences:

- The lockfiles are **not reformatted** to WordPress style. This is **not** an
  in-tree exclusion that skillsmith introduces — it is Biome's own default,
  exactly like `.gitignore`d paths. The spec's "no in-tree exclusions spare
  them" principle is **preserved** (skillsmith adds no exclusion); only the
  claim that the lockfiles *are reformatted* is corrected.
- The "reformatted `package-lock.json` remains install-equivalent" claim (Req 8
  and its acceptance criterion) is **dropped as moot** — the file is never
  reformatted, so there is nothing to prove install-equivalent about a reformat.
- **Kept guarantee:** `npm ci` (root and `testing-project/`) resolves and
  installs successfully against the **unchanged** lockfiles with no change to
  resolved dependency versions (verified passing). The only lockfile change in
  this work is npm's own refresh of the `@biomejs/biome` devDependency version,
  not a Biome reformat.

### Correction 2 — Multiline imports DO get an `es5` trailing comma (corrects Req 1 wording)

Faithful WordPress `es5` (both Biome `trailingCommas: "es5"` and the source of
truth, stock Prettier `trailingComma: "es5"`) adds a trailing comma to a
**multiline** import:

```ts
import {
	thingA,
	thingB,
	thingC, // trailing comma present
} from 'mod';
```

The output is byte-identical between Biome `es5` and Prettier `es5`. The spec's
"trailing commas ... not in ... imports" wording is inaccurate for `es5`; no
`es5` variant omits import trailing commas without also stripping array/object
commas (`none` would strip all of them). Single-line imports that fit on one
line get no trailing comma — the comma appears only when the construct breaks
across lines. The design's config follows WordPress: trailing comma present on
multiline imports.

**`1-spec/spec.md` is intentionally left unchanged per the owner's decision;
this design is authoritative on the two points above.**

## Approach

This is a **configuration + mechanical-reformat** change. There is no runtime
feature and no new code path. The implementer's mental model is a five-step
sequence, each step independently observable:

1. **Bump the toolchain.** Set `@biomejs/biome` to exact `2.5.0` in
   `package.json` devDependencies and let npm refresh the root
   `package-lock.json` for that one dep (and its platform-specific optional
   deps). `delimiterSpacing` and its per-language overrides exist only in Biome
   ≥ 2.5.0; 2.4.12 rejects the key. 2.5.0 is the only published 2.5.x as of
   June 2026.

2. **Rewrite the formatter config.** Edit `biome.json` to the decided Config B:
   re-pin `$schema` to 2.5.0, add the four load-bearing formatter keys plus the
   redundant-but-explicit WordPress keys, and leave JSON/CSS at Biome defaults
   (which already match WordPress). The `linter`, `assist`, `vcs`, and `files`
   blocks are untouched. See "Interfaces and Data Flow" for the exact file.

3. **Reformat the tree.** Run `biome format --write .` once. Stock Biome,
   respecting `.gitignore` and its protected-file list, reformats ~89 tracked,
   non-ignored, formattable files into WordPress style. The reformat is purely
   mechanical (whitespace, indentation, quote characters, trailing-comma tokens,
   delimiter spacing) and preserves program/data semantics. It is idempotent: a
   second run makes no edits.

4. **Resolve the a11y lint finding.** The Biome bump newly raises
   `lint/a11y/useAriaPropsSupportedByRole` on `docs/index.html:83` (the rule's
   HTML support is new in 2.5.0), which would flip `npm run lint` from exit 0 to
   exit 1. Add `role="img"` to that one `<div>` so the lint run exits zero again.
   This is a hand edit to HTML, which Biome does not format, so it is not part of
   the reformat and trips no other rule.

5. **Clear the changeset gate.** The PR touches `src/**`, `bin/**`, and
   `package.json`, so `changeset-gate.yml` mechanically requires a changeset.
   Add a `none`-bump changeset (the work warrants no version bump — it is
   format/lint config plus a behavior-equivalent build-time devDependency bump).

After these steps the change is **self-verifying**: `biome format .` (verify
mode, no `--write`) exits 0 because the committed tree already complies, and
`npm run typecheck`, `npm test`, `npm run lint`,
`npm --prefix testing-project run check:config`, and `npm ci` all pass.

## Components

### Modified

- **`biome.json`** — the heart of the change. Adds the four load-bearing
  formatter keys and the redundant-but-explicit WordPress keys, and re-pins
  `$schema` to 2.5.0. The `formatter` and `javascript.formatter` blocks change;
  no JSON or CSS formatter block is added (defaults are already faithful). The
  `linter`, `assist`, `vcs`, and `files` blocks are **not** touched.

- **`package.json`** — devDependency bump only: `@biomejs/biome` from `2.4.12`
  to exact `2.5.0`. No script changes, no new dependency.

- **`package-lock.json` (root)** — npm-refreshed for the new Biome version.
  The only resolved-version delta is `@biomejs/biome` and its platform-specific
  optional deps. This file is **npm-refreshed, not Biome-reformatted** — it is a
  protected file (see Correction 1). The code phase must regenerate it
  deliberately (a targeted update) and confirm `npm ci` reports no
  resolved-version change beyond Biome.

- **The ~89 formattable source files** — mechanically reformatted by
  `biome format --write .`. Verified real blast radius (real-tree dry-run, Biome
  2.5.0, Config B): "Formatted 95 files, Fixed 89." The 89 changed files break
  down as 74 `.ts`, 14 `.mjs`, 1 `.css` (`docs/styles.css`), and **zero** JSON.
  By directory: `src/**` ×68, `testing-project/**` ×17, `bin/skillsmith.mjs` ×1,
  `docs/styles.css` ×1, `examples/skillsmith.config.ts` ×1,
  `scripts/validate-changesets.ts` ×1. The quote flip (double → single) alone
  touches nearly every `.ts`/`.mjs`, which is why the count is high.

- **`docs/index.html`** — one-attribute a11y edit: add `role="img"` to line 83
  so the node reads
  `<div class="visual" role="img" aria-label="Skillsmith run preview">`.

- **A new `.changeset/*.md`** — a `none`-bump entry to clear the changeset gate.

### Untouched but relevant

- **The `linter` block in `biome.json`** stays exactly as-is
  (`rules.recommended: true`). Req 9 is satisfied in the HTML, not in config.
- **`assist.actions.source.organizeImports`, `vcs`, `files`** blocks unchanged.
- **Tracked JSON files** (`package.json` content layout, `tsconfig.json`,
  `.changeset/config.json`, and `testing-project` equivalents) are already
  Biome-compliant and unchanged by the reformat (zero JSON files in the blast
  radius).
- **`testing-project/package-lock.json`** — protected file, never formatted,
  unchanged.
- **`.md`, `.yaml`/`.yml`, `.html` formatting** — outside Biome's formatter, not
  reformatted (HTML remains lintable, hence the `docs/index.html` lint edit).
- **`.gitignore`d paths** (`node_modules/`, `dist/`, `build/`, `coverage/`,
  etc.) — untouched; Biome honors `.gitignore` (`vcs.useIgnoreFile: true`).

## Interfaces and Data Flow

The only public "interface" this change defines is the `biome.json`
configuration. There are no APIs, message shapes, or function signatures.

### Target `biome.json` (Config B — load-bearing)

This is the exact configuration to write. Comments below the block annotate
which keys are load-bearing versus redundant-but-explicit; the committed JSON
itself contains no comments (Biome's JSON parser is standard JSON here).

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

#### Load-bearing keys (differ from Biome defaults — these four carry the behavior)

- **`javascript.formatter.quoteStyle: "single"`** — Biome default is `double`;
  WordPress requires single quotes. (Drives the largest part of the reformat.)
- **`javascript.formatter.trailingCommas: "es5"`** — Biome's enum is
  `{all, es5, none}`, default `all`. `all` would wrongly add trailing commas to
  function parameters and arguments; `es5` matches WordPress (arrays and object
  literals get them; function params/args do not; **multiline imports DO** — see
  Correction 2).
- **`formatter.indentWidth: 4`** — Biome default is 2. This is load-bearing for
  **wrap fidelity**, not just rendering: indent width determines how a tab
  counts toward the 80-column wrap limit, so it changes *wrap decisions*.
  Prettier's `tabWidth: 4` wraps identically.
- **`javascript.formatter.delimiterSpacing: true`** — Biome default is `false`;
  this is the headline WordPress trait (spaces inside parentheses and array
  brackets: `fn( a, b )`, `[ 1, 2 ]`). Scoped to `javascript.formatter` so it
  applies to `.ts`/`.js`/`.mjs` only.

#### Redundant-but-explicit keys (already Biome's default; kept as a self-documenting WordPress mirror)

- **`formatter.indentStyle: "tab"`** — already Biome default in this repo's
  config; kept explicit.
- **`formatter.lineWidth: 80`** — Biome's default is already 80; kept explicit
  to mirror WordPress `printWidth: 80`.
- **`javascript.formatter.semicolons: "always"`** — already default; mirrors
  WordPress `semi: true`.
- **`javascript.formatter.arrowParentheses: "always"`** — already default;
  mirrors WordPress `arrowParens: "always"`. (Note: the Biome key is
  `arrowParentheses`, not Prettier's `arrowParens`.)

These four are kept so the config reads as a complete, self-documenting mirror
of `@wordpress/prettier-config` rather than relying on undocumented Biome
defaults. This is a faithfulness/legibility choice, not a behavioral one —
removing them would produce byte-identical output.

#### Keys deliberately NOT added

- **No `json.formatter` block.** Biome's JSON default already matches
  WordPress's Prettier-for-JSON output: object braces spaced (`{ "a": 1 }`),
  array brackets tight (`[1, 2, 3]`), tab indentation. Because
  `delimiterSpacing` is scoped to `javascript.formatter`, JSON never inherits a
  global ON, so no `json.formatter.delimiterSpacing: false` override is needed.
- **No `css.formatter` block.** Biome's CSS default already matches WordPress:
  tight parentheses (`rgb(0, 0, 0, 0.5)`) and double quotes. No
  `css.formatter.delimiterSpacing: false` or `quoteStyle: "double"` override is
  needed for the same reason.
- **`javascript.formatter.bracketSpacing`** is left at its default `true`
  (object braces `{ a: 1 }`). It is a **separate** setting from
  `delimiterSpacing` and already faithful, so it is not set explicitly.

### Data flow

```
package.json (@biomejs/biome 2.5.0)
        │  npm install / ci
        ▼
node_modules/.bin/biome  ──reads──▶  biome.json (Config B)
        │
        ├── biome format --write .   ──▶  ~89 source files reformatted (in-scope)
        │                                  · honors .gitignore (vcs.useIgnoreFile)
        │                                  · skips protected lockfiles (hardcoded)
        │
        ├── biome format .  (verify) ──▶  exit 0 when tree complies; non-zero + diff otherwise
        │
        └── biome lint .             ──▶  exit 0 after docs/index.html role="img" edit
```

The formatter never touches the two `package-lock.json` files (protected) or
`.md`/`.yaml`/`.html` files (outside the formatter). The linter still inspects
`docs/index.html` and `docs/styles.css`, which is why the a11y fix lives in HTML
rather than in a linter-config exclusion.

## Key Decisions

### Decision: Config B (JS-scoped delimiter spacing), not Config A (global + overrides)

- **Choice:** Set `delimiterSpacing: true` on `javascript.formatter` only, and
  leave JSON and CSS at their already-faithful Biome defaults (no override
  blocks). Add the four load-bearing keys and keep the redundant-but-explicit
  WordPress keys.
- **Alternatives:** *Config A* sets `formatter.delimiterSpacing: true` globally
  and then carves out `json.formatter.delimiterSpacing: false` and
  `css.formatter.delimiterSpacing: false`. Both configs were verified to produce
  byte-identical TS/JSON/CSS output.
- **Trade-offs:** Config A makes the JSON/CSS exemption visually explicit but
  adds two overrides whose only job is to undo a global ON that Config B never
  sets — more surface, more to drift, and arguably misleading (it reads as "turn
  spacing on everywhere, then carve out exceptions" when those exceptions equal
  the defaults). Config B is minimal and states only what differs from Biome
  defaults, but a future reader must know that JSON/CSS defaults already match
  WordPress to understand why no override is needed (documented above and here).
- **Traces to:** Requirements 1, 2, 3, 6; acceptance criteria "Formatter output
  (WordPress style)" and "Toolchain and configuration."

### Decision: Pin `@biomejs/biome` to exact `2.5.0`

- **Choice:** Pin to exact `2.5.0` (no caret), matching the repo's existing
  exact-pin style for this dependency (currently exact `2.4.12`).
- **Alternatives:** A caret range (`^2.5.0`) or a `>=2.5.0` floor.
- **Trade-offs:** An exact pin avoids a caret floating onto an untested future
  2.5.x; 2.5.0 is the only published 2.5.x as of June 2026, so a range buys
  nothing today and risks silent drift. The cost is a manual bump when the repo
  later wants a newer Biome — consistent with how the repo already manages this
  dep.
- **Traces to:** Requirement 6; acceptance criterion "version ≥ 2.5.0."

### Decision: Re-pin `$schema` to 2.5.0; do NOT migrate `linter.rules.recommended`

- **Choice:** Set `$schema` to
  `https://biomejs.dev/schemas/2.5.0/schema.json`. Keep
  `linter.rules.recommended: true` exactly as-is.
- **Alternatives:** Migrate `recommended: true` to the new `preset` form that
  2.5.0 nudges toward.
- **Trade-offs:** Re-pinning the schema eliminates the version-mismatch warning
  (an acceptance criterion). The `recommended` key is **deprecated** in 2.5.0,
  but the deprecation is **INFO-level only** ("Use preset instead") and does
  **not** change the exit code — verified: `biome lint .` exits 0 with it
  present. The config still validates with no unknown-key error. Migrating now
  would touch the linter block, which the spec wants left as-is apart from what
  Req 9 needs (Req 9 needs nothing here — it is satisfied in HTML). Leaving it is
  the minimal, spec-aligned choice; migrating to `preset` is a small mechanical
  follow-up deferred to a future change (see Risks/Open Questions).
- **Traces to:** Requirement 6 (config validates with no unknown-key error and
  no `$schema` mismatch); Out-of-Scope (linter block stays as-is).

### Decision: Whole-tree reformat with NO in-tree exclusions; do NOT force-format lockfiles

- **Choice:** Run stock Biome 2.5.0 over the whole tree with Config B, adding no
  `files.includes`/`ignore` exclusions. Accept that Biome's protected-file
  default leaves `package-lock.json` and `testing-project/package-lock.json`
  unchanged. Do not force-format lockfiles via any off-tool mechanism.
- **Alternatives:** Force-format the lockfiles outside Biome (e.g. temp-rename
  to a non-protected name, or `--stdin-file-path`). This was proven achievable
  and install-safe (a Biome-formatted lockfile is pure whitespace change, no key
  reordering, and `npm ci` tolerates it).
- **Trade-offs:** Forcing introduces a new non-Biome mechanism the spec's "stock
  Biome ≥ 2.5.0, no wp-prettier fork" constraint does not contemplate, and the
  forced result would still be **unverifiable** by `biome format .` (Biome
  re-protects the file on every run), so the lockfile would drift silently —
  directly against Requirement 7's "verifiable, not merely available." Accepting
  the protected-file default is zero-effort, stock-Biome-faithful, and preserves
  the spec's "no in-tree exclusions skillsmith adds" intent (the exclusion is
  Biome's, not skillsmith's). The kept guarantee is `npm ci` install-equivalence
  against the unchanged lockfiles.
- **Traces to:** Requirements 4, 5, 7, 8; Correction 1; acceptance criteria
  "Tree compliance and verification," the lockfile/`npm ci` criterion, and the
  `.gitignore`d-paths criterion.

### Decision: Fix the a11y finding with `role="img"` in HTML

- **Choice:** Add `role="img"` to `docs/index.html:83` →
  `<div class="visual" role="img" aria-label="Skillsmith run preview">`.
- **Alternatives (all verified to make `npm run lint` exit 0):**
  - *(2b) Inline `biome-ignore` suppression* on the line.
  - *(2a) Turn the rule off* in `linter.rules.a11y`.
  - *(3a) Exclude `docs/**` from linting* via `linter.includes`.
- **Trade-offs:** `role="img"` is the only single-attribute HTML fix that passes
  both `useAriaPropsSupportedByRole` AND `useSemanticElements` (`img` is a valid
  role that supports `aria-label` as its accessible name, and is permanently
  exempt from `useSemanticElements` per Biome docs, so it is not version-fragile).
  It needs zero linter-config changes and actually corrects the ARIA defect
  while preserving the decorative-preview label. The alternatives are worse:
  *2b* leaves the HTML technically invalid (consciously suppressed); *2a* edits
  the linter block (against "stays as-is") and loosens a recommended a11y rule
  repo-wide; *3a* is broadest — it silently also stops linting `docs/styles.css`
  (proven: an injected CSS error went uncaught once `docs/**` was excluded),
  weakening CSS linting this very feature relies on. **Fallback ranking if the
  HTML could not be edited:** 2b inline-suppress > 2a rule-off > 3a exclude-docs
  (3a worst).
- **Traces to:** Requirement 9; acceptance criterion "`npm run lint` exits zero."

### Decision: Verify via existing `biome format .`; clear the gate with a `none`-bump changeset

- **Choice:** Use the already-shipped `biome format .` (no `--write`) as the
  compliance check — no new npm script and no new CI workflow. Add a `none`-bump
  changeset to satisfy `changeset-gate.yml`.
- **Alternatives:** Add a `format:check` npm script and/or a new PR-gating CI
  workflow; use a real version bump instead of `none`.
- **Trade-offs:** Reusing `biome format .` adds no enforcement surface and meets
  Requirement 7 (verifiable, no new artifact required); a `format:check` script
  is explicitly optional convenience the implementer *may* add but is not a
  design requirement. A new gating workflow is explicitly out of scope. The work
  warrants no version bump (format/lint config + behavior-equivalent build-time
  devDependency), so a `none`-bump changeset clears the gate without a spurious
  release (precedent: `.changeset/initial-scaffolding.md`). Exact changeset
  wording is a later-phase landing detail; the design fixes only the bump type
  (`none`).
- **Traces to:** Requirement 7; Out-of-Scope (no new gating workflow; changeset
  mechanics deferred); acceptance criteria "verify mode" and "changeset gate
  passes."

## Dependencies

- **`@biomejs/biome`: `2.4.12` → exact `2.5.0`** — the only dependency change. A
  **build-time-only devDependency**; it is not shipped to consumers, so the
  published-package surface is unaffected. `delimiterSpacing` and its
  per-language overrides require Biome ≥ 2.5.0.
- **No new dependencies.** Notably, there is **no `@wordpress/biome-config`**
  package to depend on (verified June 2026); the WordPress standard is expressed
  directly in `biome.json`.
- **No new runtime dependencies and no new external services.**
- **Internal touchpoints exercised by the existing checks:** `tsc`
  (`npm run typecheck`), the test runner (`npm test`),
  `testing-project`'s `check:config` script, and `npm ci`. None change; they are
  the behavior-preservation harness.

## Failure Modes and Observability

This is build-time tooling. No new logging or telemetry is introduced or
warranted. Failures surface through tools that already ship in the repo:

- **Non-compliant formatting.** `biome format .` (verify mode, no `--write`)
  exits non-zero and prints per-file diffs on any unformatted file — the primary
  observable signal of non-compliance. The negative control is verified: removing
  parentheses spacing from a `.ts` file makes verify mode exit 1.
- **Config validation.** A wrong `$schema` pin surfaces as a version-mismatch
  warning; an unknown key surfaces as a load-time error. Both are caught when
  Biome loads the config. Config B (with `$schema` pinned to the installed
  2.5.0) was verified to load with exit 0, no unknown-key error, and no mismatch
  warning. The `recommended` deprecation is info-level only and does not affect
  exit codes.
- **Behavior regressions.** Caught by the existing checks: `npm run typecheck`
  (exit 0 verified), `npm test` (exit 0 verified — 150 tests, 148 pass, 2
  pre-existing skips, 0 fail), `npm run lint` (exit 0 after the `role="img"`
  edit — verified), and `npm --prefix testing-project run check:config` (exit 0
  verified — confirms the reformatted `testing-project/` config and its full
  import graph still load).
- **Lockfile integrity.** `npm ci` failing or rewriting a lockfile would signal
  a lockfile problem. Verified not to occur: root `npm ci` exits 0 with the
  lockfile not rewritten, and `npm --prefix testing-project ci` exits 0. The
  reformatted tree changes zero lockfile content (protected files).
- **Reformat idempotence.** After `biome format --write .`, a verify-mode re-run
  exits 0 — verified — confirming the reformat is stable and converges.

## Risks and Open Questions

### Risks

- **Downstream phases could test the superseded spec clauses literally.** The
  two corrected clauses (lockfiles reformatted; no trailing comma on imports)
  still appear verbatim in `1-spec/spec.md`, which the owner left unchanged.
  *Mitigation:* the "Spec corrections / resolution-of-record" section above is
  authoritative; plan, code, and doc phases must follow this design on both
  points. A reviewer reading only `spec.md` would otherwise expect a reformatted
  lockfile that never appears and flag a correct multiline-import trailing comma
  as a defect.
- **Lockfiles will silently not be in WordPress style.** Even after this work,
  both `package-lock.json` files stay in npm's format (npm 7+ default is
  tab-indented, so close but not identical to Biome's JSON output). This is by
  Biome's design, invisible to `biome format .`, and expected — downstream
  readers should not treat the un-Biome-formatted lockfiles as a compliance gap.
- **Lockfile version delta from the Biome bump must stay scoped.** Refreshing
  the root `package-lock.json` for `@biomejs/biome` 2.5.0 should change only that
  dep and its platform-specific optional deps. If npm pulls unrelated updates,
  that would exceed the intended scope. *Mitigation:* the code phase should
  regenerate the lockfile deliberately (targeted update) and confirm `npm ci`
  reports no resolved-version change beyond Biome.

### Open Questions (none blocking)

- **`linter.rules.recommended` is deprecated in 2.5.0 (deferred).** This design
  keeps `recommended: true` (the deprecation is info-level, non-fatal, and
  migrating is out of scope for Req 9). A future Biome major could remove
  `recommended`; migrating to the `preset` form is a small mechanical follow-up
  the repo can make whenever it chooses — out of scope for this change.
