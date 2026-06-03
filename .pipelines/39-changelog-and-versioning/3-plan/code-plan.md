# Code Plan: Changelog and Versioning

Issue: [Automattic/skillsmith#39](https://github.com/Automattic/skillsmith/issues/39) — _Add a changelog and automate package version bumps_

## Overview

Skillsmith currently ships as the unscoped `skillsmith@0.1.0` with no `CHANGELOG.md`, no `.github/workflows/`, no `.changeset/` directory, and no publishing scripts. This PR introduces the Changesets-based changelog + release pipeline end-to-end. The implementation lands as eight sequenced code tasks, in roughly this order:

1. **Task 1** — Rename `package.json:name` to `@automattic/skillsmith`, add `publishConfig`, the two new scripts (`changeset`, `release`), and the two new devDependencies (`@changesets/cli`, `@changesets/changelog-github`).
2. **Task 2** — Regenerate `package-lock.json` for the new devDependencies.
3. **Task 3** — Add the Changesets configuration in `.changeset/config.json` with the exact `changedFilePatterns` set, `baseBranch: "trunk"`, `access: "public"`, and the `changelog-github` plugin pointed at the GitHub repo.
4. **Task 4** — Hand-write `CHANGELOG.md` with the `# @automattic/skillsmith` top-level heading and the initial `## 0.1.0` entry.
5. **Task 5** — Add the `none`-bump starter changeset so the gate passes on this PR's own merge AND `changesets/action` opens the Version Packages PR despite the empty-only early-return at v1.4.0+.
6. **Task 6** — Implement `scripts/validate-changesets.ts` as a pure exported function plus an entry-guarded `main`, with the corrected fence regex and pre-1.0 guard; cover all of B1–B8 plus a CRLF case via Node test-runner tests in `src/__tests__/validate-changesets.test.ts`.
7. **Task 7** — Add `.github/workflows/changeset-gate.yml` running the validator first, then `npx changeset status --since=origin/<base>` on `pull_request`.
8. **Task 8** — Add `.github/workflows/release.yml` with `workflow_dispatch`-only initial trigger (the design's deliberate substitution for spec R8.11 / D1 / F1, ratified by the design reviewer per OQ-7), the inverted-ternary `skip_publish` kill switch, the lint → typecheck → test → `changesets/action` sequence, and the exact three permissions.

Documentation (`CONTRIBUTING.md`, `.changeset/README.md`, the three new `README.md` sections) is owned by Phase 5 and is **not** in this plan.

Two design-level substitutions are baked into this plan and are traced to design decisions rather than the literal spec wording the design reviewer acknowledged would need to be revisited (OQ-6 / OQ-7):

- The starter changeset (Task 5) is a `none`-bump entry, not the canonical empty `---\n---\n` form. Traces to design decision "Use `none`-bump starter, not the canonical empty form" and to spec D2's substantive diff (preserved bit-for-bit).
- `release.yml` (Task 8) ships `workflow_dispatch`-only in this PR. The `push: branches: [trunk]` trigger is intentionally absent and will be added by the follow-up D4 feature PR alongside the first real changeset. Traces to design decision "Bootstrap via `workflow_dispatch`-only trigger; `push: trunk` added in the follow-up D4 feature PR" and to spec D3's substantive intent (preserved by structural absence of a publish trigger).

## Tasks

### Task 1: Rename `package.json` and add Changesets devDependencies / scripts / publish config

- **Goal:** Edit `package.json` so the package is named `@automattic/skillsmith`, declares `publishConfig.access: "public"`, exposes the two scripts (`changeset`, `release`) the contributor and release workflows invoke, and lists the two new devDependencies. Leave `repository.url`, `homepage`, `bugs.url`, `version`, `engines`, `bin`, `exports`, runtime `dependencies`, the existing scripts, and the existing devDependencies unchanged.
- **Files to change:**
  - `package.json`
- **Changes:**
  - Change `"name": "skillsmith"` to `"name": "@automattic/skillsmith"`.
  - Insert `"publishConfig": { "access": "public" }` at the top level (placement next to `homepage` / `repository` is fine — JSON key order is not load-bearing, but keep `name` first and `version` second to match existing convention).
  - Add to `"scripts"`: `"changeset": "changeset"` and `"release": "changeset publish"`. Do not remove or reorder the existing `lint`, `lint:fix`, `format`, `typecheck`, `test`, `smoke` entries.
  - Add to `"devDependencies"`: `"@changesets/cli": "^2.31.0"` and `"@changesets/changelog-github": "^0.7.0"`. Keep the existing `@biomejs/biome`, `@types/node`, `typescript` entries unchanged.
  - Leave `version` at `"0.1.0"`. Do not bump it.
  - Leave `"license": "GPL-3.0"`, `"type": "module"`, `repository.url` (`git+https://github.com/Automattic/skillsmith.git`), `homepage` (`https://github.com/Automattic/skillsmith#readme`), `bugs.url`, `engines.node` (`>=20.17`), `bin`, `exports`, `dependencies` exactly as they are.
- **Depends on:** none
- **Traces to:** R5.2, R8.2, A2, design decision "Scope rename to `@automattic/skillsmith`, not a different unscoped name or a name dispute".
- **Acceptance:**
  - `package.json:name === "@automattic/skillsmith"`.
  - `package.json:publishConfig.access === "public"`.
  - `package.json:scripts.changeset === "changeset"` and `package.json:scripts.release === "changeset publish"`.
  - `package.json:devDependencies["@changesets/cli"] === "^2.31.0"`.
  - `package.json:devDependencies["@changesets/changelog-github"] === "^0.7.0"`.
  - `package.json:version === "0.1.0"` (unchanged).
  - `package.json:repository.url === "git+https://github.com/Automattic/skillsmith.git"` and `package.json:homepage === "https://github.com/Automattic/skillsmith#readme"` (unchanged).
  - `package.json` parses as valid JSON.

### Task 2: Regenerate `package-lock.json` for the new devDependencies

- **Goal:** Refresh `package-lock.json` so it records `@changesets/cli@^2.31.0`, `@changesets/changelog-github@^0.7.0`, and the transitive closure of their resolved versions. Use `npm install` (not `npm install --no-package-lock`, not `npm ci`) so the lockfile is rewritten with deterministic entries.
- **Files to change:**
  - `package-lock.json`
- **Changes:**
  - Run `npm install` at the repo root. Do not pass `--ignore-scripts` unless needed for sandboxing. Do not delete the existing lockfile manually — let `npm install` update it in place so unrelated diffs are minimised.
  - Verify that `npm ci` succeeds after the install (this is the contract Tasks 7 and 8 will exercise on CI).
  - Do not edit any other file as part of this task. If `node_modules/` exists in the worktree, leave it untracked.
- **Depends on:** Task 1.
- **Traces to:** R8.3, A3, design "New devDependencies" section.
- **Acceptance:**
  - `package-lock.json` contains entries for `node_modules/@changesets/cli` and `node_modules/@changesets/changelog-github` at versions satisfying `^2.31.0` and `^0.7.0` respectively.
  - `package-lock.json:packages[""].name === "@automattic/skillsmith"` (i.e. the lockfile root reflects the rename from Task 1).
  - `npm ci` exits 0 against the resulting `package.json` + `package-lock.json` pair.
  - `package-lock.json:lockfileVersion` remains at its current value `3` UNLESS the installed npm CLI bumps the schema on its own (e.g. npm 11 vs npm 10); a CLI-driven bump is acceptable, but the code-writer must surface it in the PR description for the reviewer's awareness. Do not manually revert a CLI-driven bump.

### Task 3: Add `.changeset/config.json` with the canonical Changesets configuration

- **Goal:** Create the `.changeset/` directory and write its `config.json` exactly as the design specifies. This file is the single source of truth for the gate's coverage set, the changelog plugin, the base branch, and the publish access.
- **Files to change:**
  - `.changeset/config.json` (new)
- **Changes:**
  - Create the file with the literal contents:

    ```json
    {
      "$schema": "https://unpkg.com/@changesets/config@3.1.4/schema.json",
      "changelog": ["@changesets/changelog-github", { "repo": "Automattic/skillsmith" }],
      "commit": false,
      "fixed": [],
      "linked": [],
      "access": "public",
      "baseBranch": "trunk",
      "updateInternalDependencies": "patch",
      "ignore": [],
      "changedFilePatterns": [
        "src/**",
        "bin/**",
        "package.json",
        "examples/**",
        "README.md",
        "!src/__tests__/**"
      ]
    }
    ```

  - Use the exact JSON formatting above (2-space indent, trailing newline). Do not add fields the schema rejects.
  - Confirm `"baseBranch"` is the string `"trunk"` (not `"main"` — the `changeset init` default is `"main"`).
  - Confirm `"changelog"` is the two-element array `["@changesets/changelog-github", { "repo": "Automattic/skillsmith" }]`. The repo string is the GitHub `owner/name` path, not the npm package name.
  - Confirm the `changedFilePatterns` array is exactly the six entries above in this order: `src/**`, `bin/**`, `package.json`, `examples/**`, `README.md`, `!src/__tests__/**`. Order matters because the negation must come after `src/**` to actually un-match the test subtree.
- **Depends on:** Task 1 (so `package.json:name === "@automattic/skillsmith"` exists for downstream agreement between this config and the validator).
- **Traces to:** R2.2, R2.3, R4.8, R5.2, R5.6, R8.4, R9.2, A4, design decision "Detection via `changedFilePatterns` config, no separate `paths-filter`".
- **Acceptance:**
  - `.changeset/config.json` exists and parses as valid JSON.
  - All literal fields above are present with the exact values shown.
  - `changedFilePatterns` has exactly six elements in the order `src/**`, `bin/**`, `package.json`, `examples/**`, `README.md`, `!src/__tests__/**`.
  - `baseBranch === "trunk"`, `access === "public"`.
  - `changelog[0] === "@changesets/changelog-github"` and `changelog[1].repo === "Automattic/skillsmith"`.

### Task 4: Hand-write `CHANGELOG.md` with the initial `## 0.1.0` entry

- **Goal:** Create `CHANGELOG.md` at the repo root with the `# @automattic/skillsmith` top-level heading and a one-paragraph `## 0.1.0` entry. Future entries will be appended above this one by `changeset version`; the format must already match what the tool maintains so the first machine-generated entry slots in without duplicating the top-level heading.
- **Files to change:**
  - `CHANGELOG.md` (new)
- **Changes:**
  - Create the file with the exact contents:

    ```md
    # @automattic/skillsmith

    ## 0.1.0

    Initial release. Skill testing harness + self-improvement loop. See [`README.md`](./README.md) for usage and configuration, and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the changeset / release policy.
    ```

  - The top-level heading `# @automattic/skillsmith` is required: `changeset version` looks for it, and absent it the action would insert a duplicate.
  - End the file with a single trailing newline.
  - Do not add a `## Unreleased` section or any forward-looking entry. The 0.1.0 paragraph is the only entry.
  - The body wording above is the design's recommendation (design-doc.md:615–621); Phase 5 (docs) may revise the wording later, but the section header `## 0.1.0` and the top-level `# @automattic/skillsmith` heading are contract.
- **Depends on:** Task 1 (the rename must already have happened so `# @automattic/skillsmith` matches `package.json:name`).
- **Traces to:** R3.6, R8.1, A1, design section "CHANGELOG.md initial format (R3.6, A1)" and design decision "Hand-written initial `## 0.1.0` entry, version stays at `0.1.0` for this PR".
- **Acceptance:**
  - `CHANGELOG.md` exists at the repo root.
  - The first non-blank line is `# @automattic/skillsmith`.
  - A `## 0.1.0` section header is present somewhere after the top-level heading.
  - The `## 0.1.0` section has a non-empty body paragraph.
  - There is no `## Unreleased` section.

### Task 5: Add the `none`-bump starter changeset

- **Goal:** Ship one starter changeset at `.changeset/<file>.md` so (a) this PR's own merge passes the gate (`changeset status` sees a changeset that covers the release-relevant diff in `package.json`), and (b) when the maintainer runs `release.yml` post-merge, `changesets/action` v1.4.0+'s `hasNonEmptyChangesets` check passes (because the starter has `releases.length === 1`), the action opens the Version Packages PR, and `changeset version` consumes the entry into the exact D2 diff (delete the starter, no version bump, no `CHANGELOG.md` change).
- **Files to change:**
  - `.changeset/initial-scaffolding.md` (new) — write the file directly with the literal contents below. **Do NOT invoke `npx changeset add`**: the interactive CLI cannot produce a `none`-bump entry and would write a `patch` or `minor` bump that the code-writer would then have to hand-edit. The deterministic filename `initial-scaffolding.md` keeps the diff readable and the acceptance check trivial; the `npx changeset add` random-name convention is not load-bearing for any downstream tool (the action enumerates `.changeset/*.md` regardless of name).
- **Changes:**
  - Create the file with exactly the following contents:

    ```md
    ---
    "@automattic/skillsmith": none
    ---

    Initial scaffolding: changeset and release automation. No consumer-visible change.
    ```

  - The front matter MUST use bump type `none` (not `patch`, not `minor`, not `major`, and not the canonical empty `---\n---\n` form). Reason: `changesets/action` at v1.4.0+ short-circuits with "All changesets are empty; not creating PR" when `hasNonEmptyChangesets === false`, which is the case for the canonical empty form (`releases.length === 0`). A `none`-bump entry has `releases.length === 1`, so `hasNonEmptyChangesets === true` and the action opens the Version Packages PR. The starter form distinction is also the reason the validator (Task 6) must accept `none` as a valid bump value.
  - The body line must be non-empty (the validator's R-shape-3 requires non-empty body for non-empty front matter).
  - Do NOT use the canonical `---\n---\n` empty form for the starter. The validator still recognises that form as the contributor-facing escape hatch for future PRs (R1.3); only the starter shipped in this PR differs.
- **Depends on:** Task 1 (so the front-matter key `"@automattic/skillsmith"` matches `package.json:name`), Task 3 (so the `.changeset/` directory exists and `config.json` is in place to be honoured by `changeset version`).
- **Traces to:** R2.4, R8.6, A6, D2, design decision "Use `none`-bump starter, not the canonical empty `---\n---\n` form" and design section "Empty-changeset mechanics for the first release (R8.6, R2.4, D2)". Note: the spec's literal R8.6 / A6 wording ("`---\n---`") is superseded by the design's `none`-bump substitution per OQ-6, which the design reviewer accepted as a wording gap that does not block design approval.
- **Acceptance:**
  - Exactly one new `.md` file exists under `.changeset/` (other than `README.md`, which Phase 5 owns).
  - The file's front matter is the single key `"@automattic/skillsmith"` mapped to the string `none`.
  - The body is a single non-empty paragraph.
  - The file does NOT have the bytes `---\n---\n` with no front matter — i.e. it is not the canonical empty form.

### Task 6: Implement `scripts/validate-changesets.ts` with B1–B8 unit tests and a CLI smoke test

- **Goal:** Ship the shape validator + pre-1.0 guard as a TypeScript script under `scripts/`, factored into a pure `validateChangesetFile(file, raw, pkgName, version) → Err[]` function and an entry-guarded `main(): number` orchestrator so the per-rule unit tests can import the pure function without executing I/O. Cover all of B1–B8 plus a CRLF-tolerance case in `src/__tests__/validate-changesets.test.ts`. Add a child-process smoke test in the same test file that spawns the script via `node --import tsx scripts/validate-changesets.ts` against a temporary directory with a seeded `package.json` and `.changeset/` directory, asserting the exit code and stderr-prefix format.

- **Files to change:**
  - `scripts/validate-changesets.ts` (new)
  - `src/__tests__/validate-changesets.test.ts` (new)

- **Changes:**

  - **`scripts/validate-changesets.ts`** — implement to the contract in design section "`scripts/validate-changesets.ts` input/output contract" and "Validator pseudocode (illustrative, not production code)":
    - Module type is ESM (project already uses `"type": "module"`); the script is loaded by `tsx` so it does not need a build step.
    - Import `readFileSync` and `readdirSync` from `node:fs`, `pathToFileURL` from `node:url`, and `parse as parseYaml` from `yaml`. Do NOT add a new YAML dependency; reuse the existing `yaml@^2.8.3` already in `package.json:dependencies`.
    - Export `type Err = { file: string; line: number; msg: string }`.
    - Define `const VALID = new Set(["patch", "minor", "major", "none"]);`.
    - Define `const FENCE_RE = /^---\r?\n([\s\S]*?)(?:\r?\n)?---\r?\n?([\s\S]*)$/;` — the corrected regex from design section "Empirical verification of the regex fix" (the prior `/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/` rejected the canonical empty form and must NOT be used).
    - Export `validateChangesetFile(file: string, raw: string, pkgName: string, version: string): Err[]`. Implementation MUST:
      - Compute `const preRelease = String(version).startsWith("0.");`.
      - Match `raw` against `FENCE_RE`. On no match, push `{ file, line: 1, msg: "missing or unterminated front matter (expected two '---' fences)" }` and return.
      - Extract `[, fmRaw, body]` from the match.
      - R-shape-2 short-circuit: if `fmRaw.trim() === "" && body.trim() === ""`, return an empty array (the empty-changeset case passes).
      - R-shape-3: if `body.trim() === ""` (and front matter is non-empty), push `{ file, line: 4, msg: "empty body (changeset has front matter but no summary)" }`. **Note on line constants:** the integers `1` / `2` / `4` are deliberate canonical values for the validator's three error sites (fence error → `1`, front-matter error → `2`, body error → `4`). They are contract for source-stability — the test assertions intentionally check `Err.msg` substrings rather than `Err.line` values, but the constants must be present and stable so the stderr-printed `:<n>:` separator (per the design's "line-numbered errors" contract) emits a non-empty integer. OQ-2 leaves the exact integer choice open; this plan settles it as `1/2/4` to match the design's pseudocode.
      - Wrap `parseYaml(fmRaw)` in a `try`/`catch`; on parse failure push `{ file, line: 2, msg: \`YAML parse error: ${(e as Error).message}\` }` and return.
      - If the parsed front matter is `null` or not a `typeof === "object"`, push `{ file, line: 2, msg: "front matter must be a YAML mapping of package name to bump" }` and return.
      - For each `[name, bump]` of `Object.entries(fm)`:
        - If `name !== pkgName`, push `{ file, line: 2, msg: \`unknown package "${name}" (expected "${pkgName}")\` }`.
        - If `!VALID.has(bump)`, push `{ file, line: 2, msg: \`invalid bump "${bump}" (expected one of patch, minor, major, none)\` }`.
        - Else if `preRelease && bump === "major"`, push `{ file, line: 2, msg: \`'major' is forbidden while pre-1.0 (version=${version}). Use 'minor' with a 'BREAKING:' prefix; see CONTRIBUTING.md#pre-10-policy.\` }`.
      - Return the accumulated `Err[]`.
    - Export `main(): number`:
      - `JSON.parse(readFileSync("package.json", "utf8"))` to read `pkg.name` and `pkg.version`.
      - `readdirSync(".changeset")` and filter to `n.endsWith(".md") && n !== "README.md"`.
      - For each file, call `validateChangesetFile(f, readFileSync(\`.changeset/${f}\`, "utf8"), pkg.name, pkg.version)` and concatenate errors.
      - If errors are empty, return `0`. Otherwise write each error to stderr as `\`.changeset/${e.file}:${e.line}: ${e.msg}\n\`` and return `1`.
    - Entry guard:

      ```ts
      if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
        process.exit(main());
      }
      ```
    - Target ~50 LOC. Do not add `console.log` calls (stdout must be empty for piping). Do not call `process.exit` from `validateChangesetFile`.

  - **`src/__tests__/validate-changesets.test.ts`** — use `node:test` and `node:assert/strict` (the existing convention; see `src/__tests__/scenarios.test.ts` and `src/__tests__/smoke.test.ts`).

    **Import statement (load-bearing for typecheck).** The test file MUST start with:

    ```ts
    import { validateChangesetFile, type Err } from "../../scripts/validate-changesets";
    ```

    Use the relative path `"../../scripts/validate-changesets"` with **no `.ts` extension** — this matches the existing import style in `src/__tests__/*.test.ts` (e.g. `import { run } from "../runner"` at `src/__tests__/smoke.test.ts:7`) and works under `tsx`'s ESM resolution with `verbatimModuleSyntax: true`. Do NOT write `"../../scripts/validate-changesets.ts"` (the explicit extension may be rejected under the project's `verbatimModuleSyntax` setting in some `tsx` versions) and do NOT write a dynamic `import()` (eager static import is what makes the test file the typecheck path for the script).

    This import is the **load-bearing typecheck path** for `scripts/validate-changesets.ts` per the design's "Untouched but contract-relevant components" section (design-doc.md:137): because `tsconfig.json:include` is `["src/**/*", "skillsmith.config.ts", "examples/**/*"]` (i.e. `scripts/**` is OUT of `include`), the script itself is not directly typechecked. The static `import` in this test file pulls the script's exported surface into the typechecker's reachable graph through the test file (which IS in `include`), so any type error in the exported signatures of `validateChangesetFile` or `Err` surfaces under `npm run typecheck`. The implementer MUST verify `npm run typecheck` passes after writing both files.

    **Path-resolution helper for the CLI smoke test.** Near the top of the file (after the imports), compute the absolute path to the validator script using the codebase convention `fileURLToPath(new URL(..., import.meta.url))`:

    ```ts
    import { fileURLToPath } from "node:url";
    // ... other imports ...
    const VALIDATOR_PATH = fileURLToPath(new URL("../../scripts/validate-changesets.ts", import.meta.url));
    ```

    This matches the existing convention in `src/__tests__/scenarios.test.ts:8–9` and `src/__tests__/smoke.test.ts:9` (both compute paths via `fileURLToPath(import.meta.url)` + path joining). The `new URL(..., import.meta.url)` form is the cleanest one-step expression for "relative to this test file". The result is an absolute filesystem path. **Do NOT use `path.resolve(process.cwd(), ...)`** — the CLI smoke test below sets the spawn `cwd` to a tmpdir, so a cwd-relative path would not resolve correctly.

    **Test cases:**

    - **B1 (passes valid changeset).** Construct `raw = '---\n"@automattic/skillsmith": minor\n---\n\nAdd a feature.\n'`; assert `validateChangesetFile("test.md", raw, "@automattic/skillsmith", "0.1.0")` returns an empty array.
    - **B2 (passes canonical empty changeset).** Construct `raw = '---\n---\n'`; assert the function returns an empty array. Also cover the no-trailing-newline variant `raw = '---\n---'`.
    - **B3 (fails missing closing fence).** Construct `raw = '---\n"@automattic/skillsmith": minor\n'` (no closing `---`); assert the result contains an error whose `msg` includes `"missing or unterminated front matter"`.
    - **B4 (fails invalid bump).** Construct `raw = '---\n"@automattic/skillsmith": superminor\n---\n\nBody.\n'`; assert the result contains an error whose `msg` includes `'invalid bump "superminor"'`.
    - **B5 (fails wrong package name).** Construct `raw = '---\nsome-other-package: minor\n---\n\nBody.\n'`; assert the result contains an error whose `msg` includes `'unknown package "some-other-package"'` AND `'expected "@automattic/skillsmith"'`.
    - **B6 (fails empty body with non-empty front matter).** Construct `raw = '---\n"@automattic/skillsmith": minor\n---\n\n\n'`; assert the result contains an error whose `msg` includes `"empty body"`. (Note: this input produces exactly one error — the front matter is well-formed and per-entry rules push no further errors. The assertion just looks for the "empty body" substring; do not assert a specific error count.)
    - **B7 (fails major bump while pre-1.0).** Construct `raw = '---\n"@automattic/skillsmith": major\n---\n\nBreaking change.\n'`; call with `version === "0.1.0"`; assert the result contains an error whose `msg` includes `"'major' is forbidden while pre-1.0"` AND `"CONTRIBUTING.md#pre-10-policy"`. Additionally, call the same `raw` with `version === "1.0.0"` and assert the result is empty (the pre-1.0 guard only fires while `version` starts with `0.`).
    - **B8 (`main()` exit codes).** Exercise `main()` indirectly via the CLI smoke test below; do not call `main()` from a unit test (the unit-test file should not have side-effects on the worktree's own `.changeset/`).
    - **CRLF tolerance.** Construct `raw = '---\r\n"@automattic/skillsmith": minor\r\n---\r\n\r\nAdd thing.\r\n'`; assert the function returns an empty array.

    **CLI smoke test (covers B8 + the `.changeset/<file>:<line>:` printed format).** Use `node:child_process`'s `spawnSync`. Construction (concrete, no placeholders):

    ```ts
    import { spawnSync } from "node:child_process";
    import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
    import { tmpdir } from "node:os";
    import path from "node:path";

    // VALIDATOR_PATH computed earlier via fileURLToPath(new URL(..., import.meta.url)).

    function setupTmpDir(changesets: Record<string, string>): string {
      const dir = mkdtempSync(path.join(tmpdir(), "validate-changesets-smoke-"));
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "@automattic/skillsmith", version: "0.1.0" }),
      );
      mkdirSync(path.join(dir, ".changeset"));
      for (const [name, body] of Object.entries(changesets)) {
        writeFileSync(path.join(dir, ".changeset", name), body);
      }
      return dir;
    }

    // Spawn:
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", VALIDATOR_PATH],
      { cwd: tmpDir, encoding: "utf8" },
    );
    ```

    Use `process.execPath` rather than the literal string `"node"` for portability across CI runners and developer environments (it resolves to the absolute path of the current Node binary, e.g. `/usr/bin/node`). The `VALIDATOR_PATH` constant is the absolute path computed earlier — independent of `cwd`.

    **Failing-case assertions.** Seed the tmpdir with two files: one passing (`---\n"@automattic/skillsmith": patch\n---\n\nFix bug.\n`) and one failing (`---\n"@automattic/skillsmith": superminor\n---\n\nBody.\n`). Assert:
    - `result.status === 1`.
    - `result.stderr.toString()` matches the regex `/\.changeset\/[^:]+:\d+: invalid bump/`.
    - `result.stdout.toString() === ""`.

    **Passing-case assertions.** Run a second invocation with only the passing changeset and assert:
    - `result.status === 0`.
    - `result.stderr.toString() === ""`.

  - Wire the new test file into the existing `npm test` invocation: it already globs `src/__tests__/*.test.ts` (see `package.json:test` script — `node --import tsx --test src/__tests__/*.test.ts`), so no script edit is needed.

- **Depends on:** Task 1 (the validator reads `package.json:name` and `package.json:version` in `main()`, which is exercised by Task 6's worktree-root acceptance smoke check), Task 3 (so the worktree has a `.changeset/` directory `main()` can `readdirSync` when run from the repo root for the acceptance smoke check), Task 5 (so the worktree's `.changeset/` contains a valid starter and the acceptance smoke check exits 0). **The unit tests in `src/__tests__/validate-changesets.test.ts` themselves have no runtime dependency on Tasks 3 or 5** — they exercise `validateChangesetFile` against in-memory strings — and the CLI smoke test exercises a freshly-seeded `.changeset/` in a tmpdir. The Tasks 3 and 5 dependencies exist solely so the worktree-root acceptance check `Running npx tsx scripts/validate-changesets.ts from the worktree root exits 0` (see Acceptance below) holds when the code-writer runs it as a one-off post-implementation sanity check. The acceptance check `npm test` passes is satisfied as soon as Task 6 itself is complete, regardless of whether Tasks 3 and 5 have landed.

- **Traces to:** R2.5, R2.6, R3.4, R8.9, A9, A10, B1, B2, B3, B4, B5, B6, B7, B8, C4, design section "Validation rules mapped to acceptance criteria", design decision "Validator pseudocode shape — pure function + entry-guarded main", design decision "Test strategy — unit tests for the validator's pure function, smoke test for the CLI entry", design section "Untouched but contract-relevant components" (specifically the `tsconfig.json:include` and load-bearing test-import note at design-doc.md:137).

- **Acceptance:**
  - `scripts/validate-changesets.ts` exists and is loadable by `tsx`.
  - The script exports `validateChangesetFile`, `main`, and the `Err` type.
  - Calling `validateChangesetFile("x.md", '---\n---\n', "@automattic/skillsmith", "0.1.0")` returns `[]`.
  - Calling `validateChangesetFile("x.md", '---\n"@automattic/skillsmith": major\n---\n\nbody\n', "@automattic/skillsmith", "0.1.0")` returns an error mentioning `'major' is forbidden while pre-1.0` and `CONTRIBUTING.md#pre-10-policy`.
  - `npm test` passes with the new test file included. (This acceptance criterion is independent of Tasks 3 and 5 — the unit and CLI smoke tests are self-contained.)
  - `npm run typecheck` passes. The test file's static `import { validateChangesetFile, type Err } from "../../scripts/validate-changesets"` is the load-bearing typecheck path for the script per the design's `tsconfig.json:include` decision; this acceptance is the explicit verification of that contract.
  - Spawning the script from a tmpdir with a malformed changeset exits `1` and writes a line matching `.changeset/<file>:<n>: <msg>` to stderr, and writes nothing to stdout.
  - `src/__tests__/validate-changesets.test.ts` covers every B1–B8 case: B1–B7 each have a dedicated `test()` block exercising `validateChangesetFile`, B8 is covered by the CLI smoke test asserting both the exit-zero (clean) and exit-one (failure) paths, and a CRLF-tolerance case is also present.
  - **Worktree-root smoke check (depends on Tasks 3 and 5).** After Tasks 3 and 5 are complete, running `npx tsx scripts/validate-changesets.ts` from the worktree root exits `0` (because Task 5's starter is a valid `none`-bump entry and Task 3's `.changeset/` directory exists). This is a one-off post-implementation sanity check the code-writer runs at the terminal; it does NOT need to be wired into the test suite. If this acceptance fails before Tasks 3/5 are complete, the failure is a Task-3 or Task-5 problem, not a Task-6 problem.

### Task 7: Add `.github/workflows/changeset-gate.yml`

- **Goal:** Add the PR-side gate workflow. Runs on every `pull_request` against `trunk`; checks out with full history; installs the lockfile (`npm ci`); runs `scripts/validate-changesets.ts` via `tsx` first; then runs `npx changeset status --since=origin/<base>` second. Both must pass for the gate to be green. Permissions are read-only; concurrency cancels in-progress runs on superseded pushes.
- **Files to change:**
  - `.github/workflows/changeset-gate.yml` (new)
- **Changes:**
  - Create the file with exactly the YAML below (preserve the indentation; this is the design's "`.github/workflows/changeset-gate.yml` (interface)" block):

    ```yaml
    name: Changeset Gate
    on:
      pull_request:
        branches: [trunk]
    permissions:
      contents: read
      pull-requests: read
    concurrency:
      group: changeset-gate-${{ github.head_ref || github.ref }}
      cancel-in-progress: true
    jobs:
      changeset:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v6
            with:
              fetch-depth: 0
          - uses: actions/setup-node@v6
            with:
              node-version: 22
              cache: npm
          - run: npm ci
          - name: Validate changeset shape
            run: npx tsx scripts/validate-changesets.ts
          - name: Require a changeset for release-relevant changes
            run: npx changeset status --since=origin/${{ github.event.pull_request.base.ref }}
    ```

  - Use `pull_request` (NOT `pull_request_target`). No secrets are needed and the gate must run against PR-head untrusted code.
  - Use `actions/checkout@v6` and `actions/setup-node@v6` with the exact `fetch-depth: 0` and `node-version: 22` / `cache: npm` shown.
  - **Action-version caveat (design-acknowledged):** the spec and design pin `actions/checkout@v6` and `actions/setup-node@v6`. The design's "Open Questions" section flagged that the current published majors on GitHub Marketplace are `v4` and `v4` respectively at design time. The plan inherits the spec/design pin. **If at code-write time `v6` is not yet released** for either action (verify with a quick `gh api repos/actions/checkout/releases` lookup), substitute `v4` for both and surface the deviation in a one-line PR description note; the substantive contract (`fetch-depth: 0`, `node-version: 22`, `cache: npm`) does not depend on the action major.
  - Validator runs BEFORE `changeset status` (R2.6) so a shape error surfaces with the validator's line-numbered message before `changeset status`'s misleading "no changesets found".
  - Concurrency uses `head_ref || ref` so PR-head pushes cancel prior in-progress runs; `cancel-in-progress: true` saves CI time on rapid pushes.
  - Permissions are exactly `contents: read` and `pull-requests: read`. No write permissions.
- **Depends on:** Task 2 (lockfile must be regenerated so `npm ci` succeeds), Task 3 (`.changeset/config.json` must exist so `npx changeset status` works), Task 5 (a starter must exist so the gate passes on this PR's own merge), Task 6 (the validator script must exist).
- **Traces to:** R2.1, R2.2, R2.4, R2.5, R2.6, R8.10, A10, C1, C2, C3, C4, design decision "Two workflows, not one", design decision "`fetch-depth: 0` on both checkouts", design decision "Concurrency settings differ between workflows", design section "`.github/workflows/changeset-gate.yml` (interface)".
- **Acceptance:**
  - `.github/workflows/changeset-gate.yml` exists and is valid YAML.
  - `on.pull_request.branches === ["trunk"]`.
  - The job has exactly the steps in order: `actions/checkout@v6` (with `fetch-depth: 0`), `actions/setup-node@v6` (with `node-version: 22`, `cache: npm`), `npm ci`, `npx tsx scripts/validate-changesets.ts`, `npx changeset status --since=origin/${{ github.event.pull_request.base.ref }}`. (If the published-major deviation above is applied, substitute `v4` for both `@v6` references.)
  - Permissions are exactly `contents: read` and `pull-requests: read`.
  - Concurrency group is `changeset-gate-${{ github.head_ref || github.ref }}` with `cancel-in-progress: true`.
  - The validator step name contains "Validate" or "validate" (so `C4`'s "fails the gate at the validator step" claim is traceable in the Actions log).

### Task 8: Add `.github/workflows/release.yml` with `workflow_dispatch`-only initial trigger

- **Goal:** Add the release workflow. This PR ships it with `workflow_dispatch` as the SOLE trigger (the design's deliberate substitution for the spec's automatic `push: trunk` trigger, ratified by the design reviewer per OQ-7). The follow-up D4 feature PR will uncomment the `push: trunk` block and ship the first real changeset. The workflow runs lint → typecheck → test on `ubuntu-latest` Node 22, then invokes `changesets/action@v1` with the inverted-ternary `skip_publish` kill switch and the exact three permissions. `GITHUB_TOKEN` is passed via `env:` for `@changesets/changelog-github`'s PR/author enrichment at the version step.
- **Files to change:**
  - `.github/workflows/release.yml` (new)
- **Changes:**
  - Create the file with exactly the YAML below (preserve the indentation, the comments, and the commented-out `push:` block; this is the design's "`.github/workflows/release.yml` (interface)" block):

    ```yaml
    name: Release
    on:
      # Bootstrap PR ships workflow_dispatch ONLY. A follow-up PR (D4 — the first real
      # feature changeset) adds `push: branches: [trunk]` so the steady-state automatic
      # trigger only goes live alongside a real version bump. See the design doc's
      # "Empty-changeset mechanics for the first release" section and the decision
      # "Bootstrap via workflow_dispatch-only trigger, push: trunk added in the follow-up
      # feature PR".
      workflow_dispatch:
        inputs:
          skip_publish:
            description: "Run Version PR step only; don't publish"
            type: boolean
            default: false
      # The line below is included by the follow-up D4 feature PR, NOT this PR.
      # Documented here so the steady-state interface is visible to future readers.
      #
      # push:
      #   branches: [trunk]
    concurrency: ${{ github.workflow }}-${{ github.ref }}
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    jobs:
      release:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v6
            with:
              fetch-depth: 0
          - uses: actions/setup-node@v6
            with:
              node-version: 22
              cache: npm
          - run: npm ci
          - run: npm run lint
          - run: npm run typecheck
          - run: npm test
          - id: changesets
            uses: changesets/action@v1
            with:
              # Ternary-trap-safe form: when the middle operand of `A && B || C` is falsy,
              # the expression always returns `C`. Empty string is falsy in GitHub Actions
              # expressions, so the form `inputs.skip_publish && '' || 'npx changeset publish'`
              # silently always returns `'npx changeset publish'`. The inverted form below
              # puts the truthy branch in the middle operand and reliably short-circuits.
              publish: ${{ !inputs.skip_publish && 'npx changeset publish' || '' }}
            env:
              GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    ```

  - The `on:` section MUST be `workflow_dispatch:` only. Do NOT include `push: branches: [trunk]` at any indentation level. The commented-out `push:` block exists as documentation so the follow-up D4 PR can uncomment it; it MUST remain commented (one contiguous `#` prefix per line, mapping cleanly to a single search/replace operation in the D4 PR).
  - Use the inverted-ternary expression `${{ !inputs.skip_publish && 'npx changeset publish' || '' }}` for the `publish:` input. Do NOT use the naive form `${{ inputs.skip_publish && '' || 'npx changeset publish' }}` — the naive form is a no-op due to the GitHub Actions ternary trap (empty string is falsy in `||`).
  - Permissions are exactly the three lines `contents: write`, `pull-requests: write`, `id-token: write`. Do NOT add `packages: write` or `issues: write`.
  - Use `concurrency: ${{ github.workflow }}-${{ github.ref }}` with NO `cancel-in-progress` (release runs must serialize, not cancel).
  - Use `actions/checkout@v6` with `fetch-depth: 0` (required by `@changesets/changelog-github`'s `git log` call for PR/author enrichment). Apply the Task-7 action-version caveat if `v6` is not yet published at code time.
  - Use `actions/setup-node@v6` with `node-version: 22` and `cache: npm`. Apply the Task-7 action-version caveat if `v6` is not yet published at code time.
  - Pre-publish steps run sequentially in this order: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`. Then the `changesets/action@v1` step runs.
  - `GITHUB_TOKEN` is passed via `env:` on the `changesets/action@v1` step.
  - Do NOT add any `--provenance` flag explicitly; OIDC publishing is automatic at npm CLI v11.5.1+ and the action handles it.
  - Do NOT set `NPM_TOKEN` or any other npm secret in `env:`. Authentication is via OIDC (E4 must be configured before the first real publish — surfaced in the PR description's pre-merge checklist).
- **Depends on:** Task 1 (so `package.json:scripts.lint`, `package.json:scripts.typecheck`, `package.json:scripts.test`, and `package.json:scripts.release` all resolve), Task 2 (so `npm ci` works), Task 3, Task 4, Task 5 (so the workflow has something to consume on the manual bootstrap run).
- **Traces to:** R4.1, R4.2, R4.3, R4.4, R4.5, R4.6, R4.10, R5.3, R5.4, R5.5, R8.11, R9.1, R9.2, A11, D1, D2, D3, D4, F1, F2, F3, design decision "Bootstrap via `workflow_dispatch`-only trigger; `push: trunk` added in the follow-up D4 feature PR", design decision "OIDC trusted publishing, not `NPM_TOKEN`", design decision "`workflow_dispatch` kill switch (`skip_publish`) — ternary-trap-safe expression", design decision "`@changesets/changelog-github`, not `@changesets/changelog-git` or default", design section "`.github/workflows/release.yml` (interface)". Note: the spec's literal R8.11 / D1 / F1 wording ("`on: push: branches: [trunk]`" / "Merging this PR triggers `release.yml`" / "the first `release.yml` run on this PR's merge commit succeeds") is superseded by the design's `workflow_dispatch`-only substitution per OQ-7, which the design reviewer accepted as a wording gap that does not block design approval; substantive D1 / D3 / F1 intent is preserved.
- **Acceptance:**
  - `.github/workflows/release.yml` exists and is valid YAML.
  - `on.workflow_dispatch` is present; `on.workflow_dispatch.inputs.skip_publish.type === "boolean"` and `default === false`.
  - `on.push` is NOT a top-level key (the `push:` block exists only as a YAML comment).
  - The `publish:` input on the `changesets/action@v1` step uses the expression `${{ !inputs.skip_publish && 'npx changeset publish' || '' }}` (inverted ternary, with the leading `!`).
  - Permissions are exactly the three lines `contents: write`, `pull-requests: write`, `id-token: write`.
  - Concurrency is `${{ github.workflow }}-${{ github.ref }}` with no `cancel-in-progress` key.
  - The job steps appear in this order: `actions/checkout@v6` (with `fetch-depth: 0`), `actions/setup-node@v6` (with `node-version: 22`, `cache: npm`), `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `changesets/action@v1`. (If the Task-7 published-major deviation is applied, substitute `v4` for both `@v6` references.)
  - The `changesets/action@v1` step has `env.GITHUB_TOKEN === ${{ secrets.GITHUB_TOKEN }}`.
  - No `NPM_TOKEN` or `--provenance` flag is present anywhere in the file.
