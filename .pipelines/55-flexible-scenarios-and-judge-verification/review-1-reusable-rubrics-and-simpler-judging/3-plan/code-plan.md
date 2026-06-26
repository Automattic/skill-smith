# Code Plan: Reusable rubrics and a leaner, human-language live-judge setup

## Overview

This plan implements review-1 of the #55 pipeline as an increment on the merged base already on the branch. It splits into two tracks that meet only inside the judge's system prompt. **Track A** (Skillsmith core, the only core change) adds reusable rubrics referenced by id: a `JUDGE.md` may carry an optional `# Rubrics` section (parsed exactly like `# Skills`), rubric ids are validated at enumeration through the existing per-scenario error channel, an optional `paths.rubrics` is added, and the resolved rubric content is loaded lazily at judge dispatch and injected into the judge system prompt; the verdict stays `{ pass, notes }`. **Track B** (testing-project) boots wp-env once per run via a live bind-mount, installs/activates each pair's plugin against that warm env under the existing serial lock, moves the live e2e (block discovery, post creation, page open, checks) into a human-language judge driven by a role-prompt "environment manual", stops enforcing the fixed block name, and restores the shared rubric to `eval/rubrics/` referenced by id from all 11 `JUDGE.md`. A set of six guard tests that pinned the base removal of these surfaces must each be flipped to the new contract; one of them throws inside the real `npm test` smoke run, so it must be updated in the same task that populates `Scenario.rubrics`. The changeset is amended (not added to). Ordering: core type + parse + load + inject + guard-test updates first (Tasks 1-7), then the testing-project conversion that exercises Track A end to end (Tasks 8-15), then the changeset and gitignore (Tasks 16-17), then a single manual sanity check (Task 18).

## Guardrail scopes

The code phase runs fixed, unscoped gates only (`npm run typecheck`, `npm run lint`, `npm test`, `npm --prefix testing-project run check:config`, `npx tsx scripts/validate-changesets.ts`). No scoped gates were passed.

| Gate | Scope |
| ---- | ----- |
| None | None |

## E2E test plan

Per the spec's testing posture (Acceptance criterion 9, Requirement 14), **full behavioral verification of `testing-project` is manual**. There are no automated browser/e2e flows in this plan, and the pipeline does not run the self-improvement loop or depend on a full-suite green run. The flows below are therefore expressed as the **manual** end-to-end behaviors a human re-drives during review; their automatable substance is covered by the per-task unit/integration acceptance (the deterministic gates), and they are also the behaviors the single-scenario manual sanity check (Task 18) spot-checks. No `e2e`-type code-writer task is created.

### Flow 1: Rubric resolved into the judge's grading material

- **Steps:** Author (or use an existing converted) scenario whose `JUDGE.md` has a `# Rubrics` section listing `- wp-interactivity-api-best-practices` and no inlined rubric text, with `paths.rubrics: './eval/rubrics'` configured and `eval/rubrics/wp-interactivity-api-best-practices.md` present. Run the judge for one (scenario, agent) pair.
- **Expected:** The judge's system prompt contains the resolved rubric file content under a dedicated grading-rubrics heading (not pasted in `JUDGE.md`), and the judge grades against it; the recorded verdict is `{ pass, notes }`.
- **Traces to:** Acceptance criterion 1, Acceptance criterion 4.

### Flow 2: No-rubric scenario stays valid

- **Steps:** Use a scenario whose `JUDGE.md` has no `# Rubrics` section. Enumerate and run it.
- **Expected:** The scenario enumerates with no error and the judge grades on the freeform brief alone; no rubric section appears in the judge prompt.
- **Traces to:** Acceptance criterion 2.

### Flow 3: Unknown rubric id surfaces as a per-scenario error

- **Steps:** Reference a non-existent rubric id in a `JUDGE.md` `# Rubrics` section with `paths.rubrics` set. Enumerate the scenario.
- **Expected:** The scenario is kept but carries a per-scenario error `unresolved reference: rubric "<id>"`, runs no agents, aggregates `pass: false`, and shows as skipped — identical observability to an unknown skill. Enumeration does not throw.
- **Traces to:** Acceptance criterion 3.

### Flow 4: wp-env booted once, clean slate per pair

- **Steps:** Run `testing-project` across multiple (scenario, agent) pairs (manual). Observe wp-env lifecycle.
- **Expected:** wp-env boots exactly once at run start (`beforeAllScenarios`) and stops once at run end (`afterAllScenarios`); per pair the built plugin is copied into the live bind-mounted staging dir, all plugins are deactivated, and only that pair's deterministic slug is activated when its judge runs.
- **Traces to:** Acceptance criterion 5.

### Flow 5: Judge-driven human-language setup with free block names

- **Steps:** For a converted scenario, let the testing agent produce one or more blocks under any name(s). The judge reads its slim human-language `JUDGE.md` plus the role-prompt environment manual.
- **Expected:** The judge discovers the produced block name(s) from `build/blocks/*/block.json`, creates a published post embedding each discovered block, opens `http://localhost:<port>/?p=<id>`, and verifies the scenario behavior — with no dependency on a fixed block name.
- **Traces to:** Acceptance criterion 6, Acceptance criterion 7.

### Flow 6: testing-project converted

