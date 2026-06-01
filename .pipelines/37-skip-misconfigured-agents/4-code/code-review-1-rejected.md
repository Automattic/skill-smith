# Code Review

## Verdict

REJECTED — one design-alignment defect (KD5/Task 3) must be fixed before approval.
Everything else in the batch is correct, well-tested, and verified end-to-end. The
single blocking issue is small (a one-line fix at two sites) but real: two hook
contexts that the design requires to carry `RunContext.misconfigured` are hardcoded
to `{}`, with inline comments that falsely claim a later task wired them.

## Batch scope

Tasks 1–12, the entire code plan:

- Task 1 — Pure misconfiguration classifier + credential env-var map (`src/config/misconfig.ts`).
- Task 2 — Run-scoped misconfiguration ledger (`src/config/misconfig-ledger.ts`).
- Task 3 — `RunContext.misconfigured` passive hook field (`src/config/types.ts`).
- Task 4 — Surface HTTP status into provider error strings (`src/providers/lib/vercel-runner.ts`).
- Task 5 — Demote unknown-provider from load-time abort to a skip (`src/config/validate.ts`).
- Task 6 — Scenario pass math excludes misconfigured skips; `inconclusive` field (`src/reports/scenario-report.ts`).
- Task 7 — Run-level verdict excludes misconfigured skips, rolls up inconclusive (`src/reports/iteration-report.ts`).
- Task 8 — Re-selection drops ledger ids (`src/pipeline/select-scenarios.ts`).
- Task 9 — Tester exclusion, runtime detection, sentinel write (`src/pipeline/agent-loop.ts`).
- Task 10 — Pipeline wiring: ledger build/seed, judge fail-fast, improver degrade, RunContext, roster persistence, threading (`src/pipeline/pipeline.ts`, `src/improvement/improver.ts`).
- Task 11 — `summary.ts` fourth-surface verdict, exit code, inconclusive rendering, one-time announcement (`src/reports/summary.ts`).
- Task 12 — Live dashboard true-absence + runtime sentinel (`src/pipeline/pipeline.ts` tracker init).

## Summary

The batch is, with one exception, a faithful and high-quality execution of the
plan and design. KD8's four verdict surfaces all agree: `aggregateScenarioReport`
(scenario-report.ts), `agentsAllPass`/`scenariosAllPass` (iteration-report.ts),
and `summary.ts`'s `isRowPass`/`computeVerdict` all apply the single shared
`isMisconfiguredSkipReason` predicate (defined once in `misconfig.ts`). KD1
(unknown-provider demoted, only the `isProviderId` branch removed, import dropped),
KD2 (allowlist classifier, status enrichment in vercel-runner with a defensive
`httpStatusOf`), KD3 (`inconclusive` on `ScenarioReport`, not on the `Cell`
union), KD4 (true absence for pre-flight, sentinel for runtime), KD6 (judge
fail-fast pre-flight, improver degrade to `maxIterations=1`), and KD7
(forward-only via the existing merge) are all implemented as specified. Tests
cover every AC, including the AC14 byte-for-byte clean-run assertion
(summary.test.ts:599) and the "ordinary SKIPPED still fails the row" guard
(summary.test.ts:643). End-to-end runs confirm AC11b (INCONCLUSIVE/exit 1),
AC12 (judge fail-fast, no run dir), and AC14 (clean PASS/exit 0).

The blocking issue is a KD5/Task 3 design-alignment gap: `RunContext.misconfigured`
must reach **all** hook contexts via inheritance (the design names `AgentContext`
explicitly), but `AgentContext` (built in `agent-loop.ts` for `beforeTestAgent`/
`afterTestAgent`) and the improver's `RunContext` (built in `improver.ts`) are
hardcoded `{}`. The fix is one line at each site (`ledger?.snapshot() ?? {}` /
the threaded snapshot), and the inline comments at both sites — "Empty until
Task 10 threads the run's ledger snapshot through here" — must be removed because
Task 10 did *not* thread them.

## Checks

