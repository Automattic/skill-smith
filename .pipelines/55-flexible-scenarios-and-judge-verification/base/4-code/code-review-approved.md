# Code Review

## Verdict: approved

## Batch scope

Tasks reviewed (T1–T19 from the code plan):

- Task 1: Reshape core types for the two-file model and judge capabilities
- Task 2: Drop `rubrics` from path defaults and the path precondition
- Task 3: Add a `# Skills` parser
- Task 4: Rewrite scenario enumeration for the two-file model
- Task 5: Remove the duplicate-name guard
- Task 6: Feed the testing brief to the testing agent
- Task 7: Translate judge capabilities in the claude-code provider
- Task 8: Translate judge capabilities in the codex provider
- Task 9: Extract `snapshotWorkspace`/`diffSnapshots` into a shared module
- Task 10: Add a workspace-copy helper
- Task 11: Wire workspace isolation, diff-guard, and the judge-concurrency knob into the agent loop
- Task 12: Surface judge notes on FAIL in `classifyVerdict`
- Task 13: Rewrite the judge agent for the freeform brief, `{ pass, notes }` verdict, capabilities, and copy cwd
- Task 14: Update the mock provider verdict JSON to `{ pass, notes }`
- Task 15: Migrate core unit-test fixtures and tests to the two-file model
- Task 16: Convert the 11 `testing-project` scenarios to the two-file model
- Task 17: Remove the `testing-project` Playwright harness and rubrics
- Task 18: Rewrite `testing-project/skillsmith.config.ts` for the new judge + WP env hooks
- Task 19: Add the breaking-change changeset

## Summary

The batch executes the full clean-break refactor exactly as the spec, design doc, and code plan
prescribe. Scenarios are now discovered from `TESTING-AGENT.md` + `JUDGE.md` (both read verbatim,
only the `# Skills` section parsed); the judge runs live against an isolated `judge-workspace/` copy
with project-configured capabilities and returns `{ pass, notes }`; the run-wide judge mutex is
instantiated once per iteration above the scenario fan-out and threaded through
`ScenarioRunArgs → RunAgentsParams → RunAgentPairParams`, serializing the whole
`beforeJudgeAgent → judge → afterJudgeAgent` bracket while the testing phase stays parallel; the
diff-guard fails the pair if the canonical workspace is mutated. All obsolete machinery
(`scenario.yaml`, `e2e.spec.mjs`, `paths.rubrics`, `nameSource`, `validateConfiguredScenarioNamesAreUnique`,
linked rubrics, the Playwright harness) is removed from `src/`, `testing-project/`, and `examples/`.
The bundled `testing-project` is fully converted: 11 two-file scenarios, per-pair wp-env hooks built
from the judge copy, a serial Bash + Playwright-MCP judge, and the env-var fact convention. One
consolidated `BREAKING:` `minor` changeset records the break; the four unrelated changesets are
untouched. All five guardrail gates pass. Every per-task acceptance criterion and the spec's
requirements 1–16 / acceptance 1–11 are satisfied by the diff, and the load-bearing correctness
points were verified against the actual code (mutex instantiation point, no-modify guarantee,
both-provider capability translation, `# Skills` parser rules, `{ pass, notes }` + `classifyVerdict`
fix, the retained `GATE_PASS`/`GATE_FAIL` inlining seam, and the removal inventory).

## Checks

| Check | Command | Result |
| ----- | ------- | ------ |
| Typecheck | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass |
| Unit/integration tests | `npm test` | pass (313 pass, 0 fail, 2 pre-existing live-Codex skips) |
| testing-project config | `npm --prefix testing-project run check:config` | pass |
| Changeset validation | `npx tsx scripts/validate-changesets.ts` | pass |

## Behavior verification

The user-observable, deterministic behavior of the new model was exercised end-to-end against the
real `testing-project` (live judge behavior is manual/out of scope per spec req. 16):

- **Real enumeration of `testing-project/eval/scenarios`** (`enumerateScenarios` against the actual
  converted folders): all 11 scenarios discovered, each with `name === id`,
  `skills=[wp-interactivity-api]` parsed from `# Skills`, `error=none`, and both briefs read verbatim
  (testing briefs ~340–1330 chars, judge briefs ~5.5–7.5 KB carrying the inlined rubric + acceptance
  + live checks). Confirms acceptance 1, 4, 11 and the Task 4/16 contracts.

  ```
  discovered scenarios: 11
  - async-fetch: name=async-fetch skills=[wp-interactivity-api] error=none tBrief=572 jBrief=6256
  - counter: name=counter skills=[wp-interactivity-api] error=none tBrief=387 jBrief=5484
  - focus-trap-menu: name=focus-trap-menu skills=[wp-interactivity-api] error=none tBrief=1245 jBrief=7342
  ... (all 11, no errors)
  ```

- **Verdict flow** (`classifyVerdict` + `parseJudgeJson` against the shipped code):
  - `classifyVerdict({ pass: false, notes: 'button did not increment' })` →
    `{ kind: 'FAIL', failures: [ 'button did not increment' ] }` (notes surfaced, not the generic
    fallback) — Task 12 / acceptance 8, 9.
  - `classifyVerdict({ pass: false })` → `{ kind: 'FAIL', failures: [ 'verdict failed without detail' ] }`.
  - `classifyVerdict({ pass: true, notes: 'ok' })` → `{ kind: 'PASS' }`.
  - `parseJudgeJson('Here is my verdict: {"pass":false,"notes":"y"}')` → `{ pass: false, notes: 'y' }`
    (lenient fallback); strict `{"pass":true,"notes":"x"}` parses; `'no json here'` → `undefined` —
    Task 13 / R8.

## Issues

None.