- **Steps:** Inspect the finished `testing-project`.
- **Expected:** `eval/rubrics/wp-interactivity-api-best-practices.md` holds the shared rubric; every `JUDGE.md` references it by id via a `# Rubrics` section with no inlined rubric text; the env is booted once per run.
- **Traces to:** Acceptance criterion 8.

## Tasks

### Task 1: Add optional `rubrics` to `Paths` and `Scenario` types

- **Goal:** Introduce the two optional type fields the rest of the change builds on.
- **Type:** tdd
- **Files to change:** `src/config/types.ts`
- **Changes:**
  - Add `rubrics?: string` to the `Paths` interface (after `scenarios`), documented as optional and "required to exist only when a project uses it".
  - Add `rubrics?: string[]` to the `Scenario` interface (after `skills`), documented as the rubric ids parsed from `JUDGE.md`'s `# Rubrics` section, paralleling `skills`.
- **Depends on:** none
- **Traces to:** Spec requirement 5; Acceptance criteria 2, 8; Design decision "`paths.rubrics` is optional…"; Interfaces and Data Flow → Core type additions
- **Acceptance:**
  - `Paths` admits an optional `rubrics` string field and still admits `base`/`skills`/`scenarios`.
  - `Scenario` admits an optional `rubrics` string-array field alongside `skills`, and its open index signature still admits arbitrary extra keys.
  - A `Paths` or `Scenario` value that omits `rubrics` is still valid.

### Task 2: Update the `core-types` guard test to the restored-optional contract

- **Goal:** Flip the type-guard assertions that pinned the absence of `rubrics` so they assert the new optional contract.
- **Type:** tdd
- **Files to change:** `src/__tests__/core-types.test.ts`
- **Changes:**
  - In the "Scenario no longer declares the legacy fields" test, remove the `// @ts-expect-error … rubrics is removed from Scenario` directive and the `const _rubrics: string[] = scenario.rubrics;` line that depended on it (and drop `_rubrics` from the trailing `assert.ok([...])`). The `description`/`prompt`/`acceptance` directives stay (those fields remain removed).
  - In the "Paths has base/skills/scenarios and no rubrics" test, remove the `// @ts-expect-error … rubrics is removed from Paths` directive and the `const _rubrics: string = paths.rubrics;` access; rename/retarget the test to assert that `rubrics` is now a valid optional `Paths` field (e.g. a `Paths` value with `rubrics: './eval/rubrics'` type-checks) while a `Paths` value without it remains valid. The base/skills/scenarios key-set assertion for a value that omits `rubrics` stays valid.
- **Depends on:** Task 1
- **Traces to:** Failure Modes → `core-types.test.ts`; Design decision "`paths.rubrics` is optional…"
- **Acceptance:**
  - The test file no longer contains a `@ts-expect-error` on `scenario.rubrics` or `paths.rubrics`.
  - `tsc --noEmit` passes: accessing `paths.rubrics` (optional string) and `scenario.rubrics` (optional string array) is now legal typed access.
  - The remaining legacy-field guards (`description`, `prompt`, `acceptance`) are unchanged and still pass.

### Task 3: Generalize the `# Skills` parser and add `parseRubricsSection`

- **Goal:** Parse an optional `# Rubrics` section from a judge brief with grammar identical to `# Skills`, without changing `parseSkillsSection`'s observable behavior.
- **Type:** tdd
- **Files to change:** `src/scenarios/enumerate.ts`
- **Changes:**
  - Factor the heading-located, list-item-collecting loop in `parseSkillsSection` into a shared helper parameterized by the heading-text predicate (the existing `SKILLS_HEADING_RE` for skills; a new `/^Rubrics$/i` for rubrics). Reuse the existing `HEADING_RE`, `LIST_ITEM_RE`, and `normalizeSkillId` (id normalization is already id-agnostic).
  - Keep `parseSkillsSection( testingBrief )` exported with unchanged signature and behavior.
  - Add and export `parseRubricsSection( judgeBrief: string ): string[] | undefined` that runs the shared helper with the `Rubrics` predicate. Same semantics: any heading depth; deeper sub-headings nest; collect until same-or-shallower heading; only list items contribute ids; backtick/link unwrap; empty section is valid (`[]`); absent section yields `undefined`; first matching heading wins.
- **Depends on:** none
- **Traces to:** Spec requirements 1, 2; Acceptance criteria 1, 2; Design decision "Parse `# Rubrics` from `JUDGE.md` by generalizing the `# Skills` parser"; Interfaces → `# Rubrics` section format
- **Acceptance:**
  - `parseRubricsSection` returns the ordered ids of a `# Rubrics` section's list items, unwrapping surrounding backticks and `[id](...)` links.
  - A `# Rubrics` heading at any depth opens the section; deeper sub-headings stay inside; a same-or-shallower heading closes it; prose and blank lines are ignored.
  - An empty `# Rubrics` section returns `[]`; a brief with no `# Rubrics` heading returns `undefined`; the first matching heading wins.
  - `parseSkillsSection`'s existing behavior is unchanged (its existing tests still pass).

### Task 4: Validate rubric ids at enumeration and populate `Scenario.rubrics`

