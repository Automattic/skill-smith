# Code Plan Review

## Verdict: rejected

## Summary

The plan is dense, comprehensive, and faithfully implements the design's OQ-6 / OQ-7 substitutions (the `none`-bump starter and the `workflow_dispatch`-only initial trigger). Coverage of spec acceptance criteria A1–A11 / B1–B8 / C1–C4 / D1–D4 is complete for the code deliverables, with Phase 5 docs correctly excluded. Traces are mostly accurate; dependency ordering is correct (Task 1 → 2 → 3 → 4/5 → 6 → 7/8). The granular details — exact regex, exact JSON for `.changeset/config.json`, exact YAML for both workflows, exact validator pseudocode, exact starter front matter — are pinned tightly enough that two independent code-writers should converge on the same diff.

The blocking concerns are concentrated in Task 6 (the validator + its tests), where two specificity gaps force the implementer to make a non-trivial mid-task decision: (1) how the test file imports the validator across the `src/__tests__/` ↔ `scripts/` directory boundary, given that `scripts/` is outside `tsconfig.json:include`, and (2) how the CLI smoke test computes the absolute path to the validator script — the plan literally leaves an `<absolute path to scripts/validate-changesets.ts>` placeholder in the spec. There is also a smaller traceability gap and one ordering nit around Task 6's listed dependency on Task 5. None of these are catastrophic, but each is a real hole worth fixing in the next iteration. After they are addressed, this plan is approval-ready.

## Issues

### Issue 1: Task 6 leaves the test file's import path for `validateChangesetFile` unspecified

**What's wrong:** Task 6 ships the validator at `scripts/validate-changesets.ts` and the tests at `src/__tests__/validate-changesets.test.ts`. The plan never says how the test file imports the validator. The implementer must choose a relative path (e.g. `import { validateChangesetFile } from "../../scripts/validate-changesets"`), decide whether to include the `.ts` extension under `tsx` + `verbatimModuleSyntax: true`, and decide how this interacts with `tsconfig.json:include` (`scripts/**` is *not* in the include list — design-doc.md:137 explicitly accepts this and points to the test file's `import` statement as the load-bearing typecheck path). This is the same `import` statement the design depends on, but the plan never names it.

**Where in plan:** Task 6, file `src/__tests__/validate-changesets.test.ts` (lines 206–215 of `code-plan.md`).

**Suggestion:** Add an explicit instruction such as:

