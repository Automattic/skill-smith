# Design Doc Review

## Verdict: rejected

## Summary

This is a strong, well-traced design. All 14 ACs are addressed, all 7 Open
Decisions are resolved (KD1–KD7) with credible alternatives and trade-offs, and
the load-bearing KD8 pass-math change is correctly identified as the invariant
that holds across KD4/KD7. I verified the key code claims against the worktree:
`classifyVerdict`/`SKIPPED` (`verdict.ts:9-12,26-28`), the pass math in
`scenario-report.ts:82-92` and `iteration-report.ts:166-188`, re-selection in
`select-scenarios.ts:68-95`, `collectConfigErrors`/`PreconditionError`
(`validate.ts:80-84`, `load.ts:29-32`), the 6 providers' credential handling,
the `ProgressTracker` up-front grid + `slots()` throw
(`tracker.ts:100-104,335-346`), and `RunContext` + the hook lifecycle
(`types.ts:144-150,239-287`, `pipeline.ts:100-106,328-336,253-260`). KD2's
status-aware classifier is feasible: the Vercel AI SDK's `APICallError` exposes
`statusCode`, so the provider enrichment can prepend a parseable `[HTTP 401]`
without changing the `InvokeResult` shape, and the allowlist guarantees the safe
fall-through direction the spec wants.

I am rejecting on one material coverage gap (Issue 1) that would let a
misconfigured-skip cell flip the run's authoritative verdict/exit code despite
KD8, plus two smaller consistency/feasibility gaps that two implementers would
resolve differently. None requires re-litigating a decision — they are
completeness fixes to the components and data-flow.

## Issues

### Issue 1 — KD8's pass-math change omits `summary.ts`, the authoritative verdict/exit-code computer (blocking)

- **What's wrong**: KD8 and the Components table scope the pass-math change to
  three functions: `aggregateScenarioReport`, `agentsAllPass`,
  `scenariosAllPass`. But the run's *authoritative* PASS/FAIL verdict and the
  process exit code are computed independently in `summary.ts`. `prepareSummary`
  derives `allPass = rows.length > 0 && rows.every((r) => isRowPass(r, ...))`
  (`summary.ts:66-67`) and `isRowPass` fails the row on any non-PASS cell —
  including a `SKIPPED` cell (`summary.ts:309-317`, and the SKIPPED branch in
  `failureLines` at `:331-333`). This computation reads `report.json` directly
  and does *not* call any of the three functions KD8 lists. Its `exitCode` is
  what the pipeline returns: `return emitSummary(prepared)` (`pipeline.ts:265`).
  Consequence: the runtime-detected sentinel cell (`skipped: "misconfigured:
  ..."`, KD4) classifies as `SKIPPED` via `classifyVerdict`
  (`verdict.ts:26-28`), `isRowPass` then returns false for that row, and the run
  is reported FAIL with exit 1 — defeating AC1/AC4/AC7/AC7b/AC11 and breaking the
  KD8 invariant precisely where it matters most (the visible verdict and exit
  code), regardless of what `scenario-report.ts` computed.
- **Where in design doc**: KD8 (lines 385-406) and the Components table row
  "Pass/fail math | `src/reports/scenario-report.ts`, `iteration-report.ts`,
  `reports/verdict.ts`" (line 149). `summary.ts` appears only under "CLI
  surfacing" (line 152) and the Failure-Modes section (lines 425-440), framed as
  rendering, not as a verdict/exit-code computer. The data-flow line
  "`prepareSummary` → one-time misconfigured announcement" (line 181) likewise
  treats it as display-only.
- **Suggestion**: Add `summary.ts` to the set of pass-computing surfaces KD8
  changes (it is a *fourth* independent verdict computation, not just
  rendering). State how `isRowPass`/`allPass` must exclude a misconfigured-skip
  cell from both numerator and denominator and how an `inconclusive` scenario
  (KD3) maps to the exit code there, so the on-disk-report verdict in
  `summary.ts` agrees with the in-memory verdict in `iteration-report.ts`. Note
  the empty-row guard `rows.length > 0` (`summary.ts:67`) interacts with KD3's
  whole-run all-misconfigured case and must be reconciled (it must not silently
  pass *and* must not read as an ordinary FAIL).
- **Why it matters**: This is the load-bearing R4/AC1/AC4 invariant and the
  user-visible verdict + exit code. As written, an implementer following KD8's
  named functions would leave `summary.ts` untouched and ship a design that still
  fails the run on a misconfigured-skip cell — the exact bug the feature exists
  to fix. Two implementers would diverge on whether `summary.ts` is in scope.

### Issue 2 — KD3's `inconclusive` verdict state is asserted but not threaded through the report data model or `summary.ts`

