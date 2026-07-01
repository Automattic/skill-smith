# Docs Review

## Verdict: approved

## Batch scope

Tasks reviewed:

- **D1** — Rewrite the README rubric/judge-brief model to natural-language references and the auto-supplied task (`README.md`)
- **D2** — Reconcile the reference example config's rubrics comment with the new model (`examples/skillsmith.config.ts`)
- **D3** — Fix the testing-project config comment that references rubrics "by id" (`testing-project/skillsmith.config.ts`)

## Summary

All three docs tasks accurately describe the shipped review-2 model and satisfy their per-task Acceptance criteria. The README now describes `JUDGE.md` as fully opaque prose with no reserved sections, rubric selection by plain-language prose (no `# Rubrics` id list), load-all-from-`paths.rubrics` delivery with the G1 `# Rubric: <id>` header and G2 selection lead-in, the optional/un-gated `paths.rubrics` surface, the removal of enumeration-time id validation (a mistyped reference is silently unreported and does not error the scenario), and the auto-supplied skill-agnostic task. Both config comments match that model and stay mutually consistent with the README. Every concrete claim was spot-checked against the shipped code and matched; no stale rubric-by-id text remains anywhere in the docs surface or the swept "no-change" surfaces; all inbound `#reusable-rubrics` (and related) anchors resolve; and `testing-project` retains `paths.rubrics: './eval/rubrics'`. Both docs gates run green.

## Checks

| Check | Command | Result |
| ----- | ------- | ------ |
| changeset-format | `npx tsx scripts/validate-changesets.ts` | pass (exit 0) |
| changeset-status | `npx changeset status --since=origin/trunk` | pass (exit 0; `@automattic/skillsmith` bumped `minor`) |

## Accuracy spot-check

- **D1 (README) — system-prompt assembly order.** README:311 states the judge system prompt is `verbatim JUDGE.md brief; then # Testing task (TESTING-AGENT.md minus # Skills); then output instruction; then # Grading rubrics when paths.rubrics is set and holds files; then # Role instructions`. Verified against `src/pipeline/judge-agent.ts:219-233`: `sections = [ judgeBrief, "# Testing task\n"+task, outputInstruction ]`, then conditionally pushes `# Grading rubrics` (when `rubricBlob` non-empty) and `# Role instructions` (when role prompt set). The `# Testing task` heading (`:221`), the always-present task, the `# Grading rubrics` heading (`:226`), and the G2 lead-in (`RUBRIC_SELECTION_LEAD_IN`, `:167-171` — "Apply ONLY the rubric(s) this scenario's brief refers to; the others are provided for reference and must not affect the verdict") all match. `task = stripSkillsSection( scenario.testingBrief )` at `:78` confirms the `# Skills`-stripped claim.
- **D1 (README) — load-all + G1 header + optional/un-gated.** README:165 ("loads **every** top-level `<id>.md` rubric... each with any Markdown-linked companion files... labeled with a self-identifying `# Rubric: <id>` header") verified against `src/scenarios/rubric-loader.ts:86-128`: enumerates top-level `*.md`, sorts ascending, `loadRubric` per file (md-link companion expansion), G1 `# Rubric: ${id}` wrapper (`:122`), `undefined` on missing/empty root (`:87,:94,:125`). README:167 ("no start-up existence gate"; "Skillsmith does not validate rubric references... does not cause the scenario to error") verified against `src/pipeline/pipeline.ts` `checkPaths` (gates only `['skills','scenarios']`, no `rubrics`) and `src/config/defaults.ts` (`DEFAULT_PATHS` has no `rubrics` entry — no default). The old "reported with a clear error and runs no agents" behavior is fully removed from the rubric sections.
- **D1 (README) — example JUDGE.md snippet runs true.** The README:157-163 example ("Also grade the produced code against the WordPress Interactivity API best-practices rubric.") is byte-faithful to the shipped `testing-project/eval/scenarios/counter/JUDGE.md` and `minimal-scaffold/JUDGE.md` prose rubric references — an accurate, working example under the shipped opaque-prose model.
- **D2 (examples config).** The `paths.rubrics` comment (`examples/skillsmith.config.ts:187-198`) now describes opting in "by naming the rubric in plain-language prose," automatic supply to the judge, "no `# Rubrics` id list and no reserved grammar," and "no default and no existence gate" — matching `Paths.rubrics?` (`src/config/types.ts:154`, optional) and `checkPaths` (no rubrics gate). The removed "clear per-scenario error" / id-to-file resolution language is gone.
- **D3 (testing-project config).** The comment (`testing-project/skillsmith.config.ts:74-76`) now reads "A scenario opts in by naming the rubric in plain-language prose in its JUDGE.md; Skillsmith supplies the rubric content to the judge automatically from this directory" — no "by id." The `paths.rubrics: './eval/rubrics'` value (`:78`) is unchanged, as required.

## Issues

None.
