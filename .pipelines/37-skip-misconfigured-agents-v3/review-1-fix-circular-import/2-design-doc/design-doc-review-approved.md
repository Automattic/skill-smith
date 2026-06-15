# Design Doc Review

## Verdict: approved

## Summary

The design doc is sound, complete, and faithful to the spec. It correctly
diagnoses the two-node import cycle and its single fatal module-init read, chooses
a mechanism (parameterize `runE2eVerification`, delete the back-edge `import
config`) that is justified against two credible rejected alternatives, and traces
every requirement and acceptance criterion to a concrete decision. I verified each
load-bearing claim against committed HEAD (`de374fd`) — the cycle topology, the
sole back-edge and sole eager read, the `normalize.ts`-backed AC4 coupling, the
unchanged `projectArgs` guaranteeing AC3, the `string[]` static-export shape behind
the AC5 assertions, the import-specifier convention, and the `playwright.config.ts`
out-of-scope rationale — and all of them hold. The fix stays inside
`testing-project`, does not weaken the `config-smoke` guardrail, and does not touch
the package's public API. No scope creep, no unjustified decisions, and the doc
stays at design altitude (architecture and decisions, not a line-by-line
implementation plan). Approved.

## Verification against committed HEAD (de374fd)

- **Cycle and lines.** `testing-project/skillsmith.config.ts:6` imports
  `runE2eVerification` from `./eval/utils/verify-e2e`; `verify-e2e.ts:12` imports the
  default `config` from `../../skillsmith.config`; `verify-e2e.ts:24` is the
  module-init `const CONFIGURED_PROJECT_NAMES = config.roles.test.agents`. Exactly as
  the doc and research state.

- **Sole back-edge, sole eager read.** `grep -rn "skillsmith.config"
  testing-project/eval/` returns exactly one hit (`verify-e2e.ts:12`). The only live
  `config` references in `verify-e2e.ts` are the import (`:12`), the const (`:24`),
  and the const's single consumer at the `projectArgs(...)` call (`:142`). No function
  body dereferences the imported `config`. So removing the import + const and
  threading `configuredProjectNames` through leaves nothing else needing `config` —
  the doc's claim is correct, and the cycle is removed *topologically*, not merely
  deferred.

- **AC4 source-of-truth coupling.** `src/config/normalize.ts:24` sets `agents[id] =
  { ...def, id }` (id injected from the declared agent-map key); `normalize.ts:30`
  builds `roles.test.agents` as `input.roles.test.agents.map((id) => agents[id])`
  (order-preserving). So the hook's `ctx.config.roles.test.agents.map((a) => a.id)`
  recovers `["haiku","gpt"]` in declared order — value- and order-identical to the
  former static read. The hook at `skillsmith.config.ts:69-71` already uses this exact
  expression for `runnableAgentIds`, so deriving `configuredProjectNames` from the same
  source is consistent, not a regression.

- **AC3 forwarding.** `testing-project/eval/utils/project-args.ts:8-16` (`projectArgs`)
  is pure and stays unchanged; the design moves only the *source* of its second
  argument. `src/__tests__/project-args.test.ts` already locks the byte-identical,
  order-preserving selectors.

- **Static export is `string[]` (AC2/AC5 shape).** `src/config/define-config.ts:9-13`
  is an identity passthrough returning `SkillsmithConfigInput`, so the default export's
  `roles.test.agents` is the `string[]` `["haiku","gpt"]`. The doc asserts the test
  against this static shape (not `AgentDefinition[]`), which is correct and matches the
  contract `project-args.test.ts:44-63` already guards.

- **AC5 feasibility.** `src/__tests__/project-args.test.ts:4` already imports from
  `../../testing-project/...` with no `.ts` extension — the cited convention and depth
  are real and resolve. The authored shape facts (`mode: "test-only"`; agents keys
  `haiku`/`opus`/`gpt`; `hooks.afterAllScenarios` a function) all match
  `skillsmith.config.ts`. Fail-before is genuine: importing `skillsmith.config` as the
  entry throws the `TypeError` on HEAD; pass-after follows from the acyclic graph.

- **`playwright.config.ts` out of scope.** `playwright.config.ts:4` imports `config`
  one-directionally and `:23` reads `config.roles.test.agents` at module top, but
  `skillsmith.config.ts` never imports it (no back-edge), and the `config-smoke` entry
  is `skillsmith.config.ts` (`testing-project/package.json:11`), not playwright. It is
  a separate root that loads after `skillsmith.config.ts` has fully initialized.
  Correctly excluded, and its `projects` derivation correctly stays as-is.

## Notes (non-blocking, for the Plan/Code phases)

These do not affect the verdict; the design is approvable as written.

- The doc's `runE2eVerification` "before" sketch shows three parameters
  (`iterationDirectory`, `scenarios`, `runnableAgentIds`), matching HEAD
  `verify-e2e.ts:37-41`, and the "after" adds `configuredProjectNames` as the fourth.
  Accurate. The sketch is explicitly labelled illustrative, which is the right altitude
  for a design doc.

- The doc lists `scaffold-plugin.ts` as an acyclic leaf "imports only
  `node:fs`/`node:path`," confirmed against HEAD (`scaffold-plugin.ts:1-2`). Likewise
  `project-args.ts` has zero local imports. The graph description is exact.
