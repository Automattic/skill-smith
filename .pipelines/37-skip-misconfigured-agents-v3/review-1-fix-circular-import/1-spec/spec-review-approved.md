# Spec Review

## Verdict: approved

## Summary

The revised spec (commit 5cb85f4) resolves all three findings from the prior
rejection and remains faithful to the intent and research, well-scoped, and
correctly mechanism-agnostic. Requirements 1–5 map cleanly to RR1–RR5, the Out of
Scope section is explicit and complete, and every load-bearing claim checks out
against source: the eager read at `verify-e2e.ts:24`
(`const CONFIGURED_PROJECT_NAMES = config.roles.test.agents;`), the
config↔verify-e2e 2-node cycle (`skillsmith.config.ts:6` imports
`runE2eVerification`; `verify-e2e.ts:12` imports the default `config` back), the
`["haiku","gpt"]` default-export shape with `agents` keys `["haiku","opus","gpt"]`,
`mode = "test-only"`, and `hooks.afterAllScenarios` a function, the
order-preserving `projectArgs` (`project-args.ts:13-15`,
`.filter(...).flatMap(...)`), `playwright.config.ts:23`'s one-directional read
outside the cycle, and the `project-args.test.ts` root-suite precedent. The spec
does not freeze `runE2eVerification`'s arity (3-ary today; the Out of Scope section
explicitly leaves a parameter fix open), invents no new scope, and the mandated
regression test remains a pure import + shape check.

## Resolution of prior findings

**Prior Issue 1 — Req 2/AC2 "structurally unchanged" not backed by the test.**
Resolved via the prior review's option (a). Requirement 5 (second bullet) and AC5
now mandate the regression test assert the broader structural sample the research
positive control enumerated (spec-research.md lines 91–98): `roles.test.agents`
deep-equals `["haiku","gpt"]`, `agents` has keys `["haiku","opus","gpt"]`, `mode`
equals `"test-only"`, and `hooks.afterAllScenarios` is a function. This is a sound,
load-bearing sample of the structure — any "loads-but-blanked" pseudo-fix would
blank `agents`, `mode`, or the hook and be caught. Requirement and required test now
describe the same surface.

**Prior Issue 2 — unobservable AC3 negative.** Resolved. The standalone negative
acceptance criterion ("no module-init read occurs") is removed; the AC list is now
contiguous (AC1–AC5) with every "then" checkable. Requirement 3 reframes the
root-cause property explicitly as code-inspection-verifiable ("not a
runtime-observable event; it is verifiable by code inspection of the config import
graph") and notes its runtime *consequence* — a clean load — is what AC1 and the
regression test (AC5) observe.

**Prior Issue 3 — AC4 ordering / multi-id case unpinned.** Resolved. The
renumbered AC3 now pins both cardinalities: runnable `["haiku"]` (gpt skipped) →
`["--project","haiku"]`, and runnable `["haiku","gpt"]` (neither skipped) →
`["--project","haiku","--project","gpt"]`, "in that order — one `--project <id>`
pair per runnable id, preserving runnable-set order." Requirement 4 (second bullet)
states the same order-preservation property. Both stay mechanism-agnostic (no
`projectArgs` internals referenced); they pin only the observable order.

## Notes (non-blocking)

AC2's "otherwise unchanged from their authored values" clause is literally broader
than the representative subset the mandated test mechanically checks (it does not
deep-equal `selfImprovement` or the full `roles` sub-tree). This is the deliberate
and research-endorsed outcome of taking option (a): the test samples the
load-bearing facets of the structure rather than enumerating a byte-for-byte
equality of every nested field, which is sufficient to catch the gutting pseudo-fix
the requirement targets. Not an issue — recorded only for downstream awareness.