> Import the pure function via `import { validateChangesetFile } from "../../scripts/validate-changesets"` (no `.ts` extension — matches existing `src/__tests__/*.test.ts` import style and the `tsx` runtime's resolution). This import is the load-bearing typecheck path for `scripts/validate-changesets.ts` per the design's "Untouched but contract-relevant components" section (design-doc.md:137).

Also note explicitly in the acceptance for Task 6 that `npm run typecheck` must pass — this catches import-time type errors in the script's exported surface and is the mechanism the design relies on for keeping `scripts/` typechecked despite being outside `tsconfig.json:include`.

**Why it matters:** The plan otherwise pins file paths, JSON keys, regex literals, and YAML structures with surgical precision. Leaving the only cross-directory import path implicit is inconsistent with that precision, and a wrong guess (e.g. `import("../../scripts/validate-changesets.ts")` with the extension, which `verbatimModuleSyntax` may reject in some configurations) costs the implementer a debug cycle. More importantly, the design has *already declared* this import to be load-bearing for typechecking the script — the plan should reflect that.

### Issue 2: Task 6 leaves the smoke test's absolute-path resolution unspecified — literally a placeholder

**What's wrong:** Task 6's CLI smoke test reads (line 216): `Use node:child_process's spawnSync with node and the args [ "--import", "tsx", "<absolute path to scripts/validate-changesets.ts>" ]`. The angle-bracketed `<absolute path to scripts/validate-changesets.ts>` is an unresolved placeholder. The plan does not say how to compute it. The implementer must choose between several reasonable approaches:

- `path.resolve(fileURLToPath(import.meta.url), "../../..", "scripts/validate-changesets.ts")`
- `fileURLToPath(new URL("../../scripts/validate-changesets.ts", import.meta.url))`
- `path.resolve(process.cwd(), "scripts/validate-changesets.ts")` (works only when `npm test` is invoked from repo root)
- A hardcoded relative path that breaks if the test is moved

Each works under slightly different assumptions about cwd and test layout. The plan should pick one.

**Where in plan:** Task 6, CLI smoke test bullet (line 216).

**Suggestion:** Replace the placeholder with a concrete construction such as:

> Resolve the script path with `fileURLToPath(new URL("../../scripts/validate-changesets.ts", import.meta.url))` so the test is independent of `process.cwd()` (the smoke test will set the spawn `cwd` to a tmpdir, so a cwd-relative path would not resolve correctly).

The choice of `fileURLToPath(new URL(..., import.meta.url))` is the existing convention in `src/__tests__/` (e.g. `src/__tests__/scenarios.test.ts:8–9` and `src/__tests__/smoke.test.ts:9`), so it also matches the codebase's style.

**Why it matters:** A placeholder in a task description is a design decision the code-writer has to make. The whole point of the plan phase is to eliminate those decisions before the code-writer starts.

### Issue 3: Task 6's "Depends on Task 5" claim is unsupported by the listed test cases

**What's wrong:** Task 6 lists Task 5 as a dependency on the grounds that "`npm test` against the worktree's actual `.changeset/` passes cleanly; the unit tests do not depend on Task 5 but the smoke test verifying behaviour on the real tree benefits from it." Reading the actual test cases (lines 207–216), the unit tests construct their `raw` inputs as in-memory strings and pass `pkgName` and `version` as parameters — they do NOT read the worktree's `.changeset/`. The CLI smoke test spawns the script with `cwd` set to a freshly-`mkdtempSync`'d temporary directory containing a *seeded* `package.json` and `.changeset/`, NOT the worktree's own tree. So neither the unit tests nor the smoke test exercise the worktree's `.changeset/<starter>.md`.

The actual dependency on Task 5 is from Task 6's acceptance criterion: `Running "npx tsx scripts/validate-changesets.ts" from the worktree root exits 0 (because Task 5's starter is valid).` This is a single one-off acceptance smoke check, not a test the suite drives. The dependency is real but the framing is misleading and may confuse the implementer about whether the unit tests should pass before Task 5 is complete (they should — the unit tests have no dependency on Task 5 whatsoever).

**Where in plan:** Task 6, `Depends on:` line (line 218).

**Suggestion:** Reword the dependency clause to:

> **Depends on:** Task 1 (the validator reads `package.json:name` and `package.json:version` in `main()`, which is exercised by Task 6's worktree-root acceptance smoke check), Task 3 (so the worktree has a `.changeset/` directory `main()` can list when run from the repo root for the acceptance smoke check), Task 5 (so the worktree's `.changeset/` contains a valid starter and the acceptance smoke check exits 0). The unit tests in `src/__tests__/validate-changesets.test.ts` themselves have no runtime dependency on Tasks 3 or 5 — they exercise `validateChangesetFile` against in-memory strings — and the CLI smoke test exercises a freshly-seeded `.changeset/` in a tmpdir. The Task 5 dependency exists solely so the acceptance criterion `Running npx tsx scripts/validate-changesets.ts from the worktree root exits 0` holds.

This wording makes the actual coupling shape obvious and removes the misleading hint that the unit tests need the worktree's tree to be in any particular state.

**Why it matters:** A misread dependency leads to incorrect ordering or to mysterious test failures (e.g. an implementer who runs `npm test` after only Task 6 but not Task 3/5 sees the worktree-root smoke check fail and wonders whether the unit tests are wrong). Being precise about which dependency item enforces which acceptance criterion prevents that confusion.

## Non-blocking nits

These are recommendations, not blockers; the implementer or the next plan iteration may address or defer them.

- **Task 6 line-number constants are pinned in the validator spec but OQ-2 leaves them open.** The plan instructs the implementer to push `line: 1` / `line: 2` / `line: 4` at specific code points (lines 182, 185–191) but also says (line 185) "the line constants 1/2/4 are pseudocode placeholders per OQ-2; the contract is 'line-numbered errors' and a stable `:<n>:` separator". If OQ-2 is genuinely open, the plan could relax the spec to "use a stable integer line number per call site; document the chosen values in a code comment" rather than naming `1`/`2`/`4` as if they were contract. The current wording is slightly confusing — it reads "pin these but they're placeholders". Either pin or release; not both.

- **Task 2 acceptance "lockfileVersion is unchanged" is brittle.** The parenthetical "regeneration should not bump the lockfile schema unless npm did so on its own" rescues it, but a code-writer encountering an npm version that bumps the schema (e.g. npm 11 vs 10) may interpret the acceptance criterion strictly and either revert the bump or fail the task. Consider rewording to "`lockfileVersion` is `3` unless the installed npm CLI bumps the schema on its own — in which case the bump is acceptable and surfaces in the PR description for the reviewer's awareness."

- **Task 1 and Task 2 could be one task.** A clean separation aids per-task diffs, but the work units are tightly coupled (rename → regenerate lockfile) and the dependency is mechanical. Not a blocker; flagged in case future plans want to consolidate trivial follow-on tasks.

- **`actions/checkout@v6` / `actions/setup-node@v6` pins faithfully follow the design and spec, but the design's review accepts this as a published-major mismatch (current public majors are `v4` and `v6` respectively; the spec pins both at `v6`).** The plan inherits the design's pin without flagging the caveat. The implementer may want to know that `actions/checkout@v6` does not exist on the GitHub Marketplace at code-writing time. Either the spec/design or this plan should surface a one-line note ("if `v6` is not yet released at code time, substitute `v4`; commit message explains the deviation"). Borderline; the design review's own caveat already discusses this.

- **Task 5's starter file naming.** The plan says (line 144) the file can be named via `npx changeset add`'s random output or via a deterministic name like `initial-scaffolding.md`. The implementer's natural path is "run `npx changeset add`, then edit the resulting file to the specified `none`-bump body". But `npx changeset add` is interactive (and the default it writes is a `patch` or `minor` bump). The plan should clarify whether the file is created directly (without invoking the CLI) or via `npx changeset add` followed by an edit. Cosmetic; the acceptance criterion catches a wrong content regardless.

- **Task 6's `Err.line` constants and B7 second assertion.** Test B7 asserts `validateChangesetFile(... "1.0.0")` returns an empty array — but the body of that test case (per the plan: `'---\n"@automattic/skillsmith": major\n---\n\nBreaking change.\n'`) is non-empty and the front matter is well-formed, so the post-1.0 call returns `[]` as expected. The framing "the pre-1.0 guard only fires while `version` starts with `0.`" is correct. No issue, just confirming the test is internally consistent.

- **Task 6's B6 input produces two errors, not one.** The body `'---\n"@automattic/skillsmith": minor\n---\n\n\n'` passes through the regex (matching empty body), R-shape-3 pushes an "empty body" error, then YAML parsing succeeds and the per-entry rules push *no* additional errors because `name === "@automattic/skillsmith"` and `bump === "minor"` are both valid. So only one error is produced. ✓ No issue, just flagging that the assertion `"msg includes 'empty body'"` is appropriately lenient.

- **Validator's non-string YAML values.** The design review's caveat noted that `parseYaml(fmRaw) as Record<string, string>` is unsound when the YAML value is a non-string (e.g. number, array). The downstream `VALID.has(bump)` still catches this, but the error message ("invalid bump '...'") may be confusing. The plan inherits the design's approach without adding a `typeof bump === "string"` guard. Not a contract concern.

- **Task 7's "Validate" step name.** The plan says (line 280) "The validator step name contains 'Validate' or 'validate' (so `C4`'s 'fails the gate at the validator step' claim is traceable in the Actions log)." The YAML in Task 7 uses `name: Validate changeset shape`. Consistent. ✓
