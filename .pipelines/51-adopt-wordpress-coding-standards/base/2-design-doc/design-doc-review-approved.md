# Design Doc Review

## Verdict: approved

## Summary

The design doc is complete, internally consistent, faithfully traces every spec
requirement to a decision or component, and — most importantly — every
load-bearing technical claim I could probe holds up against live Biome 2.5.0
experiments. It gives the exact `biome.json` to write (Config B), the exact
version pin and `$schema` re-pin, the exact one-attribute HTML edit, and the
changeset bump type, so the plan and code phases can build from it without
re-deriving any decision. The two owner-approved "resolution-of-record"
corrections (lockfiles are protected/not reformatted; faithful `es5` adds a
trailing comma to multiline imports) are prominently documented as authoritative
and are technically accurate. Alternatives and trade-offs are captured for every
key decision, failure modes route through tools already in the repo, and scope
stays within the spec without bleeding into an implementation plan. I verified
the design rather than rubber-stamping it; the verification record is below.

## Verification performed (live, Biome 2.5.0 in an isolated sandbox; 2.4.12 in the worktree)

All claims confirmed:

- **Config B is faithful to WordPress and correctly scoped.** With the design's
  exact `biome.json`, TS output is
  `import {\n\tthingA,\n\t...,\n\tthingDLong...Name,\n} from 'mod';`,
  `[ 'a', 'b', 'c' ]`, `{ a: 1, b: 2 }`, `f( x, y )`, `( x ) => x * 2`, single
  quotes, semicolons added, tab indent, multiline array trailing comma present,
  function-param trailing comma absent. JSON formatted to
  `{ "a": 1, "b": [1, 2, 3], "c": { "nested": true } }` — object braces spaced,
  **arrays tight** — confirming `delimiterSpacing` scoped to `javascript.formatter`
  does **not** leak into JSON. CSS formatted to `rgba(0, 0, 0, 0.5)` with double
  quotes — **parens tight**. This is exactly the per-language nuance the design
  and spec (Req 2, Req 3) require.
- **Correction 2 (multiline import trailing comma) is accurate.** Verified
  byte-for-byte: a multiline import gets the trailing comma; a single-line import
  that fits 80 cols (`import { a, b } from 'mod';`) gets none.
- **`2.5.0` exact pin + `$schema` re-pin is correct.** 2.5.0 is the only published
  2.5.x (`npm view` confirms 2.4.13–2.4.16 and 2.5.0 exist; no other 2.5.x).
  Config B with `$schema` pinned to 2.5.0 loads with no unknown-key error and no
  schema-mismatch warning; `biome lint` exits 0. The `linter.rules.recommended`
  deprecation surfaces as an INFO/DEPRECATED diagnostic only and does **not**
  change the exit code — as the design states.
- **The `role="img"` a11y fix is sound and touches no linter config.** Reproduced
  the flagged node: before the edit, linting the `<div class="visual"
  aria-label="...">` trips `lint/a11y/useAriaPropsSupportedByRole` (exit 1);
  after adding `role="img"`, lint exits 0 with no `useSemanticElements` or other
  rule tripped. No `biome.json` linter-block change is needed, matching the design.
- **The exit-code premise is correct.** On the unchanged worktree with the genuine
  pinned 2.4.12 binary, `npm run lint` exits 0 and `docs/index.html` lints clean;
  the a11y finding is genuinely new in 2.5.0. (An earlier apparent contradiction
  was traced to my own sandbox install transiently overwriting the worktree's
  `node_modules` to 2.5.0; after `npm ci` restored 2.4.12, the design's premise
  held.)
- **`npm ci` integrity holds.** Root `npm ci` exits 0 and does not rewrite the
  lockfile.
- **Blast radius matches.** Tracked, non-ignored formattable files: 74 `.ts` +
  14 `.mjs` + 1 `.css` = 89, plus 8 JSON (including the 2 protected lockfiles) —
  consistent with the design's "Fixed 89, zero JSON" and directory breakdown.
- **Current repo state matches the design's premises.** `biome.json` `$schema` is
  2.4.12 with `formatter.indentStyle: "tab"` (no `indentWidth`/`lineWidth`),
  `javascript.formatter.quoteStyle: "double"`, `linter.rules.recommended: true`;
  `package.json` pins `@biomejs/biome` exact `2.4.12`; `docs/index.html:83` is the
  roleless `aria-label` div the design edits.

## Notes (non-blocking, for the plan/code phases)

These do not affect the verdict; they are observations the design already
addresses or that the implementer should simply carry forward:

- The two owner-approved corrections diverge from the still-unchanged `spec.md`
  clauses (Req 5/Req 8 lockfile reformatting; Req 1 "no import trailing comma").
  The design is authoritative on these per the owner's decision and documents
  them prominently in "Spec corrections / resolution-of-record." Downstream
  phases must follow the design, not the literal superseded spec text — the
  design's Risks section already calls this out.
- The code phase should regenerate the root `package-lock.json` deliberately so
  the only resolved-version delta is `@biomejs/biome` and its platform-specific
  optional deps, and confirm `npm ci` reports no other change — as the design's
  Risks section instructs.
