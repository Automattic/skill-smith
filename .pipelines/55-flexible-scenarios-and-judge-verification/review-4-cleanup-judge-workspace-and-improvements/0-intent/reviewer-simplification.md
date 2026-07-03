# Independent reviewer report: simplification analysis

*Produced by an independent read-only reviewer against branch tip `0addcb8`, commissioned by the owner after the review-3 close-out. Preserved verbatim as intent source material for the review-4 run. Verify claims against the code before acting on them.*

Sanity check performed: every headline finding below was verified directly against source in the worktree. Test scripts glob `src/__tests__/*.test.ts`, so no file deletion requires script/CI edits.

## 1. Delete the legacy `setUpJudgeEnv`/`tearDownJudgeEnv` pair — dead code with a stale retention rationale (~90 lines)

- **Evidence**: `testing-project/eval/utils/wp-env-judge.ts:314-390`. Doc comments say "Retained as the legacy per-pair orchestrator **until the config is rewired** onto bootJudgeEnv/installPluginForPair". The config **is** rewired: `testing-project/skillsmith.config.ts:81-103` wires only `bootJudgeEnv`/`stopJudgeEnv`/`installPluginForPair`/`cleanUpPair`. Grep confirms zero callers anywhere.
- **What pins it**: only `src/__tests__/testing-project-judge-config.test.ts:242-254`, a test literally named "setUpJudgeEnv and tearDownJudgeEnv remain exported (legacy orchestrators)" — a test pinning dead code alive. Lines 191-199 of the same file add transitional negative regexes ("beforeJudgeAgent no longer calls the legacy setUpJudgeEnv").
- **Why safe**: no runtime consumer; the legacy pair also duplicates the build logic already in `defaultCommands.buildPlugin` (wp-env-judge.ts:100-112 vs 327-339) and uses a different, inferior mechanism (`execSync('npm run env:start')`, per-pair boot) that contradicts the shipped warm-env model.
- **Do**: delete wp-env-judge.ts:314-390 plus the now-unused `execSync` import (line 1); delete the pinning test block and the negative regexes. ~68 + ~22 lines.

## 2. Delete `wp-cli.mjs` — orphaned by the e2e removal, kept alive only by a source-text test (~73 lines, 1 file)

- **Evidence**: `testing-project/eval/utils/wp-cli.mjs` (57 lines). Its only consumers at merge-base were the 11 deleted `e2e.spec.mjs` files. Today the only references are a comment in wp-env-judge.ts:10 and `src/__tests__/wp-env-judge-lifecycle.test.ts:460-474`, which regex-asserts the source text ("deactivateAllPlugins stays available as the clean-slate primitive" — nothing uses it).
- **Why safe**: `installPluginForPair`/`cleanUpPair` do their own deactivate via `commands.wpCli` (wp-env-judge.ts:281, 306); the judge uses `judge-wp.mjs`. This resolves the "three parallel WP-CLI wrappers" down to two, which genuinely differ (in-process hook seam vs standalone bridge invoked by the judge over Bash).
- **Optional further step**: collapse to **one** wrapper by making `runWpCli` (wp-env-judge.ts:79-96) shell out to `judge-wp.mjs` (`execFileSync('node', [JUDGE_WP_PATH, ...args])`). Behavior-equivalent, leaving a single place that knows the `npx wp-env --config ... run cli wp` argv. Adds one node hop per call; ~15 more lines saved.

## 3. Delete `feature-changeset.test.ts` — pins release-note prose and *will* break the next release (223 lines)

- **Evidence**: `src/__tests__/feature-changeset.test.ts:72-205` asserts changeset *filenames* ("the consolidated judge-workspace-isolation changeset is removed", "the four unrelated changesets remain"), the bump type, and regex-matches the release-note *wording*.
- **Why safe (in fact necessary)**: `changeset version` consumes and deletes `.changeset/*.md` at release, so these tests are guaranteed to fail the suite on the release commit. They test pipeline history, not behavior; the changeset's correctness was the docs-reviewer's one-time job. The whole file should go.

## 4. Delete `testing-project-e2e-removal.test.ts` — a remigration guard that outlived the migration (140 lines)

- **Evidence**: asserts `playwright.config.ts`/`global-setup.mjs`/`verify-e2e.ts` don't exist, `test:e2e` is gone from package.json, and regex-scans the whole testing-project for `e2e.spec.mjs` / `@playwright/test` strings.
- **Why safe**: pure negative-space history; no current behavior is protected. The scan even forbids `playwright.config` as a *string* while the shipped judge config legitimately uses the Playwright **MCP server** — the test survives only because the spelling differs, which shows how brittle it is.

## 5. Sweep the remaining negative-space "X was removed" assertions (~60 lines across 4 files)

