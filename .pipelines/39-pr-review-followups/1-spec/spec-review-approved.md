# Spec review 2 — APPROVED

Independent adversarial re-review of `1-spec/spec.md` (committed at `c141512`, "Revise spec to fix
CONTRIBUTING anchor slug") against `1-spec/requirements.md`, `0-prompt/prompt.md`, and the live repo
state on branch `worktree-39-changelog-and-versioning` (= PR #41, HEAD `c141512`, working tree clean).

**Verdict: APPROVED.** The single blocking defect from review 1 is fully resolved, both non-blocking
nits are addressed, and a full from-scratch re-verification (not a spot-check) found no new defects.
Every empirical and structural claim in the spec reproduced exactly on the live worktree. The spec is
faithful to the resolved requirements, internally consistent, and its acceptance criteria are
independently testable.

---

## 1. Prior rejection (review 1, Issue 1) — RESOLVED

The blocking defect was a non-existent `CONTRIBUTING.md` anchor `#pre-1.0-policy` (correct slug:
`#pre-10-policy`). Verified resolved:

- **No surviving `#pre-1.0-policy`.** A content search of `spec.md` for `pre-1\.0-policy` returns
  zero matches. The literal bad string is gone.
- **Both prior sites corrected** (diff `30907c7..c141512`):
  - `spec.md:42-43` "Confirmed `CONTRIBUTING.md` anchors" list now reads `#adding-a-changeset`,
    `#bump-types`, `#pre-10-policy` (with an added "(GitHub auto-slug, dot stripped)" note).
  - `spec.md:104-105` R1.6(d) now cites `#pre-10-policy`, explains it is "GitHub's auto-slug for the
    `### Pre-1.0 policy` heading, dot stripped," and notes it "matches the validator message verbatim."
- **All three cited anchors verified correct against live headings** (`CONTRIBUTING.md`):
  - `## Adding a changeset` (`:18`) → `adding-a-changeset` ✓
  - `### Bump types` (`:40`) → `bump-types` ✓
  - `### Pre-1.0 policy` (`:48`) → `pre-10-policy` ✓ (the only candidate heading; GitHub lowercases,
    strips the `.`, leaving `pre-1`+`0` → `pre-10-policy`).
- **Matches the validator string.** `scripts/validate-changesets.ts:149` emits the literal
  `see CONTRIBUTING.md#pre-10-policy.` — identical to the spec's recommended anchor. R1.6's
  "mirror the enforcement points" intent is now satisfied rather than self-contradicted.
- **No collateral drift.** The revision diff is scoped to `spec.md` only (24 insertions / 17
  deletions) and touches exactly the four passages it should (the two anchor sites + the two nits
  below); nothing else changed.

## 2. Non-blocking nits (review 1, M1 & M2) — both ADDRESSED

- **M1 (AC16 testability).** AC16 now reads "documented **in the PR description**" (full stop),
  dropping the prior underspecified "and/or the change itself," and adds an explicit rationale:
  "the PR description is the natural home — `.changeset/config.json` is JSON with no prose slot, and
  `CONTRIBUTING.md`/`README.md` are excluded by AC19." This removes the AC16↔AC19 collision the
  prior review flagged and gives an unambiguous, checkable location.
- **M2 (AC9 / R2.2a ignore-comment count).** Both R2.2a (`spec.md:177-184`) and AC9 (`:377-386`) now
  state "**one `biome-ignore` per offending line (2 comments total, covering all 3 diagnostics)**,"
  with the explanation that the two test diagnostics share line 141 and "a line cannot carry two
  separate ignores." The earlier "3 comments" arithmetic is corrected to 2 comments / 2 lines / 2
  files. Verified against live lint: both test diagnostics are on line 141 (cols 31 & 43).

## 3. Independent empirical re-verification (all reproduced on the live worktree)

Branch `worktree-39-changelog-and-versioning` @ `c141512`; `git status` clean before and after (all
checks were read-only / sandbox-free).

- **`biome lint .` → exactly 3 errors + 6 warnings**, matching the spec table (`spec.md:159-165`) to
  the rule, file, line, column, and severity:
  - 3 × `lint/suspicious/noControlCharactersInRegex` (errors): `src/progress/tracker.ts:358:19`;
    `src/__tests__/progress-tracker.test.ts:141:31` and `:141:43` (two on the one line — confirms M2).
  - 4 × `lint/complexity/noAdjacentSpacesInRegex` (warnings, all `FIXABLE`):
    `src/__tests__/progress-render.test.ts:64,67,150,295`.
  - 2 × `lint/style/noDescendingSpecificity` (warnings): `docs/styles.css:596,605`.
- **Source/CSS citations confirmed:** `tracker.ts:358` = `const ANSI_SGR = /\x1b\[[0-9;]*m/g;`;
  `progress-tracker.test.ts:141` = `second.match(/^\x1b\[(\d+)A\x1b\[0J/)`; `styles.css:596` = bare
  `pre {}` and `:605` = bare `code {}`, both pure declaration blocks (R2.2b is a move, not a
  declaration change). ✓
- **`biome format .` → exactly 1 failing file: `.changeset/config.json`** ("Checked 95 files … Found
  1 error"), and Biome's diff converts 2-space → tabs **and** expands the array literals onto multiple
  lines — confirming R3.2's "accept the full Biome output; do NOT hand-preserve the inline array,"
  and that fixing this file makes the whole repo `biome format`-clean. ✓
- **ZERO-changeset gate (AC17) reproduced:** with only the pre-existing `.changeset/initial-scaffolding.md`
  (a `none` bump for `@automattic/skillsmith`), `validate-changesets.ts` exits 0 and
  `changeset status --since=origin/trunk` exits 0 ("NO packages to be bumped"). The `changedFilePatterns`
  in `.changeset/config.json` (`src/**`, `bin/**`, `package.json`, `examples/**`, `README.md`,
  `!src/__tests__/**`) match the spec. ✓
- **Prettier transitivity (R3.1):** `npm ls prettier` → `prettier@2.8.8` via `@changesets/cli` →
  `@changesets/apply-release-plan@7.1.1` and `@changesets/write@0.4.0` (deduped); no direct dep.
  Confirms `prettier:false` is the single switch across both Prettier-using paths. ✓
- **No agent files yet / `.rp.md` clean:** repo root has only `.rp.md` (no `AGENTS.md`/`CLAUDE.md`),
  and `.rp.md` contains **zero** occurrences of "changeset" — so R1.3/AC7 (rule not in `.rp.md`,
  `.rp.md` untouched) is correct and the files R1.1/R1.2 create are genuinely new. ✓
- **`release.yml` runs `npm run lint`** (`:37`, Change 2 premise) and `package.json` version is
  `0.1.0` (pre-1.0 guard live, R1.6 motivation). ✓
- **radical-pipelines precedent (R1.x):** live `~/Desktop/Code/radical-pipelines/AGENTS.md` carries
  exactly the three things the spec forbids copying — (a) "See the README's changelog and versioning
  section," (b) "breaking change → major," (c) "the README.md must be updated to keep it up to date"
  docs-currency bullet — and a `# Radical Pipelines` heading + one-sentence identity (the header shape
  R1.4 mirrors). Its `CLAUDE.md` is exactly `@AGENTS.md` (11 bytes), matching R1.2/AC2. The spec's
  "adapt the shape, do not copy the wording" direction is correct and necessary. ✓
- **Faithful quotes:** `CONTRIBUTING.md:50` ("write `minor` (never `major`) … prepend `BREAKING:` to
  the summary") and the validator message at `:149` are quoted accurately at `spec.md:108-110`. ✓

## 4. Internal consistency, faithfulness, testability (full pass)

- **AC↔requirement mapping is complete and consistent.** AC1-7 ↔ Change 1 (R1.1-R1.8), AC8-12 ↔
  Change 2 (R2.1-R2.4), AC13-16 ↔ Change 3 (R3.1-R3.4), AC17-19 cross-cutting. Every requirement has
  a corresponding checkable AC, and every AC traces to a requirement. The file list in AC19
  (`AGENTS.md`, `CLAUDE.md`, `tracker.ts`, `progress-tracker.test.ts`, `progress-render.test.ts`,
  `docs/styles.css`, `.changeset/config.json`) is exactly the union of the edits the three changes
  imply — no more, no less — and matches requirements.md #18.
- **All "be especially rigorous" resolved decisions are honored, unchanged:**
  - Change #1: root `AGENTS.md` + required `CLAUDE.md`=`@AGENTS.md`; defers bump/semver detail to
    `CONTRIBUTING.md#adding-a-changeset` (no inlined mapping); action-framed pre-1.0 clause with the
    load-bearing `BREAKING:` prefix named; re-sync-safe (outside `.rp.md`); explicitly forbids copying
    radical-pipelines' README pointer, breaking→major mapping, and docs-currency bullet.
  - Change #2: bar is ZERO diagnostics from `biome lint .` (with the honest exit-0/errors-only CI
    caveat preserved); source-level fixes; `biome lint` not `biome check` (R2.3 scope guard intact).
  - Change #3: `prettier:false` framed as an owner-selectable recommended **default/tradeoff** (not a
    bug fix), with the hard AC being the config.json Biome-tab reformat (AC14) and no release-flow
    post-step (R3.3/AC15).
  - Cross-cutting: ZERO new changesets; `initial-scaffolding.md` not edited (AC17).
- **Acceptance criteria are independently, mechanically checkable.** With AC16 now pinned to the PR
  description, every AC is either a file/content check (AC1-7, 13-16, 19), a command-output check
  (AC8-12, 14, 17-18), or a diff-scope check (AC12, 19). The one prior judgment-prose AC is fixed.
- **No internal contradictions found.** The previously-flagged self-contradiction (mirror the
  validator vs. recommend an anchor the validator contradicts) is gone now that both point to
  `#pre-10-policy`. The R3.1 tradeoff framing, the R2.2a (A)-ignore-vs-(B)-rewrite judgment call, and
  the ZERO-changeset constraint are each stated once and referenced consistently throughout.

---

**Conclusion.** The spec accurately and completely describes the three follow-ups, is faithful to the
prompt and the resolved requirements, contains no factual or anchor errors, and its acceptance criteria
are independently testable. APPROVED for the design-doc phase.
