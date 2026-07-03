# Docs Review

## Verdict: approved

## Batch scope

Tasks reviewed (the full initial batch, Tasks 1–8 of `docs-plan.md`):

- **Task 1** — README: rewrite the judge-material sections to the judge-library model (`03bc0f6`).
- **Task 2** — README: realign the configuration reference (`5f3a0ee`).
- **Task 3** — README: lifecycle, diagram, and report schema (`505614e`).
- **Task 4** — README: breaking-change note and migration notes for the new wave (`bdcfd93`).
- **Task 5** — README: crash-recovery one-liner replacing the deleted `env:stop` script (`bb8ad0f`).
- **Task 6** — `examples/skillsmith.config.ts`: full comment realignment to the library model (`a4a2dc3`).
- **Task 7** — Changesets: fix the falsified `dirName` clause and verify the release record reads consistently (no commit — verify-only outcome; the `nested-scenario-folders.md` edit shipped with code Task 12, `6c0e9eb`).
- **Task 8** — Cross-surface consistency sweep; one fix: dropped the feature changeset's false "no existence gate" claim (`c388bee`).

## Summary

Every task in the batch satisfies its per-task Acceptance criteria, and every concrete
claim spot-checked against the shipped branch state holds. The docs-phase diff since the
phase-4 approval (`9dfb928 → HEAD`) touches exactly the three files the plan scoped —
`README.md`, `examples/skillsmith.config.ts`, and
`.changeset/flexible-scenarios-judge-verification.md` — with no scope creep and no work on
unplanned surfaces. The README now describes the judge-library model, the realigned config
surface, the shipped prompt-assembly order, the `judging` report block with its exact
presence rule, the `dirName` removal, and the two-key breaking wave with a migration recipe
that agrees with the shipped changesets; the reference example config teaches the library
model at full depth; the pending changeset set reads as one coherent release note with the
retired model described nowhere as current. A repository-wide drift sweep found the retired
surfaces (`paths.rubrics`, `roles.judge.prompt`, `dirName`, `env:start`/`env:stop`, the
`# Rubrics`/selection-lead-in shape, the "silently unavailable" behavior) present only in
permitted migration/removal/validation-error contexts. Both docs-phase guardrail gates were
run and pass.

## Checks

| Check | Command | Result |
| ----- | ------- | ------ |
| changeset-format | `npx tsx scripts/validate-changesets.ts` | pass (exit 0) |
| changeset-status | `npx changeset status --since=origin/trunk` | pass (exit 0; minor bump for `@automattic/skillsmith`, no major) |

## Accuracy spot-check

Per task, at least one concrete claim verified against the shipped code:

- **Task 1** — README's fenced brief-reference example (README:173) is byte-identical to the
  shipped `testing-project/eval/scenarios/counter/JUDGE.md:10`
  ("As a further code check, verify the produced code against
  `judge-library/rubrics/wp-interactivity-api-best-practices.md`."), and that rubric exists
  at `testing-project/eval/judge/rubrics/wp-interactivity-api-best-practices.md`. The
  tool-less inline-fallback description (README:192 — an explicit `tools` list carrying
  neither `Read` nor `Bash`, including empty) matches `isToolLess` in
  `src/pipeline/judge-library.ts:165-169`. The library section order
  (heading → `README.md` body → manifest/inline → selection instruction) matches
  `prepareJudgeLibrary` (`judge-library.ts:141-152`).
- **Task 2** — README's judge system-prompt assembly order (README:355-360) matches
  `buildJudgeSystemPrompt` in `src/pipeline/judge-agent.ts:208-240`: brief → `# Testing task`
  → output instruction (strict-JSON, then decision rule, then missing-material duty, then
  `# Recursion guard`) → `# Judge library` last, only when configured. The `Paths` default
  `{ base: './.skillsmith', skills: './skills', scenarios: './eval/scenarios' }` (README:353)
  matches `src/config/defaults.ts:3-6`, and `Paths` no longer carries `rubrics`
  (`src/config/types.ts:165-169`).
- **Task 3** — The `dirName` removal claim (README:409) is verified: `grep -rn dirName src/`
  returns nothing. The `judging` presence rule (README:290-293) matches the write sites in
  `src/pipeline/agent-loop.ts`: `judging` omitted on the testing-failed path (256) and the
  library-prep-failure path (307), present with `duration` on the normal/dispatch-threw/
  unparseable paths (386), and the report shape is `{ testing, judging, review }` or
  `{ testing, review }` (`agent-loop.ts:485-487`). The `tokenUsage` four-field shape
  (`inputTokens`, `cachedInputTokens`, `outputTokens`, `totalTokens`) matches
  `src/providers/types.ts:61-64`. The Mermaid diagram (README:89-99) stages
  `judge-library/` "(when configured)", consistent with the shipped guarded copy.
- **Task 4** — The exact validation rejection messages quoted in the migration notes
  (README:402-403) are byte-identical to `src/config/validate.ts:65,186`. The migration
  recipe (README:397-409) agrees with `.changeset/judge-library-breaking-wave.md` (two keys
  removed → `roles.judge.library`; decision rule centralized, brief prose overrides;
  `dirName` → `id`). The top-of-file `> [!IMPORTANT]` note (README:26) no longer routes
  rubric supply via `paths.rubrics` and links to `#the-judge-library`, which resolves.
- **Task 5** — The crash-recovery command `npx wp-env stop` from `testing-project/`
  (README:200) resolves the same warm instance the shipped teardown stops:
  `testing-project/eval/utils/wp-env-judge.ts` stops with
  `wp-env stop --config <PROJECT_ROOT>/.wp-env.json` (line 121-125), and a bare
  `npx wp-env stop` from the project root defaults to that same `./.wp-env.json` absolute
  path (identical md5-keyed instance). `.wp-env.json` is deleted only on clean stop
  (`stopJudgeEnv`), so it survives a crash before `afterAllScenarios`. The `env:start`/
  `env:stop` scripts are gone from `testing-project/package.json` and referenced nowhere in
  docs.
- **Task 6** — `examples/skillsmith.config.ts` is comment-only relative to phase 4 (the
  diff since `9dfb928` contains no non-comment line changes) and carries no `paths.rubrics`,
  `roles.judge.prompt`, `judgePrompt`, or bare-id rubric surface. Its rubric-by-path
  illustration (`judge-library/rubrics/wp-interactivity-api-best-practices.md`) mirrors the
  shipped brief.
- **Task 7** — `.changeset/nested-scenario-folders.md` no longer asserts `dirName`
  availability (already corrected by code Task 12). Reading the three shipping changesets
  together, the retired load-all rubric model and the removed keys appear only as
  removal/migration descriptions; the breaking waves and their migration recipes are stated
  without contradiction; `.changeset/judging-report-block.md` states the presence rule; no
  changeset uses `major`.
- **Task 8** — Repository-wide `git grep` over the tracked doc surfaces (README, `examples/`,
  `testing-project/skillsmith.config.ts`, `testing-project/eval/**/*.md`, `docs/`,
  `CONTRIBUTING.md`, `.changeset/`) finds the retired-surface terms only in permitted
  contexts (migration notes, validation-error descriptions, changeset removal prose). The
  testing-project config comments accurately describe `library: './eval/judge'` with the
  README-as-manual and rubrics/ wiring. All nine internal README anchor links resolve to
  existing headings.
