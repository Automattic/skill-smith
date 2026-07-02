# Independent reviewer report: churn-pollution analysis

*Produced by an independent read-only reviewer against branch tip `0addcb8`, commissioned by the owner after the review-3 close-out. Preserved verbatim as intent source material for the review-4 run. Verify claims against the code before acting on them.*

Verification context: on `origin/trunk`, `wp-cli.mjs` had 12 consumers (all 11 `e2e.spec.mjs` + `verify-e2e.ts`) — every one deleted by the base run, yet the module was kept and even rewritten in review-3. All test fixtures have consumers. Sanity check: `npm run typecheck` clean, `npm test` 379 pass / 0 fail / 2 skipped on tip `0addcb8` — so every tombstone below is live and enforced, not already-broken residue.

Ranked by confidence × impact. All paths relative to the worktree root.

## High confidence, high impact

**1. Dead legacy per-pair orchestrators `setUpJudgeEnv` / `tearDownJudgeEnv`** — `testing-project/eval/utils/wp-env-judge.ts:314-390`
- Their own doc comments say "Retained … **until the config is rewired** onto bootJudgeEnv/installPluginForPair; **not used by the new run-level lifecycle**". Review-3 *did* the rewiring (`skillsmith.config.ts:81-103` wires only the four new hooks). Zero production callers.
- Drag-along pollution: the `execSync` import (line 1) is used only by these two functions; and the `npm run env:start`/`env:stop` invocations (:355, :377) are the **only code consumers** of the `env:start`/`env:stop` scripts in `testing-project/package.json:7-8`.
- Cleanup: delete both functions, drop the `execSync` import, then decide whether `env:start`/`env:stop` remain as manual dev conveniences or go too.

**2. Tombstone test that cements finding 1** — `src/__tests__/testing-project-judge-config.test.ts:242-254`
- Test titled `'setUpJudgeEnv and tearDownJudgeEnv remain exported (legacy orchestrators)'` asserts the dead exports exist; a transitional property frozen as a permanent contract, actively blocking cleanup.

**3. Dead module `testing-project/eval/utils/wp-cli.mjs`** (whole file, 57 lines) **+ its keep-alive sentinel** — `src/__tests__/wp-env-judge-lifecycle.test.ts:35, 460-474`
- The base run deleted every consumer with the e2e harness but kept the module; review-3 then *rewrote dead code* (commit `985d8bc`) to pin it to the warm-env `--config`. The sentinel test's message ("deactivateAllPlugins stays available as the clean-slate primitive") is false in practice — the clean-slate primitive actually used is `commands.wpCli(['plugin','deactivate','--all'])` inside `wp-env-judge.ts:281,306`. The judge's runtime CLI path is the separate, live `judge-wp.mjs` bridge.
- Cleanup: delete `wp-cli.mjs`, the sentinel test, and the "sibling wp-cli.mjs" comment aside in `wp-env-judge.ts:10`.

**4. Repo-state pinning in `src/__tests__/feature-changeset.test.ts` — future CI breakage on unrelated work**
- `:72-78` asserts an intermediate changeset stays deleted (pivot tombstone). `:80-87` asserts "the four unrelated changesets remain" — will fail the moment a release consumes them (`changeset version` deletes changesets). `:89-126` asserts "**exactly one** new feature changeset exists" — will fail as soon as *any* future PR adds a changeset, per the project's own AGENTS.md policy. `:177-205` asserts release-note prose tombstones of an intermediate pivot.
- The durable contract (valid changeset, no `major` pre-1.0) is already covered by `scripts/validate-changesets.ts` + its test.
- Cleanup: reduce the file to "the feature changeset exists, is `minor`, starts with `BREAKING:`, and passes the validator", or delete it.

## High confidence, medium impact

**5. Migration-scan guard file `src/__tests__/testing-project-e2e-removal.test.ts`** (whole file)
- Header says "Removal contract for Task 17". Asserts deleted files stay deleted, deleted deps/scripts stay deleted, and greps the entire testing-project for harness tokens. Post-merge, "the e2e harness silently creeping back" is not a real regression vector. It also **pins the `env:start`/`env:stop` scripts as "must be retained"** (:104-113) — scripts whose only code consumers are finding 1's dead functions — so it transitively cements more pollution. The no-legacy-files half duplicates `testing-project-scenarios.test.ts:107-114`. Header wording drift: says the rubric "is referenced by id from each scenario" (review-1 phrasing).
- Cleanup: delete the file; keep any invariant worth keeping in `testing-project-scenarios.test.ts`.

