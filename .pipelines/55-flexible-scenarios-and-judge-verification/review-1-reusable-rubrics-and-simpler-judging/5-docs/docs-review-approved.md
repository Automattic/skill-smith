# Docs Review

## Verdict: approved

## Batch scope

Tasks reviewed (review-1 docs batch, iteration N=1):

- **DR1** — Reintroduce reusable rubrics-by-id in the README (`README.md`)
- **DR2** — Show optional `paths.rubrics` and the judge "environment manual" in the example config (`examples/skillsmith.config.ts`)
- **DR3** — Reflect env-once and judge-driven setup in the README's WordPress narrative (`README.md`)
- **DR4** — Reflect env-once and judge-driven setup in the example-config hook comments (`examples/skillsmith.config.ts`)
- **DR5** — Audit CONTRIBUTING for rubric/contract drift (`CONTRIBUTING.md`, no-op audit)
- **DR6** — Verify the landing page does not misstate the model (`docs/index.html`, no-op audit)

## Summary

The batch is accurate, complete, and consistent with the shipped code. Every concrete claim across `README.md` and `examples/skillsmith.config.ts` was spot-checked against the phase-4 source and matched: rubrics-by-id parsing under `# Rubrics`, enumeration-time validation with a per-scenario `unresolved reference: rubric "<id>"` error (no throw), optional `paths.rubrics` with no default and no `checkPaths` existence gate, lazy `loadRubric` from a flat `<id>.md`, injection under the literal `# Grading rubrics` heading in the judge system prompt, the unchanged `{ pass, notes }` verdict, env booted once per run via `beforeAllScenarios`/`afterAllScenarios` with per-pair install/clean-slate, the dropped `SKILLSMITH_JUDGE_URL`/`SKILLSMITH_POST_ID` env vars, and the un-enforced block name. No remaining README or example statement asserts that rubrics or `paths.rubrics` don't exist, that the harness pre-creates the post / hands a fixed URL, or that the shared env boots per pair. Audience fit is right (consumers/adopters), the rationale is faithful to the spec and design doc, and every new cross-link resolves to a real heading. The two no-op audits (DR5, DR6) were correct: CONTRIBUTING contains no `rubric`/`paths`-absence statement to correct, and the `docs/index.html` note-card ("stands up `wp-env` and drives a real browser ... that runtime belongs to the example") still reads true under the env-once, judge-driven model. All four guardrail gates run and pass.

## Checks

| Check | Command | Result |
| ----- | ------- | ------ |
| Changeset validation | `npx tsx scripts/validate-changesets.ts` | pass |
| Changeset status | `npx changeset status --since=origin/trunk` | pass |
| Typecheck (example config is typechecked) | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass |

Notes: `changeset status` reports `@automattic/skillsmith` at `minor` with no `major` (pre-1.0 compliant). `npm run lint` exits 0 with a single Biome config-migration *info* (`biome migrate` suggestion) unrelated to the docs.

## Accuracy spot-check

Each claim below was verified against the shipped phase-4 source under the worktree.

- **DR1 — rubric injection heading.** README: "supplies it to the judge automatically, under a `# Grading rubrics` heading in the judge's system prompt." Verified `src/pipeline/judge-agent.ts` `buildJudgeSystemPrompt` pushes `` `# Grading rubrics\n${ rubricBlob }` `` into its `sections` array only when the blob is non-empty — the literal heading text matches exactly.
- **DR1 — unknown-id behavior.** README: "that scenario is reported with a clear error and runs no agents — the same keep-but-skip-and-fail behavior as an unknown skill id." Verified `src/scenarios/enumerate.ts` validates each id with `existsSync(join(rubricsRoot, `${rubric}.md`))` and pushes `unresolved reference: rubric "<id>"` to the same `problems[]` array used for skills; no throw.
- **DR1 — flat `<id>.md` resolution.** README: "Each id resolves to a flat `<id>.md` file under the rubrics directory." Verified `src/scenarios/rubric-loader.ts` `loadRubric` resolves `<rubricsRoot>/<id>.md` (flat, not `<id>/RUBRIC.md`) and concatenates md-linked companions with `=== <rel> ===` headers.
- **DR2 — optional `paths.rubrics`, no default.** Example comment: "Omit this key entirely if no scenario references a rubric — it is required to exist only when a project uses it." Verified `Paths.rubrics?: string` in `src/config/types.ts`, `DEFAULT_PATHS` in `src/config/defaults.ts` has no `rubrics` key, and `checkPaths` in `src/pipeline/pipeline.ts` existence-checks only `['skills', 'scenarios']`.
- **DR2 — `roles.judge.prompt` "environment manual."** Verified the testing-project mirrors this pattern: `testing-project/skillsmith.config.ts` loads `roles.judge.prompt` from a real `eval/prompts/judge.md` file that exists on disk and carries the runtime mechanics (CLI bridge command form, block discovery via `block.json`). The example's generic comment accurately describes that pattern without leaking WordPress-specific command strings.
- **DR3 — env-once + dropped URL.** README: reference project "boots a single `wp-env` once per run in `beforeAllScenarios` ... the harness does not pre-create a post or hand the judge a fixed URL." Verified `testing-project/skillsmith.config.ts` wires `beforeAllScenarios: () => bootJudgeEnv()` / `afterAllScenarios: () => stopJudgeEnv()` and per-pair `installPluginForPair`/`cleanUpPair`; `wp-env-judge.ts` exports `SKILLSMITH_PROJECT_ROOT`, `SKILLSMITH_WP_PORT`, `SKILLSMITH_PLUGIN_SLUG` and contains no `SKILLSMITH_JUDGE_URL`/`SKILLSMITH_POST_ID`.
- **DR3 — exported facts.** README: "exports the per-pair facts the judge reads to reach the environment (the project root, the port, and the plugin slug)." Matches the three env vars set in `wp-env-judge.ts` exactly.
- **DR4 — hook comments.** Example `beforeJudgeAgent` comment ("build the artifact ... install it into the warm environment") and `afterJudgeAgent` comment ("uninstall this pair's artifact ... the shared environment stays up") match the env-once install/clean-slate model and no longer imply per-pair boot or a harness-created post.
- **DR5 — CONTRIBUTING no-op.** `grep -ni rubric CONTRIBUTING.md` returns nothing; no statement pins the absence of `Scenario.rubrics`/`paths.rubrics`. The "When a changeset is required" / `defineConfig` discussion documents the *process*, not the feature's contract surface. Leaving the file unchanged is correct.
- **DR6 — landing page no-op.** `docs/index.html:240` note-card ("stands up `wp-env` and drives a real browser as the judge's environment ... That runtime belongs to the example, not to Skillsmith") still reads true: the example still owns `wp-env`, the judge still drives the browser, and no card claims rubrics were removed. Leaving the file unchanged is correct.

### Note (not an issue)

`examples/skillsmith.config.ts` reads `roles.judge.prompt` from `prompts/judge.md` via `readFileSync`, and `examples/prompts/` does not exist. This was checked specifically per the launch prompt. It is **not** an issue: the same already-shipped, already-approved file reads `prompts/testing-agent.md` and `prompts/improver.md` from that same non-existent directory at the base ref, so the new `prompts/judge.md` reference is fully consistent with the established illustrative pattern. The file's header explicitly instructs consumers to "copy the parts you need into your project's `skillsmith.config.ts`" (i.e. supply their own prompt files). The example is typechecked (`tsconfig.json` includes `examples/**/*`) but `readFileSync` is not executed by `tsc`, so this does not affect any gate, and it is not a regression introduced by this batch.

## Issues

None.