- **What's wrong**: KD3 introduces a new `inconclusive` scenario outcome
  ("neither pass nor fail") and the Risks section says it "widens the `Cell`
  union" (line 514). But `Cell` (`verdict.ts:9-12`) is the *per-(scenario,agent)*
  verdict, whereas `inconclusive` is a *scenario-level* state. Scenario pass is a
  boolean (`ScenarioReport.pass`, `scenario-report.ts:31-36`) and run pass is a
  boolean (`writeRunReport`/`scenariosAllPass`, `iteration-report.ts:153-177`);
  neither has a third state, and `summary.ts` has no scenario-level
  inconclusive concept — it only renders per-cell `Cell.kind` and a binary
  RUN RESULT. The design does not say where `inconclusive` lives in the data
  model (a new `ScenarioReport` field? a sentinel `pass` value? a reused
  `error`?) nor how `scenariosAllPass`/`isRowPass` distinguish it from FAIL so it
  is "not indistinguishable from a real failure" (AC11a) while still being
  non-PASS (exit 1, AC11b).
- **Where in design doc**: KD3 (lines 267-292), the Components row "Empty-set
  outcome | `scenario-report.ts` + summary" (line 150), the Dependencies note
  "`Cell` type (extended with an `inconclusive`-equivalent or reusing SKIPPED
  with a marker)" (lines 415-416), and the Risk at lines 514-517. These three
  references disagree on *where* the new state lives (Cell union vs scenario
  level vs reusing SKIPPED).
- **Suggestion**: Pick one representation for the scenario-level inconclusive
  outcome and state it concretely — e.g. a distinct marker on `ScenarioReport`
  (not on `Cell`, which is per-agent), how `scenariosAllPass` treats it
  (non-PASS but distinct from FAIL), and how both `iteration-report.ts` and
  `summary.ts` render and exit-code it. Resolve the Cell-vs-scenario-level
  ambiguity so the AC11a "distinguishable from a real failure" requirement has a
  concrete home.
- **Why it matters**: Without a single, concrete data-model decision, two
  implementers build different artifact shapes, and the AC11a "explicit,
  distinguishable, not a silent pass" invariant cannot be verified. This couples
  tightly to Issue 1 (the same `summary.ts` verdict path must learn the new
  state).

### Issue 3 — KD1's unknown-provider demotion under-specifies the typed-field / dispatch path and the still-hard-abort boundary

- **What's wrong**: KD1 demotes the unknown-`provider` check from a hard
  `PreconditionError` abort to a per-agent skip. Two feasibility details are
  unaddressed: (a) `provider` is typed `ProviderId` on `AgentDefinitionInput`
  (`types.ts:26`), and the abort today comes from `isProviderId` in
  `collectConfigErrors` (`validate.ts:80-84`); demoting it means a non-`ProviderId`
  string now flows through `normalizeConfig` (`normalize.ts:24`) into a runtime
  `AgentDefinition.provider` that downstream `getProvider(id)` will throw on
  (`registry.ts:23-29`). The design says pre-flight records it and the tester is
  filtered before dispatch, but does not state that `preflightMisconfig` /
  the dispatch path must guard against `getProvider` ever being called for a
  ledgered unknown-provider agent (testing-agent, judge-agent, and improver all
  resolve a provider). (b) The design correctly says other structural checks stay
  hard aborts (line 242), but the unknown-provider check currently lives *inside*
  `validateAgentEntry` alongside the `model` check (`validate.ts:77-84`) — the
  design should note that only the `isProviderId` branch is removed from
  `collectConfigErrors` and re-homed as a pre-flight ledger entry, while the
  empty-`model` branch in the same function stays.
- **Where in design doc**: KD1 (lines 225-244), Components row "Config validation
  | `src/config/validate.ts` | Demote unknown-provider from hard abort to a
  skippable case" (line 153), and the data-flow line "loadConfig ► (Decision 1)
  validate.ts no longer aborts on unknown provider" (line 158).
- **Suggestion**: State explicitly (1) that the `isProviderId` branch is the only
  part of `collectConfigErrors` removed (the `model` and role-reference checks in
  the same functions stay hard aborts), and (2) that the dispatch/pre-flight path
  must never reach `getProvider(unknownId)` for a ledgered agent — i.e. the
  ledger filter in `runAgents` and the judge fail-fast must short-circuit before
  provider resolution. A one-line note on how `preflightMisconfig` detects
  unknown-provider (via `isProviderId`/`PROVIDER_IDS`, already a listed
  dependency) without invoking `getProvider` closes the gap.
- **Why it matters**: Without this, an implementer could leave a path where a
  typo'd-provider agent reaches `getProvider` and throws a raw `Error`
  (uncaught at dispatch in some roles), re-introducing a crash instead of the
  intended skip — undermining KD1's whole point and AC11b's explicit empty-set
  outcome for the all-typo'd-provider case.
