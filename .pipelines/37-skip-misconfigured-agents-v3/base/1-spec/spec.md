# Spec: Skip misconfigured agents across all phases of a run

## Overview

`skillsmith` evaluates skills by running agents declared in `skillsmith.config.ts`
under three roles: a list of **test** agents that generate code, a single **judge**
that grades each result, and a single **improver** that edits skills between
iterations (self-improvement mode). A run sweeps every (scenario, test-agent) pair,
grades each, and may repeat over several iterations, re-selecting failures.

An agent is **misconfigured** when it cannot run for a reason knowable
independently of its output and identical on every attempt this run —
paradigmatically, a required provider credential is absent from the environment.
Today such an agent is invoked anyway, its call returns an error, and that error is
conflated with a graded failure: it burns compute, scaffolds a workspace for an
agent that can produce nothing, repeats once per scenario and iteration, and (in
the end-to-end harness) runs Playwright against a plugin that was never built —
producing spurious failures. There is no role-aware handling and no way to tell
"this agent could not run" from "this skill failed."

This feature makes a misconfigured agent **vanish from everything that executes**
while being **recorded loudly in the outcome**, so a partial run is never mistaken
for a clean one. Concretely, two layers both hold:

- **In the work, it's gone.** The agent runs no phase, is absent from pass/fail
  accounting, is not re-selected in later iterations, and triggers no per-agent
  provisioning. For everything that executes, the run behaves as if the agent were
  not in the configuration.
- **In the outcome, it's present.** Every skipped agent is announced once in the
  CLI with its id and reason, visually distinct from an agent that genuinely ran
  and failed; it appears the same way in the machine-readable run report; and the
  run exits non-zero so the result never looks green.

These two outcomes are co-equal. Handling is role-aware, the policy decision is
routed through a single seam (only the default "warn" behavior is built now), and
the end-to-end harness consumes the result so it no longer tests skipped agents.

### Definitions

- **Misconfigured** — an agent cannot run for an agent-local reason knowable
  without grading its output and identical on every call this run (e.g. a required
  provider credential is absent). This is the condition the feature acts on.
- **Failed** — an agent *ran* and produced an error or non-passing result. Distinct
  from misconfigured; unchanged by this feature.
- **Runnable** — not misconfigured, from the static view (configuration plus
  environment, with no model invocation).
- **Lane** — everything attributable to one agent across the whole run: its column
  of (scenario, iteration) cells, the judge reviews paired with it, and its use in
  any role it fills.
- **"Warn"** — the default (and only implemented) policy for a misconfigured test
  agent: remove its lane, surface it, force a non-zero exit.

The names above are descriptive for this document; they do not prescribe
identifiers, types, or code placement.

## Requirements

Each requirement states required behavior, not how to achieve it.

### R1 — What counts as misconfigured

- **R1.1** An agent is *misconfigured* when it cannot run for an agent-local reason
  knowable without grading its output and identical on every call this run.
- **R1.2** The following are explicitly **not** misconfiguration and remain ordinary
  test failures recorded in the matrix and counted in pass/fail: transient or
  operational errors (rate limiting, 5xx, network timeout) and input-specific
  errors (context-length-exceeded, content-filter refusal, max-steps/step-cap
  exhaustion).
