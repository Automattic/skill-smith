# Spec: Fix the testing-project circular import (v3)

## Overview

The base run of pipeline `37-skip-misconfigured-agents-v3` shipped the
skip-misconfigured-agents feature but left a circular import inside
`testing-project`: `skillsmith.config.ts` imports `runE2eVerification` from
`eval/utils/verify-e2e.ts`, and `verify-e2e.ts` imports the default `config`
back from `skillsmith.config.ts` and dereferences it at module-initialization
time. When `skillsmith.config.ts` is the import entry point, `config` is still
`undefined` while `verify-e2e.ts`'s module body runs, so the eager read throws
`TypeError: Cannot read properties of undefined (reading 'roles')`. Today the
`config-smoke` guardrail (`npm --prefix testing-project run check:config`, which
imports `./skillsmith.config.ts` as its entry) exits 1 because of this.

This review run fixes the cycle so that loading `testing-project`'s config and
its full import graph initializes cleanly, while preserving every behavior the
base run's skip-misconfigured-agents feature already delivers. The fix stays
inside `testing-project`; it must not weaken the `config-smoke` guardrail or
change the public API of the `@automattic/skillsmith` package.

## Requirements

1. **The config import graph loads cleanly.**
   `npm --prefix testing-project run check:config` exits 0. Because that script
   imports `./skillsmith.config.ts` as its entry point — the exact entry that
   fails today — a green result demonstrates that the config import graph rooted
   at `skillsmith.config.ts` (reaching `scaffold-plugin.ts`, `verify-e2e.ts`,
   `project-args.ts`, and the config back-edge) initializes without throwing.

2. **The config's default export is structurally unchanged.**
   After the fix, importing `testing-project/skillsmith.config.ts` yields a
   default export whose `roles.test.agents` deep-equals `["haiku", "gpt"]`, with
   its `agents`, `roles`, `hooks`, `selfImprovement`, and `mode` otherwise
   unchanged from their authored values. A "fix" that lets the module load by
   gutting or blanking the config value does not satisfy this requirement.

3. **The module-initialization-time read of the imported `config` in the cycle
   is removed.** Today `verify-e2e.ts` reads `config.roles.test.agents` at module
   top level (the sole module-init-time read of `config` within the cycle, and
   the cause of the crash). After the fix, nothing in the config import graph
   reads the imported `config` at module-initialization time — this is the
   root-cause property whose *consequence*, a clean load, is what Requirement 1
   and the regression test (Requirement 5) observe. The absence of the eager read
   itself is not a runtime-observable event; it is verifiable by code inspection
   of the config import graph (`verify-e2e.ts` no longer reads
   `config.roles.test.agents`, or any property of the imported `config`, at module
   top level). How the configured project names are instead obtained at run time —
   e.g. read lazily when needed, or supplied as input — is left to the design
   phase.

4. **The skip-misconfigured-agents behavior is preserved (no regression).**
   - The runnable (post-skip-filter) set of agent ids continues to drive the e2e
     run: it is what determines which agents Playwright runs, and nothing else
     decides this.
   - For any given runnable set, the `--project` selectors forwarded to the
     Playwright child process are identical to today's behavior. The selectors
     preserve the order of the runnable set, appending one `--project <id>` pair
     per runnable id that is a configured project name. So a runnable set of
     `["haiku"]`, with `gpt` skipped, forwards exactly `["--project", "haiku"]`,
     and a runnable set of `["haiku", "gpt"]` (neither skipped) forwards exactly
     `["--project", "haiku", "--project", "gpt"]` — in that order.
   - The set of configured project names used to build those `--project`
     selectors continues to derive from `skillsmith.config.ts`'s declared
     `roles.test.agents`, not from a hardcoded literal or any other source, so
     that renaming, adding, or removing a declared test agent automatically
     updates the e2e project filter.

