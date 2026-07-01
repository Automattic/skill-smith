# Code Summary — review-2: natural-language rubrics and an auto-supplied task

## What

The review-2 code phase reshaped the enumeration/judge boundary of Skillsmith so a scenario's `JUDGE.md` is leaner to author and free of duplication, and converted the bundled `testing-project` to the new shape. Concretely, spanning base ref `3b7b872` → HEAD `4d84698` (T1–T8; T6 was a verification checkpoint with no commit):

- `src/scenarios/enumerate.ts` — added exported `stripSkillsSection( testingBrief )`; removed the review-1 `# Rubrics` machinery (`parseRubricsSection`, `RUBRICS_HEADING_RE`, the enumeration-time id validation, the `rubricsRoot` plumbing, and the `Scenario.rubrics` writes). Enumeration now reads `JUDGE.md` verbatim into `judgeBrief` and parses nothing structured from it; `# Skills` parsing and skill existence-validation are unchanged.
- `src/scenarios/rubric-loader.ts` — added exported `loadAllRubrics( rubricsRoot )` (enumerate top-level `*.md`, sort ascending, `loadRubric` each for md-link expansion, dedupe by resolved path, wrap each under a G1 `# Rubric: <id>` header, `undefined` on missing/empty root, skip an unreadable file rather than throw). `loadRubric` is repurposed as the per-file primitive, no longer orphaned.
- `src/pipeline/judge-agent.ts` — removed `resolveRubricBlob`; `runJudgeAgent` now computes `loadAllRubrics(...)` (when `paths.rubrics` is set) and `stripSkillsSection( scenario.testingBrief )`, and `buildJudgeSystemPrompt( scenario, config, task, rubricBlob? )` assembles `[ judgeBrief, # Testing task, output+recursion, # Grading rubrics?, # Role instructions? ]`. The `# Grading rubrics` body is a G2 selection lead-in followed by the G1-wrapped blob. `buildUserMessage`, `parseJudgeJson`, and the `{ pass, notes }` contract are untouched.
- `src/config/types.ts` — removed `Scenario.rubrics?` and its JSDoc; `Paths.rubrics?` kept optional, no default, no existence gate.
- `testing-project/eval/scenarios/*/JUDGE.md` (all 11) — converted to the opaque shape: dropped the `# Rubrics` id-list and the `## Scenario requirements` block; added a plain-prose rubric reference; re-homed scenario-specific mechanism checks under `## What to check` where such residue exists (9 of 11; absent from `counter` and `async-fetch`); kept `## Environment` and `## Live checks`. The rubric file `eval/rubrics/wp-interactivity-api-best-practices.md` is byte-for-byte unchanged and `paths.rubrics: './eval/rubrics'` is still configured.
- `.changeset/flexible-scenarios-judge-verification.md` — amended to describe the final natural-language-rubric + auto-supplied-skill-agnostic-task model (single `@automattic/skillsmith` `minor`, `BREAKING:`-prefixed).
- Tests — new `strip-skills-section.test.ts`; new rubric fixtures (`rubrics-multi`, `rubrics-dedupe`, `rubrics-empty`); extended `rubric-loader.test.ts` (`loadAllRubrics`) and `judge-agent.test.ts` (task injection + load-all, at builder and `runJudgeAgent` level); rewrote `enumerate-rubrics.test.ts` to the opaque model (AC1/AC4); deleted `rubrics-section.test.ts`; updated `core-types.test.ts` (`Scenario.rubrics` guard), `testing-project-scenarios.test.ts` (opaque-shape conformance), and `feature-changeset.test.ts` (final-model assertions).

## Why

Review-1 reintroduced two frictions the two-file scenario model was meant to avoid: a required, id-matched `# Rubrics` section inside `JUDGE.md`, and `JUDGE.md` files that repeated the testing task in a `## Scenario requirements` block. This phase removes both — rubrics are referenced in natural-language prose and the task is auto-supplied to the judge — so authoring a scenario's `JUDGE.md` is leaner and non-duplicative, while the judge stays skill-agnostic and the live `{ pass, notes }` behavioral judge, reporting, and self-improvement loop are preserved.

## How

Realized as three cohesive, mostly-independent changes at the enumeration/judge boundary plus a content conversion, ordered so every commit keeps the gates green: the two additive primitives landed first with their own tests (T1 `stripSkillsSection`, T2 `loadAllRubrics`), then the judge was rewired to consume them with its tests rewritten in the same commit (T3), then the now-orphaned enumeration/type machinery was deleted with its tests reconciled in the same commits (T4–T5), then the 11 `JUDGE.md` files were converted with the static-file conformance test updated assertion-first (T7), and the changeset was amended last (T8). All tasks were TDD; no full scenario suite or self-improvement-loop run was performed. Rubric delivery uses the load-all-from-path mechanism with two prompt guardrails (G1 self-identifying `# Rubric: <id>` headers; G2 "apply only the rubric(s) the brief names" lead-in) so the opaque prose selects which rubric applies without any parsed selector.

## Key decisions

- **Load-all-from-path over per-scenario selection.** Skillsmith injects every rubric from `paths.rubrics` and lets the `JUDGE.md` prose pick, rather than re-introducing a parsed selector or brittle NL-to-filename matching. G1/G2 guardrails plus sorted/deterministic assembly keep it reliable; at today's N=1 it is trivially reliable, and it scales by dropping files into the path with zero authoring ceremony.
- **Task auto-supplied via the system prompt, minus the whole `# Skills` section.** The task is grading context, so it goes in the system prompt (keeping `buildUserMessage` a pure file-inliner and the "what the judge reads == what it verifies" invariant). The entire `# Skills` section is stripped — not just its list items — so no skill identity leaks via surrounding prose.
- **Changeset amended, not added.** One coherent `minor` release note describes the final model instead of a rubric-by-id note followed by a reversal. (Rejected alternative: a second `minor` changeset.)
- **Conversion preserves unique judge signal.** `## Scenario requirements` was not wholesale-deleted; category-(b) mechanism checks were re-homed under `## What to check` (9 of 11 scenarios), honoring AC8's intent rather than only its letter.

## Known limitations

- A mistyped rubric name in `JUDGE.md` prose is not detected — the reference is ordinary prose and Skillsmith performs no enumeration-time validation (accepted trade per spec req 5 / Out of Scope).
- The deterministic gates prove the judge prompt is *assembled* correctly (rubric present, task present, `# Skills` absent); whether the judge behaviorally *acts* on the named rubric ("reliably grades", req 3) is a first-class quality bar verified manually/owner-run, not by the pipeline.