- **Goal:** At enumeration, parse and validate rubric ids against the rubrics root, route unknown ids through the existing per-scenario error channel, and store parsed ids on `Scenario.rubrics`.
- **Type:** tdd
- **Files to change:** `src/scenarios/enumerate.ts`
- **Changes:**
  - In `enumerateScenarios`, resolve the rubrics root from `paths.rubrics` when it is set (mirroring how `skillsRoot` is resolved via `join( projectRoot, paths.rubrics )`); pass it (or `undefined` when unset) into `scenarioFromBriefs`.
  - In `scenarioFromBriefs`, call `parseRubricsSection( judgeBrief )`. When `paths.rubrics` is set, validate each parsed id with `existsSync( join( rubricsRoot, \`${id}.md\` ) )` (flat `<id>.md`, not a directory); append any unresolved ids to the same `problems[]` array used for skills, formatted `unresolved reference: rubric "<id>"` (matching the skills wording/joining). When `paths.rubrics` is unset, skip validation. An absent `# Rubrics` section yields no rubrics and never produces a problem (referencing rubrics is optional).
  - Store the parsed ids on the produced `Scenario` as `rubrics` (use `[]` when the section is absent or empty so the field is always populated).
  - Update `stubScenario` to populate `rubrics: []`.
  - Update the relevant doc comments to mention `# Rubrics` parsing/validation.
- **Depends on:** Task 1, Task 3
- **Traces to:** Spec requirements 1, 3; Acceptance criteria 1, 3; Design decision "Validate rubric ids at enumeration through the existing per-scenario `error` channel"; Core data flow (rubrics)
- **Acceptance:**
  - A scenario whose `JUDGE.md` references an existing rubric id (with `paths.rubrics` set) enumerates with no error and `scenario.rubrics` contains that id.
  - A scenario referencing an unknown rubric id (with `paths.rubrics` set) enumerates with `error` containing `unresolved reference: rubric "<id>"`, runs no agents, and aggregates fail — enumeration does not throw.
  - A scenario with no `# Rubrics` section enumerates valid with `scenario.rubrics` equal to `[]`.
  - When `paths.rubrics` is unset, rubric ids are not existence-validated (no rubric error is produced) and parsed ids (if any) are still stored.
  - `stubScenario` produces a scenario with `rubrics: []`.

### Task 5: Add `loadRubric` mirroring `loadSkill`

