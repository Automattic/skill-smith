# Code Plan Review

## Verdict: approved

## Summary

The plan executes the approved design (KD1–KD8) and satisfies every spec
requirement (R1–R9) and acceptance criterion (AC1–AC14, including AC7b/AC11a/
AC11b) across 12 ordered tasks. I verified every named file and line reference
against the live codebase; all match reality, and the integration points the
two new files (`misconfig.ts`, `misconfig-ledger.ts`) plug into exist as the
plan assumes. The dependency order is acyclic and each task can run after its
prerequisites. No task prescribes specific tests or produces docs, and nothing
exceeds spec+design scope. Approving.

### AC coverage (verified, not merely asserted)

- **AC1** → T9 (true absence) + T6/T7/T11 (pass math, all four surfaces). ✔
- **AC2** → T8 (re-selection drops ledger ids); the `mode === "all"` /
  iteration-1 case is correctly deferred to T9's universal pre-dispatch filter,
  which the T8 body states explicitly. ✔
- **AC3** → T11 (one-time announcement from persisted roster). ✔
- **AC4** → T11 (distinct SKIPPED render, genuine FAIL still counts) + T12
  (dashboard skipped slot, not failed). ✔
- **AC5** → T1 (`classifyRuntimeError` → `undefined` for transient) + T9
  (ordinary FAIL path preserved). ✔
- **AC6** → T10 (pre-flight before phase work) + T9 (filter before dispatch, no
  `beforeTestAgent`) + T12 (no grid slot). ✔
- **AC7** → T4 (status surfaced) + T1 (classify) + T9 (record + sentinel, not
  counted) + T6/T7/T11 (excluded) + T8 (not re-selected). ✔
- **AC7b** → T7 (forward-only merge preserves earlier PASS via the existing
  `...body` spread + recomputed `agentsAllPass`, KD7) + T9 + T6/T7/T11. ✔
- **AC8** → T3 (field) + T2 (live snapshot) + T10 (set on `RunContext`). ✔
- **AC9** → T9 (no `beforeTestAgent` for filtered agent) + T10 (pre-flight
  before phase work). ✔
- **AC10** → T2 (role union) + T10 (probe over deduped role ids) + T9 (tester
  ref). ✔
- **AC11a** → T6 (`inconclusive` field per scenario) + T11 (distinct render,
  siblings proceed). ✔
- **AC11b** → T6/T7 (every scenario inconclusive) + T11 (`RUN RESULT:
  INCONCLUSIVE`, exit 1) + T5/T10 (all-agents unknown-provider lands here). ✔
- **AC12** → T10 (judge fail-fast `PreconditionError`). ✔
- **AC13** → T10 (improver degrade, `maxIterations`→1). ✔
- **AC14** → every task's final acceptance bullet pins byte-for-byte/identical
  clean-run behavior (empty ledger → all new branches are no-ops). ✔

### Design coverage (KD1–KD8 all executed, none contradicted)

- **KD1** (unknown-provider → skip): T5 deletes *only* the `validate.ts:80-84`
  `isProviderId` branch; T1 detects unknown-provider via `isProviderId`/
  `PROVIDER_IDS` membership (never `getProvider`); T9 filters ledger ids before
  the dispatch loop (i.e. before `testing-agent.ts:67` `getProvider`), and T10
  judge fail-fast fires pre-flight. Verified: `normalizeConfig` spreads
  `...def`, so an unknown provider string survives to `AgentDefinition.provider`
  unchanged — the demotion is safe exactly as KD1 argues, and the raw
  `registry.ts:26` throw is unreachable for ledgered ids.
- **KD2** (full status-aware classifier): T1 (classifier + allowlist), T4
  (HTTP-status enrichment in the shared `vercel-runner` catch), T9 (runtime
  detection). Verified the three env-var providers short-circuit with the exact
  `"<KEY> is not set"` literals T1 parses, and `runVercel` is the shared catch
  for their SDK errors.
- **KD3** (per-scenario `inconclusive`, no abort): T6 (field on
  `ScenarioReport`, not on the `Cell` union), T7 (`scenariosAllPass` non-PASS),
  T11 (inconclusive exit + render).
- **KD4** (true absence + runtime sentinel): T9 (pre-flight absence, runtime
  sentinel cell).
- **KD5** (progressive live hook field): T3 (field), T2 (`preflight()` freeze +
  growing `all()`), T10 (live view on `RunContext`).
