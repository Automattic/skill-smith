# Spec research — Fix the testing-project circular import (v3)

Review run: `review-1-fix-circular-import` of pipeline `37-skip-misconfigured-agents-v3`.

This is a tightly-scoped bug-fix review run. The base run shipped the
skip-misconfigured-agents feature but left a circular import between
`testing-project/skillsmith.config.ts` and `testing-project/eval/utils/verify-e2e.ts`
that breaks module initialization. The `config-smoke` guardrail
(`npm --prefix testing-project run check:config`) catches it and currently exits 1.

This document is the running Q&A record between `spec-analyst` and
`spec-researcher`. It feeds the spec-writer; it is NOT the spec.

## Confirmed grounding (pre-Q&A, from reading the code)

- **Reproduced.** `npm --prefix testing-project run check:config` exits **1** today.
  The crash is `TypeError: Cannot read properties of undefined (reading 'roles')`
  at `testing-project/eval/utils/verify-e2e.ts:24`:
  `const CONFIGURED_PROJECT_NAMES = config.roles.test.agents;`.
- **The cycle.** `skillsmith.config.ts` imports `runE2eVerification` from
  `eval/utils/verify-e2e.ts` (line 6); `verify-e2e.ts` imports the default
  `config` back from `../../skillsmith.config` (line 12) and dereferences it at
  module top level (line 24). During the cycle `config` is still `undefined`
  when `verify-e2e.ts`'s module body runs, so line 24 throws.
- **What `check:config` loads.** The npm script is
  `node --import tsx -e "await import('./skillsmith.config.ts')"`. Its import
  graph is `skillsmith.config.ts` → {`scaffold-plugin.ts`, `verify-e2e.ts`} →
  (`verify-e2e.ts`) {`project-args.ts`, back-edge to `skillsmith.config.ts`}.
  `playwright.config.ts` is NOT in this graph (config does not import it), so the
  cycle in scope is exactly config ↔ verify-e2e.
- **`playwright.config.ts` also reads `config.roles.test.agents`** at module top
  level (line 23), but it imports config one-directionally (no back-edge), so it
  does not participate in the cycle and is not exercised by `check:config`.
- **Static vs normalized config shape.** In the *static* default export,
  `roles.test.agents` is `string[]` (`["haiku", "gpt"]`). So
  `CONFIGURED_PROJECT_NAMES` is the array of declared test-agent ids, and
  `projectArgs(runnableAgentIds, CONFIGURED_PROJECT_NAMES)` filters runnable ids
  against that set. (Inside the hook, `config.roles.test.agents` is the
  *normalized* `AgentDefinition[]`, which is why the hook maps `a => a.id`.)
- **Test surface.** `testing-project` has NO test runner (no vitest, no test
  script). Repo tests live at root `src/__tests__/` and run via
  `node --import tsx --test`. The root suite ALREADY imports
  `testing-project/eval/utils/project-args` directly
  (`src/__tests__/project-args.test.ts`), so a root-level regression test that
  imports `testing-project/skillsmith.config.ts` is precedented and feasible.

## Q&A log

### Q1 — The exact, testable definition of "fixed"

**Asked:** Is config-smoke exiting 0 a sufficient/complete definition of "the
import graph loads cleanly"? Does anything in the config's full import graph go
unloaded by `check:config` (e.g. `playwright.config.ts`)? And must the loaded
config's *shape/value* be asserted unchanged, or is "no throw on import" the bar?

**Researcher answer (evidence-backed):**
- Cycle is a 2-node, **entry-point-dependent** ESM cycle. Proof it's
  entry-dependent: importing `./eval/utils/verify-e2e.ts` as the entry
  *succeeds* (config runs to completion first, so `config` is defined by the
  time line 24 runs); importing `./skillsmith.config.ts` as the entry *fails*.
  Same files, opposite outcomes — `check:config` uses the failing entry.
- The **eager read at `verify-e2e.ts:24` is the sole module-init-time read of
  `config` in the cycle.** config only *calls* `runE2eVerification` at runtime
  inside the `afterAllScenarios` hook (line 72); it reads nothing from
  verify-e2e at module top level. `scaffold-plugin.ts` and `project-args.ts`
  import nothing from config — pure, not in the cycle.
