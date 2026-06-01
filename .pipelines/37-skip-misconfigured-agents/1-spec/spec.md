# Spec: Skip misconfigured agents across all phases of a run

Tracking issue: https://github.com/Automattic/skillsmith/issues/37

## Overview

`skillsmith` runs a project's evaluation by reading agents defined in
`skillsmith.config.ts` and assigning them to roles: a list of **testing**
agents that generate code, a single **judge** agent that grades each result,
and a single **improver** agent that edits skills between iterations
(self-improvement mode only). A run sweeps every (scenario, testing-agent)
pair, grades each pair, and may repeat over several iterations, re-selecting
failures to retry.

Today, when an agent is *misconfigured* — it has a defect in its own
configuration or credentials that will fail the same way on every attempt
(for example a missing or invalid API token, or a provider that does not
exist) — `skillsmith` does not handle it cleanly:

- A misconfigured testing agent is still dispatched; it returns an error, its
  paired judge is skipped, and a failed/errored row is written. This repeats
  for **every scenario and every iteration**, producing many identical failure
  rows.
- The defective agent's failures are fed back into re-selection, so it is
  re-run every iteration instead of being excluded — directly contradicting
  the intended behaviour that a misconfigured agent is "excluded from
  evaluation in subsequent iterations."
- A misconfigured agent's rows count as failures in the run's pass/fail math,
  so one bad agent can fail an otherwise-passing run.

This feature changes that handling so a misconfigured agent is **identified
once and ignored everywhere for the rest of that run**: it does no work in any
phase, is excluded from pass/fail accounting and from re-selection, is
announced once with its reason, and is exposed to hooks so per-agent
provisioning is not wasted on it. A run with no misconfigured agents must be
unchanged from today.

The single-instance roles (judge, improver) cannot be "skipped everywhere" in
the same sense as one tester among many, so they receive role-appropriate
consequences. Several behaviour forks that the prior phase deliberately left
open are recorded under **Open Decisions (deferred to design)** below; they
must not be silently resolved here.

## Requirements

### R1 — Definition of "misconfigured"

An agent is **misconfigured** when it has an agent-local configuration or
credential defect that would fail identically on every attempt, regardless of
which scenario or iteration is running.

In scope (treated as misconfiguration):
- A required API credential is **absent** (deterministically detectable before
  any call, for env-var-based providers).
- A credential is **present but invalid / revoked / unauthorized**
  (manifests as an authorization failure on the first real call).
- (Subject to **Open Decision 1**) an **unknown provider id**.
- (Subject to **Open Decision 2**) a **nonexistent model** ("model not found").

Explicitly NOT misconfiguration (these remain ordinary test failures and stay
in the matrix as failures, not skips):
- Transient / operational errors: rate limiting, server errors (5xx), network
  timeouts, context-length-exceeded, content-filter rejections, and step-cap
  (maximum-steps) exhaustion.

The discriminator is *agent-local and deterministic across attempts* vs
*transient or attempt-specific*.

### R2 — A misconfigured agent does no work in any phase

Once an agent is determined to be misconfigured, for the remainder of that run:
- As a **testing** agent it generates no code — its testing phase does not
  execute (or produces no counted result).
- The **judge** review paired with that testing agent does not run.
- It is **excluded from evaluation in every subsequent iteration**, including
  re-selection of failed pairs / failed scenarios and any final full pass.

This must fix the confirmed bug where a defective agent is re-selected and
re-fails on every iteration.

### R3 — Detection timing

Misconfiguration must be detected in both of these ways:
- **Pre-flight**, wherever it is deterministically knowable without making a
  call (e.g. a required credential is absent), so the agent can be excluded
  before any phase runs.
- **At runtime**, on the first invocation that fails with a
  misconfiguration-class error; from that point the agent is treated as
  misconfigured for the rest of the run and does no further work.

(The exact breadth of the runtime classifier is **Open Decision 2**.)

When misconfiguration is discovered at runtime, an agent may already have
produced results earlier in the same run (e.g. a tester that PASSed an earlier
scenario before failing with an auth error on a later one). Whether those
already-recorded results are **purged** from pass/fail accounting (retroactive
exclusion) or **kept** (forward-only — only subsequent work is skipped) is
**Open Decision 7**. Regardless of which is chosen, the following invariant
holds: no result produced *by a misconfigured agent on or after the invocation
that triggered detection* is ever counted, and no further work is dispatched
for that agent (see R2). The accounting-scope invariant in R4 below is stated
so that it holds under either resolution of Open Decision 7.