- **KD6** (judge fail-fast / improver degrade): T10.
- **KD7** (forward-only): T2 (first-reason-wins), T7 (merge preserves prior
  PASS), T9 (forward-only record).
- **KD8** (four verdict surfaces): T6 (surface 1 `aggregateScenarioReport`), T7
  (surface 2 `agentsAllPass`/`scenariosAllPass`), T11 (surfaces 3–4
  `isRowPass`/`prepareSummary` + exit code). All three reuse T1's single
  `isMisconfiguredSkipReason` predicate over `classifyVerdict`'s SKIPPED reason,
  so the four surfaces cannot diverge. Verified `classifyVerdict` maps
  `{ skipped: "..." }` → `{ kind: "SKIPPED", reason }`, and that `summary.ts`
  is a genuinely independent fourth verdict computer (`prepareSummary` re-reads
  `report.json`, `isRowPass` at :309-317, exit code at :76 → `pipeline.ts:265`).

### Feasibility (every path/line ref checked against live code)

- `src/config/types.ts` `RunContext` at lines 144–150 — confirmed; every hook
  context (`ScenarioContext`/`AgentContext`/`IterationHookContext`) extends it,
  so T3's single field reaches all hooks as claimed.
- `src/config/validate.ts:77-79` (model branch) and `:80-84` (isProviderId
  branch) — confirmed exact; siblings T5 must preserve all present.
- `src/reports/scenario-report.ts` `ScenarioReport` :31-36, `aggregateScenarioReport`
  :46-105, `allPass` :82-92 — confirmed.
- `src/reports/iteration-report.ts` merge :115-146 (`...body` spread :136,
  recomputed `pass` :139), `scenariosAllPass` :166-177, `agentsAllPass`
  :179-188 — confirmed; `inconclusive` correctly rides the `...body` spread.
- `src/pipeline/select-scenarios.ts` :39-41 early return, :54-64 agentFilter,
  :68-95 `collectFailingAgents` — confirmed.
- `src/pipeline/agent-loop.ts` `runAgents` :66-111, `RunAgentsParams` :23-40,
  testing-failure branch :209-222 — confirmed (writes
  `{ skipped: "testing failed: ..." }`, marks judge skipped); the
  pre-dispatch `agents` computation at :83-86 is exactly where T9's
  `ledger.has` filter belongs.
- `src/pipeline/pipeline.ts` load+checkPaths :82-83, RunContext :100-106,
  tracker :108-117 (`agentIds` :113), `maxIterations` :118-119,
  `runImprovement` :188-208, `return emitSummary` :265,
  `PreconditionError` import :4 — confirmed; `PreconditionError` exists at
  `resolve-cwd.ts:58`.
- `src/reports/summary.ts` `allPass` :66-67, `collectAgentIds` :115-121,
  `sortedAgents.length === 0` table path :160-170, `isRowPass` :309-317,
  `failureLines` :319-338, `emitSummary` :80-83 — confirmed.
- `src/providers/lib/vercel-runner.ts` catch :64-66 — confirmed shared catch
  for `anthropic-api`/`openai-api`/`gemini-api`.
- `src/progress/types.ts` (`RunCounters.skipped`, `Failure`) and `tracker.ts`
  `phaseFinished` :180-199 — confirmed: only `status === "failed"` pushes to the
  `failed` counter / failures list, so T12's reuse of the existing `skipped`
  status path keeps a runtime sentinel out of `failed` with no new counter.
- New files `src/config/misconfig.ts` (T1) and `src/config/misconfig-ledger.ts`
  (T2) — their consumed exports (`registry.ts` `isProviderId`/`PROVIDER_IDS`,
  `providers/types.ts` `ProviderId`, `AgentDefinition`) all exist.

### Granularity, clarity, scope

- No task hides an unresolved design decision; every Open Decision is already
  resolved in the design and the plan executes the chosen branch.
- T10 explicitly forces a single roster-persistence channel ("Pick one channel
  and make Task 11's source match it"), and T11 reads "whichever channel Task 10
  provides" — the two tasks are pinned together, so two code-writers converge.
- No task prescribes specific tests; acceptance bullets are WHAT-not-which-test
  and observable. No task produces documentation.
- Nothing exceeds spec+design scope; the `Cell` union and per-cell SKIPPED
  rendering stay untouched (KD3), as the design requires.
