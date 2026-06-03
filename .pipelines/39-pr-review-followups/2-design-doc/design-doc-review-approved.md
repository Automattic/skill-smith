# Design Doc Review — APPROVED

Reviewed: `2-design-doc/design-doc.md` (commit `7b5d430`) against `1-spec/spec.md` (19 ACs) and
`1-spec/requirements.md`.

Verdict: **APPROVED**. The design is complete, internally consistent, faithful to the spec,
technically sound, and concretely implementable. Every load-bearing empirical claim — every file,
line, column, regex literal, and transform it specifies — was independently re-confirmed against the
live worktree (branch `worktree-39-changelog-and-versioning` = PR #41) at HEAD `7b5d430`.

## How this was verified (not just read — executed)

The decisive check was an **end-to-end dry run**: I applied the design's exact Change 2 edits to a
scratch copy of the tree and confirmed the acceptance bar empirically, then fully restored the branch
to `7b5d430` (clean tree, `initial-scaffolding.md` intact, both gates green).

| Design claim | Verification | Result |
|---|---|---|
| 9 live diagnostics (3 err + 6 warn), exact files/lines/cols/rules | `biome lint .` | Matches the doc's table **exactly**: `tracker.ts:358:19`, `progress-tracker.test.ts:141:31` & `:141:43`, `styles.css:596`/`605`, `progress-render.test.ts:64,67,150,295` |
| **AC8: all edits → ZERO diagnostics** | Applied 2a (two `biome-ignore`s), 2b (CSS reorder), 2c (scoped `biome lint --write`); ran `biome lint .` | "Checked 96 files… No fixes applied" — **0 errors, 0 warnings** |
| AC11: regex auto-fix correct, tests pass | inspected diff; ran the two test files | Auto-fix touched **only** the 4 regex lines with the exact `{2}`/`{5}`/`{3}`/`{3}` transforms; **24/24 tests pass** |
| AC10: CSS reorder is a pure move | `git diff docs/styles.css` | Added blocks byte-identical to removed; **13 add / 13 del, 0 net**; tabs preserved |
| AC12: scope guard (no import reorder) | `git diff --name-only`; grep for `^[+-]import` | Exactly the 4 Change-2 files; **zero** import-line changes |
| tracker.ts:358 / test:141 content + indent | read both | `const ANSI_SGR = /\x1b\[[0-9;]*m/g;` at module level (no indent); test line is **tab-indented** — matches the doc's indentation caution and exact `biome-ignore` insertion text |
| AC14: config.json reformat = full Biome output, idempotent | `biome format --write` on a copy; re-ran | Output matches the doc's "after" **verbatim** (tabs; `changelog` array expanded, inner `{ "repo": … }` inline); re-run → "No fixes applied"; `JSON.parse` ✓ |
| AC13/AC14 together: `prettier:false` + reformat stays clean | built the file with `"prettier": false` after `"commit": false`, tabs; ran `biome format` | "No fixes applied"; valid JSON, `prettier` key present |
| `prettier:false` is the right single switch | `npm ls prettier` | `prettier@2.8.8` resolves via `@changesets/cli` → **both** `apply-release-plan@7.1.1` and `write@0.4.0` (the two paths the doc names); no direct dep; version `0.1.0` |
| Scope-guard rationale (check reorders ~6 files) | `biome check .` | 10 errors; **6** `organizeImports` findings; design's "~6 unrelated files" holds |
| `biome format` repo-wide flags only config.json | `biome format .` | "Checked 95 files… Found 1 error" — only `.changeset/config.json` |
| AC17: ZERO new changesets; `none` is load-bearing | both gate steps on clean branch; control test removing `initial-scaffolding.md` | Both pass (exit 0); removing the `none` changeset **reds** `changeset status` ("no changesets were found") — proves it satisfies the per-package gate |
| CONTRIBUTING anchors `#adding-a-changeset` / `#pre-10-policy` | read headings | `## Adding a changeset` (:18) → `adding-a-changeset` ✓; `### Pre-1.0 policy` (:48) → `pre-10-policy` (dot stripped) ✓ |
| Validator message matches `#pre-10-policy` | `validate-changesets.ts:149` | "…see CONTRIBUTING.md#pre-10-policy." — verbatim |
| R1.6 mirroring of canonical wording | `CONTRIBUTING.md:16` & `:50` | ":16" = "a small `.changeset/*.md` … travels"; ":50" = "write `minor` (never `major`) … prepend `BREAKING:`" — design's bullet mirrors both |
| radical-pipelines precedent (shape, 3 divergences) | read live `…/radical-pipelines/AGENTS.md` + `CLAUDE.md` | `CLAUDE.md` = `@AGENTS.md` ✓; rp has "breaking→major", "see the README", and a "keep README current" bullet — the **exact three** the design excludes for skillsmith |
| README has no changelog how-to; defer precedent | README headings; `.changeset/README.md:5` | README has only `## Releases` + `## Contributing` one-liner deferring to `#adding-a-changeset`; `.changeset/README.md` says verbatim "a cheat sheet, not the source of truth" |
| AGENTS.md / CLAUDE.md absent; `.rp.md` has no changeset rule | `ls`; grep `.rp.md` | Both absent (correct — to be created); `.rp.md` contains no changeset rule |

## AC-by-AC judgment on the authored `AGENTS.md` bullet (AC3–AC6)

The single bullet (design line 68) was checked clause-by-clause:

- **AC3** — imperative ("Record a changeset for every release-relevant change"), states the committed-
  `.changeset/*.md`-travels-with-the-PR obligation (mirrors `CONTRIBUTING.md:16`), cross-refs
  `CONTRIBUTING.md#adding-a-changeset`, single bullet. ✓
- **AC4** — pre-1.0 sub-clause carries all four elements **action-first**: (a) "While pre-1.0
  (version `0.x`)"; (b) "record breaking changes as `minor` with a `BREAKING:` summary prefix";
  (c) "`major` is rejected pre-1.0"; (d) `CONTRIBUTING.md#pre-10-policy`. Literal `BREAKING:` present.
  It is a trailing sub-clause of the same bullet, not a second top-level bullet. ✓
- **AC5** — no inlined semver triad; **maps breaking → `minor`** (the inverse of the forbidden
  "breaking → major"); the words "breaking" and "major" co-occur only in service of the *prohibition*
  ("`major` is rejected"), not a mapping; no "when-required" path list; no bump-table duplication; no
  "the README" pointer. ✓
- **AC6** — identity header + the single changeset bullet only; no "keep docs current" or other rule
  (correctly justified: `CONTRIBUTING.md:31` treats docs-only edits *more loosely*, so adding such a
  rule would contradict live policy). ✓

`CLAUDE.md` = exactly `@AGENTS.md` (AC2); placement as repo-root siblings of `.rp.md` is re-sync-safe
because the sync copies only `.rp.md` (AC7) — both confirmed sound.

## Cross-cutting closure

- **AC19 manifest (7 files)** is exact and closed: `AGENTS.md` (new), `CLAUDE.md` (new),
  `src/progress/tracker.ts`, `src/__tests__/progress-tracker.test.ts`,
  `src/__tests__/progress-render.test.ts`, `docs/styles.css`, `.changeset/config.json`. The dry run's
  `git diff --name-only` produced precisely the Change-2 subset (4 files) with no strays. `.rp.md`,
  `CONTRIBUTING.md`, `README.md`, `release.yml`, and `initial-scaffolding.md` are all correctly
  excluded; **no new `.changeset/*.md`**.
- **AC16** — the Change 3 trade-off (recommended `prettier:false` as a decoupling choice, exact
  `CHANGELOG.md` before/after spacing, the `prettier:true`+explicit-devDependency alternative) is
  routed to the PR #41 description with enough specificity to be actionable; correctly kept out of the
  file manifest.
- The design uses `biome lint` for every prescribed lint operation and names `biome check` only to
  warn against it (AC12/R2.3). The pre-edit line-number cautions (CSS "edit #1 before #2 or locate by
  selector text"; the test's tab-indent note) are correct and necessary.

## Non-blocking observations (recorded; not defects in the design)

1. The **requirements** doc lists `src/index.ts` among the `organizeImports`-affected files; the live
   set is `src/runner.ts`, `src/pipeline/pipeline.ts`, `src/progress/index.ts` + 3 test files. The
   **design doc itself** wisely says "~6 unrelated files" without enumerating, so it is accurate as
   written — no change needed.
2. The design's CSS code blocks render with 4-space indentation, but the surrounding prose explicitly
   instructs preserving the file's tabs ("the CSS uses tabs"). This is a Markdown-rendering artifact,
   correctly caveated; the implementer is told the right thing.

Neither affects implementability or any AC.

## Cleanup note

All verification was performed on scratch edits that were then reverted; the branch is restored to
`7b5d430` with a clean working tree and `initial-scaffolding.md` intact. One harmless scratch
`git stash` entry remains (Safety Net blocked `stash drop`); it is unreferenced by the branch and can
be dropped at leisure — it does not affect repo state.

## Conclusion

Approved. An implementer can follow this document verbatim and reach every acceptance criterion; the
zero-diagnostics result and the seven-file manifest were both demonstrated, not merely asserted.
