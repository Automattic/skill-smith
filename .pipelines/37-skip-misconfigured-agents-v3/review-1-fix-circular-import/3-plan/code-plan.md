# Code Plan: Fix the testing-project circular import (v3)

## Overview

The `testing-project` config module (`testing-project/skillsmith.config.ts`) and
the e2e verification driver (`testing-project/eval/utils/verify-e2e.ts`) form a
two-node import cycle. `skillsmith.config.ts` imports `runE2eVerification` from
`verify-e2e.ts`, and `verify-e2e.ts` imports the default `config` back and reads
`config.roles.test.agents` at module-initialization time
(`const CONFIGURED_PROJECT_NAMES = config.roles.test.agents`). When
`skillsmith.config.ts` is the ESM entry point (which is exactly what the
`config-smoke` guardrail, `npm --prefix testing-project run check:config`, uses),
the default `config` is still `undefined` while `verify-e2e.ts`'s body runs, so
the eager read throws `TypeError: Cannot read properties of undefined (reading
'roles')` and the guardrail exits 1.

This plan breaks the cycle topologically. It removes the back-edge import and the
module-init const from `verify-e2e.ts`, adds a fourth parameter
`configuredProjectNames: string[]` to `runE2eVerification`, and supplies that
argument from the `afterAllScenarios` hook in `skillsmith.config.ts` (sourced
from the harness-supplied normalized `ctx.config`, the same object the hook
already maps to compute `runnableAgentIds`). It then adds a root-suite regression
test that imports `testing-project/skillsmith.config` and asserts no-throw plus
the default-export shape. The work is ordered so that the two `testing-project`
edits land together (they must, or the config will not typecheck/run), followed
by the new test. The fix stays entirely inside `testing-project/` plus one new
file under `src/__tests__/`; it does not touch the public API of
`@automattic/skillsmith` and does not weaken any guardrail.

### Scope and guardrail notes for code-writers

- **Shared worktree.** This worktree is SHARED across agents. NEVER use
  `git stash`. Stage ONLY the files your own task changes (named per task below);
  never `git add -A` or `git add .`.
- **No changeset is required.** All changes are confined to `testing-project/**`
  (the fixture, explicitly excluded from the changeset gate per
  `CONTRIBUTING.md`) and `src/__tests__/**` (tests-only, also excluded). Do NOT
  add or edit any `.changeset/*.md` file. The `changeset-format` guardrail
  (`npx tsx scripts/validate-changesets.ts`) only validates the *format* of
  existing changesets and does not require a new one; it stays green untouched.
- **Guardrails that must stay green** (declared in `.rp.md`): `typecheck`
  (`npm run typecheck`), `lint` (`npm run lint`), `tests` (`npm test`),
  `config-smoke` (`npm --prefix testing-project run check:config`),
  `changeset-format` (`npx tsx scripts/validate-changesets.ts`).
- **Do not touch out-of-scope files:** `testing-project/eval/utils/project-args.ts`
  (unchanged; it is the guarantor of AC3), `testing-project/eval/utils/scaffold-plugin.ts`,
  `testing-project/playwright.config.ts` (separate entry point, not in the cycle,
  out of scope), and `src/config/normalize.ts` (relied upon, not modified).

## Tasks

### Task 1: Parameterize `runE2eVerification` and delete the back-edge import in `verify-e2e.ts`

- **Goal:** Remove the only import edge from `verify-e2e.ts` back to
  `skillsmith.config.ts` and the only module-initialization-time read of the
  imported `config`, replacing the read with a function parameter so the runtime
  forwarding behavior is preserved.
- **Files to change:**
  - `testing-project/eval/utils/verify-e2e.ts`
- **Changes:**
  1. Delete the import line `import config from "../../skillsmith.config";`
     (currently line 12). Leave the adjacent imports
     (`import { projectArgs } from "./project-args";` and the `@automattic/skillsmith`
     type import) intact.
  2. Delete the module-top const and its explanatory comment (currently lines
     21–24):
     ```
     // Every configured test agent gets a Playwright project (see
     // playwright.config.ts), so the configured project names are exactly the
     // test-agent ids the config declares.
     const CONFIGURED_PROJECT_NAMES = config.roles.test.agents;
     ```
  3. Add a fourth parameter `configuredProjectNames: string[]` to the
     `runE2eVerification` signature (currently the three params
     `iterationDirectory: string`, `scenarios: RunScenario[]`,
     `runnableAgentIds: string[]`), so the signature becomes:
     ```ts
     export function runE2eVerification(
       iterationDirectory: string,
       scenarios: RunScenario[],
       runnableAgentIds: string[],
       configuredProjectNames: string[],
     ): VerificationFailure[]
     ```
  4. At the existing call to `projectArgs` (currently lines 140–143), replace the
     reference to the deleted const with the new parameter, keeping the call
     shape unchanged:
     ```ts
     const projectSelectors = projectArgs(runnableAgentIds, configuredProjectNames);
     ```
  5. After these edits, confirm `verify-e2e.ts` contains no remaining reference to
     `config` anywhere (no import of it, no `config.` access). The rest of the
     module body (plugin discovery, wp-env writing, report parsing) is unchanged.
