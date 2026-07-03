# Code Plan Review

## Verdict: rejected

## Summary

This is an unusually well-verified plan. I re-checked its load-bearing claims against the worktree and they hold: all five guardrail commands resolve and pass (379 tests green); the root tsconfig covers `src/**/*` + `examples/**/*` but not `testing-project/`, so the Task 7 atom boundary is exactly right; `defineConfig` is an identity passthrough and validation runs at `src/config/load.ts:29`, so `check:config` and the raw-object testing-project config tests genuinely stay green between Tasks 7 and 8 (`testing-project-judge-config.test.ts` loads the config via dynamic import of the resolved object, no validating loader); every reader of `paths.rubrics` / `roles.judge.prompt` / `judgePrompt` / `rubric-loader` in the repo is either inside the Task 7 atom, deleted by an earlier task (`feature-changeset.test.ts:162` in Task 1, `enumerate-rubrics.test.ts` in Task 5), or safely deferred to Task 8; all test-fixture configs build judge roles without `prompt`/`rubrics`; `src/index.ts` exports no rubric-loader symbol; the 11 briefs' opener line and rubric sentence are byte-identical (single md5) and the rubric sentence is the closing line of `## Code checks` in every brief; the conformance test's numbered invariants 1–7, tests 1–4, and test 6 match the plan's refit exactly; the `dirName` site inventory is complete (3 src files, the named test/fixture sites, README:105); the agent-loop bracket, `judgeStart` timing, `writeAgentReport`, and `{ skipped }` marker match Task 10's presence-rule mechanics; the mock provider reports `usage` and `TokenUsage.totalTokens` exists; the changeset plan is consistent with `.changeset/config.json`, the pre-1.0 policy, and the stale load-all prose in `flexible-scenarios-judge-verification.md`. Cleanup coverage against the design's adjudicated verdicts is complete, the three keep-with-reason items are preserved, dependencies are acyclic and honest, and the eight flows map 1:1 onto AC1–AC8. I reject on three issues, one of them material: Task 5's "verified" inventory of `enumerate-two-file.test.ts`'s distinct observables is factually wrong — it omits at least four live behavioral contracts, so a code-writer following the plan drops real coverage (or two code-writers diverge). Two smaller issues: prescriptive new-unit-test lists in Tasks 6/7/10, and an over-broad Task 1 acceptance grep.

## Issues

### Issue 1: Task 5's "distinct observable" inventory for the enumeration-test merge is incomplete — live coverage would be silently dropped

**What's wrong:** Task 5 instructs: "keep each distinct observable exactly once: both-briefs discovery, brief-only directory layout, nested slash-joined ids, walk-through of non-scenario folders, missing-`JUDGE.md` error" and marks the overlap analysis "verified". The acceptance repeats a four-item list ("two-file discovery, nested ids, non-scenario folder walking, missing-brief error"). I diffed the two files' actual test sets. `enumerate-two-file.test.ts` uniquely covers at least four more live behavioral contracts that `scenarios.test.ts` does not assert anywhere:

- line 191: an **empty** `# Skills` section is valid and not flagged (distinct from `scenarios.test.ts:75`, which tests a *missing* section);
- line 224: multiple unknown skill ids are **comma-joined** in the error (`scenarios.test.ts:93` covers only a single unknown skill);
- line 242: a mix of known and unknown skills flags **only the unknown ones**;
- line 260: enumeration does **not throw on a missing scenarios root** and returns sorted ids.

Meanwhile one item the plan does list as a carry-over — the missing-`JUDGE.md` error — is already covered in `scenarios.test.ts:112` (which asserts *both* missing-brief directions with the error naming the file), evidence that the plan's overlap analysis was not actually performed test-by-test. The ordering-related tests (lines 270, 293) plausibly overlap `scenarios.test.ts:142/188/20`, but that judgment is nowhere recorded either.

**Where in plan:** Task 5, second Changes bullet and Acceptance bullet 2.

