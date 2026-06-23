# Code Plan Review

## Verdict: approved

## Summary

The code plan is complete, feasible, correctly ordered, and fully traceable to
both the spec and the (authoritative) design. All five tasks are self-contained
(Goal / Files / Changes / Depends on / Traces to / Acceptance), every spec
acceptance criterion maps to at least one task, and the acceptance gates are
concrete and observable (`npx @biomejs/biome --version`, `npm run typecheck`,
`npm run lint`, `npm test`, `npm --prefix testing-project run check:config`,
`biome format .` verify mode with a negative control, `npx tsx
scripts/validate-changesets.ts`, and `npx changeset status`). The load-bearing
ordering is honored: the Biome `2.5.0` bump (Task 1), the Config B rewrite
(Task 2), and the `docs/index.html` a11y fix (Task 3) all precede the whole-tree
reformat (Task 4), and the `none`-bump changeset plus full-guardrail
verification land last (Task 5). The dependency graph is acyclic and correct,
and no task hides an unresolved design decision (Config B is specified
byte-for-byte; the a11y fix is a single named attribute on a verified line).
The plan correctly follows the design's resolution-of-record on the two
superseded spec clauses — lockfiles are not Biome-reformatted (no in-tree
exclusion is added; the kept guarantee is `npm ci` install-equivalence against
the unchanged lockfiles), and multiline imports receive an `es5` trailing comma
— which the review brief explicitly instructs not to reject for. The plan
prescribes no specific unit or end-to-end tests (it states observable outcomes,
not which tests to write) and includes no documentation tasks, both correctly
deferred.

## Verification performed against the codebase

- **`biome.json`, `package.json`, `docs/index.html`** match the plan's
  pre-task assumptions exactly: current schema `2.4.12`, `quoteStyle: double`,
  no `delimiterSpacing`/`indentWidth`/`lineWidth`; `@biomejs/biome` pinned to
  exact `2.4.12`; `docs/index.html` line 83 is
  `<div class="visual" aria-label="Skillsmith run preview">` (the Task 3 edit
  target). The Task 2 deltas and the Task 3 result line are accurate.
- **Lockfiles are protected.** `biome format package-lock.json` and
  `biome format testing-project/package-lock.json` both report the paths as
  "provided but ignored" — confirming Correction 1 and Task 4's claim that the
  reformat never touches the lockfiles and that no in-tree exclusion is needed.
- **`es5` multiline imports get a trailing comma.** A live format of a sample
  with `trailingCommas: "es5"` broke a long import across lines and emitted a
  trailing comma on the final specifier (and confirmed single quotes plus
  `arrowParentheses: always`) — confirming Correction 2 and the matching
  acceptance criteria in Tasks 2 and 4.
- **Blast-radius file counts** are consistent: 74 tracked `.ts`, 14 `.mjs`,
  1 `.css`, and the tracked JSON files (`biome.json`, `package.json`,
  `tsconfig.json`, `.changeset/config.json`, and `testing-project` equivalents)
  are already Biome-compliant, matching the design's "Fixed 89, zero JSON"
  dry-run. Zero `.tsx`/`.jsx` files exist, so the JSX out-of-scope point is
  correctly moot.
- **Task 5 gates are accurate.** `scripts/validate-changesets.ts` requires a
  leading `---` fence, a recognized bump (`none` is in the valid set), the
  package name `@automattic/skillsmith`, and a non-empty body — exactly the
  shape Task 5 prescribes, mirroring `.changeset/initial-scaffolding.md`. The
  `testing-project` `check:config` script referenced by Task 4 exists.

## Notes (non-blocking, no action required)

- Task 3's "may be done before or after Task 2" prose is slightly redundant
  with Task 4 listing Task 3 as a hard dependency, but the two statements do not
  conflict: Task 4 unambiguously requires Task 3, so the sequencing is
  deterministic. Two independent code-writers would produce the same ordering.