- `config.roles.test.agents` on the **default export is `string[]`**
  (`["haiku","gpt"]`), per `src/config/types.ts` `TestRoleInput.agents: string[]`
  and `defineConfig` being an identity passthrough. Normalization to
  `AgentDefinition[]` happens later at harness-load time, NOT on the default
  export. `playwright.config.ts:23` treats each element as a string id
  (consistent). `skillsmith.config.ts:69`'s `.map(a => a.id)` operates on the
  *normalized* `ctx.config` (a different object), so both are correct.

**Resolution / decisions for the spec:**
- **Definition of "fixed" = config-smoke exits 0**, and that is sufficient.
  `check:config` imports `./skillsmith.config.ts` as the entry — exactly the
  failing entry — so a green config-smoke proves the cycle no longer breaks
  module initialization. The spec bounds "full import graph" to what
  `check:config` loads (config → scaffold-plugin, verify-e2e → project-args +
  the config back-edge). `playwright.config.ts` is NOT in that graph (config
  never imports it) and is out of scope for the fix's load assertion; it
  imports config one-directionally and is not part of the cycle.
- **The bar is not merely "no throw."** The default export must remain
  structurally intact: `roles.test.agents` still equals `["haiku","gpt"]` and
  the rest of the config (agents, other roles, hooks, selfImprovement) is
  unchanged. A "fix" that loaded by gutting/altering the config value would be
  a regression. So: config-smoke exits 0 AND the loaded config's value is
  unchanged from its authored intent.

**Supporting evidence (researcher positive control):** Temporarily replacing the
eager read at `verify-e2e.ts:24` with a lazy stub, then loading config, yields a
clean load AND an intact default export: `roles.test.agents = ["haiku","gpt"]`,
`agents` keys = `["haiku","opus","gpt"]`, `mode = "test-only"`,
`hooks.afterAllScenarios` is a function. This confirms the correct fix produces
both outcomes, and that asserting the shape (`config.default.roles.test.agents`
deep-equals `["haiku","gpt"]`, default export structurally unchanged) is a cheap
guard against a "loads-but-blanked" pseudo-fix that would silently break the
project-selector forwarding R10/AC10 depend on. `tsconfig.json` lists both
`skillsmith.config.ts` and `playwright.config.ts` as independent roots — they are
separate entry points, not a config→playwright import edge.

### Q2 — The behavior-preservation boundary (what the spec must protect)

**Asked:** Which exact runtime behaviors must stay invariant after the fix? And
should the spec require that the configured project names continue to derive from
the config's declared test agents, or is that over-constraining the design phase?

**Researcher answer (confirmed/extended, tied to lines):**

Invariants that MUST be preserved (the fix may not regress any):
1. **Runnable set still drives the e2e run.** The hook still passes the runnable
   (post-skip-filter) set into `runE2eVerification` (caller
   `skillsmith.config.ts:72-76`; runnable set computed at lines 69-71). **Phrase
   this as a semantic invariant, NOT "signature is frozen"** — fix-option (b)
   would legitimately add a 4th `configuredProjectNames` parameter. The invariant
   is "the runnable set still flows in and nothing else decides which agents
   Playwright runs," leaving arity free for the design phase.
2. **Project-selector forwarding is byte-identical for a given runnable set.**
   `projectArgs(runnableAgentIds, CONFIGURED_PROJECT_NAMES)` at
   `verify-e2e.ts:140-143` must still receive `["haiku","gpt"]` as its
   `configuredProjectNames` arg. `projectArgs` (`project-args.ts:8-16`) intersects
   the runnable ids with that set and emits `--project <id>` pairs, so for any
   given `runnableAgentIds` the forwarded selectors are identical to today. This
   is exactly the mechanism base R10 (lines 196-199) names — protect it precisely.
3. **The hook body in `skillsmith.config.ts:60-78` is OUT of scope.** There
   `config` is the destructured `ctx.config` — the *normalized* `SkillsmithConfig`
   where `roles.test.agents` is `AgentDefinition[]` (hence `.map(a => a.id)` at
   line 70). It is a DIFFERENT object from the module default export that
   `verify-e2e.ts:12` imports (un-normalized input, `string[]`). The cycle is
   entirely on the default-export side; `ctx.config` is supplied by the harness at
   runtime and never touches module-init. The runnable-set computation need not
   and should not change.
