# Design Doc Review

## Verdict: rejected

## Summary

This is a strong, feasible, and unusually well-grounded design. I verified its core feasibility claims against the live codebase: the current `query()` call does not pass `options.env` (so adding it is the only behavioral delta), the proposed `QueryFn` type accepts both the real SDK `query` and a one-line `async function*` fake under the project's strict tsconfig (confirmed by running `npm run typecheck` against a temporary probe file), `Options.env` is structurally `NodeJS.ProcessEnv` so no cast is needed, the SDK is v0.2.141 with `apiKeySource`/`'oauth'` present as claimed, and the consumers (`testing-agent.ts`, `judge-agent.ts`, `improver.ts`) resolve via `getProvider(...)` and depend only on the `Provider` interface, so the const→factory swap is genuinely transparent. The codex factory + save/restore-`process.env` test is an exact, reusable template. The denylist-vs-allowlist reasoning, the precedence analysis, and the risk register are all honest and proportional. I am rejecting on a single, fixable issue: Requirement 6 (the `anthropic-api` provider keeps using `ANTHROPIC_API_KEY` in the same run) is satisfied only by the "scrub operates on a copy" property, but that property is never owned by a Key Decision's traceability line, and — more importantly — the design's own test strategy cannot observe it, so the one safeguard for Requirement 6 ships unverified. Two smaller traceability gaps are bundled in for the writer to close at the same time.

## Issues

### Issue 1: Requirement 6's only safeguard ("operate on a copy") is untraced and unobservable by the proposed test

**What's wrong:** Requirement 6 and its acceptance criterion require that, in the same process/run, `anthropic-api` still reads and uses `ANTHROPIC_API_KEY` exactly as today (including its "ANTHROPIC_API_KEY is not set" guard). The single design property that guarantees this is that `claudeCodeEnv` builds a *copy* (`const out = { ...env }`) and never mutates `process.env` in place — `anthropic-api.ts:8` reads `process.env.ANTHROPIC_API_KEY` directly, so an in-place `delete process.env.ANTHROPIC_API_KEY` would silently break it. The design states this property correctly in prose (Overview, Components "Untouched but relevant", Data flow), but:

1. **No Key Decision traces to Requirement 6 or its acceptance criterion.** Decision 1's "Traces to" line lists "Requirements 1, 2, 3, 4, 5, 7; Acceptance criteria 1–5, 7" — Requirement 6 / acceptance criterion 6 appear in no decision's traceability footer. The copy-not-mutate property is the load-bearing decision for Req 6, yet it is never elevated from a prose consequence to a traced decision.

2. **The proposed offline test (Decision 5) cannot distinguish the correct implementation from a Req-6-breaking one.** The test asserts only on the captured `options.env` and restores `process.env` in a `finally`. A buggy in-place implementation (`delete process.env.ANTHROPIC_API_KEY` before constructing the env) would produce an identical captured `options.env` (key absent) and the `finally` would mask the global mutation — so the test passes either way. Req 9 is explicitly framed as "the measurable success criterion for Requirements 1–4" (line 136), pointedly *not* 6, which confirms Req 6 has no measurable check anywhere in the design.

**Where in design doc:** Key Decisions → Decision 1 "Traces to" (line 108); Decision 5 "Offline scrub test" (lines 132–136); Components "Untouched but relevant" (line 36).

**Suggestion:** (a) Add an explicit traceability link for Requirement 6 / acceptance criterion 6 to the decision that owns the copy-not-mutate property (Decision 1 and/or Decision 3). (b) Specify, in the test strategy, an observable assertion that the copy property holds — e.g. after `invoke()` returns, assert `process.env.ANTHROPIC_API_KEY` is still the sentinel (proving no in-place mutation), and/or that a subsequent `anthropicApiProvider.invoke(...)` in the same test still sees the key. This converts "operate on a copy" from an unverifiable claim into the design's coverage of Req 6. (You need not write the test code — just commit the design to an assertion that observes the property.)

**Why it matters:** Requirement 6 is a first-class spec requirement with its own acceptance criterion ("the `anthropic-api` provider continues to read and use `ANTHROPIC_API_KEY` exactly as it does today"). As designed, the sole thing standing between the fix and a Req-6 regression is an implementation detail that no decision is accountable for and no test can catch. A downstream implementer who reasonably "simplifies" by mutating `process.env` in place would satisfy every assertion the design specifies while silently breaking `anthropic-api`. Closing this is the difference between Req 6 being *claimed* covered and being *demonstrably* covered.

### Issue 2: Requirement 5 (out-of-credit account) has no observable success criterion and its trace is asserted, not grounded

**What's wrong:** Decision 1 traces to Requirement 5 (out-of-credit pay-as-you-go account → run proceeds on the subscription). The design treats Req 5 purely as a downstream consequence of the scrub, which is logically reasonable. But Req 5 is the requirement most directly tied to the originating bug (the credit-balance failure), and the design never states how anyone confirms it is fixed — it is neither in the offline test's scope (correctly, since it needs real credentials) nor flagged as requiring a credentialed/integration check, nor explicitly mapped to "satisfied transitively by Requirements 1–2 plus the precedence research." The reader is left to infer the chain.

**Where in design doc:** Key Decisions → Decision 1 "Traces to" (line 108); Risks (the precedence risk at line 163 is the actual basis for Req 5 but is never connected to it).

**Suggestion:** Add one sentence making the Req 5 chain explicit and honest: Req 5 is satisfied transitively — once Req 1/Req 2 hold (the two keys are absent), the precedence research guarantees the subscription is selected, so an out-of-credit pay-as-you-go account is never consulted; and note that this is verified offline only at the env-construction level (Req 9), with end-to-end confirmation deferred to real-run/integration testing under the documented "native-binary precedence is doc-derived" risk. This keeps the trace honest about what the offline test does and does not prove.

**Why it matters:** Req 5 is the user-visible symptom that motivated the whole spec. Leaving its verification path implicit makes the design's coverage of the headline requirement weaker than its coverage of the mechanical ones, and risks an implementer assuming the offline scrub test "covers" Req 5 when it only covers the precondition.

### Issue 3: Acceptance criteria are partially traced — several decisions cite requirements but omit the matching acceptance criterion

**What's wrong:** The spec carries nine acceptance criteria, one per requirement. Decision 4 traces to "Requirement 8 ... and Requirement 7" but omits the matching acceptance criteria (the visible-failure AC and the no-regression AC). Decision 1 lists "Acceptance criteria 1–5, 7" — omitting AC 6 (anthropic-api unaffected, related to Issue 1) and AC 8 (visible failure). Because the spec defines acceptance criteria as the testable form of the requirements, partial criterion-level tracing makes it harder for the plan/test phases to confirm each criterion has a home.

**Where in design doc:** Key Decisions → "Traces to" lines on Decision 1 (line 108) and Decision 4 (line 129).

**Suggestion:** Normalize every decision's "Traces to" line to cite both the requirement(s) and the corresponding acceptance criterion/criteria, so the full set of nine criteria is visibly covered across the decisions (in particular AC 6 and AC 8). This is a low-effort consistency fix that pairs naturally with Issues 1 and 2.

**Why it matters:** Traceability is only useful if it is complete; a criterion cited by no decision is indistinguishable, to the downstream plan and test phases, from a criterion that was dropped. Full criterion-level coverage lets the next phase confirm at a glance that nothing fell through.
