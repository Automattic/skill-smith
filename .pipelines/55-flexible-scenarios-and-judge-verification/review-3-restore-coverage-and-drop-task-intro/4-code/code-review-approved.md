# Code Review

## Verdict: approved

## Batch scope

Tasks reviewed (code-plan.md, tasks 1–13, one commit each):

- Task 1: Trim the conformance test to transition-safe invariants (`ce29231`)
- Task 2: Rewrite counter/JUDGE.md to the template (worked example) (`ff8bbca`)
- Task 3: Rewrite async-fetch/JUDGE.md to the template (`44cdf00`)
- Task 4: Rewrite config-fetch/JUDGE.md to the template (`0f3a1fa`)
- Task 5: Rewrite derived-double/JUDGE.md to the template (`a6a95c0`)
- Task 6: Rewrite focus-trap-menu/JUDGE.md to the template (`cb34588`)
- Task 7: Rewrite fruit-list-each/JUDGE.md to the template (`ac0a87f`)
- Task 8: Rewrite independent-counters/JUDGE.md to the template (`bb78359`)
- Task 9: Rewrite minimal-scaffold/JUDGE.md to the template (`47b1fdb`)
- Task 10: Rewrite paginated-list/JUDGE.md to the template (`883b967`)
- Task 11: Rewrite shared-state/JUDGE.md to the template (`cffbb7e`)
- Task 12: Rewrite toggle-visibility/JUDGE.md to the template (`aed9cca`)
- Task 13: Finalize the conformance test to the template contract (`bd72be0`)

Review scope: `fdec900..HEAD`; code surface `git diff --name-only <parent-of-ce29231>..HEAD -- . ':(exclude).pipelines'`.

## Summary

The batch delivers exactly what the plan promised: the 11 `JUDGE.md` briefs rewritten to the fixed two-section template carrying trunk's full judging coverage, plus the conformance test realigned in the Task 1 → Tasks 2–12 → Task 13 sandwich. Per spec R8 I acted as the control for coverage parity and verified it against `origin/trunk` directly (never from the plan's summaries, per R10): a byte-exact programmatic comparison found all 63 trunk `acceptance:` bullets present verbatim, in trunk order, with the only deviations being the permitted YAML unescaping and the single permitted derived-double edit; a per-scenario reading of all 11 trunk `e2e.spec.mjs` files confirmed every observable assertion is covered by a behavior bullet, the three environment-delta setup bullets and the two mandated conditional-fallback bullets are present exactly as planned, and no bullet asserts behavior trunk did not cover. R4 overlaps appear in both modes (e.g. counter's initial 5, paginated-list's router region and accessibility-tree absence). The diff surface is exactly the 12 planned files, no changeset was added, the suite was green at the transitional and a mid-batch commit, the seven final conformance invariants were each mutation-verified to fail the suite when broken, and all five guardrails pass fresh at HEAD. No task restatement, no scope creep, no design deviation found.

## Checks

| Check | Command | Result |
| ----- | ------- | ------ |
| typecheck | `npm run typecheck` | pass |
| lint | `npm run lint` | pass |
| tests | `npm test` | pass (379 pass, 0 fail, 2 skipped) |
| config-smoke | `npm --prefix testing-project run check:config` | pass |
| changeset-format | `npx tsx scripts/validate-changesets.ts` | pass |

## Behavior verification

All eight manual flows from the plan's E2E test plan were re-driven, plus prompt-assembly and mutation evidence:

- **Flow 1 (code-check parity, AC1/R1/R10):** wrote a comparison script that extracts every `acceptance:` bullet from `git show origin/trunk:.../scenario.yaml` (with YAML unescaping: double-quoted scalars' quotes dropped and `\"` → `"`; single-quoted scalars' quotes dropped) and diffs it byte-for-byte against the brief's `## Code checks` bullets. Result: 63/63 bullets, counts matching the plan exactly (async-fetch 5, config-fetch 8, counter 4, derived-double 5, focus-trap-menu 9, fruit-list-each 6, independent-counters 5, minimal-scaffold 3, paginated-list 7, shared-state 6, toggle-visibility 5); 62 byte-exact after unescaping, and the single diff is precisely the permitted edit — derived-double bullet 1 dropping "from the Interactivity API skill", the parenthetical becoming `(this is the static-derived-state pattern)`. No bullet added, dropped, or merged. Unescaping observed exactly where trunk quotes scalars: config-fetch 1–2, paginated-list 6–7 (incl. `\"` → `"`), minimal-scaffold 2, toggle-visibility 5.
- **Flow 2 (behavior-check parity, AC2/R3/R4):** read all 11 trunk `e2e.spec.mjs` files fresh and mapped every observable assertion to a brief bullet: counter 5/6/4 sequence; async-fetch pre-click absence + exactly-one-request-to-stub-URL + the rendered-joke conditional fallback (normative wording, names the covering code checks, not optional); config-fetch WP-CLI title-lookup setup + request URL + title render + the nonce-header bullet with its fallback to the `view.js` nonce-wiring code check; derived-double 1/2 → 2/4 → 3/6 → 5/10 with the double invariant; focus-trap-menu initial state, open, Escape-close with focus return, and both wrap directions; fruit-list-each 3 → 4 → 5 items with Mango positions; independent-counters embed-twice setup + 0/0 → 2/0 → 2/1 with untouched-instance assertions; minimal-scaffold Hello text + console `iapi-ready` after hydration + non-empty `data-wp-interactive` (no once-ness live claim, per plan); paginated-list 5-extra-posts setup + newest-3/oldest-absent in the router region + "Previous" absent from the accessibility tree + window-marker plant + Next-click in-place swap with `?pg=2` and surviving marker; shared-state embed-twice setup + 0/0 + 1 → 2 → 3 lockstep alternating buttons; toggle-visibility hidden/false → visible/true → hidden/false. Harness mechanics (activation, host-post creation, goto plumbing, teardown, poll timeouts, locator scoping) correctly excluded everywhere. Exactly two briefs carry a conditional ("fall back" grep hits only async-fetch and config-fetch); the three env-delta setup bullets are present (config-fetch's fourth `Setup:` bullet is the plan-mandated title lookup, not an env delta).
- **Flow 3 (rubric, AC3/R2):** `grep -L 'wp-interactivity-api-best-practices'` and `grep -l 'viewScriptModule'` over the 11 briefs both output nothing.
- **Flow 4 (no task restatement, AC4/R5):** read all 11 briefs end to end; each opens with the exact fixed opener; greps for "You are grading", positional task references, activation prose, URLs, and any `$SKILLSMITH` env var all clean. A structural script verified each file consists of exactly the opener, the two headings with their exact lead-ins, bullets, and the exact rubric sentence closing `## Code checks` — nothing else, opener and fixed strings byte-exact and unwrapped.
- **Flow 5 (auto-supply, AC5/R6):** `npm test` green; revision diff (`:(exclude).pipelines`) lists exactly 12 files — the 11 briefs plus `src/__tests__/testing-project-scenarios.test.ts`; nothing under `src/pipeline/`, `src/scenarios/`, `src/config/`. Additionally assembled the real judge system prompt for `counter` via `enumerateScenarios` + `stripSkillsSection` + `loadAllRubrics` + `buildJudgeSystemPrompt`: the prompt opens with the new brief verbatim, injects the skill-stripped trunk task under `# Testing task` after the brief, injects the rubric blob under `# Rubric: wp-interactivity-api-best-practices` matching the brief's bare-id activation key, and leaks no skill name.
- **Flow 6 (workspace decision, AC6/R7):** design doc Decision 2 records the not-adopted rationale and recommended future shape; `testing-project/skillsmith.config.ts`, `eval/prompts/judge.md`, and `eval/prompts/testing-agent.md` are absent from the revision diff (byte-identical).
- **Flow 7 (no coverage artifact, AC7/R8):** `grep -rn liveChecks src/` empty; `ANCHORS` carries only the 11 `prompt` fragments; `git diff --diff-filter=A` shows zero new files outside `.pipelines`.
- **Flow 8 (guardrails, AC8/R9):** all five gates run fresh at HEAD by this reviewer — see Checks table.
- **Sandwich greenness:** full suite run in a temp worktree at `ce29231` (transitional test vs old briefs) and at mid-batch `cb34588` — both 379 pass / 0 fail.
- **Task 13 invariant liveness:** mutation-tested all seven invariants against the counter brief (rename either heading, remove the rubric id, inline the sentinel, pre-state `{ "pass"`, name a dead env var, reword the opener fragment, add `# Rubrics`) — every mutation failed the suite; restoration passed; working tree left clean.
- **Task-level extras:** counter brief is byte-exact against the plan's Task 2 target (diff empty); Task 4's one-time warm-env verification is recorded in `0f3a1fa`'s commit message (`node testing-project/eval/utils/judge-wp.mjs post get 1 --field=post_title` → `Hello world!`); each of the 13 commits touches exactly its task's single file; commit subjects follow the host format; no `.changeset/*` added in the range.