- **Goal:** Provide lazy, dispatch-time loading of a rubric's content (single `<id>.md` file plus md-linked companions inside the rubrics root).
- **Type:** tdd
- **Files to change:** `src/scenarios/rubric-loader.ts` (new)
- **Changes:**
  - Add `loadRubric( id: string, rubricsRoot: string ): string`, mirroring `src/scenarios/skill-loader.ts`'s `loadSkill`, with the one structural difference that the entry file is a flat `<rubricsRoot>/<id>.md` (not `<id>/SKILL.md`).
  - Read the entry file, follow md-links that resolve **inside the rubrics root** (reuse the same link-matching, external/absolute-link skipping, and cycle-guarding approach as `loadSkill`), concatenate sections with `=== <rel> ===` headers where `<rel>` is relative to `rubricsRoot`.
  - Throw a clear error when `<rubricsRoot>/<id>.md` does not exist (mirroring `loadSkill`'s missing-entry throw); the enumeration-time validation in Task 4 is what normally prevents reaching this path with a missing file.
- **Depends on:** none
- **Traces to:** Spec requirement 1; Acceptance criterion 1; Design decision "Load rubric content lazily at judge dispatch via a `loadRubric` mirroring `loadSkill`"; Design decision "Rubric file layout is flat `<id>.md`"; Interfaces → Core function signatures
- **Acceptance:**
  - `loadRubric( 'r', root )` returns the contents of `<root>/r.md` wrapped in a `=== r.md ===` section header.
  - Md-links inside `<root>/r.md` that resolve within `root` are followed and inlined with their own `=== <rel> ===` headers; external/absolute links and link cycles are ignored.
  - A missing `<root>/<id>.md` raises a clear error naming the id and the expected path.

### Task 6: Inject the resolved rubric blob into the judge system prompt

- **Goal:** Resolve and load the rubric content in `runJudgeAgent` and inject it into the judge system prompt under a clear heading, keeping `buildJudgeSystemPrompt` filesystem-free; verdict shape unchanged.
- **Type:** tdd
- **Files to change:** `src/pipeline/judge-agent.ts`
- **Changes:**
  - In `runJudgeAgent`, when `config.paths.rubrics` is set and `scenario.rubrics` is non-empty, resolve `rubricsRoot = resolve( projectRoot, config.paths.rubrics )`, build the blob `scenario.rubrics.map( ( id ) => loadRubric( id, rubricsRoot ) ).join( '\n\n' )`, and pass it to `buildJudgeSystemPrompt`. When `paths.rubrics` is unset or `scenario.rubrics` is empty/absent, pass no blob (`undefined`).
  - Add an optional `rubricBlob?: string` parameter to `buildJudgeSystemPrompt( scenario, config, rubricBlob? )`. When the blob is non-empty, push it into the existing `sections` array under a clear, distinct heading (`# Grading rubrics`), composing cleanly with `judgeBrief`, the `# Output format` / `# Recursion guard` block, and the `# Role instructions` section. The builder stays a pure string function (no filesystem access); the existing output instruction, recursion guard, and role-prompt handling are unchanged.
  - Import `loadRubric` from `../scenarios/rubric-loader`.
- **Depends on:** Task 1, Task 5
- **Traces to:** Spec requirements 1, 4; Acceptance criteria 1, 4; Design decision "Inject the resolved rubric blob into the judge system prompt; keep the builder pure"; Design decision "Verdict stays `{ pass, notes }`"
- **Acceptance:**
  - When a scenario references rubrics and `paths.rubrics` is set, the judge system prompt includes the resolved rubric content under a `# Grading rubrics` heading; when it references none (or `paths.rubrics` is unset), no `# Grading rubrics` section appears.
  - `buildJudgeSystemPrompt` remains a pure string builder (no filesystem reads); the `# Output format`, `# Recursion guard`, and `# Role instructions` sections are unchanged and the `# Grading rubrics` heading does not collide with them.
  - The judge's verdict remains `{ pass, notes }` with no per-rubric structured result; `parseJudgeJson`/`buildUserMessage` are untouched.
  - The literal `# Rubrics` id list in `judgeBrief` is left in place (not stripped).

### Task 7: Update the `judge-agent` rubric-scaffolding guard test

- **Goal:** Replace the blanket `!/rubric/i` ban with the precise contract: no rubric section for a no-rubric scenario, and a `# Grading rubrics` section when a scenario references rubrics.
- **Type:** tdd
- **Files to change:** `src/__tests__/judge-agent.test.ts`
- **Changes:**
  - In "buildJudgeSystemPrompt carries no rubric/acceptance scaffolding", change the rubric assertion: for a scenario that references no rubric and with no `rubricBlob` passed, assert the prompt contains no `# Grading rubrics` section (rather than asserting `!/rubric/i` over the whole prompt). The `!/acceptance/i` companion assertion stays unchanged.
  - Add a focused case proving that when a non-empty `rubricBlob` is passed to `buildJudgeSystemPrompt`, the prompt includes that blob under a `# Grading rubrics` heading. Use the helpers already in the file (`makeScenario`, `makeConfig`, the third `buildJudgeSystemPrompt` argument).
- **Depends on:** Task 6
- **Traces to:** Failure Modes → `judge-agent.test.ts`; Design decision "Inject the resolved rubric blob…"
- **Acceptance:**
  - The no-rubric case asserts the absence of a `# Grading rubrics` section instead of a blanket `/rubric/i` ban, and passes.
  - A new case asserts that a passed rubric blob appears under `# Grading rubrics`, and passes.
  - The `!/acceptance/i` assertion is retained and passes.

### Task 8: Update the smoke fixture `afterAllScenarios` removed-field guard

- **Goal:** Stop the smoke fixture hook from throwing on the now-legitimate `rubrics` field so the real `npm test` smoke run stays green once `Scenario.rubrics` is populated.
- **Type:** tdd
- **Files to change:** `src/__tests__/fixtures/smoke-project/skillsmith.config.ts`
- **Changes:**
  - In the `afterAllScenarios` hook, drop `'rubrics'` from the `['description','prompt','acceptance','rubrics']` removed-field list so it no longer throws when `scenario.scenario` carries `rubrics`. The `description`/`prompt`/`acceptance` checks stay (those remain removed). Optionally assert the optional `rubrics` field is permitted on the scenario record.
- **Depends on:** Task 4
- **Traces to:** Failure Modes → `fixtures/smoke-project/skillsmith.config.ts`; Design decision "`paths.rubrics` is optional…"
- **Acceptance:**
  - The fixture hook no longer treats `rubrics` as a removed field and does not throw when an enumerated scenario carries `rubrics`.
  - The `smoke.test.ts` run (driving this fixture via a real `run()`) passes under `npm test`.
  - The `description`/`prompt`/`acceptance` removed-field guards are retained.

### Task 9: Confirm `check-paths` guard test holds under the restored-optional contract

- **Goal:** Ensure the `check-paths` guards still encode the intended contract: `DEFAULT_PATHS` omits `rubrics`, and `checkPaths` adds no rubrics existence gate.
- **Type:** tdd
- **Files to change:** `src/__tests__/check-paths.test.ts`
- **Changes:**
  - Keep "DEFAULT_PATHS no longer contains a rubrics key" — the design deliberately adds no `rubrics` default. Restate its intent in a comment as "optional, not defaulted" if helpful; assertions stay as-is and pass.
  - Keep "checkPaths passes when skills/ and scenarios/ exist but rubrics/ does not" — no existence gate for rubrics is added, so this stays true. Confirm it still passes after Task 1 (the `Paths` type now allows but does not require `rubrics`).
  - Make no change to `src/config/defaults.ts` (no `rubrics` default) and no change to `checkPaths` in `src/pipeline/pipeline.ts` (the existence loop stays `['skills','scenarios']`).
- **Depends on:** Task 1
- **Traces to:** Failure Modes → `check-paths.test.ts`; Design decision "`paths.rubrics` is optional, with no `DEFAULT_PATHS` entry and no `checkPaths` existence gate"; Components → `checkPaths`
- **Acceptance:**
  - `DEFAULT_PATHS` keys remain exactly `base`, `scenarios`, `skills`; `DEFAULT_PATHS.rubrics` is `undefined`.
  - `checkPaths` passes when `skills/` and `scenarios/` exist and `rubrics/` does not; it still throws clearly when `skills/` or `scenarios/` is missing.
  - No `rubrics` key is added to `DEFAULT_PATHS` and no rubrics existence check is added to `checkPaths`.

### Task 10: Restore the shared rubric file to `testing-project/eval/rubrics/`

- **Goal:** Recreate the shared best-practices rubric as a single file referenced by id.
- **Type:** tdd
- **Files to change:** `testing-project/eval/rubrics/wp-interactivity-api-best-practices.md` (new)
- **Changes:**
  - Create the rubric file with the WordPress Interactivity API best-practices content (the same criteria currently inlined as the `## Best-practices rubric` block in every `JUDGE.md`; the historical `eval/rubrics/wp-interactivity-api-best-practices.md` from git `03535e0^` is the canonical source and is content-identical). The rubric id is `wp-interactivity-api-best-practices` (= filename without `.md`).
  - Keep the distinctive sentence ``` `block.json` declares the view module as `viewScriptModule` (NOT `viewScript`). ``` verbatim (it is the rubric sentinel used by the conversion guard in Task 15).
- **Depends on:** none
- **Traces to:** Spec requirement 11; Acceptance criterion 8; Design decision "Restore the shared rubric to `eval/rubrics/` and reference it by id"; Design decision "Rubric file layout is flat `<id>.md`"
- **Acceptance:**
  - `testing-project/eval/rubrics/wp-interactivity-api-best-practices.md` exists and contains the shared best-practices rubric content (block wiring, server-side initialization, reactivity/directives, async-actions sections).
  - The file contains the sentinel sentence about `viewScriptModule` (NOT `viewScript`) verbatim.

### Task 11: Update the `testing-project-e2e-removal` guard to expect the restored `rubrics/`

- **Goal:** Stop asserting `eval/rubrics` is absent now that it is restored.
- **Type:** tdd
- **Files to change:** `src/__tests__/testing-project-e2e-removal.test.ts`
- **Changes:**
  - In "the Playwright/e2e harness files no longer exist", remove `'eval/rubrics'` from the removed-paths list (the directory is restored). Leave the genuine Playwright/e2e removals (`playwright.config.ts`, `global-setup.mjs`, `eval/utils/verify-e2e.ts`) asserted as absent.
  - Leave the other tests in the file (package.json drops Playwright/e2e deps and `test:e2e`; keeps `@wordpress/env`/`@wordpress/scripts` and `env:start`/`env:stop`/`skillsmith`/`check:config`; no file references the removed e2e harness) unchanged.
- **Depends on:** Task 10
- **Traces to:** Failure Modes → `testing-project-e2e-removal.test.ts`
- **Acceptance:**
  - The removal guard no longer requires `eval/rubrics` to be absent and passes with the restored directory.
  - The remaining Playwright/e2e removal assertions are retained and pass.

### Task 12: Boot wp-env once and install/clean-slate per pair (`wp-env-judge.ts`)

- **Goal:** Replace per-pair boot/teardown with a run-level warm-env boot/stop plus per-pair install + clean-slate, via a live bind-mount of `wp-content/plugins` to a host staging dir.
- **Type:** tdd
- **Files to change:** `testing-project/eval/utils/wp-env-judge.ts`, `testing-project/eval/utils/wp-cli.mjs`
- **Changes:**
  - In `wp-env-judge.ts`, **shed**: `wpEnvConfig` (single-plugin form), `testPostContent`, `TESTING_BLOCK_NAME`, `judgeUrl`, `judgeEnvVars`, the `SKILLSMITH_JUDGE_URL` / `SKILLSMITH_POST_ID` exports, per-pair `env:start`/`env:stop`, and per-pair post creation. **Keep**: the fixed port (8987), the `wp-scripts build` step, the `judgePluginSlug` re-export, and a `wpCli` transport now pinned with `--config "<WP_ENV_CONFIG_PATH>"` for cwd-robustness.
  - Add a module-level `let booted = false` flag and constants for the staging dir (`<PROJECT_ROOT>/.wp-env-plugins`) and the warm-env config path (`<PROJECT_ROOT>/.wp-env.json`).
  - Add `bootJudgeEnv()` (run-level): defensively clean + recreate the empty staging dir, overwrite `.wp-env.json` with `{ "plugins": [], "mappings": { "wp-content/plugins": "<PROJECT_ROOT>/.wp-env-plugins" }, "port": 8987 }`, run `wp-env start --config "<config>"` once, set `booted = true`. Idempotent: a re-entry while `booted` is already true must not double-boot.
  - Add `stopJudgeEnv()` (run-level): run `wp-env stop --config "<config>"`, remove the staging dir and `.wp-env.json`, all wrapped in try/catch (log, do not throw); reset `booted = false`.
  - Add `installPluginForPair( ctx )` (per pair): build the plugin from the judge copy (existing `wp-scripts build` against `<judgeWorkspace>/<slug>` when `src/blocks` exists), copy the built plugin dir into `<staging>/<slug>/` (the live bind-mount makes it visible without restart), `wp plugin deactivate --all` then `wp plugin activate <slug>`, and export the retained bridge env vars (`SKILLSMITH_PROJECT_ROOT`, the wp-env port as `SKILLSMITH_WP_PORT`, `SKILLSMITH_PLUGIN_SLUG`).
  - Add `cleanUpPair( ctx )` (per pair): `wp plugin deactivate --all` and remove `<staging>/<slug>/`; clear the per-pair env vars it set. No env stop.
  - In `wp-cli.mjs`, pin `wpCli` (and therefore `deactivateAllPlugins`) with `--config "<PROJECT_ROOT>/.wp-env.json"` for cwd-robustness; keep `deactivateAllPlugins()` available as the clean-slate primitive.
- **Depends on:** none
- **Traces to:** Spec requirements 6, 7, 8; Acceptance criterion 5; Design decision "Boot wp-env once via a live bind-mount + per-slug staging dir"; testing-project data flow
- **Acceptance:**
  - `bootJudgeEnv` writes a `.wp-env.json` with `plugins: []`, a `mappings` entry mapping `wp-content/plugins` to the staging dir, and port 8987, creates an empty staging dir, and is idempotent under the `booted` flag.
  - `installPluginForPair` copies the built plugin into `<staging>/<slug>/`, deactivates all then activates `<slug>`, and exports `SKILLSMITH_PROJECT_ROOT`, the wp-env port, and `SKILLSMITH_PLUGIN_SLUG` (and does not export `SKILLSMITH_JUDGE_URL` or `SKILLSMITH_POST_ID`).
  - `cleanUpPair` deactivates all and removes the pair's staging subdir without stopping wp-env.
  - `stopJudgeEnv` stops wp-env and removes the staging dir and `.wp-env.json`, swallowing errors (never throws).
  - `wpCli`/`deactivateAllPlugins` pass `--config` with the warm-env config path; `judgePluginSlug` re-export and the fixed port are retained; `testPostContent`/`TESTING_BLOCK_NAME`/`judgeUrl`/`judgeEnvVars`/`wpEnvConfig` are removed.

### Task 13: Wire run-level + per-pair env hooks and the judge environment manual (`skillsmith.config.ts`)

- **Goal:** Move env lifecycle to run-level hooks, add per-pair install/clean-up, add `paths.rubrics`, and supply the judge role-prompt "environment manual".
- **Type:** tdd
- **Files to change:** `testing-project/skillsmith.config.ts`
- **Changes:**
  - Replace `beforeJudgeAgent: setUpJudgeEnv` / `afterJudgeAgent: tearDownJudgeEnv` wiring with: `beforeAllScenarios: () => bootJudgeEnv()`, `afterAllScenarios: () => stopJudgeEnv()`, `beforeJudgeAgent: ( ctx ) => installPluginForPair( ctx )`, `afterJudgeAgent: ( ctx ) => cleanUpPair( ctx )`. Keep `beforeTestAgent: scaffoldPlugin(...)`. Import the new helpers from `./eval/utils/wp-env-judge`. Ensure `afterAllScenarios` returns nothing (treated as pass).
  - Add `paths: { rubrics: './eval/rubrics' }` to the config.
  - Keep `roles.judge.concurrency: 'serial'`.
  - Set `roles.judge.prompt` to an "environment manual" carrying the reusable runtime mechanics: the `judge-wp.mjs` command form (`node "$SKILLSMITH_PROJECT_ROOT/eval/utils/judge-wp.mjs" <wp args>`); the post-create template `wp post create --post_type=post --post_status=publish --post_title='...' --post_content='<!-- wp:NS/NAME /-->' --porcelain` (stdout = numeric id); the URL shape `http://localhost:$SKILLSMITH_WP_PORT/?p=<id>`; and "discover block name(s) by reading `$SKILLSMITH_PLUGIN_SLUG/build/blocks/*/block.json` and inserting one self-closing block comment per discovered `name`". Read the manual from a prompt file (e.g. `eval/prompts/judge.md`) for parity with `testing-agent.md`/`improver.md`, or inline it; keep WordPress vocabulary out of core.
- **Depends on:** Task 1, Task 12
- **Traces to:** Spec requirements 6, 7, 9; Acceptance criteria 5, 6, 7; Design decision "Judge owns the behavioral e2e; harness owns deterministic infra"; Lifecycle hooks used
- **Acceptance:**
  - The config wires `beforeAllScenarios`/`afterAllScenarios` to boot/stop and `beforeJudgeAgent`/`afterJudgeAgent` to per-pair install/clean-up; `beforeTestAgent` still scaffolds the plugin.
  - The config sets `paths.rubrics: './eval/rubrics'` and keeps `roles.judge.concurrency: 'serial'`.
  - `roles.judge.prompt` includes the `judge-wp.mjs` command form, the `wp post create … --porcelain` template, the `?p=<id>` URL shape with the port var, and the block-discovery instruction reading `build/blocks/*/block.json`.
  - `npm --prefix testing-project run check:config` passes (the config module loads and typechecks, including `paths.rubrics`).

### Task 14: Add the `judge-wp.mjs` WP-CLI bridge wrapper

- **Goal:** Give the judge a single, cwd-independent command to reach the warm wp-env.
- **Type:** tdd
- **Files to change:** `testing-project/eval/utils/judge-wp.mjs` (new)
- **Changes:**
  - Resolve `PROJECT_ROOT` from `import.meta.url` (the file lives at `<PROJECT_ROOT>/eval/utils/judge-wp.mjs`, so two directories up — matching `wp-cli.mjs`).
  - Shell `npx wp-env --config "<PROJECT_ROOT>/.wp-env.json" run cli wp "$@"`, forwarding the script's CLI args and the process exit code/stdout so the judge sees WP-CLI output. The `--config` absolute path is what makes it reach the warm instance from any cwd (wp-env keys the instance on `md5(configFilePath)`).
- **Depends on:** none
- **Traces to:** Spec requirement 9; Acceptance criterion 6; Design decision "Judge owns the behavioral e2e … bridge via `--config` + wrapper"; testing-project bridge interface
- **Acceptance:**
  - `node eval/utils/judge-wp.mjs <args>` invokes `npx wp-env --config "<PROJECT_ROOT>/.wp-env.json" run cli wp <args>` with `PROJECT_ROOT` resolved from the script's own location (independent of the caller's cwd).
  - The wrapper forwards arbitrary trailing args and propagates wp-env's exit status and output.

