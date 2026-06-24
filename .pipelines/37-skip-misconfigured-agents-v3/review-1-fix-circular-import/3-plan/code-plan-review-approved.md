# Code Plan Review

## Verdict: approved

## Summary

The plan is complete, feasible, correctly ordered, and fully traceable to the
spec and design doc. Every requirement (R1–R5) and acceptance criterion (AC1–AC5)
maps to at least one task, and the plan's own coverage table is accurate. I
verified every cited line number, symbol, signature, and behavioral claim against
the actual source at committed HEAD (`b4866d1`, which the worktree is checked out
to with a clean tree): the back-edge `import config` at `verify-e2e.ts:12`, the
module-init `const CONFIGURED_PROJECT_NAMES = config.roles.test.agents` at
`verify-e2e.ts:24`, the three-parameter `runE2eVerification` signature at
`verify-e2e.ts:37-41`, the `projectArgs(runnableAgentIds, CONFIGURED_PROJECT_NAMES)`
call at `verify-e2e.ts:140-143`, the `afterAllScenarios` hook destructuring `config`
from `ctx` at `skillsmith.config.ts:60`, the `runnableAgentIds` derivation and
three-argument call at `skillsmith.config.ts:69-77`, the `normalize.ts` id-injection
(`agents[id] = { ...def, id }`) and order-preserving `.map((id) => agents[id])`,
the `check:config` entry (`node --import tsx -e "await import('./skillsmith.config.ts')"`),
the root-suite runner glob (`node --import tsx --test src/__tests__/*.test.ts`), and
the no-`.ts`-extension dynamic-import convention at `project-args.test.ts:4`. Task
ordering is sound (Tasks 1+2 must ship together or the config won't typecheck;
Task 3 depends on both), each task's acceptance is objective and tied to a guardrail
or to code inspection, and the changeset claim is correct. All five `.rp.md` code
guardrails (plus the docs-phase `changeset-status`) stay green. No over-reach: the
out-of-scope files the spec names are explicitly left untouched.

## Verification notes (non-blocking; recorded for traceability)

- **Completeness — every AC covered.**
  - AC1 (clean load, `check:config` exits 0): Tasks 1+2 remove the back-edge and
    the eager read; the cycle becomes a DAG. Verified by the `config-smoke`
    guardrail.
  - AC2 (default-export shape preserved): Task 2 explicitly leaves `defineConfig({...})`
    unchanged (only the hook body changes); Task 3 asserts the full shape.
  - AC3 (order-preserving `--project` forwarding): Task 1 keeps the `projectArgs`
    call shape; `project-args.ts` is untouched (confirmed: pure, signature
    `(runnableAgentIds, configuredProjectNames)`, already unit-covered by
    `project-args.test.ts`).
  - AC4 (source-of-truth coupling): Task 2 derives `configuredProjectNames` from
    the normalized `config.roles.test.agents.map((a) => a.id)`, not a literal. The
    `normalize.ts` facts the plan relies on (order-preserving map + id == declared
    key) are present in the source.
  - AC5 (regression test fails before / passes after): Task 3.

- **Feasibility — claims match source at HEAD.** All four `config` *identifier*
  references in `verify-e2e.ts` are the import (line 12) and the const read (line
  24) plus the comment block (lines 21–23) the plan deletes; the remaining textual
  "config" occurrences (lines 22/34/138) are prose mentioning `playwright.config.ts`
  / "misconfigured", not the imported identifier. So Task 1's acceptance ("no
  reference to the identifier `config` at all") is achievable, and deleting the
  import leaves no unused-import lint error because its sole use (line 24) is
  removed in the same task.

- **Ordering/dependencies correct.** Task 1 (signature gains the 4th param) and
  Task 2 (call site supplies it) are interdependent and the plan states they must
  ship in the same batch. Task 3 depends on both. No cycles, no missing
  prerequisites.

- **Guardrails stay green.**
  - `typecheck`: the new 4th param and the 4-arg call are mutually consistent;
    `configuredProjectNames` is `string[]` and `.map((a) => a.id)` over normalized
    `AgentDefinition[]` yields `string[]`.
  - `lint` (Biome, `recommended: true`): clean import deletion; no dangling symbol.
  - `tests`: new `src/__tests__/config-loads.test.ts` is picked up by the glob;
    `project-args.test.ts` is untouched.
  - `config-smoke`: cycle broken topologically → entry import resolves → exits 0.
  - `changeset-format`: `validate-changesets.ts` validates only the *format* of
    *existing* `.changeset/*.md`; it does not require a new one. Plan correctly
    adds none.

- **Changeset claim sound.** All changes are confined to `testing-project/**` (the
  fixture, excluded per `CONTRIBUTING.md`) and `src/__tests__/**` (tests-only,
  excluded per `CONTRIBUTING.md`). No changeset is required, and the docs-phase
  `changeset-status` (`--since=origin/trunk`) stays green because no
  changeset-requiring path is touched.

- **No over-reach.** `playwright.config.ts`, `scaffold-plugin.ts`,
  `project-args.ts`, and `src/config/normalize.ts` are explicitly out of scope and
  left untouched — matching the spec's Out of Scope. The plan adds exactly one
  parameter to an internal function, which the spec explicitly permits, and does
  not freeze any signature the spec left open.