### R4 — Pass/fail accounting excludes misconfigured agents

A misconfigured agent must NOT count as a failure anywhere in the run's
pass/fail computation. The firm, resolution-independent invariant is:

- The act of being misconfigured (a skipped testing phase, a skipped paired
  judge review, or any invocation that failed with a misconfiguration-class
  error) is **never** counted as a failure in any scenario's or the run's
  pass/fail math. Today such a cell counts as a failure; that accounting must
  change.
- For any (scenario, iteration) in which a misconfigured agent does no counted
  work, that agent contributes **neither** to the numerator **nor** to the
  denominator of that scenario's pass/fail computation.

The run's pass/fail is therefore computed over the surviving, well-configured
results only. This change is required regardless of how a skipped agent is
surfaced.

The one case where the two readings of Open Decision 7 differ is a result the
agent *successfully recorded before* runtime detection (e.g. an earlier PASS).
Under retroactive exclusion that earlier result is purged from accounting too;
under forward-only it remains counted. Either way the invariant above holds —
the misconfiguration itself is never a failure, and the agent is absent from
the denominator of every scenario where it did no counted work. (Whether a
skipped agent is wholly absent from the matrix or present-but-marked is **Open
Decision 4**; either way, the verdict math excludes the misconfiguration as a
failure.)

### R5 — Degenerate case: empty surviving tester set

R4 removes misconfigured testers from a scenario's denominator. This can leave
a scenario, or the whole run, with **no surviving testers** — an empty
denominator. Two distinct scopes exist and must both be covered:

- **R5a — Per-scenario empty set.** A single scenario whose entire tester
  denominator is excluded (its only testers are all misconfigured) while other
  scenarios still have surviving testers.
- **R5b — Whole-run empty set.** Every testing agent in the run is
  misconfigured, so no scenario has any surviving tester.

In **both** scopes the firm, resolution-independent invariant is: an
empty-denominator scope must reach a **clearly-defined, explicit, surfaced
outcome** — it must NOT silently report a "pass" over an empty set, and must
NOT be reported as an ordinary failure indistinguishable from a real
test failure. The empty set is a consequence of misconfiguration and must be
surfaced as such.

What that explicit outcome is — and at which *granularity* it applies — is
**Open Decision 3**, which now covers two coupled choices: (i) the outcome
*type* (abort / inconclusive / fail), and (ii) the *granularity* for the
per-scenario case (R5a): does a single all-misconfigured scenario abort the
whole run, or mark just that scenario (e.g. inconclusive) while other scenarios
proceed and roll up normally? The firm requirement, holding regardless, is that
neither R5a nor R5b produces a silent empty-set pass and that the
empty-set condition is explicitly communicated with the misconfigured agent
ids and reasons.

### R6 — Single-instance roles (judge, improver)

Because the judge and improver are each a single agent, "skip everywhere" does
not transfer directly:
- A misconfigured **judge** means the run cannot grade any result, so the run
  must terminate in a clear, defined way that names the judge agent and the
  reason. (The exact consequence — recommended fail-fast/abort, ideally
  pre-flight before any tester runs — is **Open Decision 6**.)
- A misconfigured **improver** (self-improvement mode only) still allows a
  valid test/judge matrix to be produced, so the run must degrade gracefully
  rather than fail. (The exact consequence — recommended: behave as test-only,
  run the sweep, attempt no edits, and do not spin redundant identical
  iterations — is **Open Decision 6**.)

Detection is **per agent id**. An agent id may fill multiple roles
(a supported and exercised configuration); it is detected misconfigured once,
and the role-appropriate consequence applies at every place it is referenced.

### R7 — Hooks are informed (explicit prompt constraint)

Hooks must be able to learn which agents are misconfigured/skipped, expressed
**by agent id** along with the role(s) each fills.

- Pre-flight-known skips must be visible from the earliest run-scoped hook
  (`beforeAll`) onward, so that per-agent provisioning hooks (e.g. a
  `beforeTestAgent` infrastructure-scaffolding hook) do not set up state for an
  agent that will not run.
- Runtime-discovered skips must be visible to end-of-run / reporting hooks
  (e.g. `afterAll`).

This is provided as **passive data on the existing hook context** (keyed by
agent id), not as a new mandatory callback hooks must implement.

