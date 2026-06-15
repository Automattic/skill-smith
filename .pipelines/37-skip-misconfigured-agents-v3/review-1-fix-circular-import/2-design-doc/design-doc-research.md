# Design research: Fix the testing-project circular import (v3)

Review run `review-1-fix-circular-import` of pipeline `37-skip-misconfigured-agents-v3`.
This file is the running record of the design Q&A and the decision rationale. The
design-doc-writer turns it into `design-doc.md`; this file captures *why*.

## 1. The defect, confirmed against committed HEAD

The cycle has two edges and one fatal eager read (line numbers are committed HEAD):

- `testing-project/skillsmith.config.ts:6` — `import { runE2eVerification } from "./eval/utils/verify-e2e"`.
- `testing-project/eval/utils/verify-e2e.ts:12` — `import config from "../../skillsmith.config"` (the back-edge).
- `testing-project/eval/utils/verify-e2e.ts:24` — `const CONFIGURED_PROJECT_NAMES = config.roles.test.agents;` — a **module-initialization-time** dereference of the imported `config`.

When `skillsmith.config.ts` is the import entry point (which `check:config` does:
`node --import tsx -e "await import('./skillsmith.config.ts')"`), ESM evaluates
`skillsmith.config.ts` first; reaching its `import` of `verify-e2e.ts` it pauses and
evaluates `verify-e2e.ts`'s body — at which point `config` (the not-yet-finished
default export of `skillsmith.config.ts`) is still `undefined`, so line 24 throws.

Reproduced directly on committed HEAD:

```
$ npm --prefix testing-project run check:config
TypeError: Cannot read properties of undefined (reading 'roles')
    at .../testing-project/eval/utils/verify-e2e.ts:24:41
```

`verify-e2e.ts:24` is the **sole** module-init-time read of the imported `config` in
the cycle. The hook body in `skillsmith.config.ts` (`afterAllScenarios`) reads
`config.roles.test.agents` too, but that read happens at **hook-call time**, not
module-init, and it reads the harness-supplied normalized `ctx.config`, not the
default export — so it is not part of the crash.

The cycle is a single 2-node loop. The config import graph rooted at
`skillsmith.config.ts` (what `check:config` evaluates) is:

```
skillsmith.config.ts ─▶ scaffold-plugin.ts        (leaf: imports only node:fs, node:path)
skillsmith.config.ts ─▶ verify-e2e.ts ─▶ project-args.ts   (leaf: ZERO imports)
                        verify-e2e.ts ─▶ skillsmith.config.ts   ◀── the ONLY back-edge
```

`grep -rn "skillsmith.config" eval/ --include=*.ts` returns exactly one hit
(`verify-e2e.ts:12`), so `verify-e2e.ts:12` is the sole back-edge and
`scaffold-plugin.ts`/`project-args.ts` are acyclic leaves. The only live `config`
references in `verify-e2e.ts` are the import (`:12`), the eager deref (`:24`), and the
call site that consumes the *const* `CONFIGURED_PROJECT_NAMES` (`:140-143`) — no
function body ever touches the imported `config` directly. So removing the import and
the const (mechanism b, §3) leaves nothing else in the module needing `config`.

### 1.1 The static default export is the *unnormalized input* (`string[]`)

`defineConfig` (`src/config/define-config.ts`) is an **identity passthrough** — it
returns its `SkillsmithConfigInput` argument unchanged. So the value `verify-e2e.ts`
imports (the default export) is the **`SkillsmithConfigInput`**, whose
`roles.test.agents` is a **`string[]`** of ids (`["haiku","gpt"]`), *not* the
normalized `AgentDefinition[]`. Normalization to `AgentDefinition[]` happens only in
`loadConfig → normalizeConfig` (`src/config/load.ts:33`, `src/config/normalize.ts:30`),
which the harness runs at runtime and feeds to hooks as `ctx.config`. This is why the
old `verify-e2e.ts:24` read was already the correct `string[]` for `projectArgs`'s
`configuredProjectNames`, and it is the contract the existing test
`src/__tests__/project-args.test.ts:38-63` explicitly guards (static input is
`string[]`; do not map over it as if it were `AgentDefinition[]`). The regression test
(§5) therefore asserts against this **static** shape: `roles.test.agents` deep-equals
the `string[]` `["haiku","gpt"]`.

