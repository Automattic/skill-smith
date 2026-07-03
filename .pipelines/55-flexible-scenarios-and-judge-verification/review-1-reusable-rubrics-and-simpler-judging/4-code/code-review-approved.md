# Code Review

## Verdict: approved

## Batch scope

Tasks reviewed (review-1 code batch, tasks 1–15; task 16 is an owner-run manual sanity check, out of scope):

- Task 1: Add optional `rubrics` to `Paths`/`Scenario` types and flip the `core-types` rubrics guard in the same commit
- Task 2: Generalize the `# Skills` parser and add `parseRubricsSection`
- Task 3: Validate rubric ids at enumeration, populate `Scenario.rubrics`, and flip the smoke-fixture removed-field guard
- Task 4: Add `loadRubric` mirroring `loadSkill`
- Task 5: Inject the resolved rubric blob into the judge system prompt
- Task 6: Update the `judge-agent` rubric-scaffolding guard test
- Task 7: Confirm `check-paths` guard test holds under the restored-optional contract
- Task 8: Restore the shared rubric file to `testing-project/eval/rubrics/` and flip the `e2e-removal` rubrics guard in the same commit
- Task 9: Boot wp-env once and install/clean-slate per pair (`wp-env-judge.ts`)
- Task 10: Wire run-level + per-pair env hooks and the judge environment manual (`skillsmith.config.ts`)
- Task 11: Add the `judge-wp.mjs` WP-CLI bridge wrapper
- Task 12: Convert all 11 `JUDGE.md`, slim the briefs, and update the conversion guard tests
- Task 13: Stop enforcing the block name (scaffold + testing-agent prompt)
- Task 14: Add the staging dir to `.gitignore`
- Task 15: Extend the existing changeset

## Summary

The batch faithfully implements review-1 of the #55 pipeline as an additive increment on the merged base. Track A (Skillsmith core) adds reusable rubrics-by-id by mirroring the skills path at every step: `parseRubricsSection` shares the generalized `# Skills` section-collection machinery; rubric ids are validated at enumeration through the same per-scenario `problems[]`/error channel as unknown skills (no throw); `Scenario.rubrics?` and an optional `paths.rubrics` (no `DEFAULT_PATHS` entry, no `checkPaths` gate) are introduced; `loadRubric` mirrors `loadSkill` with a flat `<id>.md` entry; and the resolved blob is read in `runJudgeAgent` and injected under `# Grading rubrics` while `buildJudgeSystemPrompt` stays a pure string builder and the verdict remains `{ pass, notes }`. Track B (testing-project) boots wp-env once via a live bind-mount + per-slug staging dir, installs/clean-slates per pair under the serial lock, moves the live e2e into a human-language judge driven by a role-prompt environment manual and the `judge-wp.mjs` `--config` bridge, stops enforcing the block name (deterministic slug kept), and restores the shared rubric to `eval/rubrics/` referenced by id from all 11 `JUDGE.md`. The green-gate invariant holds: each of the four straddling guard flips (core-types `@ts-expect-error`, smoke-fixture removed-field hook, `e2e-removal` `eval/rubrics`, and the `testing-project-scenarios` conversion) lands in the same commit as the change that would otherwise trip it. The changeset is amended in place (single file, `minor` + `BREAKING:`), internally consistent, with no stale "drops rubrics" claim. All five deterministic gates run green.

## Checks

| Check | Command | Result |
| ----- | ------- | ------ |
| Typecheck | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass (exit 0; one Biome `recommended`-field deprecation **info**, not an error) |
| Unit/integration tests | `npm test` | pass (383 tests: 381 pass, 0 fail, 2 pre-existing conditional `codex.e2e` skips gated on `E2E_ENABLED`) |
| testing-project config | `npm --prefix testing-project run check:config` | pass (config loads/typechecks with `paths.rubrics`) |
| Changesets | `npx tsx scripts/validate-changesets.ts` | pass (exit 0) |

## Behavior verification

Per the spec's testing posture (Acceptance criterion 9, Requirement 14) and the launch prompt, full behavioral verification of `testing-project` is **manual** and Task 16 (Docker + live wp-env) is an owner-run sanity check, out of scope for this review. There is no automated, user-observable behavior change drivable here without Docker/live wp-env. The verifiable evidence for this batch is therefore the five deterministic gates above, all green, plus the following manual re-drive of the plan's E2E flows against the resulting code:

- **Flow 1 (rubric resolved into grading material):** `counter/JUDGE.md` carries a `# Rubrics` section listing `wp-interactivity-api-best-practices` with no inlined rubric text; `paths.rubrics: './eval/rubrics'` is set; `eval/rubrics/wp-interactivity-api-best-practices.md` exists. `resolveRubricBlob` → `loadRubric` → `buildJudgeSystemPrompt` injects the file body under `# Grading rubrics`; verdict stays `{ pass, notes }`. Covered by `judge-agent.test.ts` and `rubric-loader.test.ts`.
- **Flow 2 (no-rubric scenario stays valid):** `parseRubricsSection` returns `undefined` for an absent section; `scenarioFromBriefs` stores `[]` and produces no problem; `buildJudgeSystemPrompt` emits no `# Grading rubrics` section (verified by the flipped `judge-agent.test.ts` no-rubric case).
- **Flow 3 (unknown rubric id → per-scenario error):** `scenarioFromBriefs` appends `unresolved reference: rubric "<id>"` to the same `problems[]` as skills when `paths.rubrics` is set and the file is missing; no throw. Covered by `enumerate-rubrics.test.ts`.
- **Flow 4 (wp-env booted once, clean slate per pair):** config wires `beforeAllScenarios → bootJudgeEnv`, `afterAllScenarios → stopJudgeEnv`, `beforeJudgeAgent → installPluginForPair` (build + copy into `<staging>/<slug>/` + `deactivate --all` + `activate <slug>`), `afterJudgeAgent → cleanUpPair`; `booted` singleton guards double-boot; judge `concurrency: 'serial'`. Covered by `wp-env-judge-lifecycle.test.ts`.
- **Flow 5 (judge-driven human-language setup, free block names):** `judge.md` environment manual carries the `judge-wp.mjs` form, the `wp post create … --porcelain` template, the `?p=<id>` URL shape with `$SKILLSMITH_WP_PORT`, and block discovery from `$SKILLSMITH_PLUGIN_SLUG/build/blocks/*/block.json`; scaffold uses a non-binding placeholder block name and a name-agnostic globbing `index.php`; testing-agent prompt drops the rename prohibition while preserving the slug.
- **Flow 6 (testing-project converted):** `eval/rubrics/wp-interactivity-api-best-practices.md` restored (with the `viewScriptModule` (NOT `viewScript`) sentinel); all 11 `JUDGE.md` reference the rubric by id with no inlined rubric text, no dropped env vars (`SKILLSMITH_JUDGE_URL`/`SKILLSMITH_POST_ID`), and no pre-stated `{ pass, notes }` instruction; env booted once.

Green-gate fold spot-check (verified via `git show`):
- Task 1 (`582a528`): type declarations and the two `rubrics` `@ts-expect-error` removals are in one commit.
- Task 3 (`632d206`): `Scenario.rubrics` population and the smoke-fixture `afterAllScenarios` removed-field flip are in one commit.
- Task 8 (`80721c5`): rubric-file restore and the `e2e-removal` `eval/rubrics` removed-paths flip are in one commit.
- Task 12 (`84942ce`): the 11 `JUDGE.md` conversions and the `testing-project-scenarios.test.ts` contract flip are in one commit.

## Notes (non-blocking, recorded for transparency)

`testing-project/eval/utils/wp-env-judge.ts` retains the legacy per-pair `setUpJudgeEnv` / `tearDownJudgeEnv` functions (explicitly documented as unused legacy orchestrators and pinned by a `testing-project-judge-config.test.ts` "remain exported" assertion). They are unwired dead code — `skillsmith.config.ts` uses only the new run-level/per-pair helpers — and the genuinely-shed data helpers (`wpEnvConfig`, `testPostContent`, `TESTING_BLOCK_NAME`, `judgeUrl`, `judgeEnvVars`, the dropped env exports) are confirmed removed and guarded by `wp-env-judge-lifecycle.test.ts`. The plan's Task 9 shed list does not enumerate these two functions, no acceptance criterion requires their removal, and they affect no behavior or gate. Recorded as a minor cleanliness observation, not a rejection finding.
