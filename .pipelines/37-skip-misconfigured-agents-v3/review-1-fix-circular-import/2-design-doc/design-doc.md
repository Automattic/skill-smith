# Design Doc: Fix the testing-project circular import (v3)

## Overview

The base run of pipeline `37-skip-misconfigured-agents-v3` shipped the
skip-misconfigured-agents feature but left a circular import inside
`testing-project`. The config module (`skillsmith.config.ts`) imports
`runE2eVerification` from `eval/utils/verify-e2e.ts`, and `verify-e2e.ts` imports
the default `config` back from `skillsmith.config.ts` and dereferences it at
module-initialization time (`const CONFIGURED_PROJECT_NAMES = config.roles.test.agents`).
Because ESM evaluates the entry module first and pauses to evaluate its imports,
when `skillsmith.config.ts` is the entry point the default `config` is still
`undefined` while `verify-e2e.ts`'s body runs, so that eager read throws
`TypeError: Cannot read properties of undefined (reading 'roles')`. The
`config-smoke` guardrail (`npm --prefix testing-project run check:config`, whose
entry is exactly `skillsmith.config.ts`) exits 1 today for this reason.

The chosen approach breaks the cycle **topologically**: delete `verify-e2e.ts`'s
back-edge `import config` and the module-init const that read it, and pass the
configured project names into `runE2eVerification` as a new parameter, sourced by
the `afterAllScenarios` hook from the harness-supplied normalized config it already
holds. With no import edge from `verify-e2e.ts` back to `skillsmith.config.ts`, the
config import graph becomes a DAG, the eager read disappears, and every behavior the
skip-misconfigured-agents feature delivers is preserved unchanged. The fix stays
entirely inside `testing-project` and does not alter the public API of the
`@automattic/skillsmith` package.

## Approach

The defect is a two-node import cycle with one fatal eager read. The config import
graph rooted at `skillsmith.config.ts` (the graph `check:config` evaluates) is:

```
skillsmith.config.ts ─▶ scaffold-plugin.ts        (leaf: imports only node:fs, node:path)
skillsmith.config.ts ─▶ verify-e2e.ts ─▶ project-args.ts   (leaf: ZERO local imports)
                        verify-e2e.ts ─▶ skillsmith.config.ts   ◀── the ONLY back-edge
```

`verify-e2e.ts`'s `import config from "../../skillsmith.config"` is the sole back-edge,
and its module-top `const CONFIGURED_PROJECT_NAMES = config.roles.test.agents` is the
sole module-initialization-time read of the imported `config` anywhere in the cycle.
`scaffold-plugin.ts` and `project-args.ts` are acyclic leaves; the hook body's read of
`config.roles.test.agents` in `skillsmith.config.ts` happens at hook-call time (not
module-init) and reads the harness-supplied normalized `ctx.config`, not the default
export — so it is not part of the crash.

The fix removes the back-edge rather than merely deferring the read:

1. **In `verify-e2e.ts`:** delete the line `import config from "../../skillsmith.config"`
   and the line `const CONFIGURED_PROJECT_NAMES = config.roles.test.agents`. Add a
   fourth parameter `configuredProjectNames: string[]` to `runE2eVerification`, and at
   the existing call site pass that parameter straight into the unchanged
   `projectArgs(runnableAgentIds, configuredProjectNames)`. After this, `verify-e2e.ts`
   has no reference to `config` at all and no import edge back to `skillsmith.config.ts`.

2. **In `skillsmith.config.ts`:** the `afterAllScenarios` hook supplies the new argument.
   The hook already computes `runnableAgentIds` from the normalized
   `ctx.config.roles.test.agents.map((agent) => agent.id)` (then filters out skipped ids).
   It derives `configuredProjectNames` from the **same** normalized source — the full,
   unfiltered `ctx.config.roles.test.agents.map((agent) => agent.id)` — and passes it as
   the fourth argument to `runE2eVerification`.