4. **`playwright.config.ts` is untouched** and not in the cycle. Its `projects`
   derivation (line 23) stays as-is; base AC10 (line 345) explicitly requires the
   skip work NOT to need hand-editing that project list, and the fix doesn't.

**Source-of-truth coupling — REQUIRED, and not over-constraining:** The set of
configured project names fed to `projectArgs` MUST continue to derive from
`skillsmith.config.ts`'s declared `roles.test.agents` (currently `["haiku","gpt"]`),
NOT a hardcoded literal or a list re-derived from another source — so that
renaming/adding/removing a declared test agent automatically updates the e2e
project filter. The invariant comment already states this at `verify-e2e.ts:21-24`
("the configured project names are exactly the test-agent ids the config
declares"). Decoupling would silently reintroduce exactly the staleness base R10
(lines 199-201) was written to kill. Both legitimate fix options satisfy it
natively (option (a) lazy-reads `config.roles.test.agents` from the same default
export at call time; option (b) passes `config.roles.test.agents` from
`skillsmith.config.ts`), so the invariant forbids only DECOUPLING, not either
mechanism.

**Two anti-regression ACs the spec-writer can derive (mechanism-agnostic):**
- **AC-i (forwarding unchanged):** Given `runnableAgentIds = ["haiku"]` (gpt
  skipped), the `--project` selectors forwarded to the Playwright child are
  exactly `["--project","haiku"]` — identical to current behavior.
- **AC-ii (source-of-truth coupling):** The `configuredProjectNames` consumed by
  `projectArgs` deep-equals `skillsmith.config.ts`'s `roles.test.agents`
  (`["haiku","gpt"]`); it is not a hardcoded literal divorced from the config.

### Q3 — The regression test: required, shape, location

**Asked:** Is a new regression test required, or does config-smoke already
satisfy fail-before/pass-after? If a root-suite test is warranted, what is its
minimal shape and assertion, and is it feasible under `node --import tsx --test`?
What must it avoid?

**Researcher answer (all claims empirically verified by the researcher):**

1. **Require BOTH** — keep config-smoke as the CI gate AND add one root-suite
   test (option (c)). config-smoke is a genuine fail-before/pass-after gate
   (exits 1 today, 0 after fix) and is in `.rp.md`, so it technically satisfies
   "fails before, passes after." But a root-suite test adds value the guardrail
   can't: (i) it runs under `npm test`
   (`node --import tsx --test src/__tests__/*.test.ts`) — the suite contributors
   run locally and that gates the package — so a future refactor reintroducing
   the eager read is caught by `npm test`, not only by the separate config-smoke
   step; (ii) it pins the SHAPE/source-of-truth bar in the same assertion,
   covering Q1's no-throw bar AND Q2's coupling bar in one test; (iii) precedent
   exists — `src/__tests__/project-args.test.ts` already imports into
   `testing-project`, so a config-import test is idiomatic. Cost ~10 lines.

2. **Minimal shape (matches existing `node:test` + `node:assert/strict` style):**
   a `src/__tests__/<name>.test.ts` that does
   `await import("../../testing-project/skillsmith.config")`, then asserts the
   default export is defined AND `config.default.roles.test.agents` deep-equals
   `["haiku","gpt"]`. **Verified fail-before/pass-after:** the researcher wrote
   this exact test, ran it before any fix → `not ok ... Cannot read properties
   of undefined (reading 'roles')`; applied a simulated lazy-read fix → `ok ...
   pass 1 fail 0` (and config-smoke then exited 0); restored `verify-e2e.ts` and
   deleted the throwaway test, leaving git clean except this `1-spec/` artifact
   folder. **Feasibility confirmed — no tsx/path/ESM gotchas:** `import.meta.url`
   + `readFileSync(resolve(here, "eval/prompts/*.md"))` (config.ts:8-16) resolves
   from the config FILE's own URL, not the importer's, so prompt paths resolve
   regardless of which suite imports it; tsx handles the `.ts` import and the
   extensionless `../../testing-project/skillsmith.config` specifier exactly as
   `project-args.test.ts` already relies on. The test is mechanism-agnostic:
   passes under either the lazy-read or the parameter fix (both remove the eager
   read).

3. **The test must stay a pure import + shape check.** Importing config.ts has
   EXACTLY ONE side effect: reading the two committed prompt files
   (`eval/prompts/testing-agent.md`, `improver.md`) at config.ts:9-16 — no setup
   needed. Confirmed there are NO other module-init side effects in the whole
   config import graph: scaffold-plugin's writes are inside `scaffoldPlugin`;
   verify-e2e's `execSync`/`execFileSync`/`writeFileSync` (wp-env, Playwright,
   `.wp-env.json`) are ALL inside `runE2eVerification`, never at top level; the
   hook only *calls* `runE2eVerification` at runtime, which the test never
   triggers. The test MUST avoid: (1) invoking `runE2eVerification` or the
   `afterAllScenarios` hook (only read the default export); (2) anything needing
   wp-env, Playwright, network, or credentials (none touched by import);
   (3) `OPENAI_API_KEY` — irrelevant; skip logic is runtime-only and not
   exercised by importing config. The test needs zero environment.