- **Depends on:** none. (Must land together with Task 2 in the same batch so the
  config compiles/runs; see Task 2 dependency. Either order of editing is fine as
  long as both ship before any guardrail run.)
- **Traces to:** Spec Requirement 3 (remove the module-init read of the imported
  `config`); Requirement 4 / AC3 (forwarding preserved via unchanged `projectArgs`
  call); Design "Approach" step 1 and "Decision: Break the cycle by parameterizing
  `runE2eVerification`"; Design "Changed interface: `runE2eVerification`".
- **Acceptance:**
  - `verify-e2e.ts` no longer imports `config` from `../../skillsmith.config` and
    contains no reference to the identifier `config` at all.
  - `verify-e2e.ts` has no module-top-level (module-initialization-time) read of
    `config.roles.test.agents` or any property of the imported config.
  - `runE2eVerification` accepts a fourth parameter typed `string[]`, and the
    `projectArgs(...)` call inside its body passes that parameter as its second
    argument (its first argument remains `runnableAgentIds`).
  - With Task 2 applied, `npm run typecheck` passes (no unused-import, no
    missing-argument, and no missing-symbol errors arising from this file).

### Task 2: Supply `configuredProjectNames` from the `afterAllScenarios` hook in `skillsmith.config.ts`

- **Goal:** Pass the new fourth argument to `runE2eVerification`, derived from the
  same normalized `ctx.config` the hook already uses, so the configured project
  names stay coupled to the declared `roles.test.agents` and the call typechecks.
- **Files to change:**
  - `testing-project/skillsmith.config.ts`
- **Changes:**
  - Inside the `afterAllScenarios` hook body only (currently lines 60–78), after
    the existing `skippedTestIds` / `runnableAgentIds` computation, derive the
    configured project names from the full, unfiltered normalized config and pass
    them as the new fourth argument to `runE2eVerification`. Concretely, add a
    derivation equivalent to:
    ```ts
    const configuredProjectNames = config.roles.test.agents.map((agent) => agent.id);
    ```
    and update the call from:
    ```ts
    const failures = runE2eVerification(
      iterationDirectory,
      scenarios,
      runnableAgentIds,
    );
    ```
    to:
    ```ts
    const failures = runE2eVerification(
      iterationDirectory,
      scenarios,
      runnableAgentIds,
      configuredProjectNames,
    );
    ```
  - The new value MUST be the **unfiltered** `config.roles.test.agents.map((agent)
    => agent.id)` (the full configured set), distinct from `runnableAgentIds`
    which additionally filters out `skippedTestIds`. Here `config` is the
    hook-argument `config` (the harness-supplied normalized `ctx.config`,
    destructured in the hook signature), NOT a module import.
  - Do NOT change the `defineConfig({...})` object (`mode`, `agents`, `roles`,
    `hooks` structure, `selfImprovement`) — only the hook body that drives e2e.
  - Do NOT add any new import to this file.
- **Depends on:** Task 1 (the new fourth parameter must exist on
  `runE2eVerification` for this call to typecheck). Both files must ship together.
- **Traces to:** Spec Requirement 4 / AC3 (order-preserving forwarding) and AC4
  (source-of-truth coupling to declared `roles.test.agents`); Design "Approach"
  step 2, "Decision: Source the configured names from the normalized `ctx.config`,
  not the static export", and "Data flow at runtime (hook-call time)".
- **Acceptance:**
  - The `afterAllScenarios` hook computes a `configuredProjectNames` value equal to
    `config.roles.test.agents.map((agent) => agent.id)` using the hook-supplied
    normalized `config`, with no `skipped` filtering applied to it.
  - `runE2eVerification` is called with exactly four arguments, the fourth being
    `configuredProjectNames`; `runnableAgentIds` remains the third argument and
    still has skipped test ids filtered out.
  - For the authored config, `configuredProjectNames` deep-equals
    `["haiku", "gpt"]` in that order (declared order preserved), so for a runnable
    set of `["haiku"]` the forwarded selectors are `["--project", "haiku"]`, and
    for `["haiku", "gpt"]` they are `["--project", "haiku", "--project", "gpt"]` —
    identical to current behavior.
  - The `defineConfig({...})` default-export object is byte-unchanged except for
    the hook body; `npm run typecheck` and `npm --prefix testing-project run
    check:config` both pass (the latter exits 0, demonstrating the import graph
    rooted at `skillsmith.config.ts` now loads without throwing).