## 2. Scope confirmation: playwright.config.ts is correctly out of scope

`playwright.config.ts:4` imports `config` and `:23` reads `config.roles.test.agents`
at its own module top. It is **not** part of this cycle:

- It imports `skillsmith.config.ts` **one-directionally** — `skillsmith.config.ts`
  does not import `playwright.config.ts` (the config import graph is
  config → {scaffold-plugin, verify-e2e} → {project-args}; no edge to playwright).
- It is a **separate entry point** not loaded by `check:config` (whose entry is
  `skillsmith.config.ts`). Playwright loads `playwright.config.ts` as its own root, by
  which time `skillsmith.config.ts` has fully initialized, so its top-level read is safe.

The spec lists it Out of Scope; this is correct. We do not touch it.

## 3. Candidate mechanisms

### (a) Lazy read — defer the access, keep the import
Delete the module-top `CONFIGURED_PROJECT_NAMES` const; read `config.roles.test.agents`
*inside* `runE2eVerification` at call time. `verify-e2e.ts` **still imports** `config`.

- Breaks the crash: yes — no module-init dereference, so R3's literal property
  ("nothing reads imported config at module-init") holds.
- Removes the cycle: **no** — the back-edge import remains. The cyclic import topology
  is preserved; only the eager *read* is gone. The module graph is still a cycle, which
  is more fragile (any future module-top use of `config` re-breaks it).
- Source-of-truth (AC4): preserved — still reads `config.roles.test.agents`.
- Touches `runE2eVerification` arity: no. Touches hook body: no. project-args/scaffold: no.

### (b) Parameter — pass the configured names in, drop the import  ← CHOSEN
Remove `verify-e2e.ts`'s `import config` **entirely**. Add a parameter
(`configuredProjectNames: string[]`) to `runE2eVerification`; the `afterAllScenarios`
hook supplies it from the normalized `ctx.config`.

- Breaks the crash: yes.
- Removes the cycle: **yes, topologically** — with no `import config`, `verify-e2e.ts`
  has no edge back to `skillsmith.config.ts`. The graph is acyclic, not merely
  init-order-safe. This is the strongest satisfaction of R3 (the eager read is gone
  *and* the structural cycle that made it dangerous is gone).
- Source-of-truth (AC4): **preserved, and verified.** The hook sources names from
  `ctx.config.roles.test.agents`. `src/config/normalize.ts:30-31` builds that array as
  `input.roles.test.agents.map(id => agents[id])` — i.e. it is derived directly from the
  declared `roles.test.agents` string list. So `ctx.config.roles.test.agents.map(a=>a.id)`
  recovers exactly the declared `["haiku","gpt"]`; rename/add/remove a declared test
  agent and the forwarded names follow automatically. Not a hardcoded literal.
- AC3 byte-identical forwarding: preserved. `projectArgs(runnableAgentIds,
  configuredProjectNames)` is unchanged; the same two arguments feed it, just sourced via
  the parameter instead of a module-top const. The hook already computes
  `runnableAgentIds` by filtering the configured ids, so order is preserved.
