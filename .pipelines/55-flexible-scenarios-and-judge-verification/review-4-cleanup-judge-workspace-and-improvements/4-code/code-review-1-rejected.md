# Code Review

## Verdict: rejected

## Batch scope

Tasks reviewed (all 12, initial batch):

- Task 1: Delete the history-scanning test files and the orphaned asset; relocate the live selection test
- Task 2: Delete the dead judge-env code, `wp-cli.mjs`, the env scripts, and the `judgePluginSlug` alias; excise their tombstones
- Task 3: Purge the negative-assertion cohort in the core test files
- Task 4: Byte-parity core simplifications (shared scanner, shared comparator, shared inlining helper)
- Task 5: Merge the overlapping enumeration tests; reframe `enumerate-rubrics.test.ts` as the opaque-brief contract
- Task 6: The `judge-library` module
- Task 7: The breaking core swap — `roles.judge.library` replaces `roles.judge.prompt` + `paths.rubrics`; judge-agent/agent-loop rework; `rubric-loader` retires
- Task 8: Testing-project migration onto the library
- Task 9: The 11 briefs drop the opener; rubric sentence re-points; framing merges into the manual; conformance test follows
- Task 10: The `judging: { duration, tokenUsage? }` report block
- Task 11: Remove the write-only `dirName` alias
- Task 12: Changesets — update the stale feature changeset, add the breaking-wave and `judging` changesets

## Summary

The batch is very close to complete and the mandated work — the judge library replacing the two removed config channels, the centralized decision rule, the behavior-neutral cleanup, the `judging` report block, and the `dirName` removal — is implemented faithfully and matches the design and plan on every point I checked. Eleven of twelve tasks pass. The batch is rejected for a single, well-scoped issue: Task 12 introduced a **new** test file, `src/__tests__/release-changesets.test.ts`, that reintroduces exactly the repository-`.changeset/`-pinning tombstone pattern the revision was mandated to purge — asserting on the count, filenames, and prose of the live shipping changesets. This directly violates Task 1's acceptance ("No remaining test asserts on the contents, filenames, or count of the repository's own `.changeset/` directory"), spec AC1, and the design's own stated reason for deleting `feature-changeset.test.ts` (guaranteed future-CI breakage). It is also outside Task 12's declared Files list. Because a rejection finding stands from code inspection, the guardrail gates were not run this iteration (recorded as skipped below).

The two writer-flagged adjudications both resolve in the writers' favor and are **not** rejection issues (see Adjudications).

## Checks

Guardrails were not run: a rejection finding stands from steps 2–3, so the batch returns to the writer regardless. Each gate is recorded as skipped, deliberately.

| Check | Command | Result |
| ----- | ------- | ------ |
| typecheck | `npm run typecheck` | skipped |
| lint | `npm run lint` | skipped |
| tests | `npm test` | skipped |
| config-smoke | `npm --prefix testing-project run check:config` | skipped |
| changeset-format | `npx tsx scripts/validate-changesets.ts` | skipped |

## Adjudications (writer-reported flags)

**Flag 1 — Task 10 AC4 first clause ("scenario aggregation output embeds the `judging` block verbatim … with zero changes to `scenario-report.ts`"): ACCEPTED, no issue.**
Verified: `src/reports/scenario-report.ts` is untouched this run, and `aggregateScenarioReport` copies only `testing` and `review` into `ScenarioAgentEntry` (which has no `judging` slot) at `src/reports/scenario-report.ts:77-79`. The scenario-level aggregate therefore does not carry `judging`. This is a latent tension inside the design itself — the design lists `scenario-report.ts` as "Untouched but relevant" and simultaneously asserts the block "flows through aggregation with zero changes." The two cannot both hold literally. The writer honored the binding constraint (do not modify aggregation) and delivered the block in its design-specified home, the per-pair `report.json` (design "Per-pair report" section), where it is written verbatim and end-to-end-verified (`judging.tokenUsage.totalTokens === 150` in `smoke.test.ts`). Adding a `judging` slot to `scenario-report.ts` would be scope creep beyond the plan and contradict the design's untouched-list. The chosen resolution is correct.

The related `src/providers/mock.ts` change (mock testing and judge invokes now return `usage: MOCK_USAGE`) is **accepted** as the test infrastructure the AC4 end-to-end assertion requires; it is additive, does not alter the mock's verdict/branch behavior, and the smoke/agent-loop suites depend on it.