**Suggestion:** Replace the five-item list with the complete per-test disposition for `enumerate-two-file.test.ts`'s 14 tests: which merge into `scenarios.test.ts` as unique observables (at minimum the four above plus the ones already listed), and which are dropped as duplicates with the specific `scenarios.test.ts` test that covers each (e.g. line 127/152 → `scenarios.test.ts:112`; line 87/270 → `scenarios.test.ts:142`). Update the acceptance to name the full merged set so it is checkable.

**Why it matters:** The plan's own standing rule and R1 require keeping every live contract while purging tombstones; the design's finding 10 says "merge the overlapping enumeration tests' **unique assertions**". As written, a code-writer executing the plan literally deletes four live behavioral tests with no recorded reason, and two code-writers would produce different files — precisely the ambiguity a plan exists to remove. Enumeration edge-case behavior (empty skills section, multi-unknown error shape, missing-root tolerance) is public-facing behavior the revision is not supposed to change, let alone un-pin.

### Issue 2: Tasks 6, 7, and 10 prescribe specific new unit tests, which is the code-writer's TDD territory

**What's wrong:** Task 6's Changes end with "Unit tests cover at minimum: mounted section shape …; inline section shape for a tool-less judge (`tools: []` and `tools: ['WebSearch']`); not-tool-less cases …" — an enumerated new-unit-test list. Task 7's test-refit bullets go beyond refitting the named existing tests (legitimate and necessary) into prescribing new ones: "add coverage for the two new sentences … add tests that a provided `librarySection` string appears verbatim …", plus the new agent-loop coverage bullet. Task 10's "Tests:" bullet dictates the exact new test cases per file. Unit-test selection belongs to the code-writer, derived from each task's Acceptance; the plan should state *what must be true*, not *which tests to write*.

**Where in plan:** Task 6 (final Changes bullet), Task 7 ("Test refits" — the "add …" clauses), Task 10 ("Tests:" bullet).

**Suggestion:** Keep every refit/deletion instruction for *existing* named tests (that is file-change planning and is required for the green-gate sequencing). Recast the new-test prescriptions as Acceptance bullets — behavioral statements. Most already have Acceptance twins (e.g. Task 6's acceptance bullets 2–4 cover the disk contract, predicate, and empty-library cases); the semantic content that only lives in the test lists (e.g. `tools: ['WebSearch']` counts as tool-less, nested library files appear with `/`-joined paths, the smoke report embeds `judging` via the verbatim agent report) should move into Acceptance so no information is lost, and the "unit tests cover at minimum" framing should go.

**Why it matters:** The pipeline's division of labor makes per-task Acceptance the contract and TDD the code-writer's method. Prescribed test lists invite the writer to satisfy the list instead of the acceptance, and they hide design semantics (the WebSearch predicate case, the `/`-joined path form) inside test selection where the reviewer of the code phase may not look for them.

### Issue 3: Task 1's acceptance "No remaining test references `.changeset/` filenames or prose" is falsified by a surviving, legitimate test

**What's wrong:** `src/__tests__/validate-changesets.test.ts` (explicitly kept, correctly) references `.changeset/` throughout — it builds synthetic `.changeset/` directories in a temp dir and asserts on `.changeset/<file>:<n>` message shapes. A literal grep for `.changeset` after Task 1 matches it, so the acceptance as phrased cannot be satisfied and a diligent code-writer (or the batch code-reviewer) hits a contradiction between "delete `feature-changeset.test.ts`, keep `validate-changesets.test.ts` untouched" and this bullet.

**Where in plan:** Task 1, Acceptance bullet 3.

**Suggestion:** Scope the bullet to the repository's real changeset state, e.g. "No remaining test asserts on the contents, filenames, or count of the repository's own `.changeset/` directory (the validator's tests run against synthetic temp-dir fixtures and stay)."

**Why it matters:** Acceptance criteria are the per-task contract; one that is unsatisfiable as written either gets waved through (eroding the contract's authority) or triggers needless churn on a task whose actual instructions are correct.
