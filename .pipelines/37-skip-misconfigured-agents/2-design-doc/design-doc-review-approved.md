# Design Doc Review

## Verdict: approved

## Summary

The revised design (commit `73ff14d`) genuinely and completely resolves all
three issues from review #1, introduces no new inconsistencies, and remains
sound, complete, and fully traceable across all 14 ACs and all 7 Open
Decisions. I re-verified every load-bearing code claim against the worktree
rather than trusting the prose; the line references are accurate.

**Issue 1 (BLOCKING — `summary.ts` as a fourth verdict computer) — resolved.**
KD8 is retitled "across all FOUR verdict-computing surfaces" and opens with an
explicit "there are four independent verdict computations, not three" paragraph
that names and correctly locates each: `aggregateScenarioReport`
(`scenario-report.ts:82-92`), `scenariosAllPass`/`agentsAllPass`
(`iteration-report.ts:166-188`), and `summary.ts`'s
`prepareSummary`/`isRowPass`/`allPass` (`summary.ts:66-67,309-317`) with
`exitCode` (`:76`) returned via `emitSummary(prepared)` (`pipeline.ts:265`). I
confirmed all of these line refs: `prepareSummary` derives `allPass = rows.length
> 0 && rows.every(isRowPass)`, `isRowPass` fails on any non-PASS cell including
`SKIPPED`, and `pipeline.ts:265` is exactly `return emitSummary(prepared)`. The
Components table now carries a dedicated row for `summary.ts` as the on-disk
verdict + exit-code computer (distinct from the in-memory math row), and the
data-flow shows it RECOMPUTES the verdict + exit code. I checked for a fifth
hidden path: there is none — `agentsAllPass` is a co-resident per-scenario
helper (not currently invoked by `writeRunReport`, which uses `scenariosAllPass`),
and the design accurately describes it as a helper. The fix is complete.

**Issue 2 (`inconclusive` data-model home) — resolved.** KD3 now gives one
unambiguous home: an optional `inconclusive?: { reason: "all-testers-misconfigured";
agents: string[] }` field on `ScenarioReport` (`scenario-report.ts:31-36`), with
the per-agent `Cell` union (`verdict.ts:9-12`) explicitly left at its three
existing kinds. It specifies `scenariosAllPass` behavior (already non-PASS for
any `pass !== true`, so an inconclusive scenario correctly fails run-level PASS),
the on-disk `report.json` shape that makes AC11a "distinguishable from a real
failure" verifiable, the `summary.ts` rendering (`RUN RESULT: INCONCLUSIVE`,
exit code 1, distinct section), and that the run-level inconclusive is *derived*,
not a stored fourth state. The prior contradictory Risks line ("widens the
`Cell` union") is corrected to "does not widen the per-agent `Cell` union," and
the Dependencies note now agrees ("`Cell` type read unchanged ... lives on
`ScenarioReport`"). All three references now agree.

**Issue 3 (KD1 boundary + dispatch path) — resolved.** KD1 now states the
**only** removed check is the `isProviderId` branch in `validateAgentEntry`
(`validate.ts:80-84`) and explicitly keeps the empty-`model` branch
(`validate.ts:77-79`), role-reference checks, and mode/scope as hard aborts — I
verified `:80-84` is precisely the `isProviderId` branch and `:77-79` the model
branch. It adds the short-circuit reasoning so `getProvider` (`registry.ts:23-29`)
is never reached for a ledgered unknown-provider id in any role: tester via the
ledger filter ahead of dispatch, judge via pre-flight fail-fast, improver via
degrade. I confirmed the agent-loop builds its `agents` list before any
`provider.invoke` (`agent-loop.ts:83-86`, dispatch at `:95`/`:171`), so a ledger
filter there short-circuits before provider resolution, and that pre-flight can
detect unknown-provider structurally via `isProviderId`/`PROVIDER_IDS`
(`registry.ts:21,31-33`) without calling `getProvider`. Feasible and complete.

**New-inconsistency re-scan (the edits touched KD8, Components, Interfaces/Data
Flow, Decision-4, KD1, KD3, AC coverage).** All edited cross-references now
agree: the Components table, Dependencies block, Risks block, and per-AC
coverage lines consistently describe `inconclusive` as a `ScenarioReport` field
(not a `Cell` widening), `summary.ts` as a fourth verdict surface, and KD1's
single removed check. The stale phrasings the prior review flagged
("widens/extends the `Cell` union", "reusing SKIPPED", "Demote unknown-provider",
"validate.ts no longer aborts on unknown provider") are all gone. The lone
"no longer aborts" hit (line 281) is accurate prose for the all-agents-typo case
rolling up to the inconclusive outcome, not a contradiction.

**Feasibility / coverage spot-checks.** KD6's improver degrade ("effectively
`maxIterations` 1") maps onto the existing `selfImprovement.mode === "test-only"
? 1 : maxIterations` mechanism (`pipeline.ts:118-119`). The runtime sentinel
`{ skipped: "misconfigured: <reason>" }` classifies as `{ kind: "SKIPPED" }`
(`verdict.ts:26-28`), and the design specifies the recognizable
`"misconfigured:"` reason prefix as the discriminator at every verdict surface —
specified, not hand-waved. Re-selection drops ledger ids in `collectFailingAgents`
(`select-scenarios.ts:68-95`). Hook context, dependencies, failure
modes/observability, scope, and backward-compat (AC14 as a four-surface no-op)
are all covered and internally consistent.

All 14 ACs are traced with the resolving KDs; no AC is unaddressed and none of
the seven decisions provably violates a spec invariant. The document is a design
(decisions, interfaces, data flow, trade-offs) — not a step-by-step plan and not
production code. Phase 2 is complete.
