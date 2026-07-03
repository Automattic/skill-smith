# Code Summary: Reusable rubrics and a leaner, human-language live-judge setup

## What

Review-1 of the #55 pipeline, landed as an additive increment on the merged base across two tracks that meet only inside the judge's system prompt:

- **Track A (Skillsmith core, the only release-bumping change):** reusable rubrics referenced by id. A `JUDGE.md` may carry an optional `# Rubrics` section (parsed exactly like `# Skills`); ids are validated at enumeration and routed through the existing per-scenario error channel; an optional `paths.rubrics` config surface and a `Scenario.rubrics?` field are introduced; the resolved rubric content is loaded lazily at judge dispatch and injected into the judge system prompt under a `# Grading rubrics` heading. The verdict stays `{ pass, notes }`.
- **Track B (testing-project, no package bump):** wp-env is booted once per run via a live Docker bind-mount + per-slug staging dir; each pair's built plugin is installed/activated against that warm env under the existing serial judge lock with a `deactivate --all` clean slate; the live e2e (block discovery, post creation, page open, behavioral checks) moves into a human-language, judge-driven setup powered by a role-prompt "environment manual" and a `judge-wp.mjs` `--config` WP-CLI bridge; the fixed block name is no longer enforced (the plugin slug stays deterministic); and the shared best-practices rubric is restored to `eval/rubrics/`, referenced by id from all 11 `JUDGE.md`.

## Why

The base run inlined an identical best-practices rubric in all 11 `JUDGE.md` files and booted/tore down wp-env per (scenario, agent) pair, with the harness pre-creating the post and handing the judge a URL. This review removes the 11x rubric duplication (so shared criteria are authored once and different scenarios can select different rubrics), pays the wp-env boot cost once and keeps the env warm, and slims each judge brief to a plain-language e2e test — refining, not reverting, the merged live-judge model.

## How

- **Core parse/validate/load/inject** mirrors the skills path at each seam: `parseRubricsSection` shares a generalized section-collection helper with `parseSkillsSection`; `scenarioFromBriefs` validates each id with `existsSync(<rubricsRoot>/<id>.md)` and appends `unresolved reference: rubric "<id>"` to the same `problems[]` as skills (no throw); `loadRubric` mirrors `loadSkill` with a flat `<id>.md` entry and md-link following inside the rubrics root; `runJudgeAgent` resolves the rubrics root and builds the blob, keeping `buildJudgeSystemPrompt` a pure, filesystem-free string builder. `paths.rubrics` is optional with no `DEFAULT_PATHS` entry and no `checkPaths` existence gate (a missing referenced rubric surfaces per-scenario, mirroring skills).
- **Env-once** is implemented entirely in `testing-project` hooks (no core run-lifecycle change): `bootJudgeEnv`/`stopJudgeEnv` at run level (`beforeAllScenarios`/`afterAllScenarios`) with a module-level `booted` singleton; `installPluginForPair`/`cleanUpPair` per pair (`beforeJudgeAgent`/`afterJudgeAgent`). The `.wp-env.json` maps the whole `wp-content/plugins` to the host staging dir via `mappings` (mount without auto-activate) so a plugin copied in after boot is live without a restart.
- **Six guard tests** that pinned the base removal were flipped to the restored-optional/by-id contract. The green-gate invariant (all five gates green at every commit) is preserved by folding four straddling guard flips into the same commit as the change that would trip them (core-types `@ts-expect-error`; smoke-fixture `afterAllScenarios` removed-field hook; `e2e-removal` `eval/rubrics`; `testing-project-scenarios` conversion).
- **Changeset** is amended in place (single `flexible-scenarios-judge-verification.md`, `minor` + `BREAKING:`): the `paths.rubrics`/`Scenario.rubrics` "dropped" claim is rewritten to "drops then restores as optional" and a rubrics-by-id note is added; only `src/**` bumps the package, so the testing-project changes do not bump.

## Key decisions

- Mirror the proven `# Skills` parser, validation channel, and lazy loader rather than inventing a bespoke rubric grammar or a generic include mechanism — one consistent author mental model, reused tested machinery.
- Keep the verdict `{ pass, notes }`: rubrics are reusable grading *content*, not a structured per-rubric scoring grid, so `parseJudgeJson`/reporting/improver wiring is untouched.
- `paths.rubrics` is "required only when used" (optional field, no default, no path gate); a referenced-but-missing rubric fails its scenario clearly via the per-id enumeration error.
- Trade determinism for simplicity on the judge side: block insertion and page open move from the deterministic harness to the LLM judge, mitigated by exact command templates in the role-prompt environment manual and the `judge-wp.mjs --config` wrapper. The harness keeps the deterministic infra (boot, build, copy-install, clean-slate, WP-CLI bridge).

## Known limitations

- **R16 manual sanity check is owner-run and outstanding.** Per the spec's unchanged testing posture (Acceptance criterion 9, Requirement 14), full behavioral verification across the suite is manual, and the single source-verified-but-unbooted claim — that a plugin copied into the live bind-mounted staging dir is immediately activatable without a restart, and that the judge-driven setup works end to end for one scenario — is gated behind Docker + a live wp-env boot. This review verified the deterministic gates and re-drove the E2E flows against the code, but did not boot wp-env; Task 16 remains an owner-run check.
- **LLM-judge flakiness is an accepted trade.** Moving block discovery, post creation, and page open into the LLM judge introduces nondeterminism a flaky judge could fail on. This is an explicit, owner-requested trade, mitigated by the role-prompt manual's exact templates and the `judge-wp.mjs` bridge, but it is a known reliability cost relative to the base's harness-driven setup.
- **Legacy `setUpJudgeEnv` / `tearDownJudgeEnv` retained as unwired exports** in `wp-env-judge.ts` (documented and test-pinned), affecting no behavior or gate — a minor cleanliness item, not a defect.