(Whether the exposed set is static-only — a frozen pre-flight roster — or
progressively accumulating as agents are discovered bad, is **Open Decision
5**.)

### R8 — CLI surfacing

- Existing failure surfacing must be **preserved**: a well-configured agent
  that genuinely fails its tests is still reported as a failure.
- Each misconfigured/skipped agent must be announced **once per run** with its
  id and the reason it was skipped — replacing today's repeated identical
  per-scenario / per-iteration failure rows.
- A misconfigured agent must be **visually distinguishable** from a
  well-configured agent that genuinely failed its tests.

### R9 — Backward compatibility

A run in which no agent is misconfigured must behave **exactly as today**: same
matrix, same verdict, same hook firing, same CLI output. The new behaviour
only changes the handling of defective agents.

## Open Decisions (deferred to design)

These are genuine behaviour (WHAT) forks that the requirements deliberately did
NOT resolve. Design must choose, with maintainer input. They are recorded here
so they are not lost and so that none of the requirements above is read as
having silently settled them.

1. **Unknown provider: abort vs skip.** Today an unknown `provider` id is a
   hard precondition error that aborts the whole run. The issue lists "a
   provider that doesn't exist" as a misconfiguration example. Decision: flip
   it to a per-agent skip (honoring "ignored everywhere"), or keep fail-fast
   for structurally-invalid config (a typo'd provider id is an author error)
   and apply skipping only to credential problems? This determines whether
   unknown-provider falls under R1's in-scope set.

2. **Classifier breadth: full vs minimal.** Full = inspect structured error
   detail (HTTP status / error type) so invalid-token-on-call (401/403) and
   nonexistent-model (404) are classified as skips. Minimal = treat only the
   deterministic missing-credential case (plus unknown-provider, pending
   Decision 1) as a skip and leave everything else — including a 401 on a
   live call — as an ordinary failure. Minimal is smaller and safer but does
   not fully cover the prompt's explicit "invalid API token" example. This
   determines the runtime branch of R3 and which entries of R1 are honored.

3. **Empty surviving-tester-set outcome and granularity.** The explicit
   outcome required by R5 has two coupled choices. (i) The outcome *type* —
   abort, inconclusive, or fail. (ii) The *granularity* for the per-scenario
   case (R5a): does one all-misconfigured scenario abort the whole run, or mark
   only that scenario (e.g. inconclusive) while sibling scenarios proceed and
   roll up normally? Today an empty tester list makes a scenario fail and an
   all-empty run fail; both readings change that. R5's no-silent-pass invariant
   holds regardless of either choice.

4. **Tester skip surface representation.** True-absence (no row, no workspace
   for the agent) vs present-but-marked (`skipped: misconfigured`). R4's
   pass-math exclusion holds either way; this picks the observable matrix
   shape.

5. **Hooks contract temporal scope.** Static-only (a frozen pre-flight set
   exposed at `beforeAll`) vs progressive (an accumulating set that later hooks
   such as `afterAll` see grow as agents are discovered bad). R7 requires
   pre-flight skips at `beforeAll` and runtime skips by `afterAll`; this picks
   whether one field grows or two scopes are distinguished.

6. **Judge / improver consequence.** The exact handling required by R6 —
   recommended: misconfigured judge → fail-fast/abort; misconfigured improver →
   degrade to test-only — is the design's choice to confirm with the
   maintainer.

7. **Runtime-detected exclusion: retroactive vs forward-only.** When an agent
   is discovered misconfigured at runtime *after* it already recorded a result
   (e.g. PASSed an earlier scenario), are those earlier results purged from
   pass/fail accounting (retroactive) or kept while only future work is skipped
   (forward-only)? R2/R3 stop all *future* work either way; R4's failure-never-
   counted and empty-denominator invariants hold either way. This decision only
   governs the treatment of results successfully recorded before detection. The
   prompt's flagship "invalid API token" example most often surfaces on a live
   call that may be the second or third scenario, so this is a realistic path
   and its resolution changes the verdict for affected runs.

## Out of Scope

- Retrying or repairing a misconfigured agent (no auto-fixing of credentials).
- Distinguishing degrees of transient failure, or adding any retry/backoff
  policy.
- Adding new providers or changing any provider's authentication mechanism.
- The exact API shape of the hooks field, the classifier implementation, and
  the surface representation of skipped rows — these are design-phase concerns,
  framed by the Open Decisions above.

## Acceptance Criteria

Given-When-Then scenarios that drive tests. Where an outcome depends on an Open
Decision, the criterion is written to assert the *invariant that holds
regardless of which option is chosen*, and notes the decision it defers to.

### AC1 — One misconfigured tester among several does not derail the run
- **Given** a run with N testing agents where exactly one has a missing
  credential (deterministically detected pre-flight, before any phase work) and
  the remaining N-1 are well-configured,
- **When** the run executes,
- **Then** the run completes; the pass/fail accounting for every scenario and
  for the run includes only the N-1 well-configured agents; the misconfigured
  agent appears in no scenario's pass/fail numerator or denominator; and the
  run's pass/fail *result* (the overall PASS/FAIL verdict and each scenario's
  pass math) is identical to a run configured with only the N-1
  well-configured agents.
