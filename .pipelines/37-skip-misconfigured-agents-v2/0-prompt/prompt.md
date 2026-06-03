# Skip misconfigured agents across all phases of a run

Tracks GitHub issue [Automattic/skillsmith#37](https://github.com/Automattic/skillsmith/issues/37).

## Goal

When the runtime encounters an agent it cannot run because it is misconfigured
(for example, missing or invalid provider credentials), the run must handle it
gracefully under a default **"warn"** policy instead of either failing opaquely
or passing silently:

- The run proceeds with the agents that **can** run; the misconfigured agent is
  excluded from execution.
- The misconfiguration is surfaced clearly in the run output.
- The run's exit status is **non-zero**, so CI gates catch that fewer agents ran
  than were declared. A partial run must not look green.

The non-zero exit status is the central requirement: a prior attempt skipped
misconfigured agents **silently and exited zero**, so a partial run looked
successful. That behavior must not return as the default.

## Role-aware handling

The "warn" policy above governs **test agents**. Handling differs by role, and
the following role-aware behavior is required:

- A misconfigured **judge** stops the run — it cannot grade anything.
- A misconfigured **improver** degrades the run to test-only.
- A misconfigured **test agent** follows the "warn" policy above.

The existing guard for the degenerate "all test agents are misconfigured" case
must be preserved — that case must not become a vacuous pass.

## Extensibility: design now, implement later

Implement **only** the "warn" policy. Design the API so that two further
policies can be added later with a localized change rather than a rewrite:

- **"fail"** — stop the whole run up front when any agent is misconfigured.
- **"skip"** — proceed and exit zero (the prior silent behavior, but opt-in).

Route the decision through a **single policy seam** consumed at the decision
points; do not scatter policy-specific branching across the codebase. Do **not**
implement "fail" or "skip" now — just leave a clean seam for them.

## The end-to-end harness must consume the API

The end-to-end harness must not run e2e tests for misconfigured agents. Today,
`testing-project/playwright.config.ts` creates one Playwright project per
configured agent regardless of misconfiguration, so a skipped agent's e2e suite
runs against a plugin that was never built and fails spuriously.

Update `testing-project/skillsmith.config.ts` (and its e2e hook / Playwright
setup as needed) so the e2e set excludes misconfigured agents via the new API.

**Verification:** running `npx skillsmith counter` in `testing-project` with no
OpenAI credentials (so `openai-api-nano` is misconfigured) must run e2e only for
the configured agent and must not fail on the skipped one.

## Constraints

These apply to all produced code, tests, and documentation:

- **Independent components, isolation:** keep the policy logic a self-contained
  component; do not entangle it with unrelated pipeline code.
- **Minimal change:** keep internal APIs unchanged wherever possible; make the
  minimal change needed. Do not refactor or alter existing internal signatures
  unless necessary.
- **Comment sparingly:** comment only what is not obvious from the code itself —
  not internal APIs and not self-explanatory code. Never modify comments on code
  that has not changed.
- **No process vocabulary in deliverables:** do not mention or reference internal
  process artifacts (phase names, specifications, design documents, plans,
  acceptance criteria, task identifiers, or similar tags) anywhere in code,
  comments, tests, or documentation.
