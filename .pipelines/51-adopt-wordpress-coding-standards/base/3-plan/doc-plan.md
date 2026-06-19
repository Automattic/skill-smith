# Doc Plan: Adopt WordPress coding standards in Biome formatting

## Overview

This change adopts the WordPress JavaScript/TypeScript formatting standard in
skillsmith's Biome configuration (single quotes, tabs at width 4, an 80-column
wrap target, ES5 trailing commas, and the headline trait — spaces inside
parentheses and array brackets, `fn( a, b )` / `[ 1, 2 ]`), bumps
`@biomejs/biome` to 2.5.0, and mechanically reformats the whole tree. The change
introduces no runtime feature and no new public API, so most of skillsmith's
human-facing documentation is unaffected. The one documentation surface that
genuinely goes out of sync is the **contributor workflow in `CONTRIBUTING.md`**:
its "Running tests and checks locally" section enumerates the local checks but
is silent on code formatting, even though contributors will now write new code
that must match a specific, visible WordPress style, and the repo already ships
a formatting script (`npm run format`) plus a verify-mode formatting check that
neither the docs nor any other prose currently mention. This plan contains the
single doc task needed to close that gap, plus an explicit record of the
documentation surfaces that were checked and deliberately left untouched so the
doc phase does not invent unwarranted work.

## Authoritative design corrections (the doc-writer MUST follow the design, not the superseded spec wording)

The design doc is the authoritative resolution-of-record on two points where
`1-spec/spec.md` was intentionally left unchanged. Any documentation this plan
produces that describes formatting behavior MUST match the design:

1. **Lockfiles are NOT reformatted.** Stock Biome hardcodes `package-lock.json`
   and `testing-project/package-lock.json` as protected files; skillsmith adds
   no in-tree exclusion. Do not write any doc claim that lockfiles are
   reformatted or that a "reformatted lockfile is install-equivalent" — that
   spec wording is superseded.
2. **Multiline imports DO get an `es5` trailing comma.** A multiline `import {
   ... }` ends with a trailing comma under the adopted style; single-line
   imports that fit on one line do not. Do not write any doc claim that imports
   never get trailing commas — that spec wording is superseded. If a task's
   prose lists which constructs receive trailing commas, it must match this.

## Tasks

### Task 1: Document the WordPress formatting convention and how to apply/verify it in `CONTRIBUTING.md`

- **Goal:** Make a contributor able to (a) understand that skillsmith's
  JS/TS/MJS code follows a specific WordPress-derived formatting style, (b)
  bring their changes into compliance with the existing auto-fix script, and (c)
  verify compliance the same way the project does — without prescribing exact
  config keys or values that live in `biome.json` and the code the doc-writer
  reads in phase 5.
- **Audience:** Contributors and maintainers of skillsmith (people opening PRs
  against this repo), i.e. the same audience `CONTRIBUTING.md` already serves —
  not consumers of the published `@automattic/skillsmith` package.
- **Files to change:** `CONTRIBUTING.md` (root). The natural home is the
  existing "Running tests and checks locally" section (which currently lists
  `npm run lint`, `npm run typecheck`, `npm test`, `npm run smoke`, and the
  `testing-project` `check:config` command), extended or accompanied by a short
  code-style note; the doc-writer may add a brief subsection rather than
  overloading the existing bullet list if that reads better.
