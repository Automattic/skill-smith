# Spec Review

## Verdict: approved

## Summary

The spec for reconciling the skip-misconfigured-agents branch with current `trunk` is precise, complete, and fully grounded in the actual repository state. I verified every load-bearing claim against the codebase: the trial merge of `trunk` into the branch produces exactly the 19 conflicting files the spec lists (byte-for-byte the same set); the structural overlaps the spec calls out are all real (the `runScenario` call site where the branch's `agentFilter`/`skipped` meet trunk's `scenarios` plumbing; the 4-arg skip-bearing `writeRunReport` signature; the `interactive` → `interactiveMode` rename plus `get interactive()` getter that a naive take-both would fail to compile; the `summary.ts` skip-aware `exitCode = skipped.length > 0 ? 2 : allPass ? 0 : 1` over trunk's early-return refactor). The toolchain delta is correct — the branch currently pins Biome 2.4.12 and trunk pins 2.5.0, so requirement 3's "adopt trunk's exactly-pinned 2.5.0" is accurate. The three changesets (`minor`/`patch`/`none`) and all nine skip-feature test files exist as named, the three branch-only files are present and not in the conflict set, the verification commands match trunk's authoritative `.rp.md` guardrail table verbatim (`npx tsx scripts/validate-changesets.ts`, `npx changeset status --since=origin/trunk`), and the relevant source trees currently carry no process vocabulary. The requirements cover all ten consolidated requirements, the acceptance criteria are specific and in Given-When-Then form (including the edge cases: all-misconfigured → exit 2, judge-stop, improver-halt, exit-code precedence, and the no-skip-no-announcement negative case), and the Out of Scope section is explicit and matches the research. The spec correctly stays on the observable-outcome side of WHAT-vs-HOW by deferring the integration mechanism (merge commit vs alternative) to the design phase while still pinning the outcomes that any mechanism must satisfy.

## Issues

None. The spec is approved as written.

### Notes (non-blocking, for downstream awareness)

- This is a reconciliation spec, so the WHAT is unusually close to mechanics: requirement 2 enumerates 19 files and requirement 4 names specific call sites and signatures. This is appropriate rather than a HOW leak, because each is framed as an observable post-reconciliation outcome ("the call carries both...", "the writer retains its skip-bearing signature") and the spec explicitly leaves the integration mechanism to the design phase in Out of Scope. Downstream phases should preserve that framing — the named files and signatures are acceptance anchors, not a prescribed merge procedure.
- The spec correctly scopes the live Playwright/wp-env e2e exclusion as design-verifiable and outside the `npm test` guardrail, with only its selector logic (`project-args.test.ts`) guardrail-observable. Downstream work should not claim the full live e2e path is proven by `npm test`.