### Task 15: Convert all 11 `JUDGE.md`, slim the briefs, and update the conversion guard tests

- **Goal:** Reference the shared rubric by id, delete inlined rubric text, replace the removed env-var catalog with human-language judge-driven setup, and flip the conversion guards to the new shape.
- **Type:** tdd
- **Files to change:** all of `testing-project/eval/scenarios/{async-fetch,config-fetch,counter,derived-double,focus-trap-menu,fruit-list-each,independent-counters,minimal-scaffold,paginated-list,shared-state,toggle-visibility}/JUDGE.md`; `src/__tests__/testing-project-scenarios.test.ts`
- **Changes:**
  - In each `JUDGE.md`: delete the inlined `## Best-practices rubric` block; add a `# Rubrics` section listing `- wp-interactivity-api-best-practices`; replace the `## Environment` env-var catalog (which named the now-removed `$SKILLSMITH_JUDGE_URL` / `$SKILLSMITH_POST_ID`) with slim human-language setup that has the judge activate the plugin, discover the produced block name(s), insert them on a published post, open the page, and run the scenario-specific live checks — keeping the existing scenario-specific behavioral asserts (the per-scenario live-check fragments in the `ANCHORS` table, e.g. counter's `5`/`Increment`/`Decrement`). Move all reusable runtime mechanics (commands, port, URL form) to the role-prompt manual (Task 13); keep each brief purely behavioral and scenario-specific. Do not pre-state the `{ pass, notes }` output instruction. Where retained bridge facts are needed, reference only `$SKILLSMITH_PLUGIN_SLUG` (the retained var).
  - In `src/__tests__/testing-project-scenarios.test.ts`, flip the "each JUDGE.md inlines the full rubric…" test to the new contract: assert each `JUDGE.md` references the rubric **by id** (a `# Rubrics` section listing `wp-interactivity-api-best-practices`) and does **not** inline the `RUBRIC_SENTINEL` text; drop the requirement that the brief states `$SKILLSMITH_JUDGE_URL` / `$SKILLSMITH_POST_ID` (only retained bridge facts such as `$SKILLSMITH_PLUGIN_SLUG` may be required); keep the per-scenario `liveChecks` fragment assertions and the "no `{ pass …` output instruction" assertion. Mirror the flip style used when `testing-project-e2e-removal.test.ts` was inverted.
  - Leave the `_candidates.yaml` guard (lines ~231-248) intact: the conversion must **not** re-introduce a `rubrics:` mention or `scenario.yaml` reference into `_candidates.yaml`; only update that assertion if such wording is accidentally added.
  - Keep all 11 scenarios enumerating cleanly with the `wp-interactivity-api` skill (the "all 11 scenarios enumerate cleanly" test must still pass).
- **Depends on:** Task 4, Task 10, Task 13
- **Traces to:** Spec requirements 9, 10, 11; Acceptance criteria 6, 7, 8; Design decision "Restore the shared rubric to `eval/rubrics/` and reference it by id"; Failure Modes → `testing-project-scenarios.test.ts`
- **Acceptance:**
  - Every one of the 11 `JUDGE.md` contains a `# Rubrics` section listing `wp-interactivity-api-best-practices` and contains no inlined rubric text (the `RUBRIC_SENTINEL` sentence appears only in the rubric file, not in any `JUDGE.md`).
  - Every `JUDGE.md` describes the judge-driven human-language setup (activate, discover block(s), insert, open, check) and retains its scenario-specific live-check fragments; none names `$SKILLSMITH_JUDGE_URL` or `$SKILLSMITH_POST_ID`; none pre-states the `{ pass, notes }` output instruction.
  - `src/__tests__/testing-project-scenarios.test.ts` asserts the new by-id / not-inlined / dropped-env-var / live-check contract and passes; the `_candidates.yaml` guard is unchanged and passes.
  - All 11 scenarios still enumerate cleanly with the `wp-interactivity-api` skill and no enumeration error.

### Task 16: Stop enforcing the block name (scaffold + testing-agent prompt)

- **Goal:** Make the scaffold's starter block name non-binding and drop the rename prohibition so the testing agent may name/structure block(s) freely; keep the deterministic slug.
- **Type:** tdd
- **Files to change:** `testing-project/eval/utils/scaffold-plugin.ts`, `testing-project/eval/prompts/testing-agent.md`
- **Changes:**
  - In `scaffold-plugin.ts`: drop the fixed `BLOCK_NAME = 'skillsmith/testing-block'` constraint from the scaffolded `block.json` — give the starter block a non-binding placeholder name the agent may rename (or omit the pinned name). Keep the name-agnostic `index.php` (globs `build/blocks/*` then `src/blocks/*`) and the deterministic slug-named `package.json` unchanged. Update the doc comment that currently says "the block name is fixed because the e2e specs reference it directly" and the index.php "do not rename" wording so they no longer imply a pinned block name (the **plugin slug** stays deterministic and must still not be renamed).
  - In `testing-agent.md`: drop the constraint (currently the paragraph forbidding renaming the block / changing registration). Reword to: implement inside the scaffold, keep the plugin as-is (slug preserved), but name/structure the block(s) as the task needs. Keep the `get_block_wrapper_attributes()` guidance (name-independent, still good practice).
- **Depends on:** none
- **Traces to:** Spec requirement 10; Acceptance criterion 7; Design decision "Stop enforcing the block name; the judge discovers names from built `block.json`; the slug stays deterministic"
- **Acceptance:**
  - The scaffolded `block.json` no longer pins `skillsmith/testing-block`; the starter block name is a non-binding placeholder (or unset) the agent may change.
  - `index.php` still registers any block dir name-agnostically and the plugin slug remains `plugin-<scenario>-<agent>` (deterministic, still not renameable).
  - `testing-agent.md` no longer forbids renaming/restructuring the block, still forbids creating a new plugin or renaming the plugin slug, and retains the `get_block_wrapper_attributes()` guidance.

### Task 17: Add the staging dir to `.gitignore`

- **Goal:** Ignore the hook-owned host staging dir created at boot.
- **Type:** tdd
- **Files to change:** `.gitignore`
- **Changes:**
  - Add `testing-project/.wp-env-plugins/` alongside the existing `testing-project/.wp-env.json` entry in the "TESTING PROJECT SPECIFIC" section.
- **Depends on:** none
- **Traces to:** Spec requirement 6; Design decision "Boot wp-env once…"; Components → Root `.gitignore`
- **Acceptance:**
  - `.gitignore` ignores `testing-project/.wp-env-plugins/` and still ignores `testing-project/.wp-env.json`.

### Task 18: Extend the existing changeset

- **Goal:** Record the core rubric support by amending the existing base changeset (do not add a second).
- **Type:** tdd
- **Files to change:** `.changeset/flexible-scenarios-judge-verification.md`
- **Changes:**
  - Amend the sentence stating the `Paths` type drops `paths.rubrics` to read that it **drops then restores `paths.rubrics` as optional**.
  - Add a note that a `JUDGE.md` may reference reusable rubrics by id under a `# Rubrics` section, resolved from the optional `paths.rubrics` location and injected into the judge's grading material (verdict unchanged).
  - Keep the bump `minor` with the `BREAKING:` summary prefix. Do not add a second changeset file.
- **Depends on:** Task 1, Task 3, Task 4, Task 5, Task 6
- **Traces to:** Spec requirement 13; Design decision "Extend the existing changeset; only core changes bump"; Research → Changeset state
- **Acceptance:**
  - The single changeset `.changeset/flexible-scenarios-judge-verification.md` states `paths.rubrics` is dropped then restored as optional and documents rubrics-by-id (`# Rubrics`, resolved from `paths.rubrics`).
  - The frontmatter bump stays `@automattic/skillsmith: minor` and the summary keeps the `BREAKING:` prefix; no second changeset file is added.
  - `npx tsx scripts/validate-changesets.ts` passes.

### Task 19: Single-scenario manual sanity check (live bind-mount + judge-driven setup)

- **Goal:** Empirically confirm, once, the one source-verified-but-unbooted claim: a plugin copied into the live bind-mounted staging dir is immediately activatable and the judge-driven setup works end to end for one scenario.
- **Type:** tdd
- **Files to change:** none (manual verification; no source change)
- **Changes:**
  - Manually, within the testing posture (at most a single scenario × single agent — do **not** run the self-improvement loop or a full suite): boot wp-env once via `bootJudgeEnv`, copy a built plugin into `.wp-env-plugins/<slug>/`, `wp plugin activate <slug>`, confirm it registers; then drive one converted scenario through the judge to confirm it discovers the block from `build/blocks/*/block.json`, creates the post, opens `?p=<id>`, and produces a `{ pass, notes }` verdict. Tear down with `stopJudgeEnv`.
  - Requires Docker available locally. If any step fails, surface it as a blocker rather than altering the design.
- **Depends on:** Task 12, Task 13, Task 14, Task 15, Task 16
- **Traces to:** Acceptance criteria 5, 6, 7, 9; Risk 2 (live-bind-mount empirical check); Risk 5 (judge reliability); Risk 4 (Docker)
- **Acceptance:**
  - wp-env boots once; a plugin copied into the live-mounted staging dir activates without a restart.
  - One converted scenario runs through the judge end to end: block discovered, post created, page opened, `{ pass, notes }` verdict recorded.
  - No self-improvement loop and no full-suite run are performed; the deterministic gates remain green.