| Check | Command | Result |
| --- | --- | --- |
| Tests | `npm test` | PASS — 208 tests, 206 pass, 0 fail, 2 skip (the 2 expected pre-existing skips). Matches the expected baseline. |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | PASS — no errors. |
| Lint | `npm run lint` (biome) | Baseline only — 3 errors / 6 warnings, all in `src/progress/tracker.ts`, `src/__tests__/progress-tracker.test.ts`, `src/__tests__/progress-render.test.ts` (control-char/ANSI/adjacent-space regexes). `git diff 39559d7..HEAD` shows none of those three files were touched by this batch, so **no new lint finding was introduced**. Not a rejection cause. |

## Behavior verification

Run end-to-end via the mock provider and the batch's fixtures (the `.skillsmith`
output dirs are gitignored; working tree confirmed clean after).

**AC11b / AC3 / AC4 — whole-run all-misconfigured → INCONCLUSIVE, exit 1, one-time
announcement** (`misconfig-hook-project`): `bad-multi` (pre-flight unknown-provider,
true-absent) + `mock-misconfig-testing` (runtime HTTP 401 sentinel):

```
scenario        agent                   result   duration  tokens
hello-scenario  mock-misconfig-testing  SKIPPED  0.0s      —

RUN RESULT: INCONCLUSIVE (1 scenario: all testers misconfigured)

INCONCLUSIVE SCENARIOS (all testers misconfigured):
  hello-scenario — mock-misconfig-testing

SKIPPED AGENTS (misconfigured):
  bad-multi               test, improver  unknown-provider "nope-provider"
  mock-misconfig-testing  test            invalid-credential (HTTP 401)
=====EXITCODE=====1
```

Evidence: exit code 1, distinct INCONCLUSIVE banner (no PASS, no red FAIL),
`bad-multi` absent from the grid (true absence), each agent announced exactly once
with id + roles + reason, `mock-misconfig-testing` shown with its unioned roster
roles. Sentinel cell renders SKIPPED, not a failure.

**AC12 — misconfigured judge fail-fast** (`judge-misconfig-project`):

```
skillsmith: precondition failed
  - Judge agent "bad-judge" is misconfigured: unknown-provider "nope-provider"
=====JUDGE EXITCODE=====1
```

Evidence: `PreconditionError` names the judge id and reason, exit 1, and
`.skillsmith` was **not** created (`ls` → No such file or directory) — no run
directory, no partial matrix, no tester dispatch.

**AC14 — clean run unchanged** (`smoke-project`):

```
scenario        agent   result  duration  tokens
hello-scenario  haiku   PASS    0.0s      150
                sonnet  PASS    0.0s      150

RUN RESULT: PASS
=====CLEAN EXITCODE=====0
```

Evidence: PASS, exit 0, no SKIPPED-AGENTS block, no INCONCLUSIVE section; persisted
`report.json.misconfigured` is `{}` (asserted by pipeline-misconfig.test.ts:313).

**Dashboard (flagged item #2)** — same all-misconfigured run, live stderr counters:

```
scenarios  ██████████████████████████████  1/1  pass 1 · fail 0
phases     ██████████████████████████████  2/2  pass 0 · fail 0 · skip 2
```

Phase counter correctly routes the runtime sentinel to `skip` (not `fail`), and the
pre-flight skip occupies no grid slot (2 phases, not 4) — Task 12's ACs hold. The
scenario counter's `pass 1` is discussed in Adjudications below.

## Adjudications of the two writer-flagged items

**Item 1 — `AgentContext.misconfigured` (and the improver `RunContext`) still `{}`:
REAL DEFECT, must fix.** See Issue 1 below. AC8's *literal* text only requires
visibility at `beforeAll`/`afterAll` (RunContext-level), and that is satisfied and
tested (pipeline-misconfig.test.ts:183). But KD5 and Task 3's Changes section
state the field reaches **all** hook contexts — naming `AgentContext` and
`IterationHookContext` — via `RunContext` inheritance, "no other interface
changes." `ScenarioContext` was wired correctly (pipeline.ts:582,
`misconfigured: args.ledger.snapshot()`); `AgentContext` and the improver context
were not. A `beforeTestAgent`/`afterTestAgent` provisioning hook (the precise hook
family R7/AC9 are about) reading `agentCtx.misconfigured` sees `{}`, contradicting
the approved design and the field's own doc comment. The `ledger` is already in
scope at both sites, so the fix is one line each. Not a rubber-stamp: this is a
load-bearing KD the batch silently left half-done, with inline comments that
misrepresent it as Task 10's completed work.