- `src/__tests__/selection-duplicate-name-guard-removed.test.ts:18-23` — asserts `validateConfiguredScenarioNamesAreUnique` is *not* exported. (Keep the behavior test at lines 25-36, or fold it into scenario-filter-selection tests and drop the file.)
- `src/__tests__/wp-env-judge-lifecycle.test.ts:434-458` — "the helper sheds the retired per-pair symbols": source-text absence checks for 7 retired names, plus a regex pinning the `judgePluginSlug` re-export.
- `src/__tests__/core-types.test.ts:59-83` — "Scenario no longer declares the legacy fields" via `@ts-expect-error` on removed fields. The positive shape test (lines 29-57) is a fine type contract; the removal test is transitional.
- `src/__tests__/testing-project-judge-config.test.ts:191-199` and the import-list regex parse at 270-292 (redundant once the config-behavior tests load the config and hooks work).

## 6. `enumerate.ts`: one section-boundary scanner written twice, plus unused generality (~25 lines)

- **Evidence**: `src/scenarios/enumerate.ts:37-67` (`parseListSection`) takes an `isHeading` *predicate* but has exactly one caller (`parseSkillsSection`, line 91, always `SKILLS_HEADING_RE`). Meanwhile `stripSkillsSection` (lines 125-151) re-implements the identical find-heading/find-end scan inline.
- **Do**: extract `findSkillsSectionBounds(lines)`; have both use it; drop the predicate parameter. Behavior heavily covered by `skills-section.test.ts` (16 tests) and `strip-skills-section.test.ts` (8 tests).

## 7. `rubric-loader.ts`: `loadAllRubrics` regex-parses its own output to recover data it already had (latent bug, ~12 lines)

- **Evidence**: `src/scenarios/rubric-loader.ts:116-120` — after `loadRubric` builds a `visited` set internally (line 29), `loadAllRubrics` re-derives the emitted files by matching `SECTION_HEADER_RE` (`^=== (.+?) ===$`) against the concatenated blob.
- **Why it matters**: a rubric whose *body* contains a line like `=== anything ===` (e.g. a fenced example) would be mis-parsed as a section header, polluting `emitted` and potentially silently skipping a real top-level rubric.
- **Do**: have `loadRubric` return `{ text, files }`; delete `SECTION_HEADER_RE` and the re-parse loop.

## 8. Drop the `judgePluginSlug` alias and its tautological test (~20 lines)

- **Evidence**: `wp-env-judge.ts:45` — `export const judgePluginSlug = pluginSlug;` used only inside the same file. `testing-project-judge-config.test.ts:227-240` asserts the alias equals its aliasee — trivially true. Also pinned by the source regex at wp-env-judge-lifecycle.test.ts:450-453.

## 9. Dead parameters in the judge surface (~10 lines)

- `src/pipeline/judge-agent.ts:19-24` — `RunJudgeAgentParams.agentWorkspace` documented ("kept for logging and parity") but never read; the caller threads it (agent-loop.ts:278) for nothing. Removing tightens the isolation story.
- `src/pipeline/judge-agent.ts:312` — `buildUserMessage(_scenario, ...)` unused first param.
- Cost: mechanical updates in `judge-agent.test.ts`.

## 10. Test overlap: `scenarios.test.ts` vs `enumerate-two-file.test.ts` (~90 lines)

Both test `enumerateScenarios()`; merge the unique fixture assertions into one file, extract duplicated `makeProject()`/`writeScenario()` helpers into a shared test helper.

## 11. JUDGE.md boilerplate repeated 11x (design option, ~30 lines + drift risk)

Every brief opens with the identical decision rule and identical rubric sentence; the repetition is *enforced* by the conformance test. The decision-rule opener is scenario-invariant and belongs in the judge role prompt or core's output instruction. Trade-off: briefs become less self-contained.

## 12. The `id`/`dirName`/`scenario.name` triplet (breaking-change candidate — flag only)

`enumerate.ts:191` declares `dirName` as "Compatibility alias for `id`"; `scenario.name` is also always `id`. Three names for one value travel through `RunScenario`, pipeline.ts, README, and the smoke fixture. Removing `dirName` is a real API simplification but breaking — pre-1.0 `minor` with `BREAKING:` prefix.

## 13. Small, cheap wins

- Duplicated sort comparator: `enumerate.ts:279` vs `selection.ts:161-165` (`compareScenarioIds`).
- `buildWorkspaceContents` (`testing-agent.ts:109-126`) and `buildUserMessage` (judge-agent.ts:312-331) duplicate the `=== <rel> ===` file-inlining incl. identical read-error placeholder (join separators differ — unify deliberately).
- `checkPaths` exported from pipeline.ts:573 only for its test — acceptable, but test-motivated surface.

## Verified non-findings (fine as-is)

`src/util/mutex.ts` (justified); provider duplication (SDKs genuinely differ); selection layering (distinct concerns); config fields (all consumed); `src/index.ts` exports (all used); the big behavior test files (distinct phases, little overlap).

**Aggregate**: roughly 800+ removable/collapsible lines, of which ~550 are pure deletions (findings 1-5, 8) requiring no behavior changes.
