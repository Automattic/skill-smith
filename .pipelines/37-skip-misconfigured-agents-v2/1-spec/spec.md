# Skip misconfigured agents across a run

## Overview

A run evaluates skills using agents declared in three roles: a list of **test**
agents, one **judge**, and one **improver**. An agent is **misconfigured** when
it cannot run for an environmental reason that is knowable without grading its
output — paradigmatically, a required provider credential is absent from the
environment.

Today, when an agent is misconfigured, the runtime invokes it anyway, that
invocation returns an error, and the error is conflated with a graded failure.
This burns compute, spins up workspace artifacts for an agent that can never
produce output, and (in the end-to-end harness) runs Playwright tests against a
plugin that was never built — producing spurious failures. There is also no
role-aware handling: a misconfigured judge or improver is treated the same as a
misconfigured test agent.

This feature introduces an upfront, pre-invoke notion of misconfiguration and
handles it under a default **"warn"** policy, with role-specific behavior:

- **Test agent** — the run proceeds with the test agents that *can* run; the
  misconfigured test agent is excluded from execution; the misconfiguration is
  surfaced clearly in the run output; and **the run exits non-zero**, so a
  partial run never looks green.
- **Judge** — a misconfigured judge **stops the run**; nothing can be graded.
- **Improver** — a misconfigured improver **degrades the run to test-only**: the
  test agents and judge still run, but no improvement step runs.

The decision about what to do with a misconfigured agent is routed through a
**single policy seam**. Only the "warn" policy is built now. Two further
policies — "fail" (stop the whole run up front when any agent is misconfigured)
and "skip" (proceed and exit zero) — are out of scope to implement but must be
addable later by a localized change at the seam, not a rewrite.

The end-to-end (e2e) harness — which today creates one Playwright project per
declared test agent regardless of misconfiguration — must consume a new public
API so that misconfigured agents are excluded from the Playwright project set and
do not fail spuriously.

### Definitions

- **Misconfigured** — the agent cannot run for an environmental reason knowable
  *without* grading its output (e.g. a required provider credential is absent).
  This is the condition the policy keys off.
- **Failed** — the agent *ran* and produced an error or a non-passing result.
  This is distinct from misconfigured and is unchanged by this feature.
- **Runnable** — not misconfigured, from the static view (configuration plus
  environment, no model invocation).
- **Provider** — the backend that executes an agent. Some providers gate on a
  single environment variable that can be checked before invocation
  (`openai-api` → `OPENAI_API_KEY`, `anthropic-api` → `ANTHROPIC_API_KEY`,
  `gemini-api` → `GOOGLE_GENERATIVE_AI_API_KEY`). Others (`claude-code`, `mock`)
  have no environment-readable credential gate. `codex` reads the same
  `OPENAI_API_KEY` but does NOT pre-check it today, so its static-misconfiguration
  status is an explicit decision (see R1.3 and Open items).
- **"Warn" policy** — the default handling for a misconfigured test agent:
  exclude it from execution, surface it clearly, and force a non-zero exit.

The names above ("warn", "misconfigured", "policy seam", "runnable") are
descriptive for this document. They do not prescribe identifiers, types, or
placement in the shipped code.

## Requirements

Each requirement states the required behavior, not how to achieve it.

### R1 — Misconfiguration is a distinct, pre-invoke condition

- **R1.1** An agent is "misconfigured" when it cannot run for an environmental
  reason knowable *without* grading its output — paradigmatically, a required
  provider credential is absent. This is conceptually distinct from "ran and
  failed".
- **R1.2** For providers whose credential requirement is a plain environment
  read (`openai-api` → `OPENAI_API_KEY`, `anthropic-api` → `ANTHROPIC_API_KEY`,
  `gemini-api` → `GOOGLE_GENERATIVE_AI_API_KEY`), misconfiguration MUST be
  determinable *before* the agent is invoked — purely from the agent's declared
  provider plus the environment, with no model call.
