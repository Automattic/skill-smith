# Code Plan: Unified cleanup, judge library, and centralized decision rule

## Overview

This plan implements review-4 of Skillsmith (issue #55 / PR #56) in twelve ordered tasks across four streams: (1) a verified, behavior-neutral cleanup — Tasks 1–5 delete the history-scanning test files, the dead judge-env code (`setUpJudgeEnv`/`tearDownJudgeEnv`, `wp-cli.mjs`, the `env:start`/`env:stop` scripts, the `judgePluginSlug` alias), the negative-assertion cohort, the orphaned PNG, and apply the byte-parity core simplifications; (2) the judge library — Task 6 adds the new `src/pipeline/judge-library.ts` module standalone, Task 7 executes the breaking core swap in one atom (config types/validate/normalize/`checkPaths`, the judge-agent prompt rework including the decision-rule default and the missing-material failure duty, agent-loop wiring, `rubric-loader.ts` retirement, and — compile-coupled — `examples/skillsmith.config.ts`), Task 8 migrates the bundled testing-project onto the library; (3) the centralized decision rule — Task 9 drops the 11 briefs' opener, re-points their rubric sentence to the path form, merges the framing sentence into the library manual, and refits the conformance test; (4) ship-now extras — Task 10 adds the `judging: { duration, tokenUsage? }` report block, Task 11 removes `dirName`, and Task 12 lands the three changeset actions. Sequencing keeps every gate green after every task's commit: tombstone tests are deleted before the code they pin (Task 1 → 2), the type removal and the type-checked example migrate in the same atom (Task 7), and the testing-project migration (Task 8) can follow Task 7 in its own commit because config validation runs at load time (`src/config/load.ts:29`), not in `defineConfig` (a verified passthrough) — so `check:config` and the config test suite stay green in between.

## Guardrail scopes

All five code-phase gates are fixed commands with no `{scope}` placeholders; no scope values need filling.

| Gate | Scope |
| ---- | ----- |
| typecheck (`npm run typecheck`) | None (fixed command) |
| lint (`npm run lint`) | None (fixed command) |
| tests (`npm test`) | None (fixed command) |
| config-smoke (`npm --prefix testing-project run check:config`) | None (fixed command) |
| changeset-format (`npx tsx scripts/validate-changesets.ts`) | None (fixed command) |

## E2E test plan

The project ships no e2e harness (tests run via `node --test` over `src/__tests__/*.test.ts`), so every task below is Type `tdd`. These flows are the reviewer's manual re-drive script for the spec's acceptance criteria; where a flow is automatable it names the unit/integration tests that encode it.

### Flow 1: Churn residue is gone, keeps have recorded reasons

- **Steps:** After the final task, from the repo root run: `ls src/__tests__/feature-changeset.test.ts src/__tests__/testing-project-e2e-removal.test.ts src/__tests__/selection-duplicate-name-guard-removed.test.ts src/__tests__/rubric-loader.test.ts src/scenarios/rubric-loader.ts testing-project/eval/utils/wp-cli.mjs assets/skill-tester-workflow.png` (expect all missing); `grep -rn "setUpJudgeEnv\|tearDownJudgeEnv\|judgePluginSlug" src/ testing-project/ --include="*.ts"` (expect empty); `grep -n "env:start\|env:stop" testing-project/package.json` (expect empty); `grep -rn "no longer\|remains removed\|legacy export" src/__tests__/` and confirm no test asserts that removed code stays removed. Read the header of the reframed opaque-brief test file (Task 5) and confirm it records the keep-reason for the kept `enumerate-rubrics` contract.
- **Expected:** every AC1-named casualty is absent; no negative/tombstone assertion survives; the one keep-with-reframe (brief-opaqueness contract) carries its recorded reason.
- **Traces to:** Acceptance criterion 1.

### Flow 2: Cleanup is behavior-neutral

- **Steps:** Check out the commit of Task 5, run all five gates; diff `src/` (non-test) against the pre-revision baseline commit: `git diff <baseline>..<task-5-commit> -- src/ ':!src/__tests__' testing-project/eval/utils/`.
- **Expected:** all gates green; the only non-test source changes are the dead-code deletions, the alias removal, comment/wording fixes, and the byte-parity refactors (shared section-bounds scanner, shared comparator, shared inlining helper) — no observable behavior change. The sanctioned `loadAllRubrics` self-reparse fix is **not** applied anywhere (the loader retires in Task 7 instead).
- **Traces to:** Acceptance criterion 2.

### Flow 3: The judge library supplies material to judges only; removed keys fail loudly

- **Steps:** (a) In a scratch directory, write a `skillsmith.config.ts` using the `mock` provider with `roles: { judge: { agent, library: './judge-lib' } }` and a `judge-lib/` holding `README.md` and `rubrics/sample.md`; drive a run through the `run()` API (mirroring `src/__tests__/smoke.test.ts`) with the mock provider's `invoke` captured. (b) Change the config to set `paths: { rubrics: './judge-lib' }`; reload. (c) Change it to set `roles: { judge: { agent, prompt: 'x' } }`; reload.
- **Expected:** (a) the judge invocation's system prompt contains a `# Judge library` section with the README body inlined and a sorted manifest listing `judge-library/rubrics/sample.md`; on disk `<agent-dir>/judge-workspace/judge-library/` mirrors the library; the testing invocation's system prompt and user message contain none of the library text. (b) and (c) config loading fails with a validation error naming `roles.judge.library` as the migration target. Automated by: `judge-library.test.ts` (Task 6), the agent-loop library tests and `config-validate.test.ts` rejection tests (Task 7).
- **Traces to:** Acceptance criterion 3.

### Flow 4: Missing material fails observably; tool-less judges still get everything

- **Steps:** (a) Configure `roles.judge.library: './does-not-exist'` and start a run. (b) With a real library, read the assembled judge system prompt (mock capture, as in Flow 3) and locate the output-instruction block. (c) Give the judge agent `tools: []` and re-run the capture. (d) Remove the `library` key entirely but keep a brief referencing `judge-library/…`; re-read the output instruction.
- **Expected:** (a) the run refuses to start with a `checkPaths` precondition error naming `roles.judge.library`. (b) the output instruction unconditionally carries the missing-material failure duty (fail the verdict and name the missing item in `notes`) and the selection instruction in the library section says to apply only brief-named items. (c) the prompt inlines every library file body as `judge-library/<rel>`-labelled blocks in place of the manifest, and the disk copy at `judge-workspace/judge-library/` still exists. (d) the failure duty is still present even with no library configured. Automated by: `check-paths.test.ts` (Task 7), `judge-library.test.ts` (Task 6), `judge-agent.test.ts` output-instruction tests (Task 7).
- **Traces to:** Acceptance criterion 4.

### Flow 5: One decision rule, stated once, brief prose overrides

- **Steps:** `grep -rn "Pass only if every check" testing-project/eval/scenarios/*/JUDGE.md` and `head -1` each of the 11 briefs; read the output instruction in `src/pipeline/judge-agent.ts`; inspect an assembled judge prompt for one scenario (Flow 3 capture).
- **Expected:** no brief contains the opener (each now starts at its first heading); the harness output instruction states the all-must-pass default exactly once, phrased with an explicit "unless the brief states its own decision rule" override clause; the assembled prompt contains the rule exactly once.
- **Traces to:** Acceptance criterion 5.

### Flow 6: Coverage parity against `origin/trunk` (reviewer-verified, never test-encoded)

- **Steps:** For each of the 11 briefs, diff the brief against its pre-revision state (`git diff <baseline>..HEAD -- testing-project/eval/scenarios/<id>/JUDGE.md`); then re-derive each brief's check set from the `origin/trunk` sources (the trunk `acceptance:` bullets and e2e observables, per review-3's restoration) and compare.
- **Expected:** the only brief edits are (1) deletion of line 1 (the two-sentence opener) plus its trailing blank line and (2) the rubric sentence re-pointed from the bare id to `judge-library/rubrics/wp-interactivity-api-best-practices.md` in the same sentence slot; every code check (all trunk `acceptance:` bullets), every behavior check (all trunk e2e observables including the two conditional-fallback bullets in `async-fetch`/`config-fetch` and the three setup bullets), and the rubric check are the identical check set — nothing dropped, nothing added. The dropped framing sentence's content ("using both the produced source files and the live, running site") now lives merged into `testing-project/eval/judge/README.md`'s intro. No test or artifact encodes this mapping.
- **Traces to:** Acceptance criterion 6.