5. **A regression test for the cycle exists at the root suite, in addition to the
   guardrail.** The `config-smoke` guardrail stays green as the CI gate, and a new
   test is added at `src/__tests__/<name>.test.ts` that:
   - does `await import("../../testing-project/skillsmith.config")` and asserts it
     resolves without throwing;
   - asserts the default export is structurally intact, covering the full
     Requirement 2 guarantee: `roles.test.agents` deep-equals `["haiku", "gpt"]`,
     `agents` has keys `["haiku", "opus", "gpt"]`, `mode` equals `"test-only"`,
     and `hooks.afterAllScenarios` is a function;
   - is a pure import-and-shape check: it reads only the imported default export
     and never invokes `runE2eVerification` or the `afterAllScenarios` hook, and
     requires no wp-env, Playwright, network access, or credentials;
   - runs under the existing root suite runner (`node --import tsx --test`);
   - fails before the fix is applied and passes after it.

## Out of Scope

- Any redesign of the skip-misconfigured-agents feature delivered by the base
  run.
- Weakening, disabling, or otherwise neutralizing the `config-smoke` guardrail.
- Changing the public API of the `@automattic/skillsmith` package.
- Freezing the arity or signature of `runE2eVerification` — the design phase may
  legitimately add a parameter for the configured project names. Requirement 4
  is a semantic invariant, not a signature constraint.
- Changes to `playwright.config.ts`. It reads `config.roles.test.agents` at its
  own module top level but imports `config` one-directionally (no back-edge), is
  a separate entry point not loaded by `config-smoke`, and is not part of the
  cycle. Its `projects` derivation stays as-is and must not require hand-editing.
- Changes to the hook body in `skillsmith.config.ts` (which operates on the
  harness-supplied, normalized `ctx.config` — a different object from the default
  export involved in the cycle), to `scaffold-plugin.ts`, or to `project-args.ts`,
  beyond what Requirement 3 strictly requires.

## Acceptance Criteria

- **AC1 — Config loads cleanly.** Given the fix is applied, when
  `npm --prefix testing-project run check:config` is run, then it exits 0.

- **AC2 — Default export shape preserved.** Given the fix is applied, when
  `testing-project/skillsmith.config.ts` is imported, then the import resolves
  without throwing and the default export's `roles.test.agents` deep-equals
  `["haiku", "gpt"]`, with `agents`, `roles`, `hooks`, `selfImprovement`, and
  `mode` unchanged from their authored values.

- **AC3 — Project-selector forwarding unchanged (order-preserving).** Given a
  runnable set of `["haiku"]` (with `gpt` skipped), when the e2e verification
  forwards project selectors to the Playwright child, then the forwarded
  `--project` selectors are exactly `["--project", "haiku"]`; and given a runnable
  set of `["haiku", "gpt"]` (neither skipped), the forwarded selectors are exactly
  `["--project", "haiku", "--project", "gpt"]`, in that order — one `--project
  <id>` pair per runnable id, preserving runnable-set order, identical to current
  behavior.

- **AC4 — Source-of-truth coupling.** Given the fix is applied, when the
  configured project names used to build the `--project` selectors are
  determined, then they deep-equal `skillsmith.config.ts`'s declared
  `roles.test.agents` (`["haiku", "gpt"]`) and are not a hardcoded literal
  divorced from the config; so that renaming, adding, or removing a declared test
  agent changes the configured project names accordingly.

- **AC5 — Regression test fails before, passes after.** Given the root-suite test
  at `src/__tests__/<name>.test.ts` that imports
  `testing-project/skillsmith.config` and asserts no-throw plus the full
  structural shape of Requirement 2 / AC2 — `roles.test.agents` deep-equals
  `["haiku", "gpt"]`, `agents` has keys `["haiku", "opus", "gpt"]`, `mode` equals
  `"test-only"`, and `hooks.afterAllScenarios` is a function — when it is run under
  `node --import tsx --test` against the unfixed code, then it fails; and when it
  is run against the fixed code, then it passes — without requiring wp-env,
  Playwright, network, or credentials, and without invoking `runE2eVerification`
  or the `afterAllScenarios` hook.