**Item 2 — dashboard scenario counter shows an all-misconfigured scenario under
`pass`: ACCEPTABLE cosmetic discrepancy, NOT a reject.** The live ProgressTracker
rolls a scenario up as "pass" when `anyFailed === false`; with all phases skipped,
the all-misconfigured scenario lands in `pass 1 · fail 0`. The *authoritative*
verdict — `summary.ts` exit code and the on-disk `report.json` — correctly renders
INCONCLUSIVE / exit 1 (verified above). Task 12's three ACs are all satisfied:
pre-flight skip occupies no slot, runtime skip increments `skipped` not `failed`,
clean run unchanged. No spec AC constrains the *live dashboard's* scenario counter;
R8/AC4 require visual distinction from a real FAIL (satisfied — no red failure row,
phase lands in `skip`) and AC11 governs the summary verdict (satisfied). The
tracker's scenario roll-up is pre-existing logic outside Task 12's file scope, and
the dashboard is an ephemeral indicator superseded by the authoritative summary. I
am not requiring a fix; if the team wants the live counter to read "inconclusive"
that would be a follow-up enhancement, not a defect in this batch.

## Issues

### Issue 1 — `AgentContext.misconfigured` and the improver `RunContext` are hardcoded `{}`, violating KD5/Task 3

- **Task**: Task 9 (the `AgentContext` site) and Task 10 (the improver-context site + the threading Task 10 was supposed to finish).
- **What's wrong**: KD5 and Task 3 require `RunContext.misconfigured` to reach
  every hook context — including `AgentContext` — via inheritance, populated from
  the live ledger. The batch wired `RunContext` (live getter) and `ScenarioContext`
  (`ledger.snapshot()`) correctly, but left `AgentContext` and the improver's
  `RunContext` set to a literal `{}`. A `beforeTestAgent`/`afterTestAgent` hook on a
  surviving tester therefore cannot read the misconfigured roster (R7's "hooks
  informed, keyed by id + role"), and an improver-context hook sees an empty set.
  The two inline comments — `// Empty until Task 10 threads the run's ledger
  snapshot through here.` — are factually wrong: Task 10 landed without threading
  them, so the comments must also be corrected/removed. The `ledger` instance is
  already in scope at both call sites, so this is a one-line fix at each.
- **Where**:
  - `src/pipeline/agent-loop.ts:186-187` — in `runAgentPair`, the `AgentContext`
    literal sets `misconfigured: {}`. `ledger` is destructured into this function
    (agent-loop.ts:170) and is available here.
  - `src/improvement/improver.ts:97-98` — the `RunContext` passed to improver
    hooks sets `misconfigured: {}`. `runImprovement`'s `RunImprovementParams` do
    not currently receive the ledger snapshot, so Task 10's `runImprovement(...)`
    call site in `pipeline.ts` (around pipeline.ts:188-208) must pass
    `ledger.snapshot()` (or the ledger) through `RunImprovementParams` so this
    field can be populated.
- **Expected**: Both contexts carry the live misconfigured view.
  - `agent-loop.ts`: `misconfigured: ledger?.snapshot() ?? {}` (preserving the
    no-ledger / pre-misconfiguration path → `{}`, so AC14 stays byte-for-byte).
  - `improver.ts`: `misconfigured` populated from a ledger snapshot threaded in via
    `RunImprovementParams` from the pipeline; `{}` only when no ledger is supplied.
  - Remove/replace both "Empty until Task 10…" comments so the inline docs match
    reality.
  - Add or extend a test that asserts a `beforeTestAgent`/`afterTestAgent` hook on
    a surviving agent sees the pre-flight roster in `agentCtx.misconfigured`
    (the existing AC8 test only covers `beforeAll`/`afterAll`).