### Task 3: Add the root-suite regression test for clean config load and default-export shape

- **Goal:** Add a fast, dependency-free root-suite test that fails before the fix
  (the import throws `TypeError`) and passes after it (import resolves and the
  default-export shape is intact), giving a second signal alongside the
  `config-smoke` guardrail.
- **Files to change (new file):**
  - `src/__tests__/config-loads.test.ts`
- **Changes:**
  - Create `src/__tests__/config-loads.test.ts` using the existing root-suite
    style (`import { test } from "node:test";` and
    `import assert from "node:assert/strict";`, matching
    `src/__tests__/project-args.test.ts`). The test must:
    1. `await import("../../testing-project/skillsmith.config")` — **omit the
       `.ts` extension**, matching the convention at
       `src/__tests__/project-args.test.ts:4` (`tsx`/node resolve the `.ts`). The
       relative depth `../../testing-project/...` is correct from `src/__tests__/`.
    2. Assert the dynamic import resolves without throwing (e.g. inside an
       `async` test that awaits the import; the test failing/throwing on a
       rejected import is the no-throw assertion).
    3. Read the default export and assert its shape (the default export is the
       **unnormalized** `SkillsmithConfigInput`, because `defineConfig` is an
       identity passthrough — so `roles.test.agents` is a `string[]`, not the
       normalized `AgentDefinition[]`):
       - `roles.test.agents` deep-equals the array `["haiku", "gpt"]`.
       - `Object.keys(agents)` deep-equals `["haiku", "opus", "gpt"]`.
       - `mode` equals `"test-only"`.
       - `hooks.afterAllScenarios` is a function (`typeof ... === "function"`).
  - The test must be a **pure import-and-shape check**: it reads only the imported
    default export. It MUST NOT invoke `runE2eVerification`, MUST NOT call the
    `afterAllScenarios` hook (or any hook), and MUST NOT require wp-env,
    Playwright, network access, or credentials. Use only `node:test` and
    `node:assert/strict` — no new tooling or dependencies.
  - The file lands under `src/__tests__/*.test.ts`, so it is automatically picked
    up by the root suite runner `node --import tsx --test src/__tests__/*.test.ts`
    (the `npm test` / `tests` guardrail).
- **Depends on:** Task 1 and Task 2 (the test only passes once the cycle is fixed;
  it is authored to fail against the unfixed code and pass against the fixed code).
- **Traces to:** Spec Requirement 5 / AC5 (regression test fails before, passes
  after) and Requirement 2 / AC2 (default-export shape preserved); Design
  "Approach" step 3, "Components → `src/__tests__/<name>.test.ts` (new)", and
  "Default export shape (what the regression test asserts)".
- **Acceptance:**
  - A new file `src/__tests__/config-loads.test.ts` exists and runs under
    `node --import tsx --test` as part of `npm test`.
  - The test dynamically imports `../../testing-project/skillsmith.config` (no
    `.ts` extension) and asserts the import resolves without throwing.
  - The test asserts all four shape facts on the default export:
    `roles.test.agents` deep-equals `["haiku", "gpt"]`; `agents` keys deep-equal
    `["haiku", "opus", "gpt"]`; `mode === "test-only"`;
    `hooks.afterAllScenarios` is a function.
  - The test requires no wp-env, Playwright, network, or credentials and never
    invokes `runE2eVerification` or any hook.
  - Run against the fixed tree (Tasks 1+2 applied), `npm test` passes including
    this test. (By construction, the same test would throw the pre-fix
    `TypeError` against the unfixed code — satisfying "fails before, passes
    after".)

## Coverage check (every acceptance criterion is addressed)

- **AC1 — Config loads cleanly** (`check:config` exits 0): Tasks 1 + 2 remove the
  back-edge and the eager read; verified by the `config-smoke` guardrail and
  Task 2 acceptance.
- **AC2 — Default export shape preserved:** Task 2 leaves the `defineConfig`
  object unchanged; Task 3 asserts the full shape.
- **AC3 — Project-selector forwarding unchanged (order-preserving):** Task 1 keeps
  the `projectArgs` call shape; Task 2 supplies declared-order configured names;
  `project-args.ts` is untouched. Verified by Task 2 acceptance and the existing
  `src/__tests__/project-args.test.ts`.
- **AC4 — Source-of-truth coupling:** Task 2 derives `configuredProjectNames` from
  the normalized `config.roles.test.agents`, not a hardcoded literal.
- **AC5 — Regression test fails before, passes after:** Task 3.
