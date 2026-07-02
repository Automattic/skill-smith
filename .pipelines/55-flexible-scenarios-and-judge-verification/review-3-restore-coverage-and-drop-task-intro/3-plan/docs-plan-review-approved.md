# Docs Plan Review

## Verdict: approved

## Summary

The plan is complete, drift-resistant, and honest, and every load-bearing claim in it verified true against the current branch, `origin/trunk`, the approved design doc (`a8b8a66`), and the approved code plan (`409ef10`). The review independently reproduced the surface sweep and confirmed the plan's central claim: exactly two documentation surfaces model the superseded brief style, and both have a task. All negative claims in the `## Surfaces surveyed` table hold — both on the current branch and against the post-code-phase state. The guardrail-scope rows are correct, both filled gate commands were executed as recorded and pass, the changeset reasoning is verified against the real gates and `.changeset/config.json`, spec R8 is respected (no coverage-mapping documentation is planned), and both tasks carry a concrete audience, real traceability, and acceptance criteria that derive from the shipped briefs rather than baking in wording phase 4 may change.

## Verification performed

**Guardrail scopes (executed).** Both docs-phase gates are fixed commands with no `{scope}` placeholder, matching the rows recorded in the plan. Run from the worktree root:

- `npx tsx scripts/validate-changesets.ts` — resolved and terminated, exit 0.
- `npx changeset status --since=origin/trunk` — resolved and terminated, exit 0 (reports `@automattic/skillsmith` pending a `minor` bump via the branch's existing changeset).

Every passed scoped gate has exactly one row; no row references an unpassed gate; no unfilled placeholders.

**Surface sweep (independently reproduced).** Repo-wide greps for the old opener ("Decide whether … the task it was given"), title-style rubric references ("… best-practices rubric"), old brief vocabulary (`## Environment`, `## Live checks`, `## Scenario requirements`, `$SKILLSMITH_PLUGIN_SLUG`, `liveChecks`), decision-rule language, and `JUDGE.md` mentions across README, docs/, examples/, CONTRIBUTING, CHANGELOG, AGENTS.md, .github, scripts/, assets/, testing-project (prompts, skills, `_candidates.yaml`, `package.json`, `skillsmith.config.ts`), and `src/` comments confirmed:

- `README.md:157–163` (fenced example in `### Reusable rubrics`) and `examples/skillsmith.config.ts:187–199` (`paths.rubrics` comment) are the only two stale doc surfaces — exactly the plan's Tasks 1 and 2, with the quoted fragments and line ranges matching the files exactly.
- All other README prose about the brief model (line 26 callout, `### The judge brief`, "You do not restate the task in `JUDGE.md`", `### Reusable rubrics` mechanics prose, `Migrating from the old model`, the Mermaid lifecycle diagram) describes unchanged mechanics and stays accurate after phase 4.
- `testing-project/eval/prompts/{judge,testing-agent,improver}.md` verified: environment manual / scaffold instructions / generic brief mention only — all stay accurate once the briefs change (the new briefs reference the WP-CLI bridge affordance the manual documents; the manual does not describe brief shape).
- `src/__tests__/testing-project-scenarios.test.ts` header comment and `RUBRIC_PROSE_REFERENCE` are owned by code-plan Tasks 1 and 13 (verified in the code plan's Changes text) — correctly excluded from docs work. `src/__tests__/testing-project-e2e-removal.test.ts:15` ("referenced by id from each scenario") is consistent with the post-phase-4 briefs.
- `testing-project/eval/scenarios/_candidates.yaml` header delegates brief shape to "the converted scenarios alongside this file" — stays accurate.
- Core comments (`judge-agent.ts`, `rubric-loader.ts`, `enumerate.ts`, `config/types.ts`) describe unchanged mechanics.
- Surfaces the table does not list were also checked and are clean: `testing-project/skillsmith.config.ts` comments (generic "naming the rubric in plain-language prose" — still true under id naming), `src/__tests__/fixtures/**` briefs (trivial one-line mechanism-test inputs, not convention models), `.github/`, root `package.json`, `docs/styles.css`, skill content.

**Changeset posture (verified).** `.changeset/flexible-scenarios-judge-verification.md` exists on the branch, its content describes only mechanics this revision does not change (opaque `JUDGE.md`, prose rubric naming, auto-supplied task, `{ pass, notes }`), and it satisfies `changeset status` today. `README.md` and `examples/**` are in `changedFilePatterns`, so the planned edits fire the gate — and are covered by that existing entry; no new changeset is needed, consistent with CONTRIBUTING (comment-only reference-config edit exercising no new public API; PR already carries a real changeset).

**Plan quality.** Task blocks are complete (Goal / Audience / Files / Sections-scope / Depends on / Traces to / Acceptance). Traceability is real: design Decision 6 and its Risks entry explicitly hand the README divergence to this phase; Decision 3 defines the conventions the example must reflect; spec R2/AC3 and R5/AC4 are the correct requirement anchors; code-plan Tasks 2–12 produce the briefs the examples mirror. Acceptance criteria are reader-outcome framed and drift-resistant — the writer is directed to derive conventions from the shipped briefs, the only verbatim quotes are of the current (to-be-replaced) text, and the verdict-rule paraphrase is bracketed by "consistent in intent with the fixed opener of the shipped briefs". Task 2 is comment-only with an explicit behavioral-inertness acceptance (`npm run typecheck` / `npm run lint` unchanged), so no code is planned. Per spec R8, no coverage-mapping documentation is planned anywhere. Granularity, audience, ordering (both tasks independent, gated after phase 4 by the plan preamble), and feasibility (all referenced files and sections exist) all check out.

## Notes (non-blocking)

- The `## Surfaces surveyed` table could have recorded `testing-project/skillsmith.config.ts` and the `src/__tests__/fixtures/**` briefs as additional verified-accurate/no-task rows for completeness; both were independently checked here and nothing in them drifts out of sync after phase 4, so no task is missing.
- Task 1's fourth acceptance bullet ("copies the example's shape") is read in context of the Goal's precise two-convention statement (task-free all-must-pass opener; rubric selection by id); the docs-writer should model those conventions without necessarily inflating the README's short illustrative example into a full template.