- *Note:* this AC constrains the verdict **math** (which R4 fixes regardless of
  surface). It does NOT constrain the matrix shape or CLI artifact: under the
  present-but-marked-skipped option the artifact has an extra visibly-distinct
  skipped row (R8/AC4 require it), so it is not literally "as if only N-1 were
  configured." Whether the skipped agent is wholly absent or present-but-marked
  is **Open Decision 4**. This AC is scoped to the missing-credential
  (pre-flight) case so total absence holds unconditionally; the runtime-detected
  invalid-credential path — where an agent may have recorded an earlier PASS
  before detection — is covered by AC7/AC7b, whose accounting depends on **Open
  Decision 7**.

### AC2 — Misconfigured tester is excluded from re-selection
- **Given** the run from AC1 with more than one iteration,
- **When** a subsequent iteration re-selects work (failed pairs / failed
  scenarios) and runs any final full pass,
- **Then** the misconfigured agent is not re-selected and is not dispatched in
  any subsequent iteration.

### AC3 — Misconfigured agent is announced once, not repeatedly
- **Given** the run from AC1 spanning multiple scenarios and iterations,
- **When** the run completes,
- **Then** the misconfigured agent is announced in the CLI exactly once for the
  whole run, with its agent id and the reason it was skipped, and is not
  reported as one failure row per (scenario, iteration).

### AC4 — A misconfigured agent is visually distinct from a real test failure
- **Given** a run with one misconfigured agent and one well-configured agent
  that genuinely fails its tests,
- **When** the run completes,
- **Then** the misconfigured agent's CLI presentation is distinguishable from
  the genuinely-failing agent's; the genuinely-failing agent is still reported
  as a failure and still counts in pass/fail accounting; and the misconfigured
  agent does neither.

### AC5 — Transient errors are NOT treated as misconfiguration
- **Given** a well-configured testing agent whose invocation fails with a
  transient/operational error (rate limit, 5xx, network timeout,
  context-length-exceeded, content filter, or step-cap exhaustion),
- **When** the run executes,
- **Then** that agent produces an ordinary test failure recorded in the matrix
  and counted in pass/fail accounting; it is not skipped, not excluded from
  accounting, and not announced as misconfigured.

### AC6 — Pre-flight detection prevents any phase work for the agent
- **Given** a testing agent whose required credential is absent
  (deterministically detectable before any call),
- **When** the run executes,
- **Then** the agent's testing phase does not execute, no judge review runs for
  its pairs, and no per-agent provisioning runs for it (its
  pre-flight-misconfigured status is known before phase work begins).

### AC7 — Runtime detection skips the agent for the remainder of the run
- **Given** a testing agent whose credential is present but invalid, so the
  first real invocation fails with a misconfiguration-class authorization
  error,
- **When** the run continues across remaining scenarios and iterations,
- **Then** after that first failure the agent is treated as misconfigured and
  does no further work in any phase; the triggering failure is not counted as a
  test failure; the agent contributes to no numerator or denominator for any
  scenario where it did no counted work; and it is not re-selected.
- *Note:* whether an invalid-token-on-call is classified as misconfiguration at
  all depends on **Open Decision 2** (full vs minimal classifier). If design
  chooses the minimal classifier, this case instead behaves per AC5 (ordinary
  failure); the test for this AC must be written against the resolved decision.

### AC7b — Results recorded before runtime detection are handled per the decision
- **Given** a testing agent that PASSes scenario A and then, on scenario B,
  fails with a misconfiguration-class error and is declared misconfigured,