- **R1.3** Providers with no environment-readable credential gate
  (`claude-code`, `mock`, and `codex` unless the design opts it into the
  `OPENAI_API_KEY` check — `codex` reads that same variable today but does not
  pre-check it) are treated as "not statically misconfigurable": they are
  considered runnable from the static view, and any real misconfiguration
  continues to surface through the existing invoke-time error path. The solution
  MUST NOT assume every provider can be checked upfront. Whether `codex` opts in
  is an Open item.

### R2 — Single policy seam (extensibility)

- **R2.1** The decision "what to do about a misconfigured agent" MUST be routed
  through ONE policy seam consumed at the decision points — not scattered as
  policy-specific branches across the codebase.
- **R2.2** Only the "warn" policy is implemented now. The seam MUST be shaped so
  that "fail" (stop the whole run up front when ANY agent is misconfigured) and
  "skip" (proceed and exit zero) can each be added later by a localized change at
  the seam, NOT a rewrite.
- **R2.3** "Warn" is the DEFAULT behavior. "Fail" and "skip" are NOT implemented
  (see Out of Scope).

### R3 — "Warn" policy for a misconfigured TEST agent

- **R3.1** The run proceeds with the test agents that CAN run; the misconfigured
  test agent is excluded from EXECUTION — it is not invoked, and its pre-test
  hooks (e.g. plugin scaffolding) do not fire. Exclusion happens at or above the
  test-agent loop, so no compute and no workspace artifacts are produced for it.
- **R3.2** The misconfiguration is surfaced CLEARLY in the run output: in the
  human-readable end-of-run summary AND in the machine-readable run report,
  identifiable as a misconfiguration/exclusion and distinguishable from a normal
  grading failure and from an unrelated skip.
- **R3.3** The run's exit status MUST be NON-ZERO whenever one or more declared
  test agents were excluded as misconfigured — EVEN IF every test agent that did
  run passed. A partial run MUST NOT exit zero.

  This is the central anti-regression requirement. The exit code is decided at a
  single chokepoint from the run report. Excluding a misconfigured test agent
  MUST thread a signal to that chokepoint so the run does not exit zero. Merely
  dropping the excluded agent's row from the report — so the remaining rows all
  pass and the run exits zero — is FORBIDDEN.
- **R3.4** The existing "all declared test agents are misconfigured" degenerate
  case MUST remain a FAILURE (non-zero exit), never a vacuous pass. An empty or
  all-excluded matrix is not green.

### R4 — Role-aware handling

- **R4.1** A misconfigured JUDGE STOPS the run: the run aborts with a clear,
  single message stating the judge cannot grade, and exits non-zero. This is
  observably distinct from a matrix of grading failures (no graded matrix is
  produced). It SHOULD be detected up front — before test agents are invoked —
  when the judge's provider is statically checkable.
- **R4.2** A misconfigured IMPROVER DEGRADES the run to test-only: the test
  agents and judge run, but no improvement step runs. Degrading to test-only
  does NOT, by itself, force a non-zero exit — the exit status still derives from
  the test/judge matrix, so a clean test-only run may legitimately exit zero. The
  degrade MUST be surfaced in the run output. (The forced-non-zero rule of R3.3
  is specific to excluded TEST agents.)
- **R4.3** A misconfigured TEST agent follows the "warn" policy (R3).
- **R4.4** All three role behaviors MUST be deterministically testable without
  real provider credentials — e.g. via a provider that can be made misconfigured
  on demand — mirroring how the existing deterministic test-failure path is
  exercised today.

### R5 — Public API consumed by the e2e harness

- **R5.1** The runtime exposes a runnability/misconfiguration determination as a
  NAMED EXPORT from the package's public entry point, callable by an outside
  consumer (the testing-project). It MUST operate on the configuration the
  consumer holds and be a PURE, SYNCHRONOUS function of configuration plus
  environment — no async, no model call.
- **R5.2** The SAME public API is consumed at BOTH the runtime exclusion point
  and the e2e harness, so the two agree on which agents are runnable.

### R6 — e2e harness excludes misconfigured agents

- **R6.1** The e2e harness MUST NOT create a Playwright project for a
  misconfigured agent (and therefore MUST NOT run any e2e spec for it). The
  `projects` array in `testing-project/playwright.config.ts` is derived from the
  runnable agents via the R5 API.
