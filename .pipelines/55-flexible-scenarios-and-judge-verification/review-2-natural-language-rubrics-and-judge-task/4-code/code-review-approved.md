# Code Review

## Verdict: approved

## Batch scope

Tasks reviewed (T1–T8, `code-plan.md`):

- Task 1: Add `stripSkillsSection` to `enumerate.ts`
- Task 2: Add `loadAllRubrics` to `rubric-loader.ts`
- Task 3: Rewire the judge to auto-supply the task and load all rubrics
- Task 4: Remove the `# Rubrics` machinery from enumeration
- Task 5: Remove `Scenario.rubrics` from the config types
- Task 6: Confirm `rubric-loader.ts` / `loadRubric` is retained and integrated (no-op verification checkpoint — no commit expected)
- Task 7: Convert the 11 `testing-project` `JUDGE.md` files to the new shape
- Task 8: Amend the existing changeset to the final model

Base ref `3b7b872` → HEAD `4d84698`. Code surface: `src/**`, `testing-project/**`, `.changeset/**`.

## Summary

The batch fully and faithfully implements the approved design and plan. `JUDGE.md` is now fully opaque: `parseRubricsSection`, `RUBRICS_HEADING_RE`, `resolveRubricBlob`, and `Scenario.rubrics` are gone with no dangling references in production. Rubric delivery is the load-all-from-path mechanism (`loadAllRubrics`) with G1 self-identifying `# Rubric: <id>` headers and a G2 selection lead-in prepended by `buildJudgeSystemPrompt`; it is sorted, deduped by resolved path, md-link-expanding, and returns `undefined`/no section on an unset or empty path with no error. The judge auto-supplies the skill-stripped testing task under `# Testing task` placed immediately after the judgeBrief and before the output instruction, unconditionally, via `stripSkillsSection`. The `{ pass, notes }` verdict, `buildUserMessage`, `parseJudgeJson`, `classifyVerdict`, and the self-improvement loop are untouched — this is not a revert to trunk's grader. All 11 `testing-project` `JUDGE.md` files are converted to the opaque shape (no `## Scenario requirements`, no `# Rubrics`; prose rubric reference; `## What to check` only where category-(b) residue exists — 9 of 11, absent from `counter` and `async-fetch`; `## Environment`/`## Live checks` retained), the rubric file is byte-for-byte unchanged, and `paths.rubrics: './eval/rubrics'` is still configured. Exactly one `@automattic/skillsmith` `minor` changeset describes the final model. Test coverage is comprehensive and traces to per-task Acceptance and spec AC 1–9. All five guardrail gates run and pass, and live behavior verification against the real `testing-project` scenario + rubric confirms the assembled judge prompt has the exact intended shape.

## Checks

| Check | Command | Result |
| ----- | ------- | ------ |
| typecheck | `npm run typecheck` | pass |
| lint | `npm run lint` | pass |
| tests | `npm test` | pass (381 tests: 379 pass, 0 fail, 2 pre-existing env-gated codex-provider SKIPs) |
| config-smoke | `npm --prefix testing-project run check:config` | pass |
| changeset-format | `npx tsx scripts/validate-changesets.ts` | pass |

## Behavior verification

This is a deterministic, non-UI change; the user/downstream-observable surface is the assembled judge system prompt and enumeration output. Verification re-drove the code plan's E2E flows and, additionally, live-assembled the judge prompt from the real `testing-project` `counter` scenario and the real rubric file using the production functions (`enumerateScenarios`, `stripSkillsSection`, `loadAllRubrics`, `buildJudgeSystemPrompt`).

Re-driven flows (targeted test runs, all green):

- Flow 1 — Opaque `JUDGE.md`, enumeration parses nothing (AC1, AC4): `enumerate-rubrics.test.ts` 5/5 pass — prose-only enumerates clean and verbatim; prose naming a nonexistent rubric does not error; a literal `# Rubrics` heading is now opaque prose (no validation); no rubric validation whether the rubrics root is set or unset; skill validation still fires.
- Flow 2/3 — Rubric load-all + optionality (AC2, AC3): `rubric-loader.test.ts` 12/12 pass — sorted, G1-headed, md-link companion expansion, dedupe by resolved path, `undefined` on missing/empty dir, unreadable file skipped without throwing, no G2 leaked from the loader.
- Flow 2/3/4/5 — Prompt assembly + auto-supplied skill-agnostic task + verdict pipeline (AC2, AC3, AC5, AC6, AC7): `judge-agent.test.ts` 30/30 pass — task after judgeBrief and before output; unconditional; `# Skills` stripped at runtime; load-all under `# Grading rubrics` with G2 before G1 bodies; omitted on unset/empty path; user message carries only produced files (no task text); `{ pass, notes }` parse/return unchanged.
- Flow 4/6 — `stripSkillsSection` (AC6): `strip-skills-section.test.ts` 8/8 pass — section between/last/prose/absent/`\r\n`/deeper-heading/first-heading-only all covered, no skill-identifying text leaks.
- Flow 6 — `testing-project` conversion conformance (AC8): `testing-project-scenarios.test.ts` 6/6 pass — no `# Rubrics`, no `## Scenario requirements`, prose rubric reference present, `## Environment`/`## Live checks` present, rubric not inlined, removed env vars absent / plugin slug retained, no JSON-output instruction.

Live end-to-end assembly evidence (real `testing-project/counter` + real rubric), all 12 assertions PASS:

- 11 scenarios enumerate with `error: undefined`.
- judgeBrief prose present verbatim (incl. the natural-language rubric reference sentence).
- `# Testing task` present, placed after judgeBrief and before `# Output format`, holding the real `TESTING-AGENT.md` task.
- No `# Skills` in the prompt, though the source `testingBrief` did contain a `# Skills` section — the strip worked end-to-end.
- `# Grading rubrics` present with the G2 "Apply ONLY …" lead-in, then the G1 `# Rubric: wp-interactivity-api-best-practices` header, then the rubric's own H1/body verbatim, in that order (G2 before the rubric body).
- `{ pass, notes }` output instruction present and unchanged.

Full-suite behavioral judge runs / self-improvement-loop runs were not exercised, consistent with spec req 12 (owner-run) and the plan's testing posture.
