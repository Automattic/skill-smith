# Spec Review

## Verdict: rejected

## Summary

This is a high-quality, near-complete spec. It faithfully covers all eight consolidated requirements, resolves the three open scope decisions (enforcement = verifiable-but-no-new-CI-gate; the a11y lint outcome with means deferred; uniform reformatting of generated/fixture files) in a way that is consistent with the intent's goal of *full* WordPress-standard adoption, and it captures the load-bearing nuances the research surfaced: the per-file-type delimiter-spacing carve-out for JSON and CSS (Req 2, Req 3), the Biome ≥ 2.5.0 bump plus `$schema` re-pin (Req 6), and the lint side-effect the bump forces (Req 9). The acceptance criteria are mostly in Given-When-Then form and testable, the Out of Scope section is explicit and well-justified, and the spec generally holds spec altitude (deferring the a11y *means* and all config mechanics to later phases). I verified the premises against the codebase: `biome.json` matches the described baseline, `docs/index.html:83` does carry the roleless-`<div>`-with-`aria-label` that triggers the a11y finding, `npm run lint` runs in `release.yml`, and `changeset-gate.yml` fires on PRs to trunk with `changedFilePatterns` covering `src/**`, `bin/**`, and `package.json`. The rejection is for one moderate testability gap (the verify-only check is never pinned to anything observable) plus two smaller clarity gaps. None require rework of the spec's direction — only tightening.

## Issues

### Issue 1: The "verify-only formatting check" (Req 7) is never pinned to an observable artifact, making it un-actionable and un-testable

**What's wrong:** Req 7 requires that "A verify-only formatting check exists that passes ... and would fail ... if any in-scope file drifted," and the acceptance criteria say "when the verify-only formatting check is run, then it reports no changes and exits zero." But the spec never says *what* this check is at an observable level. Per the research (Q4), `biome format .` run without `--write` is already a verify-only check that exits non-zero on drift — using the Biome that is already installed. Under that reading the requirement is satisfied before any work is done, which makes it vacuous: it tells an implementer nothing about whether a new artifact (e.g. a named `format:check` npm script, or a CI step that is explicitly *not* a new gate) must be produced. It also makes the acceptance test non-deterministic — a test author cannot know which command to invoke ("the verify-only formatting check") to assert exit 0 / non-zero.

**Where in spec:** Requirement 7 and the two "Tree compliance and verification" acceptance criteria that reference "the verify-only formatting check."

**Suggestion:** State the observable identity of the check without prescribing implementation. For example, require that "a documented, repeatable verify-only formatting command exists (named in the repo, e.g. an npm script) that exits zero on the committed tree and non-zero on drift," OR, if the intent is merely that Biome's existing verify capability suffices, say so explicitly ("no new artifact is required; `biome format` in verify mode is the check"). Either resolves it; the spec must commit to one so the acceptance criteria become writable as a deterministic test.

**Why it matters:** Without this, two implementers could legitimately build different things (one adds a `format:check` script and asserts on it; another adds nothing and points at `biome format .`), and a test author cannot write the verification test the acceptance criteria call for. This is the spec's central "verifiable, not merely available" claim, so the ambiguity sits on a load-bearing requirement.

### Issue 2: The reformat's "no behavioral change" claim is asserted but not bounded for non-source formattable files

**What's wrong:** Req 8 states the reformat "changes only whitespace, quote characters, and trailing-comma tokens — it introduces no behavioral change," and Req 5 brings `package-lock.json` and `testing-project/` files into the reformat surface. For `.json` files (lockfiles, `package-lock.json`, the eight tracked JSON files) the WordPress style flips array-bracket spacing off and object-brace spacing on, and re-pins indentation — but JSON has no "quote character" choice and no trailing commas, so the stated change-set ("quote characters, and trailing-comma tokens") doesn't cleanly describe what happens to JSON. More importantly, the spec never states the observable guarantee that the reformatted `package-lock.json` remains a valid, install-equivalent lockfile (i.e. `npm ci` still resolves the same tree). The research notes JSON is already tab-indented, suggesting near-zero churn, but the spec leaves the "no behavioral change" guarantee for lockfiles implicit.

**Where in spec:** Requirement 5 (generated files in scope) and Requirement 8 (behavior preserved), and the corresponding acceptance criteria.

**Suggestion:** Either broaden Req 8's enumerated change-set so it also describes JSON reformatting (indentation/bracket-spacing only), or add an explicit observable guarantee that reformatting generated JSON (notably `package-lock.json`) is non-semantic — e.g. "after reformatting, `npm ci` resolves the same dependency tree" or "the lockfile remains valid and unchanged in resolved versions." Keep it at spec altitude (an observable outcome, not how it is achieved).

**Why it matters:** Req 5 deliberately pulls generated lockfiles into scope, so "no behavioral change" must demonstrably cover them. As written, the strongest behavioral-preservation criteria (`typecheck`, `test`, `lint`) don't exercise lockfile validity, leaving a tested-behavior gap precisely where the spec chose to expand scope.

### Issue 3: The changeset-gate `none` resolution (research Q6) is neither required nor declared out of scope

**What's wrong:** The research (Q6 and "Notes for later phases") establishes that the PR will mechanically trip `changeset-gate.yml` because it touches `src/**`, `bin/**`, and `package.json`, and recommends a `none`-bump changeset as the resolution. I confirmed the gate's `changedFilePatterns` cover those paths. The spec is silent on this. Because the reformat is unavoidably going to modify `src/**` and `bin/skillsmith.mjs`, the gate firing is a certainty for this change, not a hypothetical. The spec neither requires the PR to satisfy the gate nor lists "changeset handling" as out of scope, so it is simply unaddressed.

**Where in spec:** Absent — would belong either as a brief acceptance-level note ("the change satisfies the repo's changeset gate") or as an explicit Out of Scope line deferring it to later phases.

**Suggestion:** Add one line resolving this. The cleanest spec-altitude framing is an Out of Scope (or "deferred to plan") note: "Satisfying the changeset gate is a landing-process detail for later phases (the research recommends a `none`-bump changeset); the spec does not prescribe the changeset mechanics." If the owner prefers, instead add an acceptance criterion that the repo's required PR checks (including the changeset gate) pass. Either is acceptable; silence is not, because the gate firing is guaranteed for this change.

**Why it matters:** This is borderline spec altitude (it is a process/CI concern), which is exactly why an explicit decision is warranted rather than an accidental omission — the spec already chose to address the sibling CI concern (the lint side-effect, Req 9) as in-scope, so leaving the equally-certain changeset-gate consequence unmentioned is an inconsistency in how forced side-effects are surfaced. A single deferral line keeps the spec honest without dragging mechanics into it.
