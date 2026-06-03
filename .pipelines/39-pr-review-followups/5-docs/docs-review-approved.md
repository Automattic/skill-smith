# Docs review — APPROVED (batch: DT1, DT2), iteration 1

**Verdict: APPROVED.** Both Docs-phase verification verdicts (`5-docs/dt1-verification.md`,
`5-docs/dt2-verification.md`) are sound. I independently re-verified every load-bearing claim
against the SHIPPED artifacts and the approved `3-plan/doc-plan.md`, `1-spec/spec.md`, and
`2-design-doc/design-doc.md` — I did not merely trust the verdicts. The verify-only / zero-repo-doc
conclusion is itself correct, and AC19 holds.

This Docs phase wrote NO repo file (correct per `doc-plan.md`); its products are the two verdicts
plus this review. Nothing below required rework.

## DT1 — shipped `AGENTS.md` + `CLAUDE.md` read correctly (re-verified) — PASS

Independently confirmed against the live worktree (committed state; `git status --porcelain` empty):

- **`AGENTS.md` structure (AC1, AC3, AC6).** 3 non-empty lines; exactly **1** top-level bullet
  (`grep -c '^- ' AGENTS.md` = 1). Identity header `# Skillsmith` + one identity sentence naming the
  published package `@automattic/skillsmith` + the single changeset bullet. Byte-for-byte equal to the
  design-doc §"Exact content — `AGENTS.md`". Reads coherently for the dual audience: a human at the
  repo root gets context (not an orphaned one-liner); Pi reading `AGENTS.md` directly gets a
  self-contained imperative obligation with a working pointer.
- **Pre-1.0 sub-clause (AC4).** Present as the **trailing sentences of the same bullet** (not a second
  top-level bullet — bullet count is 1). All four elements: (a) "While pre-1.0 (version `0.x`)";
  (b) "record breaking changes as `minor` with a `BREAKING:` summary prefix"; (c) "`major` is rejected
  pre-1.0"; (d) pointer `CONTRIBUTING.md#pre-10-policy`. The **literal token `BREAKING:`** is present
  (load-bearing).
- **No forbidden / audience-wrong content (AC5, AC6).** No `→` arrow mapping (`grep -n '→'` = none);
  no "the README" pointer (`grep -in readme` = none); no "keep README/docs current" rule
  (`grep -inE 'keep.*(current|up-to-date|up to date)'` = none); no inlined semver triad; no restated
  "when required" list; no duplicated bump-type table. The file defers those to `CONTRIBUTING.md`
  (which carries the bump-type table at `CONTRIBUTING.md:42-46` and the "when required" list at
  `:22-38`) rather than duplicating — confirming the AGENTS.md-defers-to-CONTRIBUTING design intent.
- **`CLAUDE.md` (AC2).** Exactly `@AGENTS.md`: `wc -lc` = 1 line / 11 bytes; `cat -e` → `@AGENTS.md$`.
  No heading, no padding, no trailing prose — the `@AGENTS.md` import is the only bridge that delivers
  the rule to Claude Code (which loads `./CLAUDE.md`, not `AGENTS.md`), and it is intact.
- **Cross-references resolve (the cross-file doc-quality check).**
  - `#adding-a-changeset` → `## Adding a changeset` at `CONTRIBUTING.md:18` — exists.
  - `#pre-10-policy` → `### Pre-1.0 policy` at `CONTRIBUTING.md:48` — exists.
  - Validator slug match: `scripts/validate-changesets.ts:149` emits
    `… see CONTRIBUTING.md#pre-10-policy.` — byte-identical anchor to the `AGENTS.md` link.
  - Link form consistent with the repo's other citations of the same anchor: `README.md:239`
    (`[Adding a changeset](./CONTRIBUTING.md#adding-a-changeset)`) and `.changeset/README.md:5,10`
    (Markdown links); `AGENTS.md` uses the same Markdown-link form with a repo-root-relative target
    (no `./`/`../`), correct for a file at the repo root.
- **`.rp.md` untouched (AC7).** `git diff --quiet -- .rp.md` clean (exit 0).

DT1's verdict matched my independent findings on all 7 checks. No defect; no blocker.

## DT2 — AC16 `prettier: false` trade-off note (re-verified) — PASS

Source under review: `4-code/pr-description-note.md` (code-plan T6 / Code phase). Re-read directly:

- **(a) Recommendation + framing — present.** Frames `prettier: false` as "a deliberate decoupling
  trade-off, not a bug fix" and the "recommended default"; names it as the single switch disabling
  Prettier across both Changesets paths (`changeset version`, `changeset add`) and removing the tacit
  dependence on the undeclared transitive `prettier@2.8.8` (via `@changesets/cli`).
- **(b) Exact `CHANGELOG.md` before/after — present.** `prettier: true` → `## 0.2.0` · blank ·
  `### Minor Changes` · blank · `- <entry>` (normalized); `prettier: false` → `## 0.2.0` ·
  `### Minor Changes` (no blank line) then tighter spacing. States both render correctly and
  `package.json` is unaffected (`detect-indent` preserves tabs). Matches design-doc §"Change 3, 3-ii"
  and spec R3.1.
- **(c) Owner-selectable alternative — present.** Keep `prettier: true` for normalized spacing but
  then declare Prettier as an explicit `devDependency` (reintroducing the dual-formatter coupling);
  closes with "Recommendation remains `prettier: false`."
- **Matches shipped config.** `.changeset/config.json:8` carries top-level `"prettier": false`. The
  note describes what in fact shipped — no drift.

DT2's verdict matched my independent findings. The note is a hand-off for the PR #41 description (the
AC16-fixed home), not a repo file.

## AC19 manifest — confirmed (incl. base-commit sanity check)

`git diff --name-only f1a050d..HEAD -- . ':(exclude).pipelines/**'` = exactly the 7 Code-phase files:
`.changeset/config.json`, `AGENTS.md`, `CLAUDE.md`, `docs/styles.css`,
`src/__tests__/progress-render.test.ts`, `src/__tests__/progress-tracker.test.ts`,
`src/progress/tracker.ts`. The Docs phase added only `.pipelines/**` artifacts.

I checked the base-commit choice the verdicts use. `f1a050d` is **not** the merge-base with
`origin/trunk` (that is `fce8c4e`); `f1a050d` is an ancestor of HEAD and is the **original**
`39-changelog-and-versioning` pipeline's final "Approve docs review" commit — i.e. the as-built PR #41
baseline on which this follow-up (`39-pr-review-followups`) stacks. So `f1a050d..HEAD` correctly
measures *this follow-up's* incremental repo footprint, which is exactly the 7 files. The full PR #41
vs trunk legitimately also touches `CONTRIBUTING.md`, `README.md`, `.changeset/README.md`, etc. —
those were authored by the original pipeline and, per `doc-plan.md` (lines 37-44), must **not** be
re-touched by this follow-up. Confirmed: in the working tree `git diff --quiet` is clean for `.rp.md`,
`CONTRIBUTING.md`, and `README.md`. The verify-only conclusion is therefore correct: CONTRIBUTING /
README are correctly NOT edited, and the AGENTS.md rule defers to CONTRIBUTING rather than duplicating
it.

## Conclusion

**APPROVED.** DT1 and DT2 each covered their doc-relevant ACs with nothing silently dropped; neither
modified a repo file; AC19 holds (cumulative repo manifest still exactly the 7 code files); and the
verify-only / no-repo-doc-work conclusion is itself correct and well-justified against AC19. No
rework required.
