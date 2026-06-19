# Design Research: Adopt WordPress coding standards in Biome formatting

This document is the running record of the design-doc phase. The spec
(`1-spec/spec.md`) is the contract; this design decides *how* to realize it.
Much of the load-bearing technical fact-finding was already done and verified
with live Biome 2.5.0 experiments during the spec phase
(`1-spec/spec-research.md`) — those findings are treated as established
evidence and re-confirmed only where a concrete config shape or mechanism is
still open.

## Spec corrections / resolution-of-record

The spec phase uncovered two clauses in `1-spec/spec.md` that conflict with how
stock Biome 2.5.0 actually behaves (both verified — see Research). The owner's
decision is to **leave `1-spec/spec.md` unchanged** and make **this design the
authoritative resolution-of-record** on these specific points. Downstream phases
(plan, code, docs) follow the design here, not the superseded spec clauses. This
section must be carried into `design-doc.md`.

1. **Lockfiles are outside Biome's formatting reach (corrects Req 5, Req 8, and
   their lockfile acceptance criteria).** Stock Biome hardcodes `package-lock.json`,
   `testing-project/package-lock.json` (and `npm-shrinkwrap.json`, `yarn.lock`,
   `composer.lock`) as PROTECTED files: it never formats them and emits no
   diagnostics for them, and this cannot be overridden by any config option or CLI
   flag (verified; biomejs/biome #1668, #6764). Therefore:
   - The lockfiles are **not reformatted** to WordPress style — and this is **not**
     an in-tree exclusion skillsmith introduces; it is Biome's own default, exactly
     like `.gitignore`d paths. The spec's "no in-tree exclusions spare them"
     principle is **preserved** (skillsmith adds no exclusion); only the claim that
     the lockfiles *are reformatted* is corrected.
   - The "reformatted package-lock.json remains install-equivalent" claim (Req 8 +
     criterion) is dropped as moot.
   - **Kept guarantee:** `npm ci` (root and `testing-project/`) resolves and installs
     successfully against the **unchanged** lockfiles with no change to resolved
     dependency versions (verified passing). The only lockfile change in this work
     is npm's own refresh of the `@biomejs/biome` devDependency version, not a Biome
     reformat.
2. **Multiline imports get an es5 trailing comma (corrects Req 1 wording).**
   Faithful WordPress `es5` (both Biome `trailingCommas:"es5"` and stock Prettier
   `trailingComma:"es5"`, the source of truth) adds a trailing comma to a multiline
   import. The spec's "trailing commas ... not in ... imports" wording is inaccurate.
   The design's config follows WordPress (trailing comma present on multiline
   imports; single-line imports that fit get none). No `es5` variant omits import
   trailing commas without also stripping array/object commas, so this is the only
   faithful behavior.

`1-spec/spec.md` is intentionally left unchanged per the owner's decision; **this
design is authoritative on the two points above.**

## Research

<!-- Non-trivial findings from the design-doc-researcher, with sources cited. -->

### Established evidence carried in from the spec phase

From `1-spec/spec-research.md` (verified there via live Biome 2.5.0 / Prettier
3.8.4 / `@wordpress/prettier-config@4.48.1` experiments):

- **WordPress JS/TS style = `@wordpress/prettier-config@4.48.1`:** `useTabs:true`,
  `tabWidth:4`, `printWidth:80`, `singleQuote:true`, `trailingComma:'es5'`,
  `bracketSameLine:false`, `bracketSpacing:true`, `semi:true`,
  `arrowParens:'always'`. Only the wp-prettier-fork setting `parenSpacing`
  (true for JS, false for CSS) produces spaces-inside-parens/brackets;
  Biome's `delimiterSpacing` is its stock equivalent.
- **Biome formats only `.ts/.js/.mjs/.json/.css` in this repo.** `.html/.md/.yaml`
  are outside the formatter (HTML still lintable).
- **`delimiterSpacing` is global; JSON and CSS inherit it.** Faithful WordPress
  output requires per-language overrides: ON for JS/TS/MJS, OFF for JSON
  (arrays would otherwise get inner spaces) and OFF for CSS (parens would
  otherwise get inner spaces). Measured: `json.formatter.delimiterSpacing:false`
  → `{ "b": [1, 2, 3] }`; `css.formatter.delimiterSpacing:false` → `rgb(0,0,0,0.5)`.
