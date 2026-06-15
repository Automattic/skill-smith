# Code Review

## Verdict: approved

## Batch scope

Tasks reviewed:

- **Task 1:** Parameterize `runE2eVerification` and delete the back-edge import in `verify-e2e.ts`
- **Task 2:** Supply `configuredProjectNames` from the `afterAllScenarios` hook in `skillsmith.config.ts`
- **Task 3:** Add the root-suite regression test for clean config load and default-export shape

Diff reviewed: `git diff 2e47538..HEAD -- ':!.pipelines'` — exactly three files
(`testing-project/eval/utils/verify-e2e.ts`, `testing-project/skillsmith.config.ts`,
`src/__tests__/config-loads.test.ts`).

## Summary

The batch fixes the `testing-project` circular import exactly as the design and plan
prescribe, and nothing more. The back-edge `import config` and the module-init const
`CONFIGURED_PROJECT_NAMES = config.roles.test.agents` are both gone from `verify-e2e.ts`,
which now references `config` nowhere — the two-node cycle is broken topologically, not
merely made init-order-safe. `runE2eVerification` gains a fourth `configuredProjectNames:
string[]` parameter, threaded straight into the unchanged `projectArgs(runnableAgentIds,
configuredProjectNames)` call, so forwarding semantics (AC3) are byte-for-byte preserved.
The `afterAllScenarios` hook derives `configuredProjectNames` from the full, unfiltered
normalized `config.roles.test.agents.map((a) => a.id)` — distinct from `runnableAgentIds`,
which additionally filters skipped ids — keeping the configured names coupled to the
declared `roles.test.agents` (AC4) and order-preserving. The `defineConfig({...})` object
is unchanged except for the hook body; `project-args.ts`, `scaffold-plugin.ts`,
`playwright.config.ts`, and `normalize.ts` are untouched. The new root-suite test is a pure
import-and-shape check matching AC5/AC2, and uses `config.hooks?.afterAllScenarios`
(optional chaining) — the noted acceptable in-task adjustment for TS18048 since `hooks` is
optional on `SkillsmithConfigInput`. All five code-phase guardrails exit 0, including the
bug-catching `config-smoke` gate, and the new test is present and passing.

## Checks

| Check                  | Command                                           | Result                                                                                          |
| ---------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| typecheck              | `npm run typecheck`                               | exit 0 — `tsc --noEmit` clean                                                                    |
| lint                   | `npm run lint`                                    | exit 0 — biome checked 110 files, no findings                                                    |
| config-smoke (bug gate)| `npm --prefix testing-project run check:config`   | exit 0 — config import graph rooted at `skillsmith.config.ts` loads without throwing (was 1)     |
| changeset-format       | `npx tsx scripts/validate-changesets.ts`          | exit 0                                                                                           |
| tests                  | `npm test`                                        | exit 0 — 185 tests, 183 pass / 0 fail / 2 skip; new `config-loads` test present and passing      |

## Behavior verification

The fix's user-observable effect is the `config-smoke` gate flipping from exit 1 (broken)
to exit 0 (fixed), so I exercised it end-to-end the way the CI gate does:

- **Pre-fix state confirmed at base.** `git show 2e47538:testing-project/eval/utils/verify-e2e.ts`
  contains `import config from "../../skillsmith.config"` (line 12) and the module-init read
  `const CONFIGURED_PROJECT_NAMES = config.roles.test.agents` (line 24) — the eager
  dereference that throws `TypeError: Cannot read properties of undefined (reading 'roles')`
  when `skillsmith.config.ts` is the entry point. `src/__tests__/config-loads.test.ts` was
  absent at base.
- **Post-fix gate runs green.** `npm --prefix testing-project run check:config` (entry:
  `await import('./skillsmith.config.ts')`) exits 0.
- **Cycle genuinely broken.** `grep` of `verify-e2e.ts` shows the only remaining `config`
  tokens are inside doc comments (`playwright.config.ts`, "config declares", "config
  module"); there is no `import config`, no `skillsmith.config` import edge, and no `config.`
  dereference. Its imports are `node:*`, the type-only `@automattic/skillsmith`, and
  `./project-args` — the graph is now a DAG.
- **Regression test exercises the same import path.** The new test does
  `await import("../../testing-project/skillsmith.config")`, transitively loading
  `verify-e2e.ts`; it passes against the fixed tree (subtest 4, `npm test`) and, by the
  base-state evidence above, would throw the `TypeError` against the unfixed code — AC5
  "fails before, passes after" holds by construction. AC3 (order-preserving `--project`
  forwarding) remains covered by the untouched `src/__tests__/project-args.test.ts`.

## Per-task and acceptance-criteria assessment

- **Task 1 — met.** Back-edge import and module-init const deleted; `verify-e2e.ts` has no
  `config` reference. Fourth param `configuredProjectNames: string[]` added (line 43) and
  passed as the second arg to `projectArgs`, with `runnableAgentIds` remaining the first
  (lines 143–146). Typechecks with Task 2 applied.
- **Task 2 — met.** Hook derives unfiltered `configuredProjectNames =
  config.roles.test.agents.map((agent) => agent.id)` (lines 76–78) from the hook-supplied
  normalized `config` (destructured at line 60), distinct from `runnableAgentIds` (lines
  69–71) which filters `skippedTestIds`. Passed as the fourth argument (line 83).
  `defineConfig({...})` object unchanged except the hook body; no new import. For the
  authored config this is `["haiku", "gpt"]` in declared order → AC3/AC4 satisfied.
- **Task 3 — met.** `src/__tests__/config-loads.test.ts` is a pure import-and-shape check
  using only `node:test`/`node:assert/strict`; imports without the `.ts` extension; asserts
  no-throw plus all four shape facts (`roles.test.agents` deep-equals `["haiku","gpt"]`,
  `Object.keys(agents)` deep-equals `["haiku","opus","gpt"]`, `mode === "test-only"`,
  `typeof hooks?.afterAllScenarios === "function"`). Does not invoke `runE2eVerification`
  or any hook; needs no wp-env/Playwright/network/credentials → AC5/AC2 satisfied.
- **Out-of-scope discipline — clean.** `git diff --name-only` shows exactly the three
  intended files. `project-args.ts`, `scaffold-plugin.ts`, `playwright.config.ts`, and
  `src/config/normalize.ts` are untouched. No changeset added (correct — changes confined to
  `testing-project/**` and `src/__tests__/**`, both excluded from the changeset gate).
