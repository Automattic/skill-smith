# Code Plan Review

## Verdict: approved

## Summary

This revised (iteration-2) plan resolves both iteration-1 findings substantively and survives a fresh adversarial pass. Coverage is complete: all 16 spec requirements and all 11 acceptance criteria map to at least one task, the full removal inventory (`Paths.rubrics`, `DEFAULT_PATHS.rubrics`, the `checkPaths` loop entry, `nameSource`, `validateConfiguredScenarioNamesAreUnique`, `scenario.yaml`/`e2e.spec.mjs`/rubric/prompt inputs, the `Scenario` fields) is covered, and the pre-1.0 breaking change is recorded as a `minor` + `BREAKING:` changeset (Task 19). Every task is `tdd` with no automated e2e and no self-improvement-loop run, honoring the spec's testing posture (req. 16); the `E2E test plan` is correctly recorded as manual-only with no automated flows. I re-verified every file path, symbol, and signature the plan touches against `src/` and `testing-project/` (enumerate, config types/defaults/normalize/validate, selection, claude-code, codex, mock, verdict, judge-agent, testing-agent, agent-loop, index, the testing-project config, verify-e2e, the 11 scenarios, the shared rubric); they all match, and the SDK levers (claude `disallowedTools`/`mcpServers`, codex `sandboxMode`/`networkAccessEnabled`/`CodexOptions.config`) are real and feasible. The dependency graph is acyclic and ordering respects real prerequisites, including the subtle Task 11 → Task 13 `judgeWorkspace` signature hand-off. The `Guardrail scopes` table renders a single `None | None` row, which is the correct rendering because no scoped gate was passed to this run, and all five fixed gates resolve and terminate at exit 0 (`typecheck`, `lint` on the pinned Biome 2.5.0, `test` 162 pass / 0 fail / 2 skipped, `check:config`, `validate-changesets`).

## Iteration-1 findings — verified resolved

1. **Run-wide judge mutex in `pipeline.ts` (was Issue 1).** Task 11 now lists `src/pipeline/pipeline.ts` in "Files to change" and pins the load-bearing wiring: the shared async mutex is constructed **exactly once per iteration, above the scenario-level `Promise.all`** (~line 384), threaded through `ScenarioRunArgs → RunAgentsParams → RunAgentPairParams`, and every pair acquires that same instance. It explicitly forbids constructing the lock inside `runAgents`/`runScenario`/`runAgentPair` (which would yield a per-scenario/per-pair lock and silently fail to stop the cross-scenario `wp-env start` race). Acceptance bullets re-state the once-per-iteration construction and cross-scenario non-overlap. Verified against the code: the scenario `Promise.all` is at `pipeline.ts:384`, the `runScenario` params object at lines 386–397, and the `runAgents` call at line 511 — exactly as the task describes.

2. **Judge user-message inlining kept (was Issue 2).** Task 13 now states the per-file inlining loop is "required, not optional," reads the files from the judge-copy workspace, and explains that omitting it would break the mock `GATE_PASS`/`GATE_FAIL` seam and the `npm test` gate; Task 14 reaffirms the gate seam (`params.prompt.includes('GATE_PASS'|'GATE_FAIL')`) stays. Verified: `src/providers/mock.ts` `invokeJudge` gates on the prompt content (lines 107–110), the gated testing agent writes the token into `result.txt`, and `src/__tests__/self-improvement-loop.test.ts` is the dependent deterministic test.

3. **Task 15 duplicate-name test deletion made explicit (was the iteration-1 Note).** Task 15 now says "**delete** (do not merely de-reference)" the `'API run rejects duplicate configured names before hooks and agents'` test (cited ~lines 303–318) and the `assert.doesNotMatch( result.stderr, /Duplicate scenario\.name/ )` assertion, and rewrites the `writeScenario(id, name)` helper to drop the `name` parameter and materialize the two-file model. Verified: those exact lines exist in `src/__tests__/scenario-selection.test.ts` (duplicate test at 303–318, the `doesNotMatch` assertion at 295, `writeScenario(id, name)` at 96).

## Fresh adversarial pass — no substantive problems

- **Coverage of acceptance criteria & design decisions:** every spec acceptance criterion (1–11) and requirement (1–16) maps to a task; every key design decision (name===id, both-briefs discovery, hand-rolled `# Skills` parser, project-configurable capabilities, copied-workspace no-modify guarantee, whole-bracket serial knob, `{pass,notes}` classifier fix, removals, role-prompt + inlined rubric, testing-project env hooks) is executed.
- **Per-task acceptance:** observable and testable (e.g. Task 11's mutex-threading and cross-scenario non-overlap; Task 3's parser cases; Task 12's classifier cases). They describe what must be true, not which unit test to write.
- **Ordering/feasibility:** acyclic dependency graph; the Task 11 → Task 13 `judgeWorkspace` hand-off is internally consistent (Task 11 makes the `RunJudgeAgentParams` signature accept and pass the copy path; Task 13 wires it into `invoke({ cwd })` plus capabilities), keeping `typecheck` green at each step. `validate.ts`'s `validateSingleRole` already ignores unknown keys, so Task 11's "permissive `concurrency`" holds today.
- **No unit-test prescription, no docs tasks, no scope creep:** Task 15 specifies fixture/test *migration* mechanics (legitimate, since the model change forces fixture changes) without prescribing which new unit tests a feature task writes; docs (README/`docs/index.html`) are correctly excluded from the code plan and deferred to the docs phase; no task adds functionality beyond the spec/design.
- **Old-model removal (acceptance #10):** the only remaining `e2e.spec.mjs` references (`testing-project/playwright.config.ts`, `eval/utils/verify-e2e.ts`) are slated for deletion in Task 17; `_candidates.yaml`'s stale header is scrubbed in Task 16.

## Guardrail validation

`Guardrail scopes` renders `None | None`, the correct rendering when no scoped gate was passed. The five fixed gates were each run as they would run and all resolved and terminated:

- `npm run typecheck` — exit 0
- `npm run lint` — exit 0 (Biome 2.5.0, matching the `package.json`/`biome.json` pin; the iteration-1 stale-binary note no longer applies)
- `npm test` — exit 0 (162 pass, 0 fail, 2 skipped)
- `npm --prefix testing-project run check:config` — exit 0
- `npx tsx scripts/validate-changesets.ts` — exit 0