- **`delimiterSpacing` was added in Biome 2.5.0;** 2.4.12 rejects the key.
  2.5.0 is the only published 2.5.x as of June 2026.
- **Bump side effects (verified against the unchanged repo):**
  (a) new lint error `lint/a11y/useAriaPropsSupportedByRole` at
  `docs/index.html:83` flips `npm run lint` to exit 1;
  (b) `linter.rules.recommended` is deprecated in 2.5.0 (info-level, "use preset");
  (c) `$schema` mismatch info, resolved by re-pinning.
- **Reformat blast radius ~21 files;** mechanical, no behavioral change.
- **Changeset gate fires** because the PR touches `src/**`, `bin/**`,
  `package.json`; resolution is a `none`-bump changeset
  (precedent `.changeset/initial-scaffolding.md`).

### Biome 2.5.0 config behavior (live experiments, researcher)

Sandbox: Biome 2.5.0; cross-checked against Prettier 3.8.4 +
`@wordpress/prettier-config@4.48.1`.

- **`delimiterSpacing` exists both globally (`formatter.delimiterSpacing`) and
  per-language** (`javascript`/`json`/`css`.`formatter.delimiterSpacing`).
  Default `false` everywhere.
- **Two faithful config shapes produce byte-identical TS/JSON/CSS output:**
  - *Config A (spec's model):* global `formatter.delimiterSpacing:true` + JSON OFF
    + CSS OFF overrides.
  - *Config B (minimal):* only `javascript.formatter.delimiterSpacing:true`; JSON
    and CSS left at defaults (no override).
  Both faithful; B carries less surface (two fewer redundant overrides that exist
  only to neutralize a global ON that B never turns on).
- **JSON default already matches WordPress:** object braces spaced
  `{ "x": 10 }`, arrays tight `[1, 2, 3]`, tab indent.
- **CSS default already matches WordPress:** tight parens `rgb(0, 0, 0, 0.5)`,
  double quotes.
- **Per-setting required vs. redundant** (measured against bare-default output):
  - *Required (differs from Biome default):*
    `javascript.formatter.quoteStyle:"single"` (default `double`);
    `javascript.formatter.trailingCommas:"es5"` (Biome enum `{all,es5,none}`,
    default `all` — `all` wrongly commas function params/args);
    `formatter.indentWidth:4` (default 2 — affects how a tab counts toward the
    80-col wrap limit, so it changes *wrap decisions*, not just rendering;
    Prettier `tabWidth:4` wraps identically);
    `javascript.formatter.delimiterSpacing:true` (default false — the headline trait).
  - *Redundant-but-explicit (already Biome default):* `formatter.indentStyle:"tab"`;
    `formatter.lineWidth:80` (Biome default is 80);
    `javascript.formatter.semicolons:"always"`;
    `javascript.formatter.arrowParentheses:"always"` (note: key is
    `arrowParentheses`, not `arrowParens`);
    `javascript.formatter.bracketSpacing` (object braces `{ a: 1 }`; default true;
    SEPARATE from `delimiterSpacing`); `css.formatter.quoteStyle:"double"`.
  - Net: only **4 keys are load-bearing**; everything else WordPress wants is
    already Biome's default.
- **Validated candidate (Config B)** loads exit 0, no unknown-key error, no
  `$schema`-mismatch warning (schema pinned to 2.5.0 = installed). Proof output
  confirmed every acceptance trait: TS `fn( 1, 2 )`, `[ 1, 2 ]`, `{ a: 1 }`,
  single quotes, tabs, multiline array/object trailing comma present, multiline
  params/args trailing comma absent; JSON `{ "x": 10 }` + `[1, 2, 3]`; CSS
  `rgb(0, 0, 0, 0.5)` + double quotes. Idempotent on re-run; negative control
  (remove parens spacing) → verify exit 1.

### Spec discrepancy: trailing commas on multiline imports (researcher, verified)

Spec Requirement 1 and the acceptance criteria list imports among the constructs
that get **no** trailing comma. **This is factually wrong for `es5`.** Both Biome
`trailingCommas:"es5"` and stock Prettier `trailingComma:"es5"` (the WordPress
source of truth) add a trailing comma to a **multiline** import:
```
import {
    ...,
    somethingLong5x,   // trailing comma present
} from 'mod';
```
Byte-identical between Biome es5 and Prettier es5 on the same snippet. There is no
`es5` variant that omits import trailing commas (`none` would also strip
array/object commas). Single-line imports that fit get none (the comma is only
added when the construct breaks across lines). The faithful WordPress config (es5)
therefore puts trailing commas on multiline imports; the spec wording is the error,
not the config. Handling: see Open Questions and the Topic decision below.

### Real-tree dry-run of Config B (Biome 2.5.0, researcher)

Throwaway copy of the repo, git-baselined, Config B + Biome 2.5.0 installed.

- **Real blast radius:** `biome format --write .` → "Formatted 95 files, Fixed 89."
  89 distinct files change: 74 `.ts`, 14 `.mjs`, 1 `.css` (`docs/styles.css`);
  ZERO `.json`. By dir: `src/**` ×68, `testing-project/**` ×17, `bin` ×1,
  `docs` ×1, `examples` ×1, `scripts` ×1. Tracked JSON (`package.json`,
  `tsconfig.json`, `.changeset/config.json`, testing-project equivalents) already
  compliant → unchanged. `.gitignore`d paths untouched. Idempotent: verify-mode
  re-run after `--write` → exit 0. (The spec-research "~21 files" estimate was low;
  the quote flip alone touches nearly every `.ts`/`.mjs`, hence 89.)
- **Behavior preservation on the reformatted tree:** `npm run typecheck` exit 0;
  `npm test` exit 0 (150 tests, 148 pass, 2 pre-existing skips, 0 fail);
  `npm --prefix testing-project ci` exit 0; `npm --prefix testing-project run
  check:config` exit 0; root `npm ci` exit 0 (lockfile not rewritten). All
  behavior-preservation acceptance criteria hold against this exact config.
- **Req 9 confirmed on the real reformatted tree:** `npm run lint` → exit 1 at
  `docs/index.html:83:5 lint/a11y/useAriaPropsSupportedByRole`. Independent of the
  formatting work; still needs resolution. `linter.rules.recommended:true` also
  emits a 2.5.0 deprecation info ("use preset instead") — non-blocking.

### ⚠ Lockfiles are PROTECTED FILES — Biome refuses to format them (researcher, verified)

**Hard spec-vs-reality conflict.** Biome treats `package-lock.json`,
`npm-shrinkwrap.json`, `yarn.lock`, `composer.lock` as **protected files** by a
hardcoded internal default and will never format them or emit diagnostics for them.
This is **not** driven by `.gitignore` (neither lockfile is git-ignored).

Evidence:
- `biome format package-lock.json` → "Checked 0 files... These paths were provided
  but ignored: package-lock.json." Same for `testing-project/package-lock.json`.
- Biome docs (biomejs.dev/guides/configure-biome/): protected files are always
  ignored; no diagnostics ever emitted. List: `composer.lock`,
  `npm-shrinkwrap.json`, `package-lock.json`, `yarn.lock`.
- **Cannot be overridden:** `files.includes:["**","package-lock.json"]` still
  ignores it; the config reference documents no un-protect option and no CLI flag.
  Community issues (biomejs/biome #1668, #6764) confirm protected files resist
  override.
- Real-tree verify: 89 files change, ZERO of them JSON/lockfiles. After
  `biome format --write .`, `git diff` on both lockfiles is EMPTY.

**The underlying safety claim is sound, if forcing were pursued:** copied
`package-lock.json` to a non-protected name, ran Biome's JSON formatter (388 changed
lines — pure whitespace + collapsing short arrays onto one line; NO key reordering,
NO semantic change), swapped it back, ran `npm ci` → exit 0, npm did NOT rewrite it.
So a Biome-formatted lockfile *would be* install-equivalent and npm-tolerated — the
blocker is purely that stock Biome won't emit it. The lockfiles are also already
tab-indented (npm 7+ default), so already close to repo style.

**Spec impact:**
- **Requirement 5** ("package-lock.json ... are reformatted ... no in-tree
  exclusions spare them") — stock Biome NEVER reformats them; they're spared by
  Biome's OWN protected-file default, not by any exclusion skillsmith adds.
  Unachievable as written.
- **Requirement 8** + acceptance criterion ("a reformatted package-lock.json
  remains a valid, install-equivalent lockfile") — moot; it never gets reformatted.
- Acceptance criterion "package-lock.json ... are reformatted (no in-tree exclusions
  spare them)" — fails as a literal test.

**Reconciliation options (surfaced by researcher; decision below):**
- *(a) Accept Biome's protected-file behavior, amend the spec:* lockfiles are
  outside Biome's formatting reach because the tool protects them by default (not an
  in-tree exclusion we add). Zero-effort, stock-Biome-faithful, consistent with the
  spec's own "no wp-prettier fork / stock Biome over the tree" constraint.
- *(b) Force-format lockfiles outside Biome* (temp-rename or `--stdin-file-path`):
  achievable and proven install-safe, but a NEW mechanism beyond "stock Biome over
  the tree," and Biome verify-mode would STILL never check them, so they'd drift
  silently and be unverifiable. Advised against.

### a11y fix options for `docs/index.html:83` (Biome 2.5.0, researcher, verified)

Baseline reproduced: Config B at 2.5.0 exits 1 on `docs/index.html:83
lint/a11y/useAriaPropsSupportedByRole` (the rule's HTML support is new in v2.5.0 —
why the bump trips it). `npm run lint` = `biome lint .`. All four options verified
in a throwaway sandbox:

- **(1a) `role="img"`** → `<div class="visual" role="img" aria-label="Skillsmith
  run preview">`: **exit 0**, does NOT trip `useSemanticElements` or any other rule.
  Official Biome docs confirm `role="img"` is permanently exempt from
  `useSemanticElements` ("All elements with role=img are ignored") → not
  version-fragile. `img` is a valid named role that supports `aria-label` as its
  accessible name → fixes the defect for real and preserves the decorative-preview
  label. **The only single-attribute HTML fix that passes both rules.**
  (`role="figure"/"group"/"region"` FAIL — trip `useSemanticElements`;
  `role="presentation"` passes but is semantically wrong alongside `aria-label`.)
- **(2b) Inline suppression** — `<!-- biome-ignore
  lint/a11y/useAriaPropsSupportedByRole: <reason> -->` above line 83: **exit 0**.
  Node-scoped, leaves biome.json untouched, but the HTML stays technically invalid
  (consciously suppressed).
- **(2a) Rule off** — `linter.rules.a11y.useAriaPropsSupportedByRole:"off"`:
  **exit 0**. Edits the linter block (spec wants it untouched) and loosens a
  recommended a11y rule repo-wide; small blast radius today (1 HTML file, no
  JSX/React) but future HTML/JSX silently lose the check.
- **(3a) Exclude docs** — `linter.includes:["**","!docs/**"]`: **exit 0** ("Checked
  2 files", down from 4). **Also silently stops linting `docs/styles.css`** —
  PROVEN by injecting a real `noDuplicateProperties` CSS error: caught (exit 1)
  under Config B, NOT caught once `docs/**` excluded. Broadest collateral.
- **`recommended:true` deprecation:** CONFIRMED INFO-level only ("Use preset
  instead"); present in output for every option but does NOT change the exit code.
  Does not by itself make `npm run lint` exit non-zero.

### Current repo state (re-confirmed this phase)

- `biome.json`: `$schema` 2.4.12; `formatter.indentStyle:"tab"` (no
  `indentWidth`/`lineWidth`); `javascript.formatter.quoteStyle:"double"`;
  `linter.rules.recommended:true`; `assist.source.organizeImports:"on"`;
  `vcs.useIgnoreFile:true`; `files.ignoreUnknown:false`.
- `package.json`: `@biomejs/biome` devDep `2.4.12`; scripts
  `lint`/`lint:fix`/`format`/`typecheck`/`test`/`smoke`/`changeset`/`release`
  (no `format:check`, no combined `check`).
- `docs/index.html:83`: `<div class="visual" aria-label="Skillsmith run preview">`
  — `aria-label` on a roleless `<div>`, the exact node the new a11y rule flags.

## Topics

### Topic: Approach, components, dependencies, failure modes (overview)

- **Spec link:** all requirements (this frames the end-to-end mental model the
  implementer works from).
- **End-to-end approach:** This is a **configuration + mechanical-reformat** change,
  not a feature with runtime code. The implementer (1) bumps `@biomejs/biome`
  `2.4.12` → `2.5.0` in `package.json` devDependencies and refreshes
  `package-lock.json` via npm; (2) edits `biome.json` to the decided Config B
  (re-pin `$schema`; add the four load-bearing formatter keys + the
  redundant-but-explicit WordPress keys); (3) runs `biome format --write .` once to
  bring the ~89 in-scope files into WordPress style; (4) resolves the
  `docs/index.html` a11y lint finding (Topic: a11y) so `npm run lint` exits 0;
  (5) adds a `none`-bump changeset to clear the changeset gate. Compliance is then
  self-verifying: `biome format .` (no `--write`) exits 0, and
  typecheck/test/lint/`check:config`/`npm ci` all pass.
- **Components touched:**
  - `biome.json` — formatter config (the heart of the change: the four load-bearing
    formatter keys + redundant-but-explicit WordPress keys) and the `$schema` re-pin.
    The `linter` block is NOT touched (the a11y fix is in HTML — see a11y topic).
  - `package.json` — devDependency bump only (`@biomejs/biome` → exact `2.5.0`).
  - `package-lock.json` (root) — npm-refreshed for the new Biome version
    (resolved-versions delta only for `@biomejs/biome` and its platform-specific
    optional deps; NOT Biome-reformatted — protected file).
  - The ~89 formattable source files (`src/**` ×68, `testing-project/**` ×17,
    `bin/skillsmith.mjs`, `docs/styles.css`, `examples/skillsmith.config.ts`,
    `scripts/validate-changesets.ts`) — mechanically reformatted by `biome format`.
  - `docs/index.html` — one-attribute a11y edit (add `role="img"` to line 83).
  - A new `.changeset/*.md` — `none`-bump entry.
  - **Untouched but relevant:** the `linter` block (stays as-is — Req 9 is satisfied
    in HTML, not config), `assist.organizeImports`, `vcs`, `files`, all
    `.md`/`.yaml`/`.html` *formatting* (outside Biome's formatter), and
    `testing-project/package-lock.json` (protected, unchanged).
- **Dependencies:** Only one dependency change — the build-time devDependency
  `@biomejs/biome` 2.4.12 → 2.5.0. No new runtime dependencies, no new packages
  (notably: there is NO `@wordpress/biome-config` to depend on; the WordPress
  standard is expressed directly in `biome.json`). No new external services.
- **Failure modes & observability:**
  - *Verify check:* `biome format .` exits non-zero and prints per-file diffs on
    any unformatted file — the primary observable signal of non-compliance.
  - *Config validation:* a wrong `$schema` pin surfaces as a mismatch warning; an
    unknown key surfaces as a load-time error — both caught when Biome loads the
    config.
  - *Behavior regressions:* caught by the existing checks — `npm run typecheck`,
    `npm test`, `npm run lint`, `npm --prefix testing-project run check:config`,
    `npm ci`.
  - *Lockfile integrity:* `npm ci` failing or rewriting the lockfile would signal a
    lockfile problem (verified not to occur).
  - No new logging/telemetry is introduced or warranted; this is build-time tooling.

### Topic: Exact `biome.json` formatter structure mirroring WordPress

- **Spec link:** Requirements 1, 2, 3, 6; Acceptance criteria "Formatter output
  (WordPress style)" and "Toolchain and configuration".
- **Options:**
  1. *Config A — global + overrides:* `formatter.delimiterSpacing:true` plus
     `json.formatter.delimiterSpacing:false` and `css.formatter.delimiterSpacing:false`.
  2. *Config B — JS-scoped (minimal):* `javascript.formatter.delimiterSpacing:true`
     only; JSON and CSS left at their (already-faithful) defaults.
- **Trade-offs:** Both produce byte-identical, fully faithful TS/JSON/CSS output
  (verified). A makes the JSON/CSS exemption *visually explicit* in the config but
  adds two overrides whose only job is to undo a global ON that B never sets — more
  surface, more to drift, and arguably misleading (it reads as "we turn spacing on
  everywhere then carve out exceptions" when the carve-outs equal the defaults).
  B is minimal and states only what differs from Biome defaults, but a future
  reader must know JSON/CSS defaults already match WordPress to see *why* no
  override is needed.
- **Decision:** **Config B (JS-scoped, minimal).** Set `delimiterSpacing:true` on
  `javascript.formatter` only. The full formatter block:
  - `formatter`: `indentStyle:"tab"`, `indentWidth:4`, `lineWidth:80`
    (`indentWidth` is load-bearing for wrap fidelity; the other two are explicit
    for clarity though they match defaults).
  - `javascript.formatter`: `quoteStyle:"single"`, `trailingCommas:"es5"`,
    `semicolons:"always"`, `arrowParentheses:"always"`, `delimiterSpacing:true`.
  - JSON/CSS: no formatter blocks needed (defaults are faithful).
  - `$schema` re-pinned to `2.5.0` (Topic: version bump).
  - `linter`, `assist`, `vcs`, `files` blocks unchanged.
  The four load-bearing keys are `quoteStyle:single`, `trailingCommas:es5`,
  `indentWidth:4`, `delimiterSpacing:true`. I recommend keeping the
  redundant-but-explicit keys (`indentStyle`, `lineWidth`, `semicolons`,
  `arrowParentheses`) so the config is a self-documenting mirror of the WordPress
  prettier-config rather than relying on undocumented Biome defaults — this is a
  faithfulness/legibility call, not a behavioral one.
- **Rationale:** Faithfulness to WordPress is the spec's contract, and B is fully
  faithful with the smallest, least-drift-prone surface. Scoping `delimiterSpacing`
  to `javascript.formatter` directly encodes the spec's faithfulness requirement
  (spacing on for JS/TS/MJS, off for JSON/CSS) without overrides that only neutralize
  a global flag. The explicit-but-redundant WordPress keys are kept as documentation.
- **Note (import trailing commas):** the faithful `es5` config puts trailing commas
  on multiline imports, contradicting the spec's parenthetical "not in imports."
  This is a spec wording error about the WordPress source of truth, not a config
  choice — see the discrepancy note in Research and Open Questions. The config
  follows WordPress; the spec text should be corrected downstream.

### Topic: Tree compliance, reformat blast radius, and lockfile equivalence

- **Spec link:** Requirements 4, 5, 8; Acceptance criteria "Tree compliance and
  verification" and "Behavior and check preservation".
- **Findings (verified, real tree):** the reformat is feasible and mechanical — 89
  files change, idempotent, all behavior-preservation checks pass. **But** Biome's
  protected-file default means lockfiles are never reformatted, which contradicts
  Requirements 5 & 8 and two acceptance criteria as literally written (see Research).
- **Decision (reformat surface):** run **stock Biome 2.5.0 over the whole tree with
  Config B, adding NO in-tree exclusions** (option a). Accept that stock Biome
  protects `package-lock.json`/`testing-project/package-lock.json` and leaves them
  unchanged. Do **not** force-format lockfiles (reject option b). The committed tree
  is compliant when `biome format .` (verify mode) over the tree exits 0 — which,
  because Biome itself excludes the lockfiles, it does with the lockfiles untouched.
- **Rationale:** Option (a) is faithful to the spec's actual *intent* for
  Requirement 5 ("all files within Biome's formatting reach are reformatted; no
  in-tree exclusions are introduced") — the lockfiles are simply not within Biome's
  reach, and skillsmith adds no exclusion of its own. It also honors the spec's
  binding constraint of "stock Biome ≥ 2.5.0, no wp-prettier fork." Option (b)
  introduces a new non-Biome mechanism the spec explicitly does not contemplate,
  and the forced result would still be unverifiable by `biome format .` (Biome
  re-protects on the next run), so it would drift silently — directly against
  Requirement 7's "verifiable, not merely available." The proven install-equivalence
  of a hypothetically-formatted lockfile confirms forcing would be *safe*, but
  safety is not a reason to add an unverifiable, off-tool mechanism.
- **Blocker raised and RESOLVED (owner):** Requirements 5 & 8 and the two lockfile
  acceptance criteria assert an outcome stock Biome cannot produce (lockfiles
  reformatted + install-equivalent-after-reformat). Raised to `main`; the owner's
  resolution is to leave `1-spec/spec.md` unchanged and make **this design
  authoritative** — lockfiles are outside Biome's reach, skillsmith adds no in-tree
  exclusion, and the kept guarantee is `npm ci` install-equivalence against the
  UNCHANGED lockfiles (verified). Captured in "Spec corrections /
  resolution-of-record" at the top of this document.

### Topic: Biome version bump, `$schema` re-pin, and config-format migration

- **Spec link:** Requirement 6; Acceptance criteria "Toolchain and configuration"
  (version ≥ 2.5.0; config validates with no unknown-key error and no `$schema`
  mismatch).
- **Sub-decisions:**
  1. *Version pin:* `@biomejs/biome` is currently pinned to exact `2.4.12` (no
     caret). 2.5.0 is the only published 2.5.x as of June 2026.
  2. *`$schema` re-pin:* to `https://biomejs.dev/schemas/2.5.0/schema.json`
     (eliminates the mismatch info, satisfies the acceptance criterion).
  3. *`linter.rules.recommended` deprecation:* 2.5.0 deprecates `recommended`
     (info-level, "use `preset` instead"); it still works. Migrate now or leave?
- **Decision:**
  - Pin `@biomejs/biome` to exact **`2.5.0`** — mirrors the repo's existing
    exact-pin style for this dep; avoids a caret floating onto an untested 2.5.x.
    (2.5.0 is the only published 2.5.x as of June 2026.)
  - Re-pin `$schema` to `https://biomejs.dev/schemas/2.5.0/schema.json`.
  - **Do NOT migrate `linter.rules.recommended:true` → `preset`.** The deprecation
    is **INFO-level only** ("Use preset instead") and does NOT change the exit code —
    VERIFIED: `biome lint .` exits 0 with it present (it appeared in output for every
    a11y option without affecting the result). The config still validates with no
    unknown-key error and no `$schema` mismatch (the only validations the acceptance
    criteria require). The spec says the linter block "stays as-is apart from any
    change needed solely to satisfy Req 9"; migrating `recommended` is neither
    acceptance-criterion-required nor needed for Req 9 (Req 9 is satisfied by the
    HTML fix), so leaving it is the minimal, spec-aligned choice.
- **Rationale:** every load-bearing fact (pin availability, `$schema` mismatch, the
  deprecation being non-fatal) is verified. Keeping `recommended` avoids touching the
  linter block beyond what Req 9 requires (it requires nothing here, since the a11y
  fix is in HTML), keeps the diff minimal, and carries no risk — the deprecation is
  informational and the rule semantics are unchanged in 2.5.0 for skillsmith's code.
- **Risk noted:** `recommended` is deprecated, so a *future* Biome major could
  remove it; migrating to `preset` is a small, mechanical follow-up whenever the
  repo chooses — out of scope for this change. Logged under Open Questions.

### Topic: Resolving the `docs/index.html` a11y lint finding (Req 9)

- **Spec link:** Requirement 9; Acceptance criterion "`npm run lint` exits zero".
- **Options (all verified exit 0 at Biome 2.5.0):**
  1. *(1a) Fix the HTML with `role="img"`* on the flagged `<div>`.
  2. *(2b) Inline `biome-ignore` suppression* on the line.
  3. *(2a) Turn the rule off* in `linter.rules.a11y`.
  4. *(3a) Exclude `docs/**` from linting.*
- **Trade-offs:** 1a is the only single-attribute HTML fix that passes both
  `useAriaPropsSupportedByRole` AND `useSemanticElements`, requires ZERO linter-config
  changes, and actually corrects the ARIA defect (a valid accessible name on a
  role that supports it) while preserving the decorative-preview label;
  `role="img"` is permanently exempt from `useSemanticElements`, so it is not
  version-fragile. 2b leaves the config untouched but consciously suppresses a real
  defect (HTML stays technically invalid). 2a edits the linter block (against the
  spec's "stays as-is") and loosens a recommended rule repo-wide. 3a is broadest:
  it silently also stops linting `docs/styles.css` (proven — an injected CSS error
  goes uncaught), so it would weaken CSS linting that this very feature relies on.
- **Decision:** **(1a) add `role="img"`** →
  `<div class="visual" role="img" aria-label="Skillsmith run preview">`.
- **Rationale:** It is the smallest faithful fix, makes `npm run lint` exit 0
  (verified), needs no linter-config change (best satisfies the spec's "linter block
  stays as-is apart from any change needed solely to satisfy Req 9"), fixes the real
  accessibility issue rather than hiding it, and is robust across Biome versions.
  HTML is outside Biome's formatter (Req 10), so this hand edit is not reformatted
  and trips no other 2.5.0 rule.
- **Alternatives considered (fallback ranking if HTML couldn't be edited):**
  2b inline-suppress > 2a rule-off > 3a exclude-docs (3a worst — silently drops
  `docs/styles.css` CSS linting).

### Topic: Verification approach and changeset handling

- **Spec link:** Requirement 7 (verifiable, not merely available; no new artifact
  required); Out of Scope (no new gating CI workflow; changeset mechanics deferred);
  Acceptance criteria "verify mode" and "changeset gate passes".
- **Sub-decisions:**
  1. *The verify check:* what command/artifact establishes compliance?
  2. *Changeset:* how to satisfy the mechanically-firing changeset gate without
     forcing a version bump.
- **Decision:**
  - **Verification = the already-shipped `biome format .` (no `--write`).** It
    reports diffs and exits non-zero on any unformatted file, exits zero when the
    tree complies (verified). This IS the check. **No new npm script and no new CI
    workflow are introduced** — Requirement 7 and Out of Scope are explicit that a
    new `format:check` script is optional convenience (not required) and a new
    gating workflow is out of scope. A `format:check` script is therefore noted as
    an *optional* convenience the implementer may add, not a design requirement.
  - **Changeset = a `none`-bump changeset.** The PR touches `src/**`, `bin/**`,
    and `package.json`, so `changeset-gate.yml` mechanically demands a changeset
    even though the work warrants no version bump (lint/format config + a
    behavior-equivalent build-time devDependency bump). A `none`-bump changeset
    satisfies the gate while recording no version bump (precedent:
    `.changeset/initial-scaffolding.md`). Exact wording is a later-phase landing
    detail (spec defers changeset mechanics); the design only fixes that the bump
    type is `none`.
- **Rationale:** Both decisions take the minimal, spec-faithful path: reuse the
  tool that already ships (no new enforcement surface), and use the established
  `none`-changeset precedent to clear the gate without a spurious version bump.
  These are well-grounded by existing verified evidence (spec-research Q4, Q6),
  so they need no new research.
- **Note:** the verify check passing depends on the committed tree being
  reformatted first (Topic: tree compliance) and on lockfiles being correctly
  scoped out by Biome's protected-file default (verify-mode never inspects them,
  so they cannot cause a non-zero exit) — consistent with the lockfile decision.

## Open Questions

- **Spec wording on import trailing commas is wrong.** Spec Requirement 1 and the
  acceptance criteria say multiline imports get no trailing comma; verified
  evidence shows faithful WordPress `es5` (both Biome and Prettier) DOES add one.
  The design follows WordPress (config is correct); the spec text needs a downstream
  correction. Flagged to the design-doc-writer to surface, and ultimately a
  the design's `es5` config (trailing comma present on multiline imports).
  **RESOLVED (owner): `1-spec/spec.md` left unchanged; this design is authoritative
  on this point** (see "Spec corrections / resolution-of-record"). Downstream phases
  follow the design.

- **Lockfile reformatting requirements — RESOLVED (owner, resolution-of-record).**
  Stock Biome protects `package-lock.json` and `testing-project/package-lock.json`
  and never formats them (verified; cannot be overridden). The owner's decision:
  `1-spec/spec.md` is left unchanged; **this design is authoritative** — lockfiles
  are outside Biome's reach, skillsmith adds no in-tree exclusion, and the kept
  guarantee is `npm ci` install-equivalence against the UNCHANGED lockfiles (verified).
  See "Spec corrections / resolution-of-record." No longer blocking.

- **`linter.rules.recommended` is deprecated in 2.5.0 (deferred).** This design
  keeps `recommended:true` (the deprecation is info-level, non-fatal, and migrating
  is out of scope for Req 9). A future Biome major may remove `recommended`;
  migrating to `preset` is a small mechanical follow-up the repo can do whenever it
  chooses. Deferred to a later, separate change.

## Risks

- **Downstream phases could test the superseded spec clauses literally.** The two
  corrected clauses (lockfiles reformatted; no trailing comma on imports) still
  appear verbatim in `1-spec/spec.md`, which the owner left unchanged. Mitigation:
  the "Spec corrections / resolution-of-record" section makes this design
  authoritative on both points and MUST be carried into `design-doc.md` so the plan,
  code, and doc phases follow the design, not the literal spec text. A reviewer who
  reads only `spec.md` would otherwise (a) expect a reformatted lockfile that never
  appears, and (b) flag a correct multiline-import trailing comma as a defect.
- **Lockfiles will silently NOT be in WordPress style.** Even after this work, the
  two `package-lock.json` files stay in npm's format (already tab-indented, close
  but not identical to Biome's JSON output). This is by Biome's design and is
  invisible to `biome format .`. Acceptable and expected; downstream readers should
  not treat the un-Biome-formatted lockfiles as a compliance gap.
- **Lockfile version delta from the Biome bump must stay scoped.** Refreshing
  `package-lock.json` for `@biomejs/biome` 2.5.0 should change only that dep and its
  platform-specific optional deps. If npm pulls unrelated updates, that would exceed
  the intended scope — the code phase should regenerate the lockfile deliberately
  (targeted update) and confirm `npm ci` reports no resolved-version change beyond
  Biome.
