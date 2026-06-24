# Code review — APPROVED (batch of Tasks 1–7)

Reviewed `feedc28..HEAD` (commits f9676f9, 0d2c54a, 26aa540, db125b3, 5d41cf5,
81830cc, fcca047) against the approved spec, design doc, and code plan. The batch
is correct, complete, spec-faithful, scope-disciplined, and green.

## Gates (run locally)

- `npm run typecheck` — clean.
- `npm run lint` — clean (`Checked 109 files`, no fixes).
- `npm run test` — 184 tests, **180 pass / 2 skipped / 2 fail**. The 2 failures are
  the pre-existing `validate-changesets.test.ts` CLI smokes (`ERR_MODULE_NOT_FOUND`
  for `tsx/dist/loader.mjs` in a temp-dir subprocess) — reproduced identically on a
  clean tree, NOT caused by this batch. No new failures introduced.

## Pre-resolved items — both verified correct

1. **No `playwright.config.ts` bug.** Confirmed the design/plan's claimed bug was a
   factual error. In `testing-project/playwright.config.ts`, `config` is the *static*
   import of `defineConfig(...)`, an identity returning `SkillsmithConfigInput`
   (`src/config/define-config.ts`), where `roles.test.agents` is `string[]`
   (`src/config/types.ts:58` `TestRoleInput`). So the original
   `.map((agentId) => ({ name: agentId, metadata: { agentId } }))` already yields
   string project names; the planned `agent.id` edit would have set `name: undefined`
   and broken typecheck. Task 7 correctly left the file unchanged. The normalized
   `AgentDefinition[]` shape applies only to `ctx.config` at runtime, which
   `afterAllScenarios` uses correctly via `config.roles.test.agents.map(a => a.id)`.
   The `--project <id>` selectors bind to these string project names, and
   `src/__tests__/project-args.test.ts:44` adds an explicit regression guard that each
   generated project `name` is the string id.
2. **Pre-existing test failures** — confirmed environment/tooling, not this batch.

## Per-mechanism correctness

- **`classifyRunnability` / `decide` (`src/runnability.ts`)** — pure/synchronous,
  imports only `getProvider` + types, classifies once per id accumulating all roles
  (`note`/`roles` map), `decide` returns the most-severe consequence via a severity
  table (`STOP_RUN > HALT_AFTER_ITERATION > EXCLUDE_LANE`). `AgentRole` is the new
  domain union, distinct from provider `Role`. Empty-string credential treated as
  absent (mirrors the providers' `!process.env.X` guard).
- **`Provider.requiredEnv`** — added as optional readonly (`src/providers/types.ts:53`);
  set on openai/anthropic/gemini only; `claude-code`/`mock`/`codex` omit it (verified
  by grep). Existing in-`invoke` guards untouched (the credential-error smokes in
  `vercel-providers.test.ts` still pass).
- **`prepareSummary` exit rule (`src/reports/summary.ts:78`)** —
  `skipped.length > 0 ? 2 : (allPass ? 0 : 1)`; `loadSkipped` defaults a
  missing/non-array value to `[]` and defensively validates entries (string `id` +
  `reason`), so the empty-skip path is inert and malformed entries degrade to "no
  skips". Distinct cyan `SKIPPED AGENTS` block, mirrored ANSI-free into `summary.txt`.
- **Judge-stop (`src/pipeline/pipeline.ts:94-107`)** — classifier runs up front; if the
  judge id's `decide(entry.roles) === "STOP_RUN"`, prints a single `console.error`
  naming id + reason and `return 2` **before** the tracker (line 127), the iteration
  loop (line 161), any hook, and any report. Verified `beforeAll` (line 379) and
  `afterAll` (the `finally` at line 299, inside the `try` that begins after the early
  return) never fire, and no `report.json` is written on this path. Returns 2 rather
  than throwing, keeping the unknown-provider abort on its existing precondition→1 path.
- **Dead lane** — tracker columns built from `runnableTestAgentIds` (line 132); the
  agent loop applies the allowlist unconditionally every iteration/mode: when no
  per-scenario filter exists the allowlist *is* the filter, otherwise the intersection
  (`pipeline.ts:418-427`). `config` is never mutated; the existing `agentIdFilter`
  mechanism is reused unchanged.
- **Improver halt** — both the in-loop improver branch (line 218) and the final-pass
  sweep (line 258) gain `&& runnability.improverRunnable`; an extra post-iteration
  `break` (lines 245-250) halts after the current iteration. The matrix/verdict still
  stand; the improver id sits in `skipped`, forcing exit 2.
- **Report passthrough + `RunContext.skipped`** — `writeRunReport` gains a defaulted
  4th `skipped` param writing it as a top-level sibling of `scenarios`. `runCtx.skipped`
  is set at construction (line 124); every derived context spreads it
  (`iterationCtx`, `afterIteration`, `afterAllScenarios`) or sets it explicitly
  (`scenarioCtx`, `agentCtx`, improver `baseCtx`) — verified all literal sites.
- **testing-project e2e** — `afterAllScenarios` reads `ctx.skipped`, drops test-role
  skips, and forwards the runnable id set; `verify-e2e.ts` appends `--project <id>` via
  the pure `projectArgs` helper (defensive intersection with configured project names).
  No build-side filter needed (a skipped agent never enters the agent loop).
- **R7 (unknown provider)** — `getProvider` throws on unknown ids, but config
  validation (`src/config/validate.ts:80`) already rejects them at load time
  (before the classifier), so the existing hard-abort path is unchanged; unknown
  providers are never turned into per-agent skips.

## Completeness (R1–R12, AC1–AC13)

Every requirement is implemented and test-covered: AC1 (classifier, all three
providers + claude-code/mock + empty-string), AC2/AC3/AC5/AC7/AC8/AC11/AC12
(`skip-misconfigured.test.ts` full-pipeline, with `beforeTestAgent`/`beforeAll`
marker fixtures asserting no-provisioning and no-hook-fire), AC4 (summary skip block
+ top-level report array), AC6 (a *present* key — even a fake one — yields a runnable
agent and no skip, so a present-but-invalid key falls to the untouched invoke path as
an ordinary `FAIL`), AC10 (`project-args.test.ts` + the playwright string-name guard;
full wp-env path documented as manual). R12.4 verified by grep: no internal-process
vocabulary anywhere in shipped `src/` or `testing-project/`.

## Non-blocking notes (not defects; no re-dispatch)

- **AC9 has no dedicated behavioral assertion.** The `RunContext.skipped` push is
  correct by construction (set on `runCtx` before `beforeAll`, carried on every derived
  context) and is exercised transitively — the same `runnability.skipped` object is
  asserted via `report.json` in `skip-misconfigured.test.ts`, and `testing-project`'s
  `afterAllScenarios` reads `ctx.skipped` (compile-checked). No in-suite run-scoped hook
  reads `ctx.skipped` to assert id/roles/reason directly. The plan did not mandate this
  test (Task 5 is type-plumbing only); the mechanism is sound. A future fixture whose
  `beforeAll` records `ctx.skipped` would tighten the suite — optional.
- The `requiredEnv` env-var literal intentionally appears in both the static descriptor
  and the runtime `invoke` guard; this is the documented, expected duplication
  (design §4.1), not a refactor target.

Verdict: **APPROVED.** No blocking problems; no tasks to re-dispatch.
