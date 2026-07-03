# Docs Summary — review-2: natural-language rubrics and an auto-supplied task

## What

The docs phase brought the user-facing documentation in sync with the shipped review-2 model, across three surfaces:

- **`README.md`** — the breaking-change callout, "The judge brief" section, the entire "Reusable rubrics" section (heading/anchor retained, body rewritten), the Configuration prose (`paths.rubrics` and judge system-prompt composition), and the "Migrating from the old model" bullets. It now describes: `JUDGE.md` as fully opaque prose with no required or reserved sections; rubric selection by naming the rubric in plain-language prose (no `# Rubrics` id list, no reserved grammar); load-all-from-`paths.rubrics` delivery with per-rubric `# Rubric: <id>` labeling and a selection lead-in; `paths.rubrics` optional with no default and no existence gate; no enumeration-time validation (a mistyped/unmatched rubric reference is not reported and does not error the scenario); and the auto-supplied, skill-agnostic testing task (the `TESTING-AGENT.md` content minus its `# Skills` section, under a `# Testing task` heading). The `{ pass, notes }` verdict, reporting, and self-improvement loop are stated as unchanged.
- **`examples/skillsmith.config.ts`** — the `paths.rubrics` comment block, rewritten from the `# Rubrics` id-list opt-in (with its "clear per-scenario error" for an unmatched id) to the plain-language-prose model with automatic rubric supply, no reserved grammar, and no existence gate. The key stays documented as optional.
- **`testing-project/skillsmith.config.ts`** — the one-line comment above the `paths` block, reworded from "a scenario's JUDGE.md can reference by id" to a prose reference with rubric content supplied automatically. The `paths.rubrics: './eval/rubrics'` value is unchanged.

## Why

The branch's shipped code (review-2) removed the review-1 "reusable rubrics by id" machinery in favor of opaque `JUDGE.md` prose, load-all rubric delivery, and an auto-supplied skill-agnostic task. The prior docs described the removed id model; left unfixed they would contradict the shipped behavior for scenario authors and project maintainers (design doc Risk R6). Task 3 in particular was load-bearing because the code phase deliberately leaves `testing-project/skillsmith.config.ts` otherwise untouched, so its stale "by id" comment could only be corrected in the docs phase.

## How

Three docs-writer tasks, one per file, each committed separately (`350bcd6`, `a97da8d`, `019901a`), all consistent with each other in wording. The README anchor `#reusable-rubrics` and its heading were retained so all inbound cross-links (from the breaking-change callout, the judge-brief section, the configuration section, and the migration bullets) continue to resolve. Verification against the shipped code confirmed the assembly order and heading strings (`# Testing task`, `# Grading rubrics`, `# Rubric: <id>`, the G2 lead-in) in `src/pipeline/judge-agent.ts`, the load-all/G1 behavior and `undefined`-on-empty in `src/scenarios/rubric-loader.ts`, the `# Skills`-strip in `src/scenarios/enumerate.ts`, and the un-gated optional `paths.rubrics` in `src/config/types.ts`, `src/config/defaults.ts`, and `checkPaths` in `src/pipeline/pipeline.ts`. Both docs gates (`npx tsx scripts/validate-changesets.ts`, `npx changeset status --since=origin/trunk`) run green.

## Key decisions

- The README's example `JUDGE.md` snippet uses the same prose rubric reference sentence ("Also grade the produced code against the WordPress Interactivity API best-practices rubric.") that the shipped `testing-project` scenario briefs use, so the documented example is a real, working example rather than an illustrative approximation.
- The "Reusable rubrics" heading and its `#reusable-rubrics` anchor were kept rather than renamed, avoiding breakage of the multiple inbound in-page links while the section body was rewritten end-to-end.

## Known limitations

- The docs correctly document that a mistyped or unmatched rubric name in `JUDGE.md` prose is silently unreported and does not error the scenario (accepted trade per spec req 5). This is a shipped-behavior caveat surfaced to authors, not a docs defect.
