# Design Doc Review

## Verdict: rejected

## Summary

The design is thorough, well-traced to the spec, and shows strong reasoning about most decisions. However, it contains two demonstrable correctness bugs that would break acceptance criteria when implemented as written — a broken regex that rejects the canonical empty-changeset format (failing B2/A6), and an unaddressed `changeset publish` behavior on the no-op merge that would publish `@automattic/skillsmith@0.1.0` to npm without warning (violating D3 as stated). A third issue is structural: the validator pseudocode is not actually testable as written, despite the design committing to per-rule unit tests (B1–B8). These are not nits — the regex bug was empirically reproduced against the real output of `npx changeset add --empty`, and the publish behavior follows from reading `@changesets/cli@2.31.0`'s `publishPackages.ts`. A revised design addressing these three issues will be ready for approval.

## Issues

### Issue 1: Validator regex does not match the canonical empty-changeset format

**What's wrong:** The design's pseudocode (`design-doc.md:244`) uses the regex `/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/` to split a changeset into front matter and body. This regex requires a `\n` *immediately before* the closing `---` fence. Empirically verified against the real output of `npx --yes @changesets/cli@2.31.0 add --empty`, which writes exactly the 8 bytes `---\n---\n` (file `.changeset/free-hotels-smoke.md` in the reproduction at `/tmp/changeset-empty-test`):

```js
const raw = "---\n---\n";
raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/); // → null
```

The regex returns `null` for the canonical empty-changeset content. Consequently the validator's first branch fires and emits `"missing or unterminated front matter (expected two '---' fences)"` for the very file the design defines as the valid empty-changeset shape (`design-doc.md:142`, "Empty changeset. Exact bytes `---\n---\n`"). This breaks the empty-changeset escape hatch end-to-end:

- B2 ("an empty changeset … passes") would fail.
- A6 (the empty `.changeset/<random>.md` shipped in this PR) would fail the gate on the implementing PR's own merge.
- D2 / D3 — the no-op Version Packages PR flow — would never start, because the gate fails before merge.

This is the load-bearing case of the entire design (R1.3, R2.4, R8.6) and the spec is explicit that this exact byte sequence must pass.

**Where in design doc:** Section "Validator pseudocode (illustrative, not production code)" (`design-doc.md:226-282`), specifically the regex on line 244 and the empty-changeset rule R-shape-2 in the validation table (`design-doc.md:217`).

**Suggestion:** Replace the regex with one that does not require `\n` before the closing `---`, e.g. `/^---\r?\n([\s\S]*?)(?:\r?\n)?---\r?\n?([\s\S]*)$/`. The fence-handling and CRLF-tolerance can be picked in implementation; the design just needs to commit to a regex that matches the empirically-produced empty changeset. Verify in the revised design with a one-line `node -e` reproduction against `---\n---\n`.

**Why it matters:** This is the regression that the entire R2.5 validator exists to prevent: a validator that misclassifies a known-valid changeset shape is worse than no validator at all, because it converts the canonical recovery path (`changeset add --empty`) into a hard-error path on the very PR introducing the gate. Contributors can't escape the gate they're being onboarded to.

### Issue 2: `changeset publish` on the no-op Version Packages PR merge will publish 0.1.0

**What's wrong:** The design claims (`design-doc.md:459`) that merging the no-op Version Packages PR triggers `release.yml`, which runs `changesets/action`'s publish path, which "sees no pending changes (`changeset publish` finds nothing newer than what npm has), and **does nothing**. No version bump, no npm publish, no tag, no Release. D3 verifies this."

This is factually wrong for the first-ever publish of `@automattic/skillsmith`. Reading `@changesets/cli@2.31.0`'s `publishPackages.ts` (which the spec's R7.4 itself references): the publish step compares the local `package.json:version` to the set of versions already on npm via `infoAllow404(packageJson)`. For `@automattic/skillsmith`, the spec records (`spec.md:20`, `requirements.md:172`) that `npm view @automattic/skillsmith` returns 404 — i.e. zero published versions. So `!publishedVersions.includes("0.1.0")` is `true`, and `changeset publish` runs `npm publish` against `@automattic/skillsmith@0.1.0`.

