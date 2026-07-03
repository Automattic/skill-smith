# Docs Review

## Verdict: approved

## Batch scope

Tasks reviewed:

- Task 1: Align the README's example judge brief with the shipped brief conventions (`bb45fb6`)
- Task 2: Align the reference config's rubric-reference illustration with the id-naming convention (`1702014`)

## Summary

Both tasks land exactly what the docs plan scoped, and every concrete claim checks out against the shipped code. The README example's opener and rubric sentence are byte-identical to the shipped briefs' fixed template text (all 11 briefs share a single opener — one unique hash across `head -1` of every `JUDGE.md` — and each contains the rubric sentence exactly once); the reference config's illustrative fragment is a verbatim substring of that shipped rubric sentence. Neither edit overclaims: rubric-by-bare-id is framed as "clearest", not parsed or enforced, and all unchanged-mechanics statements (optional key, no default, no existence gate, no `# Rubrics` grammar, auto-supplied rubric content, no reference validation) remain true against `src/`. The drift sweep found no stale surface anywhere in the shipped docs set, no scope creep (two commits, one file each), and both docs-phase gates pass with no changeset added.

## Checks

| Check | Command | Result |
| ----- | ------- | ------ |
| changeset-format | `npx tsx scripts/validate-changesets.ts` | pass |
| changeset-status | `npx changeset status --since=origin/trunk` | pass (existing `minor` entry `.changeset/flexible-scenarios-judge-verification.md`; no changeset added in `fdec900..HEAD`) |

Additional acceptance-bullet verification (Task 2, not a docs-phase gate): `npm run typecheck` and `npm run lint` both exit 0 — the edit is comment-only and behaviorally inert (`rubrics: './eval/rubrics'` value line unchanged).

## Accuracy spot-check

**Task 1 (`README.md` `### Reusable rubrics`):**

- The example's opener ("Judge the produced work against the checks below … Pass only if every check, including the rubric check, is satisfied.") matches `testing-project/eval/scenarios/counter/JUDGE.md:1` verbatim; all 11 briefs share that identical first line (single md5 across the set).
- The example's closing sentence ("As a further code check, verify the produced code against the `wp-interactivity-api-best-practices` rubric.") matches `counter/JUDGE.md:12` verbatim; grep confirms exactly one occurrence in each of the 11 briefs.
- The new framing claim "matches the `# Rubric: <id>` label the judge sees on each loaded rubric" matches `src/scenarios/rubric-loader.ts:122` (`blocks.push( \`# Rubric: ${ id }\n${ body }\` )`), and the id `wp-interactivity-api-best-practices` is the filename-derived id of `testing-project/eval/rubrics/wp-interactivity-api-best-practices.md`.
- The cross-link `#the-judge-brief` resolves to the existing `### The judge brief` heading (README.md:137), whose "You do not restate the task in `JUDGE.md`" prose backs the note's auto-supply rationale.
- The superseded "Decide whether the produced block satisfies the task it was given" opener and title-style rubric naming are gone; the condensed placeholder bullet (rather than the full two-section template) follows the plan's explicit non-blocking note for Task 1.

**Task 2 (`examples/skillsmith.config.ts` `paths.rubrics` comment):**

- The illustrative reference ("verify the produced code against the `wp-interactivity-api-best-practices` rubric") is a verbatim fragment of the shipped briefs' rubric sentence; the title-style example is gone.
- Unchanged mechanics re-verified against `src/`: `rubrics?: string` is optional with no default (`src/config/types.ts:154`); no existence gate (`runJudgeAgent` passes `undefined` through when unset, and `loadAllRubrics` returns `undefined` for a missing or empty directory — no error, `src/pipeline/judge-agent.ts:73–77`, `src/scenarios/rubric-loader.ts:87–94`); rubric content is auto-supplied to the judge under `# Grading rubrics`; `JUDGE.md` is stored verbatim with no parsed structure (`src/scenarios/enumerate.ts`), so "no `# Rubrics` id list and no reserved grammar" holds.

**Drift sweep:** grep across `README.md`, `CONTRIBUTING.md`, `docs/`, `examples/`, `testing-project/eval/prompts/`, `_candidates.yaml`, and `.changeset/` for `Decide whether`, `satisfies the task`, title-style `Interactivity API best-practices`, `What to check`, `Live checks`, and the dead env vars found nothing stale. The one remaining `best-practices rubric` hit (README.md:347, `Migrating from the old model`) is generic factor-into-a-rubric guidance consistent with the new convention. The code phase shipped no public surface outside the briefs and the conformance test, so no undocumented surface exists.

## Issues

None.
