# Code Review

## Verdict: rejected

## Batch scope

Tasks reviewed (8 commits, `475cd49..1897e11`):

- Task 1 (`475cd49`) — `package.json` rename to `@automattic/skillsmith` + Changesets devDeps/scripts/publishConfig
- Task 2 (`c265b86`) — `package-lock.json` regeneration
- Task 3 (`3080c8e`) — `.changeset/config.json`
- Task 4 (`cf305c6`) — `CHANGELOG.md` initial `## 0.1.0` entry
- Task 5 (`a00adea`) — `.changeset/initial-scaffolding.md` (`none`-bump starter)
- Task 6 (`b791590`) — `scripts/validate-changesets.ts` + `src/__tests__/validate-changesets.test.ts`
- Task 7 (`c75e610`) — `.github/workflows/changeset-gate.yml`
- Task 8 (`1897e11`) — `.github/workflows/release.yml` (workflow_dispatch-only)

## Summary

The batch ships every artifact the plan calls out and the structural acceptance criteria for all eight tasks check out at the field level — package.json rename, lockfile, `.changeset/config.json`, CHANGELOG.md heading, `none`-bump starter, validator + tests (B1–B8 + CRLF + CLI smoke all pass), gate workflow, and release workflow (`workflow_dispatch`-only). Both new files (`scripts/validate-changesets.ts`, `src/__tests__/validate-changesets.test.ts`) pass Biome lint/format. `changeset version` consumes the `none`-bump starter into the exact D2 diff (delete the starter, no version bump, no `CHANGELOG.md` change — verified empirically by running `npx changeset version` in a `/tmp` copy of the worktree).

However, **Task 1's rename introduces a regression in `npm run typecheck`** that the code-writer mis-classified as pre-existing. At trunk (`fce8c4e`) `npm run typecheck` exits clean. At HEAD (`1897e11`) it emits eight TypeScript errors in `examples/skillsmith.config.ts`, all rooted in the file's `import { defineConfig } from "skillsmith"` line: pre-rename that import resolved via npm's self-name resolution (`package.json:name === "skillsmith"`); post-rename to `@automattic/skillsmith` it no longer resolves, the `defineConfig` symbol becomes `any`, and every binding pattern below it loses its inferred shape. This directly violates Task 6's acceptance bullet "`npm run typecheck` passes" (`code-plan.md:298`) and breaks the substantive intent of A11 / D1 / F1: the manual bootstrap run the maintainer is supposed to trigger on `release.yml` after this PR merges runs `npm run typecheck` as a pre-publish gate (R4.4, `release.yml:38`), and it will fail at that step.

The lint failures the code-writer also flagged (control-character regexes in `src/progress/tracker.ts`) *are* genuinely pre-existing on trunk and out of scope for this batch — they should be tracked as a separate concern.

## Checks

| Check | Command | Result |
| ----- | ------- | ------ |
| Lockfile install | `npm ci` | Pass (added 222 packages) |
| Unit + smoke tests | `npm test` | Pass (147 pass, 2 skipped, 0 fail). All B1–B8 + CRLF + CLI smoke tests for the validator pass. |
| Typecheck | `npm run typecheck` | **Fail (8 errors)** in `examples/skillsmith.config.ts` — `Cannot find module 'skillsmith'` + cascading implicit-any errors. **Regression introduced by Task 1's rename.** Trunk passes this check; HEAD does not. |
| Lint | `npm run lint` | Fail (3 errors, 6 warnings) in `src/progress/tracker.ts`. Pre-existing on trunk — out of scope for this batch. |
| Biome check on new files | `npx biome check scripts/validate-changesets.ts src/__tests__/validate-changesets.test.ts` | Pass |
| Validator from repo root | `npx tsx scripts/validate-changesets.ts` | Pass (exit 0; starter accepted as a valid `none`-bump entry) |
| Changeset status | `npx changeset status` | Pass (no packages to bump — `none`-bump entry as expected) |
| YAML parses | `node -e "yaml.parse(...)"` for both workflows | Pass (shape inspected; `release.yml` has no top-level `push:` key; `changeset-gate.yml` uses `pull_request: branches: [trunk]`) |
| `changeset version` D2 simulation | Worktree copy in `/tmp/cs-sim3` after `npm ci` | Pass — starter deleted, `package.json:version === "0.1.0"` (unchanged), `CHANGELOG.md` unchanged |
| Package name agreement | `package.json:name`, `package-lock.json:packages[""].name`, `.changeset/config.json:changelog[1].repo` (GH path), `CHANGELOG.md` heading, `.changeset/initial-scaffolding.md` front-matter key | All consistent: npm name `@automattic/skillsmith` everywhere; GH path `Automattic/skillsmith` in `config.json` |
| `actions/checkout@v6`, `actions/setup-node@v6` published | `gh api repos/actions/checkout/releases` / `repos/actions/setup-node/releases` | Both released (`v6.0.3` / `v6.4.0`) — no caveat substitution needed |
| Workflow expression sanity | Manual Node simulation of the inverted ternary | Pass — `skip_publish=true → ""`; `false/undefined → "npx changeset publish"` |