3. **Add a regression test** at `src/__tests__/<name>.test.ts` in the root suite that
   imports `testing-project/skillsmith.config` and asserts it resolves without throwing
   and has the expected default-export shape. It is a pure import-and-shape check.

Because `verify-e2e.ts` no longer imports the config module, the config import graph is
acyclic: `skillsmith.config.ts` initializes fully before any consumer reads it, and there
is no module-init dereference of an undefined value. The runtime forwarding semantics are
untouched — the same two arrays (`runnableAgentIds`, configured names) feed the unchanged
`projectArgs`, just sourced via a parameter instead of a module-top const.

## Components

All changed components live in `testing-project/`; one new file is added under `src/`.

- **`testing-project/eval/utils/verify-e2e.ts` (modified).** Owns the e2e verification
  driver `runE2eVerification`. Loses its back-edge `import config` and its module-top
  `CONFIGURED_PROJECT_NAMES` const. Gains a fourth parameter `configuredProjectNames:
  string[]` on `runE2eVerification`, consumed at the existing `projectArgs(...)` call.
  No other function body in this module references `config`, so removing the import and
  const leaves nothing else needing it.

- **`testing-project/skillsmith.config.ts` (modified, hook body only).** Owns the
  authored `defineConfig({...})` default export and the `afterAllScenarios` hook. The
  `defineConfig(...)` object is unchanged. Inside the hook, a one-line derivation
  computes `configuredProjectNames` from the normalized `ctx.config` and passes it as the
  new fourth argument. The authored config shape (`mode`, `agents`, `roles`, `hooks`,
  `selfImprovement`) is not altered.

- **`src/__tests__/<name>.test.ts` (new).** A root-suite regression test that imports
  `testing-project/skillsmith.config` and asserts no-throw plus default-export shape. Runs
  under the existing `node --import tsx --test` runner. Requires no wp-env, Playwright,
  network, or credentials.

Untouched-but-relevant components:

- **`testing-project/eval/utils/project-args.ts` (untouched).** The pure
  `projectArgs(runnableAgentIds, configuredProjectNames)` selector builder. Its signature
  and behavior are unchanged; it is the guarantor of AC3. Already unit-covered by
  `src/__tests__/project-args.test.ts`.

- **`testing-project/eval/utils/scaffold-plugin.ts` (untouched).** An acyclic leaf in the
  config graph (imports only `node:fs`/`node:path`); not part of the cycle.

- **`testing-project/playwright.config.ts` (untouched, out of scope).** It imports `config`
  one-directionally and reads `config.roles.test.agents` at its own module top, but
  `skillsmith.config.ts` does not import it (no back-edge), and it is a separate entry point
  not loaded by `check:config`. Playwright loads it as its own root, by which time
  `skillsmith.config.ts` has fully initialized, so its top-level read is safe. Its `projects`
  derivation stays as-is and is not hand-edited.

- **`src/config/normalize.ts` (untouched, load-bearing for AC4).** `normalizeConfig` injects
  `id` from the declared agent-map key and builds `roles.test.agents` by mapping over the
  declared id list. This is what makes the hook's normalized-config derivation recover the
  declared ids exactly. See Key Decisions and Interfaces below.

## Interfaces and Data Flow

### Changed interface: `runE2eVerification`

The only interface change is one added parameter. Sketch (illustrative, not implementation):

```ts
// before
export function runE2eVerification(
  iterationDirectory: string,
  scenarios: RunScenario[],
  runnableAgentIds: string[],
): VerificationFailure[]

// after
export function runE2eVerification(
  iterationDirectory: string,
  scenarios: RunScenario[],
  runnableAgentIds: string[],
  configuredProjectNames: string[],   // NEW — replaces the deleted module-top const
): VerificationFailure[]
```

Inside the body, the existing call is unchanged in shape — only its second argument's
source moves from the deleted const to the new parameter:

```ts
const projectSelectors = projectArgs(runnableAgentIds, configuredProjectNames);
```

`projectArgs` itself is unchanged:

```ts
export function projectArgs(
  runnableAgentIds: string[],
  configuredProjectNames: string[],
): string[]   // one ["--project", id] pair per runnable id that is configured, in order
```

This is internal to `testing-project`. The `@automattic/skillsmith` package's public API
(`defineConfig`, exported types, the runtime) is not touched — the spec explicitly permits
adding this parameter (Out of Scope: "Freezing the arity or signature … the design phase
may legitimately add a parameter for the configured project names").

### Data flow at runtime (hook-call time)

```
harness loadConfig → normalizeConfig(input)            [src/config/normalize.ts]
        │  builds ctx.config (normalized): roles.test.agents is AgentDefinition[],
        │  each AgentDefinition.id == the declared agent-map key
        ▼
afterAllScenarios({ scenarios, iterationDirectory, config: ctx.config, skipped })
        │  configuredProjectNames = ctx.config.roles.test.agents.map(a => a.id)   → ["haiku","gpt"]
        │  runnableAgentIds       = (same map) filtered to drop skipped test ids
        ▼
runE2eVerification(iterationDirectory, scenarios, runnableAgentIds, configuredProjectNames)
        │
        ▼
projectArgs(runnableAgentIds, configuredProjectNames)  [unchanged]
        │  one ["--project", id] pair per runnable id that is a configured name, in order
        ▼
execFileSync("npm", ["run","test:e2e","--", ...e2eSpecs, ...projectSelectors])
```

The configured-names list and the runnable-ids list now come from one consistent source
(the normalized `ctx.config`), computed in the hook, instead of mixing the static default
export (read in `verify-e2e.ts`) with the normalized context. `runnableAgentIds` is, by
construction, a subset of `configuredProjectNames` in the same order — exactly what
`projectArgs`'s "filter runnable ids to those that are configured project names" relies on.

### Config import graph after the fix (module-init time)

```
skillsmith.config.ts ─▶ scaffold-plugin.ts
skillsmith.config.ts ─▶ verify-e2e.ts ─▶ project-args.ts
   (no edge back from verify-e2e.ts — the back-edge is deleted; graph is a DAG)
```

### Default export shape (what the regression test asserts)

The static default export is the **unnormalized input** (`SkillsmithConfigInput`), because
`defineConfig` is an identity passthrough — it returns its argument unchanged. So
`roles.test.agents` on the default export is a `string[]` of ids, not the normalized
`AgentDefinition[]`. The test asserts against this static shape:

- `roles.test.agents` deep-equals the `string[]` `["haiku", "gpt"]`
- `agents` has keys `["haiku", "opus", "gpt"]`
- `mode` equals `"test-only"`
- `hooks.afterAllScenarios` is a function

Import specifier convention: from `src/__tests__/<name>.test.ts`, use
`await import("../../testing-project/skillsmith.config")` — **omit the `.ts` extension**,
matching the existing root-suite convention at `src/__tests__/project-args.test.ts:4`
(`tsx`/node resolve the `.ts`). The relative depth `../../testing-project/...` is correct.

## Key Decisions

### Decision: Break the cycle by parameterizing `runE2eVerification` (chosen)

- **Choice:** Delete `verify-e2e.ts`'s `import config` and its module-top
  `CONFIGURED_PROJECT_NAMES` const entirely. Add a `configuredProjectNames: string[]`
  parameter to `runE2eVerification`; the `afterAllScenarios` hook supplies it from the
  normalized `ctx.config.roles.test.agents.map((a) => a.id)`.
- **Alternatives:** (a) Lazy read; (c) Shared-constant module — see the two decisions below.
- **Trade-offs:** Adds one parameter to an internal function (the spec explicitly permits
  this) and one line of derivation in the hook. In exchange it removes the import back-edge
  outright, so the cycle is gone topologically — not merely init-order-safe. This makes the
  bug structurally impossible to reintroduce by a future module-top use of `config`, because
  there is no longer any `config` reference in `verify-e2e.ts` to misuse. It is the strongest
  satisfaction of the root-cause requirement (R3): the eager read is gone *and* the structural
  cycle that made it dangerous is gone. `project-args.ts`, `scaffold-plugin.ts`, and
  `playwright.config.ts` are untouched.
- **Traces to:** Requirement 1 / AC1 (clean load), Requirement 3 (no module-init read of the
  imported config), Requirement 4 / AC3 & AC4 (preserved forwarding and source-of-truth
  coupling).

### Decision: Source the configured names from the normalized `ctx.config`, not the static export

- **Choice:** In the hook, derive `configuredProjectNames` from
  `ctx.config.roles.test.agents.map((a) => a.id)` (the normalized `AgentDefinition[]`),
  rather than reading the static default export's `string[]`.
- **Alternatives:** Pass the static default export's `roles.test.agents` (a `string[]`)
  through some other path. Rejected because the whole point of the chosen mechanism is to
  sever `verify-e2e.ts`'s dependency on the config module; routing the static export back in
  would either reintroduce a config reference or add indirection for no gain. The hook already
  holds the normalized config.
- **Trade-offs:** The normalized `ctx.config.roles.test.agents` is a *different object* from
  the static export, but it yields the **identical value and order**, and this is exact, not
  coincidental, by two facts in `src/config/normalize.ts`:
  - **Order preserved (AC3):** `normalize.ts` builds the array as
    `input.roles.test.agents.map((id) => agents[id])`. `Array.prototype.map` preserves order,
    so `ctx.config.roles.test.agents` is in declared order and `.map((a) => a.id)` is
    `["haiku", "gpt"]` in that order.
  - **Ids equal the declared keys (AC4):** `normalize.ts` sets `agents[id] = { ...def, id }`
    while iterating `Object.entries(input.agents)`, so `AgentDefinition.id` is exactly the
    declared agent-map key (`"haiku"`, `"opus"`, `"gpt"`) — not a provider/model string.
    `.map((a) => a.id)` recovers exactly the declared ids.
  Deriving both arguments to `projectArgs` from the same normalized source is more internally
  consistent than mixing the static export with the normalized context, and `runnableAgentIds`
  remains a same-order subset of `configuredProjectNames` by construction.
- **Traces to:** AC3 (order-preserving forwarding), AC4 (source-of-truth coupling — names
  derive from declared `roles.test.agents`, not a hardcoded literal).

### Decision: Leave `projectArgs` and the runnable-set semantics untouched

- **Choice:** Do not change `project-args.ts` or how `runnableAgentIds` is computed/filtered.
  The same runnable set in produces the same `--project` selectors out.
- **Alternatives:** Inline or rework the selector logic while touching `verify-e2e.ts`.
  Rejected — unnecessary and risks an AC3 regression.
- **Trade-offs:** None of substance. Keeping `projectArgs` byte-for-byte identical is the
  cleanest guarantee that forwarding is unchanged, and it is already unit-covered by
  `src/__tests__/project-args.test.ts` (runnable `["haiku"]` → `["--project","haiku"]`;
  runnable `["haiku","gpt"]` → `["--project","haiku","--project","gpt"]`).
- **Traces to:** Requirement 4 / AC3 (byte-identical, order-preserving forwarding).

### Decision (rejected alternative): Lazy read — defer the access, keep the import

- **Choice:** Not taken. Delete the module-top const but keep `import config`; read
  `config.roles.test.agents` *inside* `runE2eVerification` at call time.
- **Why rejected:** It breaks the crash (no module-init dereference, so R3's literal property
  holds) and preserves AC4, but it does **not** remove the cycle — the back-edge import
  remains, so the module graph is still cyclic and merely init-order-safe. Any future
  module-top use of `config` in `verify-e2e.ts` re-breaks it. The chosen parameter mechanism
  removes the edge entirely, which is strictly more robust at the same edit cost (no extra file,
  same two files touched).
- **Traces to:** Requirement 3 (it satisfies the literal property but leaves the fragile cyclic
  topology the requirement's intent targets).

### Decision (rejected alternative): Shared-constant module

- **Choice:** Not taken. Extract the declared test-agent ids into a new third module (e.g.
  `eval/utils/test-agents.ts` exporting `export const TEST_AGENT_IDS = ["haiku","gpt"]`) that
  both `skillsmith.config.ts` and `verify-e2e.ts` import.
- **Why rejected:** Strictly dominated by the chosen mechanism. It would break the back-edge
  (a new acyclic leaf), but it adds a new file the spec's simplest-fix altitude does not want,
  and it relocates the *declaration* of the test agents out of `skillsmith.config.ts`, weakening
  R2/AC2's "authored values" intent — `roles.test.agents` would become `TEST_AGENT_IDS` instead
  of the authored literal `["haiku","gpt"]`. If the new module were *not* also consumed by
  `skillsmith.config.ts`, AC4 would break: renaming a declared test agent would not update the
  e2e filter unless the new module were hand-edited too — the divorced-from-config failure AC4
  forbids. It offers no advantage over the chosen mechanism (same back-edge elimination, one
  extra file, same two edited files).
- **Traces to:** Requirement 2 / AC2 (authored values), Requirement 4 / AC4 (source-of-truth
  coupling) — both better served by the chosen mechanism.

## Dependencies

- **Internal:** `src/config/normalize.ts` (`normalizeConfig`) is load-bearing for AC4 — its
  id-injection and order-preserving map are what make the hook's normalized derivation recover
  the declared ids exactly. It is relied upon, not modified.
- **Internal:** `testing-project/eval/utils/project-args.ts` (`projectArgs`) — relied upon
  unchanged for AC3.
- **External libraries / services:** None added. No change to `@automattic/skillsmith`'s public
  API or to any external dependency. The regression test uses only `node:test` and
  `node:assert/strict` under the existing `node --import tsx --test` runner — no new tooling, and
  no wp-env, Playwright, network, or credentials.

## Failure Modes and Observability

- **Pre-fix failure (the defect):** loading `skillsmith.config.ts` as the entry point throws
  `TypeError: Cannot read properties of undefined (reading 'roles')` at `verify-e2e.ts`'s eager
  read during module init. Surfaced today by `check:config` exiting 1. After the fix, the eager
  read and the import that fed it are gone, so this failure mode is eliminated.
- **Detection — CI gate:** the `config-smoke` guardrail
  (`npm --prefix testing-project run check:config`) remains the CI gate and exits 0 once the
  graph is acyclic. It is not weakened, disabled, or neutralized.
- **Detection — regression test:** the new root-suite test fails before the fix (the import
  throws the `TypeError`) and passes after (import resolves and all four shape facts hold),
  giving a second, faster, dependency-free signal alongside the guardrail. It asserts both
  no-throw and the full default-export shape, so a "fix" that lets the module load by gutting the
  config value would still fail the shape assertions.
- **Runtime forwarding errors:** `projectArgs` continues to forward `--project` only for ids
  that are configured project names, so a skipped or unknown id can never surface as Playwright's
  "unknown project" error — behavior preserved exactly. The hook's existing diagnostics and the
  e2e driver's existing error handling (e.g. throwing when no report is produced) are unchanged.

## Risks and Open Questions

- **Risk — value equivalence of static vs normalized source.** The chosen mechanism shifts the
  configured-names source from the static `string[]` export to the normalized
  `AgentDefinition[]`-derived `.map((a) => a.id)`. This is value- and order-preserving by the two
  `normalize.ts` facts above, and is already exercised: the hook uses the same expression for
  `runnableAgentIds` today. Low risk; called out so the implementer derives both arrays from the
  one normalized source rather than reintroducing the static export.
- **No open questions block implementation.** The mechanism, the affected lines, the parameter
  shape, the hook derivation, the test's assertions, and the import specifier convention are all
  determined. The Plan and Code phases own the actual edits; this design introduces no source
  changes.