- **R1.3** A **quota/billing-exhausted** condition is conceptually a
  configuration/environment problem (R5's exit-code class 2), but it is only
  detected as such when cheaply knowable; under the shipped classifier (R2) it
  otherwise falls through as an ordinary failure.

### R2 — Detection timing and shipped scope

- **R2.1** Misconfiguration is detected as early as it is cheaply knowable, ideally
  before any phase runs.
- **R2.2** The shipped (minimal) detection covers providers whose credential
  requirement is a plain environment read: `openai-api` → `OPENAI_API_KEY`,
  `anthropic-api` → `ANTHROPIC_API_KEY`, `gemini-api` →
  `GOOGLE_GENERATIVE_AI_API_KEY`. For these, misconfiguration MUST be determinable
  *before* the agent is invoked — purely from the agent's declared provider plus
  the environment, with no model call.
- **R2.3** Providers with no environment-readable credential gate (`claude-code`,
  `mock`, and `codex`) are treated as **not statically misconfigurable**: they are
  runnable from the static view, and any real defect continues to surface through
  the existing invoke-time error path as an ordinary failure. The solution MUST NOT
  assume every provider can be checked upfront.
- **R2.4** Deeper runtime error introspection — classifying a present-but-invalid
  key, a 404 model-not-found, or a quota error into a skip *after* invocation — is
  out of scope here (see Out of Scope) but MUST be addable later at the policy seam
  (R8) without reworking the accounting model.

### R3 — Dead lane for a misconfigured test agent (execution & accounting)

- **R3.1** A misconfigured test agent is excluded from **execution**: it is not
  invoked, and its per-agent pre-test provisioning (e.g. workspace scaffolding) does
  not fire. No compute and no workspace artifacts are produced for it.
- **R3.2** It is excluded from **pass/fail accounting**: for every scenario it
  contributes to neither the numerator nor the denominator. The run's verdict is
  computed over the surviving, runnable agents only.
- **R3.3** It is excluded from **re-selection**: it is never re-selected or
  dispatched in any subsequent iteration or final pass.
- **R3.4 (skipped-lane invariant)** A skipped lane contributes nothing, anywhere,
  ever — including any result it recorded before detection. Because the shipped
  detection (R2) is setup-time only, the lane never starts and this holds trivially;
  it is stated so that adding runtime detection (R2.4) later preserves the same
  accounting model rather than requiring a rewrite.

### R4 — Surfacing a skipped test agent (outcome)

- **R4.1** Each misconfigured/skipped agent is announced in the human-readable CLI
  output **once per run**, carrying its **agent id** and the **reason** it was
  skipped — replacing today's repeated identical per-scenario failure rows.
- **R4.2** The skip presentation is **visually distinct** from an agent that
  genuinely ran and failed, and distinct from an unrelated skip, so a reader can
  tell "could not run" from "ran and failed."
- **R4.3** The skip appears in the machine-readable run report
  (`${runDirectory}/report.json`) in a form that is likewise distinguishable from a
  grading failure, carrying the agent id and reason.
- **R4.4** Existing failure surfacing is preserved unchanged: a runnable agent that
  genuinely fails its tests is still reported and counted as a failure.

### R5 — Exit code

- **R5.1** The run's exit status MUST be **non-zero** whenever one or more declared
  agents could not run because they were misconfigured — even if every agent that
  did run passed.
- **R5.2** Exit codes are distinct by class so an autonomous/CI consumer can route
  on them: **`0`** every executed cell passed and no declared agent was skipped;
  **`1`** a surviving agent genuinely failed evaluation (and no configuration
  error); **`2`** a configuration error — one or more declared agents could not run.
- **R5.3** When a single run has both a configuration error and a genuine evaluation
  failure, the exit status is **`2`** (configuration error takes precedence); the
  report still carries both.
- **R5.4 (anti-regression)** Merely dropping a skipped agent's row from the report —
  so the remaining rows all pass and the run exits `0` — is FORBIDDEN. Excluding a
  misconfigured agent MUST thread a signal to the single exit-code chokepoint (the
  point that decides the code from the merged report) so the run does not exit `0`.
- **R5.5** The existing degenerate case — **all** declared test agents are
  misconfigured — MUST exit `2` and be surfaced; it must never become a vacuous pass
  over an empty matrix.

### R6 — Role-aware handling

- **R6.1 (test)** A misconfigured test agent follows R3–R5 (the "warn" behavior).
- **R6.2 (judge)** A misconfigured judge **stops the run**: it aborts with a clear,
  single message naming the judge agent and the reason, and exits `2`. No graded
  matrix and no run report are produced (this is the one case where "always emit a
  report" does not apply — there is nothing to grade). It SHOULD be detected up
  front, before test agents run, when the judge's provider is statically checkable.
- **R6.3 (improver)** A misconfigured improver lets the **current iteration finish**
  — the test agents and judge run and produce a complete, valid matrix — and then
  the loop **halts** with no further iterations and no skill edits attempted. The
  improver misconfiguration is surfaced (id + reason) and forces exit `2` (it is a
  configuration error, not a skill failure). The matrix and its verdict still stand.
- **R6.4 (multi-role)** Detection is per agent id. An agent id may fill more than
  one role; it is detected misconfigured once, and the **most-severe** consequence
  applies across the roles it fills — a misconfigured judge stops the run regardless
  of the agent's other roles.

### R7 — Unknown provider stays a hard abort

- **R7.1** An unknown or nonexistent provider id is a structural authoring error and
  remains a **hard precondition error that aborts the whole run** (unchanged from
  today), on any role. It is NOT treated as a per-agent skip. Only
  credential/environment defects (R1/R2) get the dead-lane treatment.

### R8 — Single policy seam (extensibility)

- **R8.1** The decision "what to do about a misconfigured agent" MUST route through
  ONE seam consumed at the decision points, not as policy-specific branches
  scattered across the runtime.
- **R8.2** Only the **"warn"** policy (R3–R6) is implemented and is the default. The
  seam MUST be shaped so that **"fail"** (abort the whole run up front when any agent
  is misconfigured) and **"skip"** (proceed and exit `0` — an opt-in for intentional
  absence) can each be added later by a localized change at the seam, not a rewrite.
  Neither "fail" nor "skip" is implemented now.

### R9 — Per-agent error containment

- **R9.1** Any error raised while invoking one agent — including a missing local
  tool that throws at spawn time — MUST be contained to that agent's lane (becoming
  that agent's outcome) and MUST NEVER crash the whole run.

### R10 — Hooks and the e2e harness learn the skipped set

- **R10.1** The runtime exposes the set of misconfigured/skipped agents — keyed by
  **agent id**, with the **role(s)** each fills and the **reason** — as passive data
  on the existing hook context (a *push*), not as a new mandatory callback. Setup-
  detected skips are readable from the earliest run-scoped hook (`beforeAll`) onward,
  so per-agent provisioning hooks do not set up state for an agent that will not run.
- **R10.2** The end-to-end harness MUST NOT build a plugin for, or create a
  Playwright project for, or run any e2e spec against, a misconfigured agent.
  Because the e2e harness launches Playwright as a separate child process, the
  surviving agent set is forwarded from the in-process e2e hook —
  `testing-project`'s `afterAllScenarios` body in `eval/utils/verify-e2e.ts` — to
  that child (e.g. as project selectors) so the child's project set excludes skipped
  agents. Today `testing-project/playwright.config.ts` derives its `projects` from
  `config.roles.test.agents` blind to runnability; that must no longer cause a
  skipped agent's e2e suite to run against a plugin that was never built.
- **R10.3** A pure, synchronous runnability determination over configuration plus
  environment (no async, no model call) MAY be exposed as a secondary convenience
  for a standalone Playwright invocation, but it is not the mechanism the in-run e2e
  path depends on (it cannot observe any future runtime-detected skip).
- **R10.4** A deterministically-misconfigurable test agent MUST exist in
  `testing-project` (e.g. an `openai-api`-backed agent that is misconfigured when
  `OPENAI_API_KEY` is unset) so the e2e exclusion is verifiable end to end.
- **R10.5** **Every in-tree consumer of the hooks contract** MUST be kept consistent
  with any change this feature makes to that contract — notably the skipped set
  added to the hook context (R10.1). A consumer is any code that reads the hook
  context or relies on which agents the runtime runs; none may be left reading a
  stale contract. In particular, `testing-project`'s hooks are the worked reference
  consumer and are **in-scope code to update, not merely a fixture**: the
  `afterAllScenarios` e2e verification MUST drive Playwright from the runnable set
  (R10.2), and no hook may provision or test an agent the runtime reported as
  skipped.

### R11 — Backward compatibility and CLI integrity

- **R11.1** A run in which no agent is misconfigured MUST behave exactly as today:
  identical matrix, verdict, set and order of hook firings, CLI output, and exit
  code. The new behavior only changes the handling of misconfigured agents.
- **R11.2** Skip surfacing MUST preserve the live CLI's in-place re-render and text
  positioning (the interface is reprinted as the run updates).

### R12 — Constraints on produced code, tests, and documentation

- **R12.1** The policy logic is a SELF-CONTAINED, isolated component, not entangled
  with unrelated runtime code.
- **R12.2** MINIMAL change: existing internal APIs/signatures are left unchanged
  wherever possible; only the change needed is made; no gratuitous refactors.
- **R12.3** Comment SPARINGLY — only what is not obvious from the code; never modify
  comments on code that did not change.
- **R12.4** NO internal-process vocabulary anywhere in produced code, comments,
  tests, or documentation — no phase names, spec/design/plan references,
  acceptance-criteria or task identifiers, or similar tags.

## Out of Scope

- Implementing the **"fail"** and **"skip"** policies (only "warn" ships; the seam
  makes them localized future additions).
- The **full runtime classifier**: deep error-body introspection to route a
  present-but-invalid key, a 404 model-not-found, or a quota error into a skip after
  invocation. (Such cases otherwise behave as ordinary failures — R1.2/R2.4.)
- Explicit **missing-tool detection**; a missing local tool is an ordinary failure
  guarded only by error containment (R9).
- Treating an **unknown/nonexistent provider id** as a per-agent skip; it stays a
  hard abort (R7).
- A **CLI argument to intentionally skip named agents** — a separate follow-up
  issue, and the natural future home for the "skip" policy's user surface.
- Retrying or repairing a misconfigured agent; adding providers or changing any
  provider's authentication mechanism.
- Any per-scenario "empty surviving-tester set" handling: test agents are global to
  the run, so the only empty-tester case is the whole-run one (R5.5).

## Acceptance Criteria

Given-When-Then scenarios that drive tests. Each must be exercisable without real
provider credentials (e.g. via a provider that can be made misconfigured on demand).

### AC1 — Pre-invoke detection of a missing credential
- **Given** a test agent with `provider: openai-api` and `OPENAI_API_KEY` unset,
- **When** runnability is determined,
- **Then** the agent is reported misconfigured/not-runnable WITHOUT any model
  invocation; with `OPENAI_API_KEY` set it is reported runnable. Analogous for
  `anthropic-api`/`ANTHROPIC_API_KEY` and `gemini-api`/`GOOGLE_GENERATIVE_AI_API_KEY`.
  An agent with `provider: claude-code` (or `mock`) is runnable regardless of
  environment.

### AC2 — One misconfigured test agent among several
- **Given** a run with two declared test agents — one misconfigured, the other
  runnable — across one or more scenarios,
- **When** the run executes,
- **Then** the runnable agent runs and is graded normally; the misconfigured agent
  is invoked in no scenario, appears in no scenario's pass/fail numerator or
  denominator, and the run's verdict math is identical to a run configured with only
  the runnable agent; AND the run exits `2`.

### AC3 — No work or provisioning for a skipped agent
- **Given** the misconfigured test agent of AC2 and a per-agent provisioning hook
  (`beforeTestAgent`-style),
- **When** the run executes,
- **Then** the agent produces no workspace/scaffold artifacts and the provisioning
  hook fires no setup for it.

### AC4 — Skip is announced once, with id + reason, distinct from a real failure
- **Given** a run with one misconfigured agent and one runnable agent that genuinely
  fails its tests, across multiple scenarios and iterations,
- **When** the run completes,
- **Then** the misconfigured agent is announced in the CLI exactly once for the
  whole run with its id and reason, presented visibly distinct from the
  genuinely-failing agent; the genuinely-failing agent is still reported and counted
  as a failure; and both appear, distinguishably, in `${runDirectory}/report.json`.

### AC5 — All test agents misconfigured is not a vacuous pass
- **Given** a run in which every declared test agent is misconfigured,
- **When** the run executes,
- **Then** it exits `2`, surfaces the misconfigured agent ids and reasons, and never
  reports a pass over the empty matrix.

### AC6 — Transient and input-specific errors are ordinary failures
- **Given** a runnable test agent whose invocation fails with a transient error
  (rate limit, 5xx, network timeout) or an input-specific error (context-length,
  content-filter, step-cap) — including a present-but-invalid credential under the
  shipped minimal classifier,
- **When** the run executes,
- **Then** that produces an ordinary test failure recorded and counted in the
  matrix; it is not skipped, not removed from accounting, and not announced as
  misconfigured.

### AC7 — Misconfigured judge stops the run
- **Given** a run whose judge agent is misconfigured,
- **When** the run executes,
- **Then** the run aborts up front with a clear single message naming the judge
  agent and the reason, exits `2`, and produces no graded matrix and no run report.

### AC8 — Misconfigured improver finishes the iteration, then halts
- **Given** a self-improvement-mode run whose improver is misconfigured and whose
  first iteration contains failures that would normally trigger another iteration,
- **When** the run executes,
- **Then** the first iteration completes and produces a valid test/judge matrix; no
  further iteration runs and no skill edit is attempted; the improver
  misconfiguration is surfaced with id + reason; and the run exits `2`.

### AC9 — Hooks can read the skipped set
- **Given** a run with at least one setup-misconfigured agent and a hook that reads
  run context,
- **When** the hook runs,
- **Then** it can read the set of skipped agents keyed by agent id, including the
  role(s) each fills and the reason; the setup-detected skips are readable from
  `beforeAll` onward; and no new mandatory callback is required of hooks that do not
  need this data.

### AC10 — e2e harness excludes a misconfigured agent
- **Given** `testing-project` with a deterministically-misconfigurable test agent
  (e.g. `openai-api`-backed) and `OPENAI_API_KEY` unset, running the counter e2e
  flow,
- **When** the run executes,
- **Then** no Playwright project is created and no plugin is built for the skipped
  agent, no e2e spec runs against it, and the merged report attributes no e2e
  failure to it; the configured runnable agent's e2e runs normally; and the overall
  run exits non-zero with the skipped agent surfaced as misconfigured. With
  `OPENAI_API_KEY` present, that agent's Playwright project IS created and included.
- **And** the e2e verification drives Playwright from the runnable set, so adding the
  skip does not require hand-editing `playwright.config.ts`'s project list.

### AC11 — Same agent id in multiple roles, most-severe wins
- **Given** a single agent id referenced in more than one role (e.g. judge and a
  test agent) that is misconfigured,
- **When** the run executes,
- **Then** the misconfiguration is detected once and the most-severe consequence
  applies — because the id is the judge, the run stops per AC7 regardless of its
  other roles.

### AC12 — Exit-code precedence
- **Given** a run with one misconfigured test agent and one runnable agent that
  genuinely fails evaluation,
- **When** the run completes,
- **Then** the run exits `2` (configuration error takes precedence over the
  evaluation failure), and the report carries both the skip and the failure.

### AC13 — No misconfigured agents is unchanged from today
- **Given** a run in which no agent is misconfigured,
- **When** the run executes,
- **Then** the matrix, verdict, the set and order of hook firings, the CLI output,
  and the exit code are identical to current behavior.