## Behavior verification

### Validator empirical correctness

`npm test` ran the full validator test surface (B1–B8 + CRLF + CLI smoke, both passing and failing). All 12 validator-related subtests pass:

```
ok 117 - B1: passes a valid minor changeset
ok 118 - B2: passes the canonical empty changeset (with trailing newline)
ok 119 - B2: passes the canonical empty changeset (no trailing newline)
ok 120 - B3: fails when the closing fence is missing
ok 121 - B4: fails on an invalid bump value
ok 122 - B5: fails on a wrong package name
ok 123 - B6: fails on empty body with non-empty front matter
ok 124 - B7: fails on major bump while pre-1.0
ok 125 - B7: allows major bump at 1.0.0 (pre-1.0 guard does not fire)
ok 126 - CRLF: tolerates \r\n line endings on a valid changeset
ok 127 - B8 CLI smoke (failing): exit 1 + stderr matches '.changeset/<file>:<n>: invalid bump'
ok 128 - B8 CLI smoke (passing): exit 0 + empty stderr
```

The CLI smoke test's documented deviation (using the absolute `file://` URL of `tsx/dist/loader.mjs` instead of the bare specifier `"tsx"` for `--import`) is empirically benign: it loads the same module (`tsx`'s `"."` export is `./dist/loader.mjs`, confirmed via `node -e "..."` on the package's `exports` field) and runs the same loader. **The deviation is also strictly local to the test** — the CI gate (`changeset-gate.yml:24`) invokes `npx tsx scripts/validate-changesets.ts` from the repo root, where `tsx` resolves from `./node_modules`. So the deviation does not affect the gate's correctness; it only matters for the smoke-test spawn from a tmpdir.

### `changeset version` consumes the `none`-bump starter into the D2 diff

Reproduced by copying `.changeset/`, `package.json`, and `CHANGELOG.md` to `/tmp/cs-sim3`, running `GITHUB_TOKEN=fake node <worktree>/node_modules/.bin/changeset version`:

```
🦋  All files have been updated. Review them and commit at your leisure
---after:
config.json                       # ← initial-scaffolding.md deleted
---pkg version: 0.1.0              # ← unchanged
---CHANGELOG:                      # ← unchanged
# @automattic/skillsmith
## 0.1.0
Initial release. ...
```

This matches D2 / D3 substantive intent (no bump, no `CHANGELOG.md` append, only the starter file is consumed).

### Typecheck regression (the blocker)

Reproduced two ways:

1. **At trunk** (worked dir `/Users/santosguillamot/Desktop/Code/skillsmith`, `package.json:name === "skillsmith"`): `npm run typecheck` exits 0 with no output.
2. **At HEAD** (this worktree, `package.json:name === "@automattic/skillsmith"`): `npm run typecheck` exits non-zero with eight `TS2307` + `TS7031` errors:
   ```
   examples/skillsmith.config.ts(12,30): error TS2307: Cannot find module 'skillsmith' or its corresponding type declarations.
   examples/skillsmith.config.ts(136,17): error TS7031: Binding element 'runDirectory' implicitly has an 'any' type.
   examples/skillsmith.config.ts(139,23): error TS7031: Binding element 'scenario' implicitly has an 'any' type.
   ... (5 more)
   ```
3. **Causal proof**: with the import line edited locally from `from "skillsmith"` to `from "@automattic/skillsmith"`, `npm run typecheck` exits 0 (verified, then reverted to leave the worktree clean). The single import is the entire root cause.

The mechanism is npm's "self-name resolution" — a package whose `name` field matches an `import` specifier resolves that specifier to its own root, honouring the `exports` field. The rename invalidates the match.

## Issues