---

## Agreed requirements (handoff to spec-writer)

The fix is a tightly-scoped bug fix inside `testing-project`. The spec must
capture these requirements; it must NOT redesign the skip-misconfigured feature
and must NOT weaken the `config-smoke` guardrail or change `@automattic/skillsmith`'s
public API (per intent constraints).

**RR1 — Cycle is broken / config loads cleanly.**
`npm --prefix testing-project run check:config` exits **0**. Because that script
imports `./skillsmith.config.ts` as the entry — the exact entry that fails today —
a green config-smoke proves the config import graph (rooted at
`skillsmith.config.ts`: → scaffold-plugin, → verify-e2e → project-args + the
config back-edge) initializes without throwing. `playwright.config.ts` is a
separate entry point outside config-smoke and not part of the cycle; it is out of
scope.

**RR2 — Default export shape preserved.** After the fix the default export is
structurally unchanged: `config.default.roles.test.agents` deep-equals
`["haiku","gpt"]`, and `agents`, `roles`, `hooks`, `selfImprovement`, `mode` are
unchanged. (Guards against a "loads-but-blanked" pseudo-fix.)

**RR3 — Root cause removed.** The fix removes the module-initialization-time read
of the imported `config` in `verify-e2e.ts` (today
`const CONFIGURED_PROJECT_NAMES = config.roles.test.agents;` at line 24) — the sole
cycle hazard. How is the design phase's choice: lazy-read at call time, or pass the
configured project names in as a parameter. The spec states the property (no
module-init read of `config` in the cycle), not the mechanism.

**RR4 — Skip-misconfigured behavior preserved (anti-regression).**
- The runnable (post-skip-filter) set still drives the e2e run — it flows into
  `runE2eVerification` and nothing else decides which agents Playwright runs.
  State this semantically; do NOT freeze the function's arity (the parameter fix
  legitimately adds a 4th arg).
- For a given runnable set the `--project` selectors forwarded to the Playwright
  child are identical to today (e.g. `runnableAgentIds = ["haiku"]` →
  `["--project","haiku"]`).
- The configured project names fed to `projectArgs` continue to derive from
  `skillsmith.config.ts`'s declared `roles.test.agents`, not a hardcoded literal
  or other source, so renaming/adding/removing a declared test agent updates the
  e2e filter automatically.
- `skillsmith.config.ts:60-78` (the hook body, on normalized `ctx.config`) and
  `playwright.config.ts` are untouched.

**RR5 — Regression test required (both layers).** Keep config-smoke green as the
guardrail AND add one root-suite test at `src/__tests__/<name>.test.ts` that
`await import("../../testing-project/skillsmith.config")`, asserts it resolves
without throwing, and asserts `config.default.roles.test.agents` deep-equals
`["haiku","gpt"]`. Proven to fail before the fix and pass after, mechanism-agnostic.
Pure import + shape check: no wp-env/Playwright/network/credentials, never invokes
the hook or `runE2eVerification`.

**Out of scope:** any redesign of skip-misconfigured-agents; weakening
`config-smoke`; changing `@automattic/skillsmith`'s public API; changes to
`playwright.config.ts`, the hook body, `scaffold-plugin.ts`, or `project-args.ts`
beyond what RR3 strictly requires.
