# Spec Review

## Verdict: rejected

## Summary

The spec is faithful to the intent and research, well-scoped, and correctly
mechanism-agnostic: it does not freeze `runE2eVerification`'s arity (verified
3-ary today; a parameter fix would make it 4-ary) and leaves the lazy-vs-parameter
choice to design. RR1–RR5 all map cleanly to Requirements 1–5 and the Out of Scope
section, and every load-bearing claim checks out against source (`verify-e2e.ts:24`
eager read, the config↔verify-e2e cycle, the `check:config` script, the
`["haiku","gpt"]` default-export shape, `playwright.config.ts`'s one-directional
import outside the cycle, and the `project-args.test.ts` precedent). It is rejected
on one substantive coverage gap and two precision issues, all narrow and quick to
fix. The core requirements are sound; this is a tightening pass, not a rewrite.

## Issues

### Issue 1: Requirement 2 / AC2 promise a "structurally unchanged" guarantee that no acceptance criterion or required test actually verifies

**What's wrong:** Requirement 2 (and AC2) assert the default export is structurally
unchanged — `roles.test.agents` deep-equals `["haiku","gpt"]` **and** `agents`,
`roles`, `hooks`, `selfImprovement`, `mode` are "otherwise unchanged from their
authored values." This is the spec's explicit guard against a "loads-but-blanked"
pseudo-fix. But the only concrete verification mechanism the spec mandates — the
regression test in Requirement 5 / AC6 — asserts a strict subset: no-throw plus
`roles.test.agents` deep-equals `["haiku","gpt"]`. Nothing in the spec verifies the
rest of Requirement 2. A fix that, e.g., dropped the `afterAllScenarios` hook,
altered `selfImprovement.maxIterations`, or changed `mode` while leaving
`roles.test.agents` intact would pass AC1, AC2 (as actually testable), AC4, AC5,
and AC6 — yet violate Requirement 2. AC2 restates the requirement but provides no
checkable procedure for the "otherwise unchanged" clause, so it is not testable as
written.

**Where in spec:** Requirement 2, AC2, Requirement 5 (third bullet of the test
shape), AC6.

**Suggestion:** Reconcile the breadth of the guarantee with its verification. Either
(a) broaden the required test's assertion so it covers what Requirement 2 claims —
e.g. assert the presence/shape of `agents` (keys `["haiku","opus","gpt"]`), `mode`
(`"test-only"`), and that `hooks.afterAllScenarios` is a function, in addition to
the `roles.test.agents` deep-equal — and reflect that in AC6; or (b) narrow
Requirement 2 / AC2 to exactly the property the mandated test checks (config
imports without throwing and `roles.test.agents` deep-equals `["haiku","gpt"]`) and
drop or downgrade the broader "agents/roles/hooks/selfImprovement/mode unchanged"
clause to non-binding context. The research positive control (spec-research.md
lines 91–98) already enumerates a concrete broader shape — `agents` keys
`["haiku","opus","gpt"]`, `mode = "test-only"`, `hooks.afterAllScenarios` is a
function — so option (a) is cheap and available. Pick one so requirement and
acceptance criterion describe the same surface.

**Why it matters:** An acceptance criterion that the spec's own required test
cannot satisfy is a coverage hole on the single requirement written specifically to
catch the most likely bad fix. Two implementers could each "satisfy the spec" and
ship materially different configs.

### Issue 2: AC3 is stated as an unobservable negative with no verification path

**What's wrong:** AC3 ("no module-initialization-time read of the imported `config`
occurs anywhere in that graph") is a structural/negative property. Unlike AC1, AC2,
AC4–AC6 it has no runnable check — you cannot directly observe "a read did not
happen." Requirement 3 acknowledges it "states the observable property," but the
property as phrased (absence of a read) is not observable at runtime; only its
*consequence* (clean load) is, and that is already AC1/AC6.

**Where in spec:** Requirement 3, AC3.

**Suggestion:** Either reframe AC3 around an observable proxy — e.g. "verifiable by
inspection of the config import graph: `verify-e2e.ts` no longer reads
`config.roles.test.agents` (or any property of the imported `config`) at module top
level" — making clear it is a code-review criterion, or fold the root-cause
property into Requirement 3 as rationale and drop AC3 as a standalone runnable
criterion (since AC1 + AC6 already prove the cycle no longer breaks init). Avoid
leaving a Given-When-Then AC whose "then" cannot be checked.

**Why it matters:** Acceptance criteria must be checkable. A negative criterion with
no inspection or execution path either gets skipped or gets argued about; naming it
a code-inspection criterion (or removing it) keeps the AC list honest.

### Issue 3: AC4's "identical to today's behavior" is underspecified without an order guarantee

**What's wrong:** AC4 forwards `["--project", "haiku"]` for runnable `["haiku"]`,
which is correct and unambiguous for the single-id case. But the underlying
invariant (RR4 bullet 2, "byte-identical for a given runnable set") covers
multi-element sets too, where ordering matters: `projectArgs` preserves
`runnableAgentIds` order (verified at `project-args.ts:13-15`,
`runnableAgentIds.filter(...).flatMap(...)`), so `["haiku","gpt"]` yields
`["--project","haiku","--project","gpt"]` and the order is load-bearing. The single
example AC does not pin the ordering property the invariant depends on.

**Where in spec:** AC4, Requirement 4 (second bullet).

**Suggestion:** Either add the two-id case explicitly (runnable `["haiku","gpt"]` →
`["--project","haiku","--project","gpt"]`, preserving runnable-set order) to AC4, or
state in Requirement 4 that the forwarded selectors preserve the order of the
runnable set and append one `--project <id>` pair per runnable id that is a
configured project name. Keep it mechanism-agnostic (do not reference `projectArgs`
internals); just pin the observable order.

**Why it matters:** "Identical to today" is the anti-regression bar; with only the
one-element example, an implementer could satisfy AC4 while reordering or
de-duplicating selectors in the multi-id path and technically pass. The base
feature (gpt skipped vs. both runnable) exercises both cardinalities, so the
multi-id ordering is in-scope for "no regression."