**Flag 2 — Tasks 11/12 edit to `.changeset/nested-scenario-folders.md:5` (struck the false "`dirName` remains available as an alias" clause): ACCEPTED, no issue.**
Task 11 removes `dirName`, so the pre-existing changeset's alias clause became false. Leaving it would make the eventual release notes describe an alias that does not ship — a release-record inconsistency squarely inside Task 12's goal ("Make the release record match what ships") and spec R7. The one-line strike is the minimal correct fix. Editing a file outside Task 12's declared list is warranted here.

## Issues

### Issue 1: New test pins the live `.changeset/` directory — a reintroduced tombstone the revision was mandated to remove

**Task:** Task 12: Changesets — update the stale feature changeset, add the breaking-wave and `judging` changesets

**What's wrong:** Task 12 added a new test file, `src/__tests__/release-changesets.test.ts`, that reads the repository's live `.changeset/` directory (`CHANGESET_DIR = fileURLToPath(new URL('../../.changeset', import.meta.url))`, then `readdirSync(CHANGESET_DIR)`) and asserts on the count, filenames, and prose of the shipping changesets. In particular:

- `'both breaking records are minor with a BREAKING: summary prefix'` asserts **exactly two** breaking changesets exist in the repo (`assert.equal(breaking.length, 2, …)`), a count assertion on the repo's own `.changeset/`.
- `'the judging changeset states the presence rule'` and `'the breaking wave changeset carries the library migration recipe and the dirName note'` pin the prose of specific shipping changeset files.

This is the exact category the revision was mandated to purge. It violates:

- **Task 1 acceptance (plan):** "No remaining test asserts on the contents, filenames, or count of the repository's own `.changeset/` directory (the kept `validate-changesets.test.ts` exercises the validator against synthetic temp-dir fixtures and stays)." The plan draws a bright line: synthetic temp-dir fixtures are allowed; pinning the live repo `.changeset/` is not.
- **Spec AC1 / R1:** "no test asserts that removed code stays removed or that legacy exports remain" — and, per the reports the spec incorporates, the removal of `feature-changeset.test.ts` precisely because it pinned changeset filenames/prose and "will fail CI on the next release or next added changeset."
- **Design "Cleanup plan" finding 4:** `feature-changeset.test.ts` was deleted **outright** because "every block is a pivot/prose tombstone, guaranteed future CI breakage (fails on first release; its 'exactly one feature changeset' assertion is tripped by *this very revision's* mandatory changesets) … `changeset-gate.yml` runs the real validator over `.changeset/` on every PR, and the validator has its own test. Nothing durable is lost." The new file's "exactly two breaking changesets" count assertion is the same guaranteed-future-CI-breakage shape (it breaks the moment a third breaking changeset lands on future work, and the whole file breaks when these changesets are consumed at the next release), and it duplicates coverage already provided by `scripts/validate-changesets.ts` (run in CI via `changeset-gate.yml`) and its own synthetic-fixture test `validate-changesets.test.ts` (kept, untouched).

It is also **scope creep**: Task 12's declared Files list is only the three changeset `.md` files; no test file is authorized, and Task 12 carries no "new test files are the code-writer's TDD" clause (unlike Tasks 6, 7, 10). The release-record consistency Task 12 must achieve is a reviewer-verified, prose-level property (Flow 8 in the plan is a manual re-drive), not a test to encode.

**Where:** `src/__tests__/release-changesets.test.ts` (whole file) — added by commit `6c0e9eb`. Notably `src/__tests__/release-changesets.test.ts:15-17` (live `.changeset/` resolution), `:56-59` (`readdirSync` over the live dir), `:106-115` (the "exactly two" count assertion), `:131-243` (prose pins on the shipping changesets).

**Expected:** Delete `src/__tests__/release-changesets.test.ts` entirely. The release-record properties it tries to pin are the reviewer's manual-verification responsibility (plan Flow 8) and are already enforced for correctness by `scripts/validate-changesets.ts` in CI and its synthetic-fixture test. No replacement test that reads the repository's own `.changeset/` directory may be added; if any changeset-shape coverage is genuinely needed, it must run against synthetic temp-dir fixtures in the style of the kept `validate-changesets.test.ts`, never against the live release record. The three shipping changesets themselves (the actual Task 12 deliverable) are correct and should stay as written.