Sequence:
1. The implementing PR (this PR) merges. `release.yml` fires. Action sees one changeset (the empty one) → opens the no-op Version Packages PR.
2. Maintainer merges the no-op PR. The merge deletes the empty changeset.
3. `release.yml` fires on the post-merge `trunk` push. Action sees zero changesets → enters the *publish* branch.
4. `changeset publish` runs. Local version is `0.1.0`. Npm has nothing. `npm publish` is invoked. If E4 is configured, `@automattic/skillsmith@0.1.0` is published with provenance — silently, on a "no-op" merge.

Empirical scratch in `requirements.md:162` verifies only the `changeset version` half (`0.1.0 + empty → no bump`) and "action does nothing when zero non-README changesets exist" — but that verification was done on a private package, not against the publish branch's npm-info lookup. The publish-branch behaviour is unverified in the spec and contradicts what the design claims.

The downstream consequences: D3 ("merging the no-op PR results in no publish") fails as stated. D4 ("first real feature PR ships end-to-end") becomes the *second* publish, not the first. If E4 is *not* configured at this point, the publish fails 401 silently on what was advertised as a no-op merge — the source tree is fine, but the on-call maintainer now has to debug a "wait, why did the workflow try to publish on the no-op merge?" surprise.

**Where in design doc:** Section "Empty-changeset mechanics for the first release (R8.6, R2.4, D2)" (`design-doc.md:447-463`), specifically steps 7 and the closing paragraph beginning "The first real publish (D4) happens on the *next* feature PR after this one merges."

**Suggestion:** Pick one and document it explicitly:

1. **Recommend the maintainer trigger the no-op merge with `workflow_dispatch: skip_publish: true`** so the publish path is suppressed for the first merge. Document this as a one-time pre-merge step in the PR description's pre-merge checklist (alongside E1–E4). The kill switch already exists in the design (`design-doc.md:333-336`); just route the first merge through it.
2. **Accept the first publish on the no-op merge as the intended outcome**, treat E4 configuration as a hard pre-merge gate, and update D3's claim accordingly. This is the simpler path — the spec is the contract, but the spec's D3 is empirically wrong; flag it for the orchestrator and revise.
3. **Set `package.json:version` to `0.1.0` only after the first real release** — i.e. start at `0.0.0` or a pre-release marker. Rejected by R3.6, but worth weighing if option 1 / 2 is unappealing.

The design must pick and justify; "the empirical scratch repo verifies this" is not enough because the scratch repo did not exercise this path.

**Why it matters:** Either an unexpected first publish goes out under the no-op merge (option 2 unaddressed), or the first publish silently fails with a 401 (E4 not configured) — both contradict the design's stated D3 success criterion. The maintainer reading the design as a contract for behaviour will be surprised either way.

### Issue 3: Validator pseudocode is not testable as written, but the design commits to per-rule unit tests

**What's wrong:** The design commits (`design-doc.md:596-599`) to:
> "Add Node test-runner tests at `src/__tests__/validate-changesets.test.ts` (one per B1–B8 case, plus a smoke test that drives the validator over a fixtures directory)."

But the validator pseudocode (`design-doc.md:226-282`) is a single imperative top-level script — it reads `package.json`, iterates `.changeset/*.md`, accumulates errors in a module-scoped array, and calls `process.exit(1)`. Nothing is exported. Importing this file from a test would:
1. Execute the imperative body on import (reading whatever `.changeset/` happens to exist in cwd, not the fixture).
2. Either call `process.exit(1)` (terminating the test process) or `process.exit(0)` (passing silently regardless of test setup).