- **R6.2** `testing-project/skillsmith.config.ts` gains an `openai-api-nano`
  test agent (`provider: openai-api`) alongside the existing configured agent, so
  that absent `OPENAI_API_KEY` makes exactly that agent misconfigured.

### R7 — Constraints on all produced code, tests, and documentation

- **R7.1** The policy logic is a SELF-CONTAINED, isolated component; it is not
  entangled with unrelated runtime code.
- **R7.2** MINIMAL change: existing internal APIs/signatures are left unchanged
  wherever possible; only the minimal change needed is made. No gratuitous
  refactors or signature churn.
- **R7.3** Comment SPARINGLY — only what is not obvious from the code itself. Do
  not comment self-explanatory code; never modify comments on code that did not
  change.
- **R7.4** NO internal-process vocabulary anywhere in the produced code,
  comments, tests, or documentation — no phase names, specifications, design
  documents, plans, acceptance-criteria identifiers, task identifiers, or similar
  tags. (This document may use such vocabulary; the constraint applies to the
  *shipped deliverables* this document records.)

## Acceptance Criteria

Each criterion is observable and testable.

### AC1 — Pre-invoke misconfiguration determination

- **AC1.1** Given an agent with `provider: openai-api` and `OPENAI_API_KEY`
  unset, the runnability API reports it as misconfigured/not-runnable WITHOUT
  invoking any model; with `OPENAI_API_KEY` set, it reports it runnable.
  Analogous for `anthropic-api` (`ANTHROPIC_API_KEY`) and `gemini-api`
  (`GOOGLE_GENERATIVE_AI_API_KEY`).
- **AC1.2** An agent with `provider: claude-code` (or `mock`) is reported
  runnable regardless of environment (no static gate).

### AC2 — "Warn" exit-code behavior (anti-regression)

- **AC2.1** A run with two declared test agents — one misconfigured, the other
  runs and PASSES — exits NON-ZERO. The passing agent's result is recorded as a
  pass; the misconfigured agent is clearly marked as misconfigured/excluded, not
  graded.
- **AC2.2** The misconfigured test agent is NOT invoked and produces no
  workspace/scaffold artifacts (no pre-test hook side effects for it).
- **AC2.3** A run where ALL declared test agents are misconfigured exits
  NON-ZERO (not a vacuous pass).
- **AC2.4** The misconfiguration appears in BOTH the end-of-run summary text and
  the merged machine-readable run report, distinguishable from a normal grading
  failure verdict.

### AC3 — Role-aware behavior (deterministic, no real credentials)

- **AC3.1** A run whose JUDGE is misconfigured aborts up front with a clear,
  single message and exits non-zero; no graded matrix is produced. Driven
  deterministically by a provider that can be made misconfigured.
- **AC3.2** A run whose IMPROVER is misconfigured runs the test agents + judge
  with no improvement step (degraded to test-only), surfaces the degrade, and
  exits per the test/judge matrix — e.g. exits zero if that matrix all-passes.
- **AC3.3** A run whose TEST agent is misconfigured behaves per AC2.

### AC4 — Single seam / extensibility (structural)

- **AC4.1** All decision points consult one policy seam; there is no
  policy-specific branching scattered across the runtime. The "fail" and "skip"
  cases are expressible as additions at the seam without touching the decision
  points. (Reviewable in the diff.)

### AC5 — e2e harness verification

- **AC5.1** Running `npx skillsmith counter` in `testing-project` with NO OpenAI
  credentials (so `openai-api-nano` is misconfigured):
  - runs the counter e2e for the configured (`claude-code`) agent only; the
    Playwright report (`${iterationDir}/tests-report.json`) contains results keyed
    by `projectName` for the configured (`haiku`) agent and NONE for
    `openai-api-nano`;
  - builds no plugin for `openai-api-nano` and creates no Playwright project for
    it;
  - does NOT fail spuriously on `openai-api-nano` (the merged
    `${runDirectory}/report.json` carries no "e2e failed" failure attributed to
    `openai-api-nano`);
  - the overall run exits NON-ZERO, with `openai-api-nano` surfaced in the merged
    `${runDirectory}/report.json` as misconfigured/excluded — machine-distinguishable
    from an e2e failure (mirroring AC2.4).