### Flow 7: Ship-now dispositions are implemented; the `judging` block obeys its presence rule

- **Steps:** Read the design doc's disposition table and confirm each ship-now item maps to a task here (proposal 1 → Tasks 6–8, proposal 3 → Tasks 7+9, proposal 6 scoped → Task 10, `dirName` → Task 11). For the report block: run the mock-provider suite and read a per-pair `report.json` on (a) the normal path, (b) a testing-failure path, (c) a judge-dispatch-throw path.
- **Expected:** (a) `report.json` is `{ testing, judging, review }` with `judging.duration` a number and `judging.tokenUsage` present (the mock provider reports usage); (b) `judging` is entirely omitted while `review` carries the `{ skipped }` marker; (c) `judging` is present with `duration` and without `tokenUsage`. No field is zero-filled. Automated by: Task 10's agent-loop and smoke tests.
- **Traces to:** Acceptance criterion 7.

### Flow 8: Gates and changesets

- **Steps:** Run all five gates, then `npx changeset status` and `ls .changeset/*.md`; read the three touched changesets together.
- **Expected:** all gates pass; `.changeset/` holds the rewritten `flexible-scenarios-judge-verification.md` (still `minor` + `BREAKING:`, prose describes the judge-library model, not load-all), one new `minor` changeset with a `BREAKING:` summary prefix covering the wave (removed keys → `roles.judge.library` with migration recipe, centralized decision rule, `dirName` removal), and one new `minor` non-breaking changeset for the `judging` block stating its presence rule; no changeset uses `major`; no changeset text still describes the retired load-all model.
- **Traces to:** Acceptance criterion 8 (and R7).

## Tasks

Standing rules for every task:

- **Coverage parity is untouchable (spec R6/AC6):** no task may change any brief's check content. The only permitted brief edits, in Task 9 only, are the opener-line deletion and the rubric-sentence re-point. No task adds a coverage-encoding test or mapping artifact.
- **Grading material is judge-only (spec R3/AC3):** `src/pipeline/testing-agent.ts`'s prompt assembly is not modified by any task (Task 4 only relocates its private inlining helper, byte-identically).
- **No new negative/tombstone tests:** no task adds an assertion that removed code stays removed (e.g. no "briefs do not contain the opener" test).
- **Gates:** every task finishes by running all five guardrails (`npm run typecheck`, `npm run lint`, `npm test`, `npm --prefix testing-project run check:config`, `npx tsx scripts/validate-changesets.ts`) and commits only when all pass.

### Task 1: Delete the history-scanning test files and the orphaned asset; relocate the live selection test