There is no surface to test against B1–B8 individually. The design table (`design-doc.md:213-224`) maps each B-case to a rule, but a rule that lives inside an imperative top-level block isn't reachable from a unit test.

This is the gap between "the validator must be ~50 lines" (the spec's hint, R2.5) and "the validator must be unit-testable" (the design's commitment). The two are compatible — extract one or two functions and gate the script entry behind a `import.meta.url === pathToFileURL(process.argv[1]).href` check — but the design doesn't say so, leaving the implementer to either re-architect against the design or skip the tests.

**Where in design doc:** Section "Validator pseudocode (illustrative, not production code)" (`design-doc.md:226-282`) for the structure, and "Decision: Test strategy — unit tests for the validator, manual verification for the gate and release flows" (`design-doc.md:594-600`) for the testing commitment.

**Suggestion:** Reshape the validator pseudocode (or add a brief explicit note) to factor out at least:

- `function validateChangesetFile(file: string, raw: string, pkgName: string, version: string): Err[]` — pure, returns errors without mutating module state or exiting.
- `function main(): number` — reads `package.json`, lists `.changeset/*.md`, calls `validateChangesetFile` for each, prints errors, returns the exit code.
- An entry guard: `if (import.meta.url === pathToFileURL(process.argv[1]!).href) process.exit(main());`

Tests then `import { validateChangesetFile } from "../../scripts/validate-changesets.ts"` and run B1–B8 directly against in-memory strings without touching disk or invoking the runner. The design only needs to commit to this shape — exact factoring is implementation detail.

**Why it matters:** Without this, either (a) the tests are not written (the design's commitment in "Test strategy" silently lapses), or (b) the implementer re-architects against the design in the plan/code phase and the design's pseudocode becomes stale-documentation. Either outcome is worse than spending two lines in the design to specify the testable shape.

## Non-blocking nits

These do not change the verdict. The writer can address them, defer them, or ignore them.

- **Off-by-one line citation for `yaml`.** Spec R2.5 said "package.json:46" (which is `zod` — `yaml` is on line 45). The design propagates the same error (`design-doc.md:123`, `design-doc.md:610`). One-character fix. Substance is correct: `yaml@^2.8.3` is already a dependency.

- **`[skip ci]` framing in R9.1 resolution is loose.** The design states (`design-doc.md:379`) "The action's `[skip ci]` commit message **prevents `release.yml` from firing on its own version commit**." The Version Packages commit lives on `changeset-release/trunk`, which `release.yml` doesn't watch anyway (`release.yml` triggers on `push: trunk`). The actual safety comes from the action no-op'ing when no changesets are pending, not from `[skip ci]`. The forward-looking guidance is still correct; the framing is just misleading.

- **`tsconfig.json:include` does not cover `scripts/**`.** The validator at `scripts/validate-changesets.ts` will not be checked by `npm run typecheck` (verified by reading `tsconfig.json:19`: `include: ["src/**/*", "skillsmith.config.ts", "examples/**/*"]`). This is fine — `tsx` runs the TypeScript directly at CI time — but the design could note that the validator script is not part of the typechecker's scope, or recommend extending `tsconfig.json:include` to cover `scripts/**`. Either is acceptable; silent omission may confuse a contributor who expects `tsc` to catch their typo.

- **Validator error line numbers are hard-coded constants in the pseudocode** (`line: 1`, `line: 2`, `line: 4`). The design's OQ-2 acknowledges this is unsettled. The pseudocode could note explicitly that exact line numbers are implementation detail; the contract is "errors are line-numbered, one per file:offset," not "errors are always at lines 1/2/4." Cosmetic.

- **`actions/checkout@v6` and `actions/setup-node@v6` are taken from the spec verbatim.** As of late 2025 the published majors were v4 for both. The design is faithful to the spec, so this is a spec-level concern surfaced by the spec-reviewer too — not a design issue. Flag for the orchestrator if the maintainer wants real-world pinning.