- **AC5.2** The same run WITH OpenAI credentials present creates the
  `openai-api-nano` Playwright project and includes it in the e2e set. The
  exclusion is conditioned on actual misconfiguration, not hard-coded.

### AC6 — Constraints (reviewable)

- **AC6.1** The policy logic is isolated; existing internal signatures are
  unchanged except where strictly necessary (reviewable in the diff).
- **AC6.2** No process vocabulary (phase / specification / design-document /
  plan / acceptance-criteria / task tags) appears in any produced code, comment,
  test, or documentation (grep-checkable).
- **AC6.3** Comments are sparse and only on non-obvious code; unchanged code's
  comments are untouched.

## Open items (to settle during design)

These are deliberately unresolved here — they concern HOW, not WHAT, and must be
settled by the design phase consistently with the requirements above. Each is a
genuinely open choice grounded in the current code; none is settled here.

1. **How "an agent was excluded" reaches the single exit-code chokepoint
   (behind R3.3/R3.4).** The exit code is decided only in `prepareSummary` from
   the merged `report.json`, and today no signal that an agent was *excluded*
   ever reaches it (only the rows that actually appear are scored). Forcing a
   partial run non-zero therefore requires new state threaded to that chokepoint.
   The design must choose the mechanism — e.g. exclude from execution but still
   emit a non-PASS marker/row for the agent so the existing "non-pass ⇒ exit 1"
   machinery fires (which also auto-preserves R3.4), vs. a new top-level
   "excluded agents" field that forces a non-zero exit and handles the
   all-excluded case explicitly. Either is acceptable if it satisfies R3.3/R3.4.
2. **How the misconfiguration/exclusion outcome is surfaced (behind R3.2).**
   The status vocabulary is a fixed enum (`PASS`/`FAIL`/`SKIPPED`). The design
   must choose whether to add a new status/verdict kind (e.g. `excluded` /
   `misconfigured`) or reuse the existing `SKIPPED` kind — provided the outcome
   stays distinguishable from a normal grading failure and from an unrelated
   skip.
3. **How the provider→credential requirement is expressed, and whether `codex`
   opts in (behind R1.2/R1.3/R5).** Today the provider contract is only
   `{ id, invoke }` with the provider→env mapping hardcoded as string literals
   inside each `invoke`. The design must choose how to make that mapping
   statically inspectable — extend the `Provider` contract with a capability vs.
   a separate provider→env mapping — and must decide whether `codex` (which reads
   the same `OPENAI_API_KEY` but does not pre-check it) opts into the
   `OPENAI_API_KEY` check or stays "not statically misconfigurable".
4. **How the judge stop aborts the run (behind R4.1).** The idiomatic up-front
   hard stop throws an abort that `run()` catches to print a message and return
   non-zero, but the existing `UserFacingError` type is internal-only (not a
   public export). The design must choose whether to export `UserFacingError` or
   reuse an existing precondition/abort path for the judge stop.
5. **The precise public-API surface/signature of the R5 runnability export.**
   Constrained only by "named export from the public entry point, pure and
   synchronous over config input plus environment"; what it takes and returns is
   the design's choice.
6. **The exact nano model id string for the `openai-api-nano` agent.** Free-form
   and never reached when `OPENAI_API_KEY` is unset (the credential gate
   short-circuits first); the design picks a plausible id.

## Out of Scope

- Implementing the **"fail"** policy (stop the whole run up front when any agent
  is misconfigured). The seam must make it a localized future addition.
- Implementing the **"skip"** policy (proceed and exit zero — the prior silent
  behavior, but opt-in). Same — a localized future addition. Note: any future
  "skip" that EXCLUDES agents from the matrix entirely must explicitly
  re-establish the all-excluded guard of R3.4, which "warn" preserves implicitly.
- Changing exit-code semantics for the improver-degrade or judge cases beyond
  what R4 states.
- Adding misconfiguration detection for providers that have no
  environment-readable credential gate (`claude-code`, `mock`, and `codex` unless
  the design opts `codex` into the `OPENAI_API_KEY` check per Open item 3); they
  remain runnable from the static view.