- **When** the run completes,
- **Then** scenario A's earlier PASS is accounted for consistently with the
  resolution of **Open Decision 7**: under retroactive exclusion the agent
  contributes to neither A's nor B's accounting; under forward-only the agent's
  A PASS still counts while its B work and all later work are excluded. In
  either case the misconfiguration on scenario B is never counted as a test
  failure, and the agent does no further work after detection.
- *Note:* retroactive vs forward-only is **Open Decision 7**; the test asserts
  the invariant common to both (the triggering failure and all later work are
  never counted; no silent failure for the misconfiguration), refined to the
  exact accounting once the decision is made.

### AC8 — Hooks can read the misconfigured set, keyed by agent id
- **Given** a run with at least one pre-flight-misconfigured agent and a hook
  that reads run context,
- **When** the hook runs,
- **Then** the hook can read the set of misconfigured/skipped agents keyed by
  agent id, including the role(s) each fills; the pre-flight-known skips are
  readable from `beforeAll` onward; runtime-discovered skips are readable by
  end-of-run hooks (e.g. `afterAll`); and no new mandatory callback is required
  of hooks that do not need this data.
- *Note:* whether the set is static/frozen or progressively accumulating is
  **Open Decision 5**.

### AC9 — Per-agent provisioning is not wasted on a skipped agent
- **Given** a `beforeTestAgent`-style per-agent provisioning hook and a
  pre-flight-misconfigured testing agent,
- **When** the run executes,
- **Then** the provisioning hook does not fire any setup for the misconfigured
  agent.

### AC10 — Same agent id in multiple roles is detected once
- **Given** an agent id referenced in more than one role (e.g. both tester and
  improver) that is misconfigured,
- **When** the run executes,
- **Then** the misconfiguration is detected once and the role-appropriate
  consequence applies at every reference (as a tester it is excluded per R2/R4;
  as an improver it degrades per R6), and the hooks-exposed entry for that id
  reflects all roles it fills.

### AC11a — A single all-misconfigured scenario reaches an explicit outcome
- **Given** a multi-scenario run in which one scenario's only testers are all
  misconfigured (empty surviving denominator for that scenario) while at least
  one other scenario has surviving well-configured testers,
- **When** the run executes,
- **Then** the empty-denominator scenario reaches a clearly-defined,
  explicitly-surfaced outcome — it does NOT silently report a pass over its
  empty agent set, and is not reported as an ordinary test failure
  indistinguishable from a real failure; the empty-set condition is surfaced
  with the misconfigured agent ids and reasons.
- *Note:* the specific outcome *type* (abort / inconclusive / fail) and the
  *granularity* — whether this aborts the whole run or marks only this scenario
  while siblings proceed — are **Open Decision 3**. The test asserts the
  no-silent-empty-pass invariant (R5a), refined once the decision is made.

### AC11b — A whole-run all-misconfigured set reaches an explicit outcome
- **Given** a run in which every testing agent is misconfigured (no scenario
  has any surviving tester),
- **When** the run executes,
- **Then** the run reaches a clearly-defined, explicitly-surfaced outcome and
  does not silently report a pass over an empty agent set; the misconfigured
  agent ids and reasons are surfaced.
- *Note:* the specific outcome (abort / inconclusive / fail) is **Open
  Decision 3**; the test asserts the no-silent-empty-pass invariant (R5b),
  refined once the decision is made.

### AC12 — Misconfigured judge terminates the run clearly
- **Given** a run whose judge agent is misconfigured,
- **When** the run executes,
- **Then** the run terminates in a clear, defined way that names the judge
  agent and the reason, rather than producing repeated per-pair failures or a
  partial matrix.
- *Note:* exact consequence (recommended fail-fast/abort, ideally pre-flight)
  is **Open Decision 6**.

### AC13 — Misconfigured improver degrades gracefully
- **Given** a self-improvement-mode run whose improver agent is misconfigured,
- **When** the run executes,
- **Then** the run still produces a valid test/judge matrix, attempts no skill
  edits, and does not spin redundant identical iterations; it does not fail
  solely because the improver is misconfigured.
- *Note:* exact consequence is **Open Decision 6**.

### AC14 — Zero misconfigured agents is unchanged from today
- **Given** a run in which no agent is misconfigured,
- **When** the run executes,
- **Then** the matrix, the verdict, the set and order of hook firings, and the
  CLI output are identical to current behaviour.