- **Sections / scope:**
  - State that skillsmith formats its JS/TS/MJS with Biome to a WordPress-derived
    style, and describe the observable, reader-facing traits at a level that does
    not lock in config mechanics — at minimum the headline trait (spaces inside
    parentheses and array brackets) and the single-quote convention, since those
    are the most visible day-to-day. Keep this descriptive of *what the code
    looks like*, not a restatement of every `biome.json` key.
  - Document how a contributor brings changes into compliance using the repo's
    **existing** `format` script (the `npm run format` entry already present in
    `package.json`) — describe it, do not invent a new script. If the doc-writer
    references the verify path, it is the already-shipped Biome verify mode
    (`biome format .` without `--write`); do not document a new `format:check`
    script or a new CI workflow (none is added by this change — see "Surfaces
    deliberately not changed").
  - Keep the existing `npm run lint` ("Biome lint over the repo") guidance
    accurate; this change keeps `npm run lint` green and does not remove or
    rename it.
  - Do NOT restate the Biome version number in prose; the installed version is
    expressed in `package.json` / `biome.json` (owned by the code phase) and a
    hardcoded version in prose would immediately drift.
  - Respect the design corrections above if the prose enumerates trailing-comma
    or lockfile behavior.
- **Depends on:** none (documentation-only; can be drafted in phase 5 against
  the shipped `biome.json` and `package.json` scripts).
- **Traces to:** Spec Req 1 (full WordPress JS/TS style), Req 4 (committed tree
  is in WordPress style), Req 7 (formatting compliance is verifiable via the
  already-shipped `biome format .`); design "Approach" steps 2–3 and the
  Config B interface; code-plan Task 2 (Config B rewrite) and Task 4 (whole-tree
  reformat). Closes the contributor-docs sync gap created by adopting a visible
  code style.
- **Acceptance:**
  - A contributor reading `CONTRIBUTING.md` comes away knowing that skillsmith's
    JS/TS code follows a WordPress-derived formatting style, including at least
    the parentheses/bracket-spacing trait and the single-quote convention.
  - The doc tells the contributor how to bring their changes into compliance
    using the repo's existing formatting script, and how compliance is verified,
    using only commands/scripts that actually exist in the shipped repo
    (no invented `format:check` script, no invented CI gate).
  - The existing local-checks guidance (`npm run lint`, `npm run typecheck`,
    `npm test`, the `testing-project` `check:config` command) remains present and
    accurate; nothing that still works is described as removed.
  - No hardcoded Biome version number appears in the prose, and any description
    of trailing-comma/lockfile behavior is consistent with the two authoritative
    design corrections (multiline imports get a trailing comma; lockfiles are not
    reformatted) — i.e. the doc does not contradict the design.

## Surfaces deliberately not changed (checked; no task warranted)

These surfaces were swept and intentionally excluded so the doc phase does not
manufacture work. Each line records why no doc task is warranted.

- **`package.json` (`@biomejs/biome` version) and `biome.json` (`$schema`
  version + formatter keys).** These are configuration/code, not documentation,
  and are owned by code-plan Task 1 (version bump) and Task 2 (Config B rewrite).
  Not a doc surface.
- **`CHANGELOG.md` and the `none`-bump changeset.** `CHANGELOG.md` is generated
  by Changesets automation, not hand-edited. The human-facing release note for
  this change is the `none`-bump changeset, which is authored in code-plan Task 5
  (not a doc task). No separate doc work.
- **`README.md`.** Its WordPress mentions refer to the reference *project under
  test* (plugins, `wp-env`, Playwright), not to skillsmith's own code style, and
  it contains no formatting/quote/indentation guidance. Nothing in it goes out of
  sync with this change.
- **`CONTRIBUTING.md` "When a changeset is required" (line ~32).** It already
  correctly states that `lint/format config` changes do not require a changeset;
  this change does not alter that rule. No edit needed.
- **`AGENTS.md` / `CLAUDE.md`.** Scope to changeset/versioning policy only; no
  code-style or formatting content to drift.
- **`.rp.md`, `.changeset/README.md`, `.github/workflows/*`.** The `npm run lint`
  references in `.rp.md` and `release.yml` keep working unchanged; these are
  pipeline/CI artifacts, not contributor documentation this plan owns, and the
  change adds no new CI workflow or npm script to document.
- **`docs/index.html` and `docs/styles.css`.** The marketing landing page and
  its stylesheet contain no documentation of skillsmith's internal code style.
  The `role="img"` a11y edit (code-plan Task 3) and the CSS reformat (code-plan
  Task 4) change files but document nothing; no prose surface references them.
- **`testing-project/` and `examples/` docs/READMEs.** Their SKILL.md/fixture
  prose concerns the WordPress Interactivity API under test, not skillsmith's own
  formatting standard; reformatting their source files changes layout only and
  alters no documentation claim.