- Arity: adds a 4th parameter to `runE2eVerification`. The spec **explicitly permits**
  this (Out of Scope: "Freezing the arity or signature … the design phase may
  legitimately add a parameter for the configured project names"). Hook body gains a
  one-line `configuredProjectNames` derivation and passes it through. project-args.ts and
  scaffold-plugin.ts are **untouched**.

### (c) Shared-constant module — extract the names into a third module
Both `skillsmith.config.ts` and `verify-e2e.ts` import the declared test-agent ids from
a new tiny module (e.g. `eval/utils/test-agents.ts` exporting
`export const TEST_AGENT_IDS = ["haiku","gpt"]`). It *would* break the back-edge (new
acyclic leaf) and *can* keep AC4 coupling — but only if `skillsmith.config.ts` also
consumes `TEST_AGENT_IDS` for its `roles.test.agents`. Rejected as **strictly dominated
by (b)**:

- Adds machinery (a new file) the spec's "simplest fix" altitude does not want.
- Weakens R2/AC2's "authored values" intent: it moves the *declaration* of the test
  agents **out** of `skillsmith.config.ts` — `roles.test.agents` becomes `TEST_AGENT_IDS`
  rather than the authored literal `["haiku","gpt"]`. If, instead, the new module is *not*
  wired back into `skillsmith.config.ts`, then AC4 breaks: renaming a declared test agent
  would not update the e2e filter unless the new module is hand-edited too — the
  divorced-from-config failure AC4 forbids.
- No advantage over (b): same back-edge elimination, but with one extra file and the same
  two edited files. (b) eliminates the back-edge *without* a new module and *without*
  relocating the authored agent list. Reject.

## 4. Decision: (b) Parameter

Chosen because it is the only option that removes the cycle **topologically** (no
import edge), rather than merely deferring the eager read while leaving the fragile
cyclic graph intact. It preserves every anti-regression invariant — AC3 byte-identical
`--project` forwarding (unchanged `projectArgs`), AC4 source-of-truth coupling (verified
via `normalize.ts`), untouched hook *bodies* beyond the minimal name-derivation, and no
edits to `project-args.ts`/`scaffold-plugin.ts`/`playwright.config.ts`. The spec
explicitly green-lights adding the parameter. It is simplest in the sense that matters:
it makes the bug structurally impossible to reintroduce by removing the back-edge, where
the lazy-read merely papers over it.

### 4.1 The one genuine divergence between (a) and (b), examined

The mechanisms differ in **where** the configured project names are sourced, and this
is a deliberate, examined choice — not an accident:

- Lazy read (a) keeps reading the **static default export** (`string[]`) — the same
  object and value as today's line 24.
- Parameter (b) sources them in the hook from the **normalized** `ctx.config`
  (`AgentDefinition[]`), via `config.roles.test.agents.map((a) => a.id)`. This is a
  *different object* from the static export, but it yields the **identical value and
  order**. Two facts from `src/config/normalize.ts` make this exact, not coincidental:
  - **Order preserved (AC3).** `normalize.ts:30` builds the array as
    `input.roles.test.agents.map((id) => agents[id])`. `Array.prototype.map` preserves
    order, so `ctx.config.roles.test.agents` is in declared order and
    `.map((a) => a.id)` is `["haiku","gpt"]` in that order.
  - **Ids equal the declared keys (AC4).** `normalize.ts:25` sets
    `agents[id] = { ...def, id }` while iterating `Object.entries(input.agents)`, so
    `AgentDefinition.id` is exactly the declared agent-map key (`"haiku"`, `"opus"`,
    `"gpt"`) — not a provider/model string. `.map((a) => a.id)` recovers exactly the
    declared ids.

So under (b) the forwarded `configuredProjectNames` is byte-identical in value and
order to the declared `roles.test.agents` — AC3 and AC4 hold simultaneously.

**Why sourcing from `ctx.config` (the normalized form) is the right choice for (b),
not a regression:** the hook *already* computes `runnableAgentIds` from
`ctx.config.roles.test.agents.map((a) => a.id)` (filtered). Deriving
`configuredProjectNames` from the **same** normalized source means both arguments to
`projectArgs` come from one consistent place, in one expression, instead of mixing the
static export with the normalized context. It removes `verify-e2e`'s dependency on the
config module entirely (the whole point), and `runnableAgentIds` is, by construction, a
subset of `configuredProjectNames` in the same order — which is precisely what
`projectArgs`'s "filter runnable ids to those that are configured project names" relies
on. The shift from static `string[]` to normalized-`.map(id)` is value-preserving here
and strictly more internally consistent.

## 5. Requirement / AC coverage

| Req / AC | How the parameter design meets it |
|----------|-----------------------------------|
| R1 / AC1 (config loads cleanly; `check:config` exits 0) | Removing `verify-e2e`'s `import config` makes the config import graph acyclic; `skillsmith.config.ts` initializes with no eager deref of an undefined `config`. |
| R2 / AC2 (default export structurally unchanged) | The fix only moves *where* the project names are sourced (caller → param). It does not alter the `defineConfig(...)` object: `roles.test.agents` stays `["haiku","gpt"]`; `agents`/`roles`/`hooks`/`selfImprovement`/`mode` unchanged. The hook body change is a local var + one extra argument, not a config-shape change. |
| R3 (no module-init read of imported config) | `verify-e2e.ts` no longer imports `config` at all, so it cannot read it at module top — verifiable by code inspection (the `import config` line is deleted). |
| R4 / AC3 (byte-identical, order-preserving `--project` forwarding) | `projectArgs` is unchanged; same runnable set in → same selectors out. Runnable `["haiku"]` → `["--project","haiku"]`; `["haiku","gpt"]` → `["--project","haiku","--project","gpt"]`. Unit-covered today by `src/__tests__/project-args.test.ts`. |
| R4 / AC4 (source-of-truth coupling) | Names derive from normalized `ctx.config.roles.test.agents` (`normalize.ts:30-31`), itself derived from declared `roles.test.agents`. Verified above. |
| R5 / AC5 (root-suite regression test) | New `src/__tests__/<name>.test.ts` does `await import("../../testing-project/skillsmith.config")`, asserts no-throw + shape: `roles.test.agents` deep-equals `["haiku","gpt"]` (the static default export is `string[]`), `agents` keys `["haiku","opus","gpt"]`, `mode === "test-only"`, `hooks.afterAllScenarios` is a function. Pure import-and-shape, no wp-env/Playwright/network; runs under `node --import tsx --test`. Fails on HEAD (the import throws), passes after. The root suite already imports from `testing-project` (see `project-args.test.ts:4`), so the cross-package import path is established. |

### Notes for the test-writer
Authored shape values, confirmed against committed HEAD `skillsmith.config.ts`:
`mode: "test-only"`; `agents` keys `haiku`, `opus`, `gpt`; `roles.test.agents: ["haiku","gpt"]`;
`hooks.afterAllScenarios` is a function. The static default export's `roles.test.agents`
is the **input** shape (`string[]` of ids), not the normalized `AgentDefinition[]` — assert
against `["haiku","gpt"]`, not objects.

Import specifier: from `src/__tests__/<name>.test.ts`, use
`await import("../../testing-project/skillsmith.config")` — **omit the `.ts` extension**
(matching the existing root-suite convention at `src/__tests__/project-args.test.ts:4`;
`tsx`/node resolve the `.ts`). The relative depth `../../testing-project/...` is correct
and resolves to the worktree's `testing-project/skillsmith.config.ts`. Runner is the
existing `node --import tsx --test` — no extra tooling. The same import-and-shape module
fails-before (the import throws the `TypeError` on unfixed HEAD) and passes-after
(import resolves + all four shape facts hold), satisfying AC5's before/after contract.

## 6. Out-of-scope / untouched, by design
- `playwright.config.ts` — separate entry, one-directional import, not in the cycle (§2).
- `project-args.ts`, `scaffold-plugin.ts` — not read at module-init in the cycle; no change needed.
- `@automattic/skillsmith` public API — untouched; the parameter is internal to `testing-project`.
- The skip-misconfigured-agents feature — the runnable-set forwarding semantics are
  preserved exactly; only the *source* of the configured-names list moves.