**6. Retired-symbol source scans in `src/__tests__/wp-env-judge-lifecycle.test.ts`**
- `:434-458` greps the helper source for seven dead-model strings; `:276-285` asserts the retired `SKILLSMITH_JUDGE_URL`/`SKILLSMITH_POST_ID` env vars "are not exported". These pin review-3's diff, not a behavior contract (positive assertions at :261-275 already fully specify the exported vars).

**7. Orphaned asset `assets/skill-tester-workflow.png`**
- `origin/trunk:README.md:60` embedded it; commit `5084844` replaced it with the Mermaid diagram, and no file references the PNG now. Keep `self-improvement-loop.png` (live at README.md:193).

**8. Tombstone file `src/__tests__/selection-duplicate-name-guard-removed.test.ts`**
- Test 1 asserts a function is *not* exported (guard removed in base-run commit `f61d10b`). Test 2 (:25-36) is a legitimate behavior test that belongs in `scenario-selection.test.ts`. Move test 2, delete the file.

## Medium confidence / lower impact (comment and naming drift)

**9.** `testing-project/eval/utils/scaffold-plugin.ts:92-94` — "…so **the e2e run** can activate each independently." The e2e run died in the base run; activation is done by `installPluginForPair`. Fix wording.

**10.** `src/__tests__/testing-project-judge-config.test.ts:7-17` — header describes the base-run **per-pair** model; review-3 made it run-level warm-env. Same file `:142-150` carries tombstone source-greps. Rewrite header, drop the negative greps.

**11. Tombstone-assertion cohort inside otherwise-live tests** — each small; together they encode three pivots' diffs as permanent negative assertions:
- `testing-project-scenarios.test.ts:202-211` (dead env vars) and `:229-246` (`_candidates.yaml` legacy shape); header `:12-14` defines the model by contrast to the "legacy structured model".
- `core-types.test.ts:59-84` "Scenario no longer declares the legacy fields".
- `check-paths.test.ts:35` — transitional framing ("no longer contains a rubrics key"); assertion itself fine.
- `scaffold-block-name.test.ts:96-113, 171` — three "no longer" source-text scans.
- `judge-agent.test.ts:406` — "does not read … any removed scenario field".
- `enumerate-rubrics.test.ts` tests 2-5 (:69-164) — all assert review-1/review-2 removals stay removed; filename names machinery that no longer exists. Rename/reframe as an opaque-brief contract test.

## Verified clean (checked, not pollution)

- `src/config/types.ts` / `validate.ts`: every addition consumed. Public export surface (`src/index.ts`): no orphans. Rubric machinery: all live; all rubric fixtures consumed.
- `judge-wp.mjs` bridge: live (judge.md prompt + dedicated test) — unlike its dead sibling `wp-cli.mjs`.
- Docs: README fully reflects the final review-3 model; old-model mentions live only in the intentional migration section. `docs/index.html`, `examples/skillsmith.config.ts`, all three prompts: no dead-model vocabulary. The "e2e failure" mentions in `src/improvement/context.ts:94`, `src/pipeline/pipeline.ts:425`, `examples/skillsmith.config.ts:237` are legitimate generic examples.
- Changeset `.changeset/flexible-scenarios-judge-verification.md`: accurately describes the final shipped model (each claim checked against code).
- Test fixtures: all nine have exactly one consumer each.

## Pattern summary

The dominant pollution mode is **the pipeline's incremental plans fossilized as tests**: "Task N" removal contracts, "remains exported until rewired" bridges whose rewiring shipped in the same review, and source-text greps pinning each pivot's diff forever. Two of these actively *prevent* deleting dead code, and one will fail CI on the first unrelated changeset. Cleanup is mechanical: ~450 lines of tests and ~130 lines of code/asset deletions, no behavior change.