### Issue 1: `npm run typecheck` regresses — `examples/skillsmith.config.ts` imports the pre-rename `"skillsmith"` specifier

**Task:** Task 1: Rename `package.json` and add Changesets devDependencies / scripts / publish config

**What's wrong:** Renaming `package.json:name` from `"skillsmith"` to `"@automattic/skillsmith"` invalidated the self-name resolution that `examples/skillsmith.config.ts:12` was relying on (`import { defineConfig } from "skillsmith"`). Post-rename that import resolves to nothing, `defineConfig` becomes `any`, and TypeScript emits eight errors (one `TS2307` for the missing module + seven `TS7031` implicit-`any` errors for the resulting bindings). `examples/**/*` is inside `tsconfig.json:include` (line 19 of `tsconfig.json`), so the errors surface under `npm run typecheck`. `examples/**` is *also* in `.changeset/config.json:changedFilePatterns`, confirming it is in-scope contract surface that the rename is responsible for keeping consistent.

This regression also breaks two distinct downstream things:

1. **Task 6's acceptance bullet "`npm run typecheck` passes"** (`code-plan.md:298`) — explicitly required, currently failing.
2. **The manual bootstrap run of `release.yml`** (the maintainer is supposed to trigger it via `workflow_dispatch` after this PR merges — see design-doc.md:724–731). `release.yml:38` runs `npm run typecheck` as a pre-publish gate (R4.4); with this regression the bootstrap run fails at that step, which prevents D2 (Version Packages PR opens) from happening at all. The structural protection against an unintended first publish (`workflow_dispatch`-only trigger) is preserved, but the substantive D1 / D2 verification path is blocked.

The code-writer's debrief for Task 1 reported pre-existing typecheck failures in `examples/skillsmith.config.ts`. That report was incorrect — at trunk these eight errors do not exist; they were introduced by the rename itself. The lint failures in `src/progress/tracker.ts` ARE genuinely pre-existing and are correctly out of scope; the typecheck failures are not.

**Where:**
- Root cause: `examples/skillsmith.config.ts:12` — `import { defineConfig } from "skillsmith";`
- Triggered by: `package.json:2` — `"name": "@automattic/skillsmith"` (this batch's Task 1, commit `475cd49`)
- Surfaces under: `npm run typecheck` (8 errors); will also surface in `release.yml`'s pre-publish typecheck step
- Cascades: `examples/skillsmith.config.ts:136,139,145` — multiple `TS7031` implicit-`any` errors on hook parameters that depend on `defineConfig`'s inferred type

**Expected:** Either (a) update `examples/skillsmith.config.ts:12` to `import { defineConfig } from "@automattic/skillsmith";` so self-name resolution works again under the scoped name, or (b) add a path-mapping entry to `tsconfig.json` that preserves the old import name for the example, or (c) document an explicit type-only exclusion for `examples/skillsmith.config.ts` from `tsconfig.json:include`. **Option (a) is the obvious and lowest-risk fix** — it preserves the design's "example is consumer-facing reference code" contract (R1.4): consumers running `npm install -D @automattic/skillsmith` will write exactly this import, so the example should now demonstrate the new specifier verbatim. Verified locally that the one-line edit makes `npm run typecheck` exit 0 with no other changes needed.

Note for the code-writer fixing this: `testing-project/skillsmith.config.ts:4` has the same `import { defineConfig } from "skillsmith"` line. That file is NOT in `tsconfig.json:include`, so it does not break `npm run typecheck`. It is also excluded from `changedFilePatterns` by R1.2(h) ("the `testing-project/` fixture"). Updating it is **not required for this batch** — its tracking belongs in a follow-up — but consider whether to fix it opportunistically in the same task for cleanliness, given the diff is one line.

## Non-blocking nits

None this round. Other findings were either pre-existing on trunk (lint failures in `src/progress/tracker.ts`) or already documented and ratified deviations (the `none`-bump starter substitution for spec A6/R8.6 wording per OQ-6; `workflow_dispatch`-only trigger for spec A11/R8.11/D1 wording per OQ-7; the smoke test's `--import <file_url>` deviation, which is empirically benign and local to the smoke test).

## Tasks to re-dispatch

```json
["Task 1"]
```

Rationale for the single-task re-dispatch: the regression is rooted in Task 1's rename. Task 6's acceptance failure (`npm run typecheck`) is a downstream symptom of the same root cause; once Task 1 is fixed, Task 6's acceptance is re-met automatically. No other task needs to change.
