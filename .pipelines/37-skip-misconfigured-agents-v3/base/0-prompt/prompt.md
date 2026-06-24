# Skip misconfigured agents across all phases of a run

Tracks GitHub issue [Automattic/skillsmith#37](https://github.com/Automattic/skillsmith/issues/37).

## Goal

When `skillsmith` runs with an agent it cannot run because it is **misconfigured**
— a defect knowable independently of the agent's output, such as a missing or
invalid credential, an unknown provider, a non-existent model, or a missing local
tool — that agent is **removed from the run as if it had never been configured**,
while the fact that it was removed is **recorded loudly** so the run is never
mistaken for a clean one.

Concretely, a misconfigured agent splits into two layers that must both hold:

- **In the work, it's gone.** It runs no phase (test, judge, improve), is absent
  from pass/fail accounting, is not re-selected in later iterations, and triggers
  no per-agent provisioning. For everything that *executes*, the run behaves
  exactly as if that agent were not in the configuration.
- **In the outcome, it's present.** Every skipped agent is announced in the
  human-readable CLI output **once per run, with its id and the reason**, visually
  distinct from an agent that genuinely ran and failed; it appears in the
  machine-readable report the same way; and the run **exits non-zero** so a
  partial run never looks green.

These two outcomes are **co-equal** — neither may be sacrificed for the other. (A
prior attempt over-rotated on the exit code and let the human-readable surfacing
decay into a generic, anonymous "skipped" marker. That regression must not return:
a skipped agent's id and reason must reach the person reading the CLI.)

Roles differ:

- A misconfigured **test agent** is skipped per the above (the default **"warn"**
  behavior).
- A misconfigured **judge** stops the run — nothing can be graded.
- A misconfigured **improver** lets the current iteration finish, then halts the
  loop (no further iterations); the test/judge results still stand.

The existing guard for the degenerate "all test agents are misconfigured" case
must be preserved — it must never become a vacuous pass.

## Directions to explore

Recorded as the owner's intent, to be confirmed and made precise in later phases:

- **Catch it early, purge if late.** Detect misconfiguration as early as it is
  cheaply knowable — ideally at setup, before any phase runs (missing credential,
  unknown provider, missing model/tool are checkable up front). A defect only
  knowable once the agent is invoked (e.g. a present-but-invalid key) is caught at
  that point, and the agent's lane is then removed retroactively, so the final
  result still reads as if it were never configured.
- **Distinguish "couldn't run" from "ran and failed" in the exit status**, so an
  autonomous/CI consumer can tell a configuration/environment problem apart from a
  genuine skill failure (e.g. distinct non-zero codes). The exact codes are open.
- **Hooks and the e2e harness must not act on skipped agents** — the end-to-end
  harness must not build plugins for or run Playwright projects against a skipped
  agent (today it spuriously runs against a plugin that was never built). The
  mechanism by which hooks/e2e learn the skipped set is open for design.
- **Design the decision as a single policy seam.** Implement only the "warn"
  behavior now, but route the "what to do about a misconfigured agent" decision
  through one seam so two further policies can be added later by a localized
  change, not a rewrite: **"fail"** (stop the whole run up front when any agent is
  misconfigured) and **"skip"** (proceed and exit zero — the opt-in escape hatch
  for when an absence is intentional). Do not implement "fail" or "skip" now.
- **Keep transient failures out of scope.** Rate limits, 5xx, network blips,
  context-length, content-filter, and step-cap exhaustion are ordinary test
  failures, not misconfiguration — they stay in the matrix and must not remove a
  lane.

## Constraints

These apply to all produced code, tests, and documentation:

- **The run must never silently look green when an agent it declared could not
  run** — surfaced (id + reason) *and* non-zero exit.
- **Per-agent errors stay in their lane.** An error invoking one agent (including
  a missing tool throwing at spawn time) must be contained to that agent and must
  never crash the whole run.
- **Keep the live CLI intact.** The interface re-renders in place as the run
  updates; skip surfacing must preserve that layout, not break the text
  positioning.
- **Independent component, isolated.** Keep the policy logic self-contained; do
  not entangle it with unrelated runtime code.
- **Minimal change.** Keep existing internal APIs/signatures unchanged wherever
  possible; make only the change needed; no gratuitous refactors.
- **Comment sparingly.** Only what is not obvious from the code; never modify
  comments on code that did not change.
- **No process vocabulary in deliverables.** No phase names, spec/design/plan
  references, acceptance-criteria or task identifiers anywhere in code, comments,
  tests, or documentation.

## Context

This supersedes an earlier attempt on the same issue whose code was clean but
whose requirements had narrowed: a phase-0 rewrite re-centered the feature on the
exit code and collapsed "announce each skipped agent with its id and reason,
distinct from a real failure" into a single vague "surfaced in the output" line,
which the implementation satisfied with a generic skipped row. This version keeps
the exit-code guarantee **and** restores the human-readable surfacing as a
co-equal outcome.