- **Goal:** Remove the three pure-tombstone test files (one of which is guaranteed to break CI on this revision's own changesets) and the orphaned workflow PNG, preserving the single live behavior test they contain.
- **Type:** tdd
- **Files to change:**
  - Delete `src/__tests__/feature-changeset.test.ts`
  - Delete `src/__tests__/testing-project-e2e-removal.test.ts`
  - Delete `src/__tests__/selection-duplicate-name-guard-removed.test.ts`
  - Edit `src/__tests__/scenario-filter-selection.test.ts`
  - Delete `assets/skill-tester-workflow.png`
- **Changes:**
  - Relocate the one live test from `selection-duplicate-name-guard-removed.test.ts` — `'sibling scenarios with distinct ids both select with no duplicate-name path'` (line 25) — into `scenario-filter-selection.test.ts` (the unit-level home of `selectScenariosByFilters`, which it already imports; this is the design's corrected target, not the CLI-level `scenario-selection.test.ts`). Retitle it positively (assert that nested sibling leaves with distinct ids both select — no "no longer"/"removed" phrasing) and adapt it to that file's existing fixture helper. Then delete the source file, including its export-scan tombstone (line 18).
  - Delete `feature-changeset.test.ts` outright (not reduce): its blocks pin changeset filenames/prose that this revision's mandatory changesets falsify, and its "exactly one feature changeset" assertion would fail on Task 12. The durable validation is redundant — `changeset-gate.yml` runs `scripts/validate-changesets.ts` over the real `.changeset/` on every PR and the validator has its own test (`validate-changesets.test.ts`, untouched).
  - Delete `testing-project-e2e-removal.test.ts` whole: pure negative space; its `env:start`/`env:stop` "must be retained" pin (lines 106–107) would cement Task 2's dead consumers.
  - Delete `assets/skill-tester-workflow.png` (zero references — verified); keep `assets/self-improvement-loop.png` (live in README).
- **Depends on:** none
- **Traces to:** Spec R1; Acceptance criterion 1 (named casualties `feature-changeset.test.ts`, `testing-project-e2e-removal.test.ts`), criterion 2; design decision "Cleanup plan" findings 4, 5, 7, 8.
- **Acceptance:**
  - The three test files and the PNG no longer exist; `npm test` passes.
  - `scenario-filter-selection.test.ts` contains a positively-titled test proving nested sibling leaf scenarios with distinct ids are both selected, and it fails if selection drops one of them.
  - No remaining test asserts on the contents, filenames, or count of the repository's own `.changeset/` directory (the kept `validate-changesets.test.ts` exercises the validator against synthetic temp-dir fixtures and stays); no remaining test references `env:start`/`env:stop` or scans for removed migration tokens.

### Task 2: Delete the dead judge-env code, `wp-cli.mjs`, the env scripts, and the `judgePluginSlug` alias; excise their tombstones from the lifecycle and judge-config tests

- **Goal:** Remove every dead testing-project runtime surface the audit confirmed (zero production callers) together with the tests that pin it, keeping all live positive contracts — with zero behavior change.
- **Type:** tdd
- **Files to change:**
  - `testing-project/eval/utils/wp-env-judge.ts`
  - Delete `testing-project/eval/utils/wp-cli.mjs`
  - `testing-project/package.json`
  - `testing-project/eval/utils/scaffold-plugin.ts`
  - `src/__tests__/wp-env-judge-lifecycle.test.ts`
  - `src/__tests__/testing-project-judge-config.test.ts`
- **Changes:**
  - `wp-env-judge.ts`: delete the dead `setUpJudgeEnv` (lines 323–364) and `tearDownJudgeEnv` (lines 375–390) functions and their doc comments; remove `execSync` from the line-1 import (its only uses were inside the deleted pair; keep `execFileSync`); delete the `export const judgePluginSlug = pluginSlug` alias (line 45) and switch the surviving internal call sites (`installPluginForPair` line 264, `cleanUpPair` line 304) to `pluginSlug` directly; fix the line-10 comment clause that references the deleted sibling `wp-cli.mjs`.
  - Delete `wp-cli.mjs` (dead: the real call path is `commands.wpCli(...)` inside `wp-env-judge.ts`).
  - `testing-project/package.json`: delete the `env:start` and `env:stop` scripts (after Task 1 and this task's test surgery, their only consumers are their own definitions; each is a thin alias of `npx wp-env start|stop` from the testing-project root — the crash-recovery use survives as a manual command, documented in phase 5, not here).
  - `scaffold-plugin.ts` (lines ~91–97): fix the stale doc-comment wording — per-pair activation is `installPluginForPair`'s job, not "the e2e run". Comment-only change.
  - `wp-env-judge-lifecycle.test.ts`: delete the retired-symbol scan test (`'the helper sheds the retired per-pair symbols but keeps the slug re-export and fixed port'`, lines 434–458 — its port fact is already asserted behaviorally by the boot test) and the `wp-cli` sentinel test (lines 460–474) plus the `WP_CLI_PATH` constant (line 35); delete the env-var negative assertions inside `'installPluginForPair exports the bridge env vars…'` (lines ~276–285), keeping the positive exports; replace every `judgePluginSlug` usage (the helper type at line 65 and the six destructure sites) with `pluginSlug` imported from `testing-project/eval/utils/scaffold-plugin`. All positive lifecycle assertions stay.
  - `testing-project-judge-config.test.ts`: delete the legacy-export tombstone test (`'setUpJudgeEnv and tearDownJudgeEnv remain exported (legacy orchestrators)'`, lines 242–254) and the tautological `judgePluginSlug` test (line 227 block — the slug contract is covered behaviorally by the lifecycle tests); inside the live wiring tests, delete the negative regexes (the `runE2eVerification`/`verify-e2e` greps at lines ~142–150 and the `setUpJudgeEnv`/`tearDownJudgeEnv` negatives at lines ~192–199), keeping every positive wiring assertion; if the exported/imported-helpers test (line 256 block) names the deleted symbols, prune them from its expected lists, keeping the live-helper positives. Rewrite the stale file header from the per-pair-boot model to the run-level warm-env model (boot once in `beforeAllScenarios`, per-pair install/clean-up, stop in `afterAllScenarios`).
- **Depends on:** Task 1 (deletes the file pinning `env:start`/`env:stop` as retained)
- **Traces to:** Spec R1, R2 (simplification finding 8); Acceptance criteria 1 (named casualties `setUpJudgeEnv`/`tearDownJudgeEnv`, `wp-cli.mjs`; no legacy-export assertions), 2; design decision "Cleanup plan" findings 1, 2, 3, 6, 9, 10, `env:start`/`env:stop`, and simplification 8.
- **Acceptance:**
  - `grep -rn "setUpJudgeEnv\|tearDownJudgeEnv\|judgePluginSlug"` over `src/` and `testing-project/` returns nothing; `wp-cli.mjs` is gone; `testing-project/package.json` has no `env:*` scripts.
  - Every surviving lifecycle/judge-config test asserts live behavior positively (boot idempotence, install/clean-up, env-var exports, hook wiring); none scans source text for absent symbols.
  - `npm test` and `npm --prefix testing-project run check:config` pass; no runtime behavior of `bootJudgeEnv`/`installPluginForPair`/`cleanUpPair`/`stopJudgeEnv` changed.

### Task 3: Purge the negative-assertion cohort in the core test files

- **Goal:** Remove the pivot-era negative assertions in core tests, keeping (and positively reframing) every live contract they shadow — no source-code change.
- **Type:** tdd
- **Files to change:**
  - `src/__tests__/core-types.test.ts`
  - `src/__tests__/check-paths.test.ts`
  - `src/__tests__/scaffold-block-name.test.ts`
  - `src/__tests__/judge-agent.test.ts`
- **Changes:**
  - `core-types.test.ts`: delete the negative test `'Scenario no longer declares the legacy fields'` (lines 59–83, the `@ts-expect-error` block). Keep the positive `Scenario` shape test (lines 29–57) and the `Paths` test (refits later in Task 7).
  - `check-paths.test.ts`: reframe `'DEFAULT_PATHS no longer contains a rubrics key'` (lines 35–47) into a positive defaults contract — assert `DEFAULT_PATHS`'s key set is exactly `base`/`skills`/`scenarios` under a positive title; drop the `rubrics`-is-`undefined` probe.
  - `scaffold-block-name.test.ts`: delete the two pure source-text tombstones — `'the scaffold source no longer hard-codes the skillsmith/testing-block name'` (line 105 block) and `"the scaffold's doc comment no longer claims the block name is fixed"` (line 113 block) — and the prompt-text tombstone `'the testing-agent prompt no longer forbids renaming or restructuring the block'` (line 171 block). Reframe the behavioral scaffold-output test `"the scaffolded block.json no longer pins skillsmith/testing-block"` (lines 96–102) positively: assert the scaffolded `block.json` carries the derived per-pair block name — or fold that assertion into the existing positive `'the plugin slug stays deterministic…'` test if that is less redundant (implementation judges which; the derived-name behavior must stay asserted either way).
  - `judge-agent.test.ts`: delete the dead-param tombstone `'buildUserMessage does not read scenario.description or any removed scenario field'` (lines 406–421) — it pins the unused `_scenario` parameter that Task 7 removes; the live inlining payload is covered by the tests at lines 372 and 397.
- **Depends on:** none
- **Traces to:** Spec R1; Acceptance criteria 1 ("no test asserts that removed code stays removed"), 2; design decision "Cleanup plan" finding 11 (cohort items i–iii and the judge-agent tombstone).
- **Acceptance:**
  - None of the four files contains an assertion phrased as "no longer" / absence-of-legacy; `npm test` passes.
  - The `DEFAULT_PATHS` exact key-set contract and the scaffold derived-block-name behavior are still asserted, each under a positive title.

### Task 4: Byte-parity core simplifications in `src/` (shared scanner, shared comparator, shared inlining helper)

- **Goal:** Apply the verification-confirmed duplications' unification with byte-identical outputs — no observable behavior change.
- **Type:** tdd
- **Files to change:**
  - `src/scenarios/enumerate.ts`
  - `src/scenarios/selection.ts`
  - `src/pipeline/workspace-snapshot.ts`
  - `src/pipeline/testing-agent.ts`
  - `src/pipeline/judge-agent.ts`
- **Changes:**
  - **Finding 6 — shared skills-section scanner:** in `enumerate.ts`, extract a shared section-bounds helper (e.g. `findSkillsSectionBounds( lines )`) that owns the boundary rule both `parseListSection` (used by `parseSkillsSection`) and `stripSkillsSection` currently re-implement (first heading whose text matches `Skills` case-insensitively at any depth; section ends before the next same-or-shallower heading). Both consumers use it; drop the now-single-caller `isHeading` predicate parameter by inlining the `SKILLS_HEADING_RE` match (the predicate has exactly one caller — verified). Parsing/stripping outputs must be byte-identical; the 19+8 existing tests (`skills-section.test.ts`, `strip-skills-section.test.ts`) pin this.
  - **Finding 13a — one comparator:** move `compareScenarioIds` (currently private in `selection.ts` lines 161–166) into `enumerate.ts` as an export (that direction keeps the module dependency one-way: `selection.ts` already imports from `enumerate.ts`); `selection.ts` imports it; replace `enumerate.ts`'s inline sort comparator (line 279) with it. The two are byte-equivalent today (verified), so sort order is unchanged.
  - **Finding 13b — one file-inlining helper:** extract the duplicated `=== <rel> ===\n<body>` block building (with the identical `<read error: …>` placeholder) shared by `testing-agent.ts`'s `buildWorkspaceContents` (lines 109–126) and `judge-agent.ts`'s `buildUserMessage` (lines 312–331) into one helper in `workspace-snapshot.ts`, **parameterized by separator, empty fallback, and missing-file handling** so both outputs stay byte-identical: testing-agent joins with `'\n\n'`, falls back to `'(empty workspace)'`, and reads every snapshot key (no existence check); judge-agent joins with `'\n'`, falls back to `'=== (no files written) ==='`, and skips non-existent files (`existsSync` continue). No prompt text changes; the existing judge-agent and testing-agent tests pin both shapes.
  - Leave the `checkPaths` export in `pipeline.ts` as-is (test-only consumer; not public surface — recorded decision).
  - Do **not** touch `rubric-loader.ts` (finding 7 is moot: the module retires wholesale in Task 7; the self-reparse fix is deliberately not applied).
- **Depends on:** Task 3 (the dead-param tombstone in `judge-agent.test.ts` is already gone, so `buildUserMessage`'s body can be refactored freely; its signature changes later in Task 7)
- **Traces to:** Spec R2 (simplification findings 6, 13; finding 7 mooted); Acceptance criterion 2; design decision "Cleanup plan — Core simplifications".
- **Acceptance:**
  - `enumerate.ts` contains exactly one implementation of the skills-section boundary rule, consumed by both the parser and the stripper; all existing section tests pass unmodified.
  - Exactly one scenario-id comparator exists (exported from `enumerate.ts`, used by both `enumerate.ts` and `selection.ts`); enumeration and selection ordering tests pass unmodified.
  - Exactly one `=== <rel> ===` inlining implementation exists; the testing-agent workspace dump and the judge user message are byte-identical to before (existing tests for the `(empty workspace)` and `=== (no files written) ===` fallbacks and the read-error placeholder pass unmodified).

### Task 5: Merge the overlapping enumeration tests; reframe `enumerate-rubrics.test.ts` as the opaque-brief contract

- **Goal:** Collapse the three copies of the enumeration test scaffolding into one shared helper, merge the overlapping test files, and keep the live brief-opaqueness contract under an honest name with its keep-reason recorded.
- **Type:** tdd
- **Files to change:**
  - New `src/__tests__/helpers/scenario-project.ts` (any name under `src/__tests__/helpers/` that does not match the `*.test.ts` glob)
  - `src/__tests__/scenarios.test.ts`
  - Delete `src/__tests__/enumerate-two-file.test.ts`
  - Rename `src/__tests__/enumerate-rubrics.test.ts` → `src/__tests__/enumerate-opaque-briefs.test.ts`
- **Changes:**
  - Extract the duplicated `makeProject`/`writeScenario` fixture builders (three copies: `scenarios.test.ts:231-`, `enumerate-two-file.test.ts:16-`, `enumerate-rubrics.test.ts:25-46`) into the shared helper module.
  - Merge `enumerate-two-file.test.ts` into `scenarios.test.ts` per the following complete per-test disposition (all 14 tests, re-verified test-by-test; line numbers refer to the pre-task files), then delete `enumerate-two-file.test.ts`. **Carry over — four uniquely-covered live contracts, merged as one test each:**
    - `:191` (empty `# Skills` section is valid): no error and `skills: []` — distinct from `scenarios.test.ts:75`, which covers a *missing* section.
    - `:224` (multiple unknown skills): the error is the exact comma-joined message `unresolved reference: skill "ghost", skill "phantom"` — also the only pin of the `skill "<id>"` quoting format.
    - `:242` (known/unknown mix): the error names only the unknown skill while `scenario.skills` keeps both — carry its `writeSkill` fixture helper into the shared helper module.
    - `:260` (missing scenarios root): a project with no `scenarios/` directory yields `[]` without throwing.
  - **Drop as duplicates — each covered by the named surviving `scenarios.test.ts` test:**
    - `:46` (full-shape both-briefs discovery) → `:41` (verbatim briefs, skills parse, no error) plus `:142` (`name === id` for every result, exact-set emission).
    - `:71` (brief-only directory layout) → `:41` (its fixture writes exactly the two briefs; discovery by brief presence alone is what it proves).
    - `:87` (nested slash-joined id and name) → `:142` (asserts the `blocks/counter` and `groups/deeper` ids with `name === id`).
    - `:104` (grouping folder not emitted, children walked) → `:142` (`groups` is not emitted while `groups/deeper` is).
    - `:127` and `:152` (missing `JUDGE.md`/`TESTING-AGENT.md` errors) → `:112`, which asserts both directions with the error naming the file. **Rider fold:** their stub-shape assertions are unique — an errored entry still carries `name === id`, the readable brief verbatim, `''` for the missing file, and `skills: []` — fold them into `scenarios.test.ts:112` so this live contract survives the merge.
    - `:173` (missing-`# Skills` flag) → `:75` (same error path; `:75`'s prefix match pins it).
    - `:207` (single unknown skill) → `:93` and the fixture test `:20`; its quoting-format rider is subsumed by the carried-over `:224`.
    - `:270` (sorted ids across nested and sibling scenarios) → `:142` (exact sorted id array across nested/sibling, `dirName === id`).
    - `:293` (errored scenarios appear in sorted output alongside valid ones) → `:188` (exact sorted array mixing errored and valid entries, errors matched).
  - `scenarios.test.ts` keeps its unique unresolved-refs, no-skills, unknown-skill, ordering, and nested-error tests. `dirName` assertions may be carried over as-is (they die in Task 11).
  - Reframe the rubrics file as the opaque-brief contract (**keep-with-reframe — recorded keep-reason, a correction of the report's "delete" verdict**): rename to `enumerate-opaque-briefs.test.ts` with a header recording why it stays — its tests encode the live never-validate-briefs-at-enumeration contract (`JUDGE.md` is stored verbatim, nothing structured is parsed or validated from it), which remains true and load-bearing under the library model. Drop the pivot framing and the `PATHS_WITH_RUBRICS` fixture (use a plain `Paths` value without `rubrics` — the field is optional today and dies in Task 7); keep the verbatim-judgeBrief test (line 48) and the literal-`# Rubrics`-heading opaqueness test (line 93); merge the duplicated pair (lines 69 and 115) into one test proving no reference named in brief prose is existence-validated at enumeration; drop the line-140 test (its skill-validation half duplicates `scenarios.test.ts`'s unknown-skill coverage; its rubric-negative rider is tombstone material); move it onto the shared helper.
- **Depends on:** Task 4 (none of its changes conflict, but sequencing the test-file surgery after the source refactor keeps each commit's diff single-purpose)
- **Traces to:** Spec R1 (pollution finding 11.iv), R2 (simplification finding 10); Acceptance criteria 1 (keep-reason recorded), 2; design decision "Cleanup plan" finding 11 and "Core simplifications" finding 10.
- **Acceptance:**
  - Exactly one `makeProject`/`writeScenario` implementation exists under `src/__tests__/`, used by both surviving enumeration test files.
  - `enumerate-two-file.test.ts` is gone and the per-test disposition above is fully realized in `scenarios.test.ts`: the four carried-over contracts (empty-`# Skills`-valid, multi-unknown comma-joined error, known/unknown mix flags only the unknown, missing-scenarios-root returns `[]` without throwing) are each asserted exactly once; the one-brief-missing test also asserts the stub shape (`name === id`, readable brief verbatim, `''` for the missing file, `skills: []`); no behavior asserted anywhere in the deleted file is left unasserted by the merged suite.
  - `enumerate-opaque-briefs.test.ts` exists, its header records the keep-reason, it contains no `PATHS_WITH_RUBRICS`/pivot framing, and it fails if enumeration starts parsing or validating judge-brief content.

### Task 6: The `judge-library` module

- **Goal:** Add `src/pipeline/judge-library.ts` — the standalone owner of the library mechanics (tool-less predicate, per-pair copy with collision guard, prompt-section building) — fully unit-tested, wired to nothing yet.
- **Type:** tdd
- **Files to change:**
  - New `src/pipeline/judge-library.ts`
  - New `src/__tests__/judge-library.test.ts`
- **Changes:**
  - Implement the design's interface exactly:
    ```ts
    type JudgeLibrarySection = { text: string; mode: 'mounted' | 'inline' };
    prepareJudgeLibrary( opts: {
      projectRoot: string;
      libraryPath: string;      // roles.judge.library (project-relative)
      judgeWorkspace: string;   // copy destination parent (the judge cwd)
      capabilities: JudgeCapabilities;
    } ): JudgeLibrarySection | undefined
    ```
  - Resolve `libraryPath` against `projectRoot` (same convention as every `paths.*` consumer). When the resolved library contains no files at all (empty directory — no README, nothing), return `undefined` and perform no copy: the section is omitted, mirroring today's empty-rubrics behavior; not an error.
  - **Tool-less predicate:** the judge is tool-less iff `capabilities.tools` is an explicit array containing neither `'Read'` nor `'Bash'` (this includes `tools: []`). An unset `tools` is never tool-less (provider defaults always read). No new config knob.
  - **Disk contract, mode-independent:** for a non-empty library, copy the whole directory (README included — faithful mirror) to `<judgeWorkspace>/judge-library/` in **both** modes, reusing the `copyWorkspaceForJudge` mechanics (recursive `cpSync`; import it or mirror its two lines). Before copying, run the collision guard: if `judgeWorkspace` already contains a top-level entry named `judge-library`, throw a descriptive error (deterministic, mode-independent). `mode` controls only the prompt-section shape, never the disk lifecycle.
  - **Section text** (the returned `text` is the complete prompt section, heading included, so the judge agent stays a dumb joiner), in order:
    - `# Judge library` heading;
    - (a) the library `README.md` body inlined verbatim when present (the environment manual; omitted when absent);
    - (b) *mounted mode:* the manifest — a fixed lead-in naming `judge-library/` in the judge's working directory plus the sorted list of relative paths as `judge-library/<rel>`, derived via `snapshotWorkspace` over the copied directory; *inline mode:* each file's body as a `judge-library/<rel>`-labelled block instead of the manifest (the README body therefore appears twice in inline mode — as the manual and as its labelled block; accepted by design);
    - (c) the selection instruction: apply only the library items the scenario's brief names; the rest is reference-only material and must not affect the verdict. (The missing-material failure duty does **not** live here — it lands in the always-present output instruction in Task 7.)
  - Exact lead-in/instruction phrasing is polished in implementation; the semantics above are fixed. Test selection is the code-writer's TDD, driven by this task's Acceptance.
- **Depends on:** none
- **Traces to:** Spec R3 (single judge-scoped directory; inlining degradation; observable failure); Acceptance criteria 3, 4; design decisions "Two-tier supply, copied per pair inside the judge cwd", "Tool-less degradation rule", "The selection lead-in dies".
- **Acceptance:**
  - `prepareJudgeLibrary` exists with the design's exact signature, unit-covered at the module level in the new `judge-library.test.ts`; `npm test` passes.
  - For a non-empty library the per-pair copy at `<judgeWorkspace>/judge-library/` and the top-level collision guard run identically in mounted and inline modes; only the section text differs between modes.
  - The section text carries, in order: the `# Judge library` heading; the README manual when `README.md` is present (omitted when absent, with the rest of the section still emitted); the sorted manifest (mounted) or the labelled file bodies (inline); and the selection instruction.
  - A judge whose explicit `tools` array lacks both `Read` and `Bash` — including `tools: []` and `tools: ['WebSearch']` — receives every file body as `judge-library/<rel>`-labelled blocks; any other capability shape (`tools` unset, or an array containing `Read` or `Bash`) receives the manifest.
  - Nested library files appear with `/`-joined relative paths (`judge-library/<dir>/<file>`) in both the manifest and the inline labels.
  - An empty configured library yields `undefined` (no section, no error) and creates no `judge-library/` directory; a `judge-library` collision in the destination throws with a message naming the collision.

### Task 7: The breaking core swap — `roles.judge.library` replaces `roles.judge.prompt` + `paths.rubrics`; judge-agent and agent-loop rework; `rubric-loader` retires

- **Goal:** Replace the two judge-material channels with the library across the core in one compile-coupled atom: config surface (types/validate/normalize/gate), prompt assembly (new section layout, decision-rule default, missing-material duty, finding-9 param removals), agent-loop wiring, loader deletion, and the type-checked reference example.
- **Type:** tdd
- **Files to change:**
  - `src/config/types.ts`, `src/config/validate.ts`, `src/config/normalize.ts`
  - `src/pipeline/pipeline.ts` (`checkPaths`)
  - `src/pipeline/judge-agent.ts`, `src/pipeline/agent-loop.ts`
  - `src/index.ts`
  - `examples/skillsmith.config.ts` (**same atom — it is type-checked by the root tsconfig (`include` covers `examples/**/*`) and sets both removed surfaces; splitting would break the typecheck gate**)
  - Delete `src/scenarios/rubric-loader.ts`, `src/__tests__/rubric-loader.test.ts`
  - Test refits (existing files): `src/__tests__/judge-agent.test.ts`, `src/__tests__/config-validate.test.ts`, `src/__tests__/core-types.test.ts`, `src/__tests__/check-paths.test.ts`; any new test files are the code-writer's TDD, driven by this task's Acceptance
- **Changes:**
  - **`types.ts`:** split the judge input type off `SingleRoleInput` (the shared type can no longer express judge and improver truthfully): add `JudgeRoleInput = string | { agent: string; library?: string; concurrency?: JudgeConcurrency }`; narrow `SingleRoleInput` to `string | { agent: string; prompt?: string }` (improver keeps it; `TestRoleInput` unchanged). `RolesInput.judge` becomes `JudgeRoleInput`. `NormalizedRoles.judge` becomes `{ agent: AgentDefinition; library?: string; concurrency: JudgeConcurrency }` (drops `prompt`). `Paths` loses `rubrics` and its doc comment. (`dirName` is untouched here — Task 11.)
  - **`validate.ts`:** judge role validation moves off `validateSingleRole` onto a judge-specific path that (1) rejects a set `prompt` key with a migration message naming `roles.judge.library` (e.g. "roles.judge.prompt was removed — move the manual into the library's README.md and set roles.judge.library"; exact phrasing polished in implementation, must name the new key), (2) accepts an optional `library` that must be a non-empty string, (3) keeps the agent-id and concurrency checks. Add a paths check that rejects a set `paths.rubrics` with a migration message naming `roles.judge.library` (today `paths` is not validated at all, so without this the breaking change would be silent — reject the named removed key only; do not start rejecting unknown keys generally). Because the input type no longer carries the removed keys, read them via a safe cast (the same `as any` pattern the existing invalid-value tests use) — the rejection is a runtime contract for JS/stale-TS consumers.
  - **`normalize.ts`:** `normalizeJudgeRole` carries `library` through (present only when set); it no longer carries `prompt`. `normalizeSingleRole` stays for the improver.
  - **`pipeline.ts` `checkPaths`:** when `config.roles.judge.library` is set, resolve it against `projectRoot`; missing or not-a-directory produces a `PreconditionError` entry naming `roles.judge.library` (same shape as the `paths.*` entries). Unset `library` is fine (opt-in).
  - **`judge-agent.ts`:**
    - Delete the `loadAllRubrics` import and call, `RUBRIC_SELECTION_LEAD_IN`, and the `rubricBlob` plumbing.
    - `RunJudgeAgentParams`: remove `agentWorkspace` (documented "kept for logging and parity", never read — finding 9); add `librarySection?: string` (the pre-built section text). Remove the `config` param **if** nothing else reads it after the `roles.judge.prompt` read disappears (verify; `paths` is no longer read here) — otherwise keep it. `buildJudgeSystemPrompt` becomes a pure joiner over `( scenario, task, librarySection? )`: sections are `judgeBrief`, `# Testing task`, the output instruction, then the library section text verbatim when provided. System-prompt assembly is now filesystem-free; `buildUserMessage` loses its unused `_scenario` param (finding 9) but keeps its judge-copy `readFileSync` inlining exactly as Task 4 left it.
    - **Output instruction** (always present, in the existing block between the JSON-shape text and `# Recursion guard`): add (1) the decision-rule default with an explicit override clause — sketch: "Decision rule: unless the brief states its own decision rule, return `"pass": true` only if every check the brief asks for — including any rubric check — is satisfied; otherwise return `"pass": false`." — and (2) the unconditional missing-material failure duty — if the brief references grading material that was not supplied or cannot be read, return `pass: false` and name the missing item in `notes`. The duty is deliberately phrased against *supplied grading material* (not "the manifest") so it holds identically in mounted mode, inline mode, and when no library is configured at all. Exact wording polished in implementation; both sentences and their placement in this block are fixed.
    - Update the rubric-count log line (no rubric loading exists anymore).
  - **`agent-loop.ts`:** inside the judge mutex bracket, after `copyWorkspaceForJudge` and **before** `beforeJudgeAgent` (hook parity), when `config.roles.judge.library` is set: call `prepareJudgeLibrary` with `{ projectRoot, libraryPath, judgeWorkspace, capabilities: judgeCapabilities( config.roles.judge.agent ) }` (import `judgeCapabilities` from `judge-agent.ts`) and pass the returned section text into `runJudgeAgent` as `librarySection`. A throw from `prepareJudgeLibrary` (collision guard, copy I/O) fails the **pair** loudly, not the run: catch it, mark the judge phase failed on the tracker, write the report with a `{ pass: false, error: <message> }` review, and skip the judge invocation (release the mutex via the existing `finally`). Drop the now-removed `agentWorkspace` argument from the `runJudgeAgent` call.
  - **`src/index.ts`:** export `JudgeRoleInput` alongside the existing type surface (`SingleRoleInput` stays exported for the improver). Verified fact for the plan: **no `rubric-loader` symbol is exported from `src/index.ts`** (checked — the file has zero rubric references), so the loader's deletion removes no public export and Task 12's changeset need not name loader symbols.
  - **Delete `rubric-loader.ts` + `rubric-loader.test.ts`:** orphaned — its only non-test caller was the judge agent's load-all call (verified: `judge-agent.ts:11,77` are the only src references). The sanctioned self-reparse fix is thereby superseded, not applied.
  - **`examples/skillsmith.config.ts` (minimum edit, comment-split rule):** on the judge role, replace `prompt: judgePrompt` with `library: './eval/judge'`; delete the `judgePrompt` `readFileSync` block and its attached comment (the `readFileSync` import stays — testing/improver prompts still use it); delete the `paths.rubrics` key together with its attached comment block; minimally rewrite the judge-role comment block (it currently documents `prompt` semantics) so no comment names a removed key — describe the `library` knob in a few lines (judge-scoped directory; `README.md` inlined as the environment manual; contents copied per pair to `judge-library/` in the judge's working directory; briefs name items by relative path). The fuller consumer-docs prose realignment stays phase 5. The hook comments destructuring `judgeWorkspace` are untouched (that identifier survives).
  - **Test refits:**
    - `judge-agent.test.ts`: delete the role-instructions pair (lines 170, 184), the rubric-section trio (254, 278, 302), the `paths.rubrics` trio (633, 689, 719), and the `G2_SENTINEL`; refit `makeConfig` (no `prompt`/`rubricsDir` params) and every `buildJudgeSystemPrompt`/`runJudgeAgent` call to the new signatures; refit the output-instruction test (line 127), the testing-task placement test (198), and the no-rubric scaffolding test (154) to the new section layout. Coverage of the two new output-instruction sentences and of the `librarySection` passthrough is the code-writer's TDD, driven by this task's Acceptance.
    - `config-validate.test.ts`: remove the judge-`prompt` validation pair (lines 215, 229) — they pin the removed acceptance of `prompt`; the accept/reject contract that supersedes them (`library`, `prompt`, `paths.rubrics`) is stated in this task's Acceptance and covered by the code-writer's TDD.
    - `core-types.test.ts`: refit the `Paths` test (line 85 block) to exactly `base`/`skills`/`scenarios` (drop the `withRubrics` half).
    - `check-paths.test.ts`: refit the stale rubrics-comment test (line 49); the library gate's accept/reject behavior is stated in this task's Acceptance and covered by the code-writer's TDD.
  - Not affected (verified): `judge-concurrency-config.test.ts`, `testing-agent.test.ts`, `self-improvement*.test.ts`, and the smoke/target fixtures build judge roles without `prompt`/`rubrics`; `testing-project` keeps its old config keys until Task 8 — nothing gates on validating it (its `check:config` executes `defineConfig`, a passthrough; the config tests read the raw object and still pass unchanged until Task 8 refits them).
- **Depends on:** Task 3 (judge-agent tombstone gone), Task 4 (inlining helper landed; this task only changes `buildUserMessage`'s signature), Task 6 (`prepareJudgeLibrary`)
- **Traces to:** Spec R3 (channel replacement, loud rejection, inlining degradation, observable failure), R4 (decision-rule home), R2 (finding 9); Acceptance criteria 3, 4, 5 (the "stated once in the design-chosen home" half); design decisions "Config key is roles.judge.library", "Two-tier supply", "Tool-less degradation", "Observable failure … layered", "Decision rule lives in the harness output instruction", "Selection lead-in dies", plus the Components/Interfaces sections.
- **Acceptance:**
  - `roles.judge.prompt` and `paths.rubrics` no longer exist in any type, normalizer, or runtime read; a config setting either fails `collectConfigErrors` with a message naming `roles.judge.library`. An optional `roles.judge.library` must be a non-empty string (any other set value fails validation) and normalizes through as `library?` on `NormalizedRoles.judge`. A configured `library` that is missing or not a directory fails the run at `checkPaths` with a `PreconditionError` naming `roles.judge.library`; an unset `library` or an existing directory passes.
  - The judge system prompt is assembled filesystem-free from: verbatim brief, `# Testing task`, the output instruction (JSON shape + decision-rule default with override clause + missing-material failure duty + recursion guard — the two new sentences present on every judge run, library or not), and — only when a library is configured and non-empty — the `librarySection` text passed in by the agent loop, verbatim, as the final section; when no section is passed, no library material appears anywhere in the prompt.
  - In a mock end-to-end pair with a library configured: the library is on disk at `judge-workspace/judge-library/` before `beforeJudgeAgent`, the judge prompt carries the section, and the testing invocation's system prompt and user message carry none of the library text (the grading-leak invariant, end-to-end); a pre-seeded top-level `judge-library` entry fails that pair with the collision error recorded in its `report.json` while the run continues.
  - `rubric-loader.ts`, its test, and `RUBRIC_SELECTION_LEAD_IN` are gone; `RunJudgeAgentParams` has no `agentWorkspace`; `buildUserMessage` has no scenario param.
  - `examples/skillsmith.config.ts` type-checks against the new surface, sets `library` on the judge role, and contains no comment naming a removed key; `npm run typecheck` (which covers `examples/**/*`) passes.

### Task 8: Testing-project migration onto the library

- **Goal:** Relocate the bundled testing-project's judge material into `eval/judge/` and swap its config to `roles.judge.library`, refitting the config conformance test — briefs untouched.
- **Type:** tdd
- **Files to change:**
  - `testing-project/eval/prompts/judge.md` → `testing-project/eval/judge/README.md` (git mv, content unchanged in this task)
  - `testing-project/eval/rubrics/wp-interactivity-api-best-practices.md` → `testing-project/eval/judge/rubrics/wp-interactivity-api-best-practices.md` (git mv; `eval/rubrics/` is then gone)
  - `testing-project/skillsmith.config.ts`
  - `src/__tests__/testing-project-judge-config.test.ts`
- **Changes:**
  - Move the manual and the rubric as above. The rubric is self-contained (zero markdown links — the retired loader's BFS expansion was a no-op for it; verified), so the move is behavior-identical. The framing-sentence merge into `README.md` happens in Task 9, not here.
  - `skillsmith.config.ts`: delete the `judgePrompt` `readFileSync` block; judge role becomes `{ agent: 'opus', library: './eval/judge', concurrency: 'serial' }`; delete the whole `paths` block (with `rubrics` gone the project sets no `paths` overrides) together with its rubrics comment; rewrite the judge-role comment minimally so it describes the library instead of the prompt (no comment may name a removed key). `eval/prompts/testing-agent.md` and `improver.md` stay wired via `roles.test.prompt`/`roles.improver.prompt`; the `testingAgentPrompt`/`improverPrompt` boilerplate stays.
  - **The bridge script stays at `eval/utils/judge-wp.mjs`** (recorded rejection of the reviewer's relocation amendment: it self-locates its project root via `import.meta.url` and derives the wp-env `--config` path from it — wp-env identifies the warm instance by the md5 of that exact path, so a per-pair copy would break it; `judge-wp-bridge.test.ts` pins exactly this property and is untouched). Env plumbing (`SKILLSMITH_PROJECT_ROOT`/`WP_PORT`/`PLUGIN_SLUG`) unchanged.
  - `testing-project-judge-config.test.ts`: replace the `paths.rubrics` declaration test (line 202 block) with a positive assertion that the normalized config sets `roles.judge.library` to `'./eval/judge'` and no `roles.judge.prompt`-era wiring remains in its positive form (no negative regexes); re-point the manual-content test (line 294 block — bridge command form, post-create walkthrough, port URL, block discovery assertions all stay) to read `testing-project/eval/judge/README.md` from disk; replace the `prompt`-is-read-from-`judge.md` test (line 330 block) with a positive library-layout contract: `eval/judge/README.md` and `eval/judge/rubrics/wp-interactivity-api-best-practices.md` exist inside the configured library directory.
  - The scenario conformance test needs no change in this task (briefs still carry the bare rubric id, which its invariant 2 `includes()` accepts, and the opener, which invariant 6 requires — both change in Task 9).
- **Depends on:** Task 7
- **Traces to:** Spec R3 bullet 4 (bundled project migrated); Acceptance criterion 3; design decision "Testing-project migration — layout, merges, and the bridge that stays".
- **Acceptance:**
  - `eval/judge/README.md` and `eval/judge/rubrics/wp-interactivity-api-best-practices.md` exist; `eval/prompts/judge.md` and `eval/rubrics/` do not; `eval/prompts/` still holds exactly `testing-agent.md` and `improver.md`.
  - `testing-project/skillsmith.config.ts` sets `library: './eval/judge'`, no `prompt` on the judge role, and no `paths` block; `npm --prefix testing-project run check:config` passes.
  - `judge-wp.mjs` is byte-unchanged at `eval/utils/`; `judge-wp-bridge.test.ts` passes unmodified.
  - The judge-config test asserts the library wiring and layout positively and `npm test` passes.

### Task 9: The 11 briefs drop the opener; rubric sentence re-points; framing merges into the manual; conformance test follows

- **Goal:** State the decision rule once (the harness default landed in Task 7), remove the elevenfold opener, re-point the rubric reference to the path form, and refit the conformance test to the new template — with the check set preserved verbatim.
- **Type:** tdd
- **Files to change:**
  - All 11 `testing-project/eval/scenarios/<id>/JUDGE.md` (`async-fetch`, `config-fetch`, `counter`, `derived-double`, `focus-trap-menu`, `fruit-list-each`, `independent-counters`, `minimal-scaffold`, `paginated-list`, `shared-state`, `toggle-visibility`)
  - `testing-project/eval/judge/README.md`
  - `src/__tests__/testing-project-scenarios.test.ts`
- **Changes:**
  - **Each brief (exactly two edits, nothing else — spec R6 hard constraint):**
    1. Delete line 1 wholesale — the byte-identical two-sentence opener ("Judge the produced work against the checks below, using both the produced source files and the live, running site. Pass only if every check, including the rubric check, is satisfied.") — plus the blank line that followed it, so the brief now starts at its first heading.
    2. Replace the rubric sentence (the byte-identical closing line of `## Code checks` in all 11 — verified) with the path form: "As a further code check, verify the produced code against `judge-library/rubrics/wp-interactivity-api-best-practices.md`." Same sentence slot, same check.
  - No other brief content changes; in particular the two conditional-fallback bullets (`async-fetch`, `config-fetch`) and the three setup bullets are untouched (they are check-level semantics, not decision-rule overrides).
  - **`README.md` framing merge:** merge the dropped framing sentence's methodological content ("using both the produced source files and the live, running site" — a WordPress-project fact, not a harness fact) into the intro line that already half-states it ("…Use it to verify the block's real behavior in addition to reading the produced source files.") — a merge producing one coherent intro conveying that judging uses both the produced source files and the live running site; not an appended duplicate sentence. Everything else in the manual (env-var list, bridge usage, post-publish walkthrough, rendered-post loading) is unchanged.
  - **Conformance test refit** (stays a format contract, never a coverage checker):
    - Keep tests 1–4 wholesale and template invariants 1 (check headings), 3 (rubric-body sentinel not inlined), 4 (no `{ "pass" }`-shaped JSON pre-statement), 7 (no `# Rubrics` heading).
    - Tighten invariant 2 from the bare-id `includes()` to the path form `judge-library/rubrics/wp-interactivity-api-best-practices.md` (the old assertion would still pass against the path form, but its "bare id" meaning goes stale — and the tightened form makes a stale bare-id-only reference fail).
    - Remove invariant 6 (the opener regex — the only code asserting the opener) and invariant 5 + test 6 (the removed-env-var scan and the `_candidates.yaml` scan — R1 tombstones, folded into this refit per the design).
    - **Add no inverse assertions** (no "briefs do not contain the opener" test — the opener's absence is verified once by this revision's reviewers).
    - Rewrite the file header (lines 9–31) to the new template: briefs open at their check headings; the rubric is named by relative path into the per-pair `judge-library/` copy; the decision rule is owned by the harness output instruction (brief prose overrides); the manual/library are supplied at judge time.
- **Depends on:** Task 7 (the default rule and failure duty are live in the output instruction), Task 8 (`README.md` and the rubric live in the library; the manifest names the path the briefs now reference)
- **Traces to:** Spec R4, R6; Acceptance criteria 5, 6; design decisions "The 11 briefs drop the entire opener line", "Conformance test — new invariant set", "Brief reference form".
- **Acceptance:**
  - `grep -rn "Pass only if every check" testing-project/eval/scenarios/` returns nothing; every brief starts at its first heading; every brief's `## Code checks` closes with the path-form rubric sentence.
  - `git diff` for each brief shows exactly the two permitted edits — reviewers can verify the check set against `origin/trunk` unchanged.
  - The conformance test passes with invariants {1, 2-path-form, 3, 4, 7}, contains no opener assertion, no env-var/`_candidates.yaml` scans, and no new negative assertions; its header describes the new template.
  - The manual's intro conveys the source-files-plus-live-site methodology exactly once.

### Task 10: The `judging: { duration, tokenUsage? }` report block

- **Goal:** Persist the judge phase's duration and token usage (both currently dropped on the floor) into the per-pair `report.json` under the design's exact presence rule.
- **Type:** tdd
- **Files to change:**
  - `src/pipeline/judge-agent.ts`
  - `src/pipeline/agent-loop.ts`
  - `src/__tests__/agent-loop.test.ts`
  - `src/__tests__/smoke.test.ts`
- **Changes:**
  - `judge-agent.ts`: `runJudgeAgent` returns `{ review: unknown; usage?: TokenUsage }` — `review` is exactly what it returns today (parsed verdict, or the error-shaped payloads on the dispatch-failed/unparseable paths); `usage` is set iff the provider's `InvokeResult` carried a `usage` (including on the unparseable path; absent when dispatch failed before a usage report).
  - `agent-loop.ts`: build `judging = { duration: Date.now() - judgeStart }` (the bracket timing already measured for the tracker) and set `judging.tokenUsage` iff `runJudgeAgent` returned usage. Extend `writeAgentReport` to take an optional `judging` block, writing `{ testing, judging, review }` (key order: `testing`, `judging`, `review`); omit `judging` when absent. **Presence rule (all three paths):** (1) testing failed → judge never starts, `judging` omitted, `review` stays the `{ skipped }` marker; (2) `runJudgeAgent` threw, or the verdict was unparseable → the phase ran, `judging` present with `duration` (no `tokenUsage` unless the provider reported one); (3) normal path → `judging` present, `tokenUsage` iff reported. No field is ever zero-filled. The Task 7 library-failure path counts as the phase having started only if the write happens after `judgeStart` — keep that path's report as written in Task 7 (library preparation happens before the judge phase starts, so its failure report carries no `judging` block; record this in a code comment).
  - Verdict parsing (`src/reports/verdict.ts`) and scenario aggregation (`scenario-report.ts`) are untouched — the block flows through aggregation with zero changes (verified: aggregation embeds the agent report verbatim).
  - Test selection is the code-writer's TDD, driven by this task's Acceptance (the existing `agent-loop.test.ts` and `smoke.test.ts` are the natural homes and may need refits where they pin report shapes).
- **Depends on:** Task 7 (`runJudgeAgent`'s signature and the agent-loop call site are already in their new shape)
- **Traces to:** Spec R5 (proposal 6, ship-now scope); Acceptance criteria 7, 8; design decisions "judging report block" and "Per-pair report".
- **Acceptance:**
  - On a normal pair, `report.json` is `{ testing, judging, review }` with `judging.duration` a number and `judging.tokenUsage` present iff the provider reported usage.
  - On a testing-failed pair, `report.json` has no `judging` key and `review` is the `{ skipped: "testing failed: …" }` marker.
  - On a judge-dispatch-throw pair, `judging` is present with `duration` and without `tokenUsage`, while `review` carries the error marker.
  - Scenario aggregation output embeds the `judging` block verbatim via the embedded agent report, with zero changes to `scenario-report.ts`/`verdict.ts`; end-to-end with the mock provider (which reports usage), `judging.tokenUsage.totalTokens` is populated.

### Task 11: Remove the write-only `dirName` alias

- **Goal:** Drop `dirName` from `RunScenario`, `EnumeratedScenario`, and `ScenarioRunRecord` — a small mechanical breaking change riding the mandatory breaking wave; nothing in src/ ever reads it (verified: every non-test occurrence constructs `dirName: id` or copies it).
- **Type:** tdd
- **Files to change:**
  - `src/config/types.ts` (`RunScenario.dirName`, line 246 block)
  - `src/scenarios/enumerate.ts` (`EnumeratedScenario.dirName` line 191 and constructions at lines 261, 330, 332)
  - `src/pipeline/pipeline.ts` (`ScenarioRunRecord.dirName` line 60, the `RunScenario` mapping at lines 103–105, the record at line 556)
  - Tests/fixtures: `src/__tests__/scenario-filter-selection.test.ts` (helper, line 18), `src/__tests__/select-scenarios.test.ts` (line 10), `src/__tests__/scenarios.test.ts` (the merged file's `dirName` assertions — assert `id`/ordering instead or drop the alias assertion where `id` already covers it), `src/__tests__/scenario-selection.test.ts` (the `afterAllScenarioKeys:dirName+id+scenario` expectation, line 294 → `id+scenario`), `src/__tests__/fixtures/smoke-project/skillsmith.config.ts` (drop the `dirName === id` check; key-set guard becomes exactly `id,scenario`), `src/__tests__/fixtures/target-project/skillsmith.config.ts` (line 43 → map `id`)
- **Changes:** Delete the field from the three types and every construction/copy site; update the tests and fixtures to the two-field surface (`{ id, scenario }` on `RunScenario`; `scenarioName` stays on `ScenarioRunRecord`). `scenario.name` stays (always equal to `id` today but load-bearing as the key for artifact paths, report keys, tracker scopes, re-run matching, filters, and improver context — recorded, not removed). The README's `dirName` line (README.md:105) is deliberately **not** edited here — consumer docs realign in phase 5 (R8); the breaking changeset in Task 12 records the migration (`use id`).
- **Depends on:** Task 5 (the enumeration tests are already merged, so the `dirName` assertions are edited once, in their final home)
- **Traces to:** Spec R2 finding 12 via R5 (disposition: ship now); Acceptance criteria 7, 8; design decision "dirName removal (ship now, breaking)".
- **Acceptance:**
  - `grep -rn "dirName" src/` returns nothing; `npm run typecheck` and `npm test` pass.
  - The smoke-project fixture's key-set guard proves the public `RunScenario` hook surface is exactly `{ id, scenario }` and the run passes.
  - Scenario ids (including nested `blocks/counter`-style ids) still flow to hooks, reports, and selection unchanged via `id`/`scenario.name`.

### Task 12: Changesets — update the stale feature changeset, add the breaking-wave and `judging` changesets

- **Goal:** Make the release record match what ships: three changeset actions, mutually consistent, per the pre-1.0 policy.
- **Type:** tdd
- **Files to change:**
  - `.changeset/flexible-scenarios-judge-verification.md` (update)
  - New `.changeset/judge-library-breaking-wave.md` (any unclaimed filename)
  - New `.changeset/judging-report-block.md` (any unclaimed filename)
- **Changes:**
  - **Update** `flexible-scenarios-judge-verification.md` (stays `minor` with the `BREAKING:` summary prefix): rewrite the paragraphs falsified by this revision — the "Skillsmith loads **all** rubrics from the optional `paths.rubrics` location and injects every one of them…" prose, the selection-lead-in description, and the migration paragraph's "describe in JUDGE.md prose which rubric to grade against" wording — to describe the judge-library model (single judge-scoped directory, README inlined as the manual, per-pair `judge-library/` copy plus manifest, briefs name items by relative path). Do not re-describe the parts that remain true (two-file scenarios, `{ pass, notes }`, judge-workspace copy, `concurrency`).
  - **Add** one `minor` changeset whose summary starts with `BREAKING:` covering this revision's wave: `roles.judge.prompt` and `paths.rubrics` removed and rejected at validation time — replaced by `roles.judge.library`, with the migration recipe (move the manual to `<library>/README.md`, move rubric files into the library, point briefs at `judge-library/<rel>` paths); the all-must-pass decision rule centralized into the harness output instruction (brief authors drop the per-brief opener; a brief stating its own rule in prose overrides the default); `RunScenario`/`EnumeratedScenario`/`ScenarioRunRecord` lose `dirName` (use `id`). No `rubric-loader` symbol needs naming: none was ever exported from `src/index.ts` (verified in Task 7).
  - **Add** one `minor` non-breaking changeset for the additive `judging: { duration, tokenUsage? }` block in the per-pair `report.json`, stating the presence rule (`judging` present iff the judge phase ran — omitted when testing failed; `tokenUsage` present iff the provider reported usage) — report field semantics are release surface.
  - Cleanup (Tasks 1–5) carries no changeset: tests, briefs, testing-project scripts, and assets sit outside the release-relevant surface; the behavior-neutral src refactors are folded into the wave where visible at all. The three texts must be read together for consistency: the retired load-all model is described nowhere.
- **Depends on:** Tasks 7, 9, 10, 11 (the changes being recorded have landed)
- **Traces to:** Spec R7; Acceptance criterion 8; design decision "Changeset plan — three actions".
- **Acceptance:**
  - `npx tsx scripts/validate-changesets.ts` passes; no changeset uses `major`; both breaking records are `minor` with a `BREAKING:` summary prefix; `npx changeset status` succeeds.
  - `grep -l "paths.rubrics\|loads all rubrics\|all rubrics" .changeset/*.md` matches only lines that describe the keys as *removed* (no changeset presents the load-all model or the removed keys as current behavior).
  - The `judging` changeset states the presence rule; the breaking changeset contains the `roles.judge.library` migration recipe and the `dirName` → `id` note.
