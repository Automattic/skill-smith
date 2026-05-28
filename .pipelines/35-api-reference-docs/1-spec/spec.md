# Spec — Complete API reference docs for skill developers

Source: GitHub issue [#35](https://github.com/Automattic/skillsmith/issues/35) — *Complete API reference docs for skill developers*.

## Overview

Skill developers who install Skillsmith and wire it into their own project currently have no single place to look up "what does `defineConfig` take?", "what fields does `scenario.yaml` have?", "what are all the hooks and their signatures?", "what providers exist and what options do they accept?". The existing `README.md` explains *how* Skillsmith works conceptually but is not a reference.

This pipeline ships that reference: a new `docs/api/` folder of nine hand-authored Markdown files covering every public surface a skill developer can reach from a consuming project. The reference becomes the **single source of truth** for every field, type, on-disk shape, default value, and exact behaviour.

A small public-surface tightening ships alongside the docs and is **not separable** from them: six new type re-exports are added to `src/index.ts` so the on-disk run-artifact shapes and token-usage shape can be documented as TypeScript types (not just JSON examples). One stale sentence in `README.md` is corrected; per-section link-outs are added from overlapping README sections into the matching `docs/api/*.md` chapter. `examples/skillsmith.config.ts` gets a one-line top comment pointing at `docs/api/` as the canonical reference.

**Target reader.** Primary: a developer who has read `README.md`, decided to adopt Skillsmith, and now needs a desk-reference. Voice is terse, precise, code-and-table-heavy. Not tutorial. No "Welcome to..." prose. Assumes the reader knows the README's vocabulary (scenario, testing agent, judge, improver). Secondary strict superset: the **hook author** who needs behavioural guarantees — every hook entry documents (1) when it fires, (2) what's in its context, (3) what its return value does (if any), (4) what happens on throw.

Explicit non-readers, no special accommodation:

- Brand-new evaluators who haven't read the README — that's the README's job.
- Fork authors extending the harness — that's `CONTRIBUTING.md` territory. The reference includes only a single "Stability and extension points" note saying *"the public surface is `src/index.ts`; everything else is internal"* and stops there.
- Third-party provider integrators — the `Provider` interface is exported but not pluggable today. The `providers.md` chapter closes with a "Custom providers (not supported)" section that states this and stops there.

## Requirements

### A. New documentation files — `docs/api/`

The pipeline creates exactly these nine files at `docs/api/`:

```
docs/api/
├── README.md                 # thin index: one paragraph + flat TOC
├── configuration.md          # SkillsmithConfigInput / defineConfig / Paths / RunMode / EvaluationScope / SelfImprovementConfig / defaults
├── agents-and-roles.md       # AgentDefinitionInput / RolesInput / TestRoleInput / SingleRoleInput / role-prompt semantics
├── providers.md              # ProviderId catalog + per-provider env vars, knobs, tool surfaces, missing-key behaviour
├── cli.md                    # `skillsmith` binary: flags, positional scenario IDs, env vars (.env, SKILLSMITH_VERBOSE), exit codes, precondition errors
├── programmatic.md           # `run(options)` and RunOptions; embedding-in-a-Node-process path; "Stability and extension points" note
├── hooks.md                  # lifecycle, Hooks fields, every context shape, the afterAllScenarios verification contract
├── scenarios-and-rubrics.md  # scenario.yaml schema, rubric file shape, SKILL.md layout + link-following rules
└── run-artifacts.md          # on-disk shapes: runDirectory layout + JSON schema for every report file; type-stability callout
```

Folder naming is **`docs/api/`** (not `docs/api-reference/` or `docs/reference/`). `docs/` already exists for the project's landing page; `api` is the cleanest scoped subfolder.

#### A.1. Per-file constraints

- Each chapter is **self-contained for the surface it documents**. A reader who arrives via a deep link to one chapter must not need to read another page to use the surface that chapter documents.
- "Self-contained" does **not** mean "duplicate every prior chapter's content". A chapter may cross-link sister chapters (e.g. `programmatic.md` → `configuration.md` for the full config shape) provided the deep-linked target satisfies the immediate lookup without further reading. Per-section snippets in each chapter remain minimal and orthogonal: `programmatic.md` shows the smallest valid `run()` call shape and one `RunOptions` example, not a full `defineConfig` body.
- Each chapter is **anchor-heavy**: every documented symbol, field, and flag gets a Markdown heading so GitHub's auto-generated anchor fragments (kebab-case, derived from the heading text) work as deep links. Do not add explicit `<a name="…">` tags. Authors should give each public symbol its own heading at a level that produces a clean anchor (typically `###` or `####`).
- If any chapter grows past ~800 lines, split it; until then one page per concept.
- Each chapter ends with a single callout: ``Full working example: see [`examples/skillsmith.config.ts`](../../examples/skillsmith.config.ts)``. No inline excerpts of the canonical example anywhere.

#### A.2. Index file — `docs/api/README.md`

The index contains exactly two things and nothing else:

1. **One paragraph** stating what the reference covers vs. what the top-level README covers.
2. **A flat link table** to the other eight files, with a one-line summary of each.

No duplicated content from the chapter files. The index should include a one-line callout pointing at `testing-project/` (the end-to-end working WordPress reference project consumed by the smoke test) as a directory layout example. The callout is limited to one line.

#### A.3. Examples policy — applied to every chapter

Each chapter ships **fresh, minimal, per-section snippets** in the appropriate format. Snippets are the smallest valid code that exercises the surface immediately under discussion; orthogonal fields use placeholder values (`provider: "claude-code"`, `model: "claude-haiku-4-5"`).

Per format:

- **TS** — in `configuration.md`, `agents-and-roles.md`, `providers.md`, `hooks.md`, `programmatic.md`. Each imports from `"skillsmith"` exactly as a consumer would.
- **YAML** — in `scenarios-and-rubrics.md`: at least one full valid `scenario.yaml`, one minimal rubric `<id>.md`, one minimal `SKILL.md` with a linked file demonstrating the link-following rule.
- **JSON** — in `run-artifacts.md`: every report shape illustrated with **both a passing case and a failing case**. The failing cases **must** include the verification-gate failure shape and the `skipped: "testing failed: <env var> is not set"` shape.
- **Shell** — in `cli.md`: one example per flag, one for positional scenario IDs, one for each documented user-visible error output (precondition, unknown-scenario singular and plural, the four argv-parsing errors).
- **Hook examples** — in `hooks.md`: every hook gets a 5–15 line snippet showing typical context destructuring.

**All snippets must be valid**: TS must typecheck, YAML must parse against the documented schema, JSON must validate, CLI commands must run if a user pastes them. Enforcement is by reviewer — no doctest runner is added.

#### A.4. Required content per chapter

The reference must cover every surface in §A.5 below. The mapping of surfaces → chapters is non-binding (a reviewer may move a sub-topic between chapters if it reads better there), but every surface listed in §A.5 must appear somewhere in `docs/api/`.

Two chapters have **specific home assignments** that downstream phases must not move:

- The "Stability and extension points" note (§A.5.9) lives in **`programmatic.md`**. It is the chapter a user looking up "what can I import?" lands on, which makes it the deep-link target the note belongs to.
- The type-stability callout (§A.6) lives in **`run-artifacts.md`**, as a single callout, immediately after the JSON shape examples for `ScenarioAgentEntry` and `IterationReport.scenarios`. The callout names both fields together, the reason each must stay as-is, and links the corresponding TypeScript exports.

#### A.5. Surfaces that must be documented

##### A.5.1. Programmatic JS/TS surface — every export from `src/index.ts`

The barrel is `src/index.ts`. `package.json` exposes only `"."` → `./src/index.ts`, so deep imports beyond it are not resolvable from a consuming project. The barrel is therefore definitive for the TypeScript surface.

**Values / functions to document:**

- `defineConfig` — authoring-time identity function for type-checked configs. Source: `src/config/define-config.ts:9-13`.
- `run` — returns `Promise<number>` (process exit code: 0 on all-pass, 1 on any failure or precondition error). Source: `src/runner.ts:29-46`.
- `DEFAULT_PATHS` — defaults object. Source: `src/config/defaults.ts:3-8`.

**Config types** (from `src/config/types.ts`):

- `SkillsmithConfig` — normalized config carried through the pipeline.
- `SkillsmithConfigInput` — raw user-authored shape.
- `Paths`.
- `RunMode` — `"test-only" | "self-improvement"`.
- `EvaluationScope` — `"failed-pairs" | "failed-scenarios" | "all"`.
- `SelfImprovementConfig`.
- `AgentDefinition` (post-normalization, `id` injected) and `AgentDefinitionInput` (raw map entry). Both expose `[key: string]: unknown` for provider-specific knobs.
- `RolesInput`, `TestRoleInput`, `SingleRoleInput`, `NormalizedRoles`.

**Scenario / runtime contexts:**

- `Scenario`, `RunScenario`, `IterationInfo`.
- `RunContext` → `ScenarioContext` → `AgentContext` (extends chain).
- `IterationHookContext` → `IterationCompleteHookContext` → `ImproveHookContext` (extends chain — `ImproveHookContext` adds `improvementPath`).

**Hook types:**

- `Hooks`, `HookFn<Ctx>`, `AfterAllScenariosHookFn`.
- `VerificationFailure`, `VerificationResult`, `VerificationReturn`.

**Provider types:** `Provider`, `ProviderId`.

**Runner:** `RunOptions` — `{ cwd?, verbose?, scenarios?, overrides? }`. Per-field semantics the docs must call out:

- `cwd` defaults to `process.cwd()` and is the **starting point for `resolveProjectRoot`**, not the project root. `resolveProjectRoot` first tries `${cwd}/skillsmith.config.ts`; if absent it walks **one level** into immediate child directories. Exactly one child with a config → that child becomes the project root. Zero or multiple matching children → `PreconditionError`. The walk **does not recurse beyond one level**. This is subtle and a foot-gun: passing `cwd: "/path/to/my-project"` works if that directory contains `skillsmith.config.ts`; passing `cwd: "/path/to/parent-of-my-project"` works only if exactly one immediate child has it.
- `verbose` defaults to `false`. The CLI ORs the flag with `SKILLSMITH_VERBOSE=1`; programmatic callers do not get that behaviour automatically — they pass the boolean explicitly.
- `scenarios` is an array of scenario directory IDs (same matching semantics as the CLI positionals: trimmed, exact match against `paths.scenarios/<dir>` names, empty entries are rejected).
- `overrides` mirrors the CLI's `--mode`, `--iterations`, `--scope`, `--final-pass` flags. Precedence: `overrides` > config > defaults (§A.5.3).

**Report types — newly added (see §B.1):** `IterationReport`, `IterationSummaryEntry`, `RunSummary`, `ScenarioAgentEntry`, `ScenarioReport`, `TokenUsage`.

**Authoring-vs-runtime nuance to call out explicitly:** users author `SkillsmithConfigInput`; hooks receive the normalized `SkillsmithConfig` (with `id` injected into each agent) via `ctx.config`. Calling this out prevents a common confusion.

##### A.5.2. CLI surface — `bin/skillsmith.mjs`

Parsed via `node:util parseArgs`. Document:

**Positional args:**

- Scenario directory IDs, matched exactly against directory names under `paths.scenarios` (**not** the `name:` field inside `scenario.yaml`).
- Positional args are **trimmed** before matching. An arg that whitespace-trims to empty fails the run with the user-facing error `"Scenario IDs must not be empty."` (source: `src/pipeline/pipeline.ts:459-462`).
- Duplicate positionals are de-duplicated silently (source: `src/pipeline/pipeline.ts:463-466`).
- Empty positional list runs all enumerated scenarios.

**Flags:**

- `--verbose` / `-v` — boolean. Also honours `SKILLSMITH_VERBOSE=1` (the CLI ORs the two).
- `--mode test-only|self-improvement` — string.
- `--iterations N` — integer `≥ 1`; becomes `overrides.maxIterations`.
- `--scope failed-pairs|failed-scenarios|all` — string.
- `--final-pass` — boolean.

**Implicit / loader behaviour:**

- `bin/skillsmith.mjs` side-effect-imports `"tsx/esm"` (`bin/skillsmith.mjs:2`) so that `tsx` is registered as the loader for the rest of the process. This is what lets `src/runner.ts` and consumer-side `skillsmith.config.ts` files execute directly without a build step. The docs should describe it as a side-effect import (not as a `register('tsx/esm', …)` call), so a reader greping for `register(…)` does not get confused.
- `.env` auto-loading uses **Node's built-in `process.loadEnvFile`** (`bin/skillsmith.mjs:7-10`), not the third-party `dotenv` package. Requires Node `>=20.12` (already implied by the project's `>=20.17` engine pin). Shell-exported env vars take precedence per `process.loadEnvFile`'s documented semantics — `loadEnvFile` only sets variables not already present in `process.env`. The docs name the function explicitly so readers do not search for `dotenv` settings that do not exist.

**User-visible failure formats to document verbatim** (so readers can recognise them in real failures):

- **Precondition failure** (source: `src/config/resolve-cwd.ts:58-65` via `new PreconditionError([...reasons])`). Format:
  ```
  skillsmith: precondition failed
    - <reason1>
    - <reason2>
  ```
  Exit code 1. The `PreconditionError` class is not exported; the **string** is the documented contract.
- **Unknown scenarios — singular** (source: `src/pipeline/pipeline.ts:472-477`). Format:
  ```
  Unknown scenario: <id>

  Available scenarios:
  - <dir1>
  - <dir2>
  ```
- **Unknown scenarios — plural** (same source, plural branch). Format:
  ```
  Unknown scenarios: <id1>, <id2>

  Available scenarios:
  - <dir1>
  - <dir2>
  ```
  Both unknown-scenario branches are thrown as `UserFacingError`; the binary catches `UserFacingError` and exits with code 1.
- **Empty scenario ID** (source: `src/pipeline/pipeline.ts:459-462`): `"Scenario IDs must not be empty."` then exit code 1.
- **Missing API key** — testing-agent errors short-circuit the judge (source: `src/pipeline/agent-loop.ts:209-222`). The per-agent report carries `review: { skipped: "testing failed: <provider error message>" }`; for the four key-gated providers the message is the provider's literal `"X is not set"` (where X is the env var). See §A.5.6 for the report shape.

**Argv-parsing error strings — also user-visible verbatim, all exit code 1** (source: `bin/skillsmith.mjs:32-67`):

- `parseArgs` rejects (unknown option, missing value, etc.) — the binary prints the thrown error's `message`, then a separate line:
  ```
  Usage: skillsmith [--verbose] [--mode test-only|self-improvement] [--iterations N] [--scope failed-pairs|failed-scenarios|all] [--final-pass] [scenario-dir ...]
  ```
- `--mode` outside the allowed set: `'--mode must be one of "test-only", "self-improvement"'` (lines 44-50).
- `--iterations` not finite or `< 1`: `"--iterations must be an integer >= 1"` (lines 53-59).
- `--scope` outside the allowed set: `'--scope must be one of "failed-pairs", "failed-scenarios", "all"'` (lines 61-67).

Each of these four argv-parsing strings is documented in `cli.md` verbatim alongside its triggering condition. None of these errors are wrapped in `PreconditionError` or `UserFacingError` — they are raw `console.error` + `process.exit(1)` from the binary itself.

##### A.5.3. `skillsmith.config.ts` shape — fields, defaults, role-prompt semantics

**Where source-of-truth lives:**

- The base normalization (paths, role/agent registry wiring) lives in `src/config/normalize.ts`.
- Validation lives in `src/config/validate.ts`.
- The `mode` and `selfImprovement` defaults plus the CLI-override merge live in **`src/config/self-improvement.ts`** (see `resolveSelfImprovement` at `src/config/self-improvement.ts:37-50`). A docs author looking for `selfImprovement` defaults will not find them in `normalize.ts` — they live in `self-improvement.ts`.
- `maxIterations` is range-validated `>= 1` in `validate.ts:188-194`, and additionally **clamped** to `Math.max(1, …)` in `self-improvement.ts:46` after the merge. The clamp is the documented runtime guarantee; the validator is the documented authoring-time check.

**Precedence (must be stated):** CLI/`run()` override > config-file value > harness default.

**Defaults to document:**

- `paths`: `{ base: "./.skillsmith", skills: "./skills", scenarios: "./eval/scenarios", rubrics: "./eval/rubrics" }` (source: `src/config/defaults.ts:3-8`).
- `mode: "test-only"` (source: `src/config/self-improvement.ts:21`, applied by `resolveSelfImprovement` when the config omits or normalizes `mode` to `undefined`).
- `selfImprovement.maxIterations: 3` (source: `src/config/self-improvement.ts:22`; clamped to `>= 1` on merge).
- `selfImprovement.scope: "failed-scenarios"` (source: `src/config/self-improvement.ts:23`).
- `selfImprovement.finalPass: false` (source: `src/config/self-improvement.ts:24`).

**Role prompt semantics — must be documented explicitly:**

- `roles.test.prompt` and `roles.judge.prompt` are **appended** to the harness-built system prompt as a `# Role instructions` section.
- `roles.improver.prompt` **replaces** the built-in improver instructions entirely. When omitted, the built-in default at `src/improvement/improver.ts:17-35` applies.

##### A.5.4. Hook contracts — firing order, contexts, return values, on-throw behaviour

Firing order (verified against `src/pipeline/pipeline.ts`):

```
beforeAll                                  once per run    RunContext
  beforeIteration                          per iteration   IterationHookContext
    beforeAllScenarios                     per iteration   IterationHookContext
      beforeScenario                       per scenario    ScenarioContext
        beforeTestAgent                    per (s,a)       AgentContext
        afterTestAgent                     per (s,a)       AgentContext
        beforeJudgeAgent                   per (s,a)       AgentContext  *skipped if testing errored*
        afterJudgeAgent                    per (s,a)       AgentContext  *skipped if testing errored*
      afterScenario                        per scenario    ScenarioContext
    afterAllScenarios   *return consumed*  per iteration   IterationCompleteHookContext
    beforeImprove                          per iteration   IterationCompleteHookContext   *self-improvement only, when failing & budget remains*
    afterImprove                           per iteration   ImproveHookContext  *adds improvementPath*
  afterIteration                           per iteration   IterationCompleteHookContext   *fires after improver*
afterAll                                   once per run    RunContext
```

**Behavioural guarantees that the docs must spell out** (not just the type shapes):

- Every fire-and-forget hook is wrapped in `tryHook` (`src/util/hooks.ts:10-28`) — hook errors are logged but **never abort the run**. The next hook in the order still fires. Non-`Error` throws are coerced to `String(err)` before logging. The log line format is `hook[<scope>] <name>: error — <message>` and is written to the iteration-scoped `RunLog` (i.e. `${iterationDirectory}/run.log`) for per-iteration hooks, and to the run-root `run.log` for `beforeAll` / `afterAll`. The docs must tie hook errors to the log files in §A.5.6 so users can diagnose silent failures.
- `afterAllScenarios` is the **only** hook whose return value is consumed (source: `src/improvement/verify.ts:56-84`). A throwing `afterAllScenarios` is treated as `pass=false` with `details: "verification hook threw: <message>"` — **fail-safe**. A `false` return value (no object) coarsely fails every scenario that ran. An object return is normalised: `failures[]` lists scenario-/agent-scoped failures, `pass` defaults to `false` when any failures are present and `true` when none are. A coarse failure attaches the `details` string (or the literal `"verification gate reported failure"` when none was provided — source: `src/improvement/verify.ts:9`) to every scenario row that ran.
- The verification gate's `details` (or the default `"verification gate reported failure"`) is appended to the affected scenario's existing `error` string with `"; "` (source: `src/improvement/verify.ts:142-145`). The compound string is what callers reading `IterationReport.scenarios[<name>].error` see.
- `beforeJudgeAgent` / `afterJudgeAgent` are **skipped when the testing agent errors** — they are not fired at all, not fired-and-no-op'd. The pair is skipped symmetrically.
- `beforeScenario` and `afterScenario` fire on **every** scenario, including those skipped due to enumeration errors (`unresolved reference: …`, `scenario.yaml parse error: …`, `scenario.yaml malformed: …` — see §A.5.5). The per-scenario hooks bracket every scenario unconditionally (source: `src/pipeline/pipeline.ts:517-555`: `beforeScenario` fires before the `try` block; `afterScenario` fires in the `finally`). Only the agent-pair hooks (`beforeTestAgent` / `afterTestAgent` / `beforeJudgeAgent` / `afterJudgeAgent`) are suppressed on the errored path, because the agent loop is short-circuited when `error !== undefined`. Hook authors writing `afterScenario` to read the per-agent workspace must be defensive: the workspace was never populated for an errored scenario.
- `afterIteration` fires **after** the improver in self-improvement mode, so its context reflects the post-improve state.
- `runDirectory` and `iterationDirectory` are absolute paths. Users may write into the iteration directory (and the reference WordPress project does — e.g. `tests-report.json`); the harness owns everything else there.

Per-hook entries must each document: **(1) when it fires, (2) what's in its context, (3) what its return value does (if any), (4) what happens on throw.**

##### A.5.5. On-disk contracts — authored by the developer

**`scenario.yaml`** (parsed by `src/scenarios/enumerate.ts`):

```yaml
name: <string, non-empty>     # SEPARATE from the directory ID — used inside iteration-N/<scenario.name>/...
description: <string>          # appended to the judge user prompt
skills:                        # ids; each must resolve to <skillsRoot>/<id>/SKILL.md
  - <skill-id>
prompt: |                      # verbatim user prompt to the testing agent
  ...
acceptance:                    # per-scenario expectations the judge grades
  - <string>
rubrics:                       # ids; each must resolve to <rubricsRoot>/<id>.md
  - <rubric-id>
```

All six required fields (`name`, `description`, `skills`, `prompt`, `acceptance`, `rubrics`) are checked by the shape validator at `src/scenarios/enumerate.ts:100-115`. A scenario with a missing or malformed YAML body is emitted with one of the following enumeration errors and skipped from agent runs (source: `src/scenarios/enumerate.ts:42-58`):

- `"scenario.yaml parse error: <yaml-parser-message>"`
- `"scenario.yaml malformed: expected name/description/skills/prompt/acceptance/rubrics"`

The `Scenario` interface (`src/config/types.ts:123-131`) additionally carries a `[key: string]: unknown` index signature alongside the six declared fields. A `scenario.yaml` author may add arbitrary extra keys (e.g. `tags`, `category`) and they will round-trip through enumeration into the runtime `Scenario` object available to hooks via `ctx.scenario`. The docs should mention this as an ergonomic affordance for hook authors writing a scenario-tag pattern — it parallels `AgentDefinitionInput`'s `[key: string]: unknown` (called out above for provider-specific knobs).

**Dual identity to call out explicitly:** the **scenario directory ID** (the directory name under `paths.scenarios/`) is what the CLI matches against positional args. The **`scenario.name`** YAML field is used to build iteration-side directory paths (`iteration-N/<scenario.name>/...`). They are independent and non-obvious; the docs must explain both.

**`SKILL.md`** layout (`src/scenarios/skill-loader.ts`):

- Required at `<skillsRoot>/<id>/SKILL.md`.
- Markdown links inside the skill directory are recursively followed and concatenated into one blob.
- External, mailto, fragment-only, and outside-skill-dir links are skipped. Cycles are guarded.

**Rubric files:** `<rubricsRoot>/<id>.md`. **A rubric (or skill) referenced by `scenario.yaml` but missing from disk fails enumeration for that scenario.** The harness records the scenario with `error: 'unresolved reference: rubric "<id>"'` (or `'unresolved reference: skill "<id>"'`; multiple missing references are joined by `", "`). When an `error` is set on a scenario, the agent loop short-circuits — neither the testing agent nor the judge runs for it (source: `src/scenarios/enumerate.ts:62-86`, with the short-circuit at `src/pipeline/pipeline.ts:513-540`). The judge has an internal `"TO BE FILLED"` rubric-body fallback (`src/pipeline/judge-agent.ts:98`), but it is reachable only if a rubric file vanishes between enumeration and judge dispatch — i.e. it is effectively dead code under the normal flow. **Users must treat referenced rubric files as required.**

##### A.5.6. On-disk contracts — produced by the harness

Layout under `${paths.base}/<runId>/`:

```
${paths.base}/<runId>/
├── run.json               # RunSummary { runId, pass, iterations: [{ number, directory, pass }] }
├── report.json            # { runId, pass, scenarios: Record<string, ScenarioReport | { error }> }
├── summary.txt            # plain-text mirror of console summary
├── run.log                # afterAll hook log
└── iteration-N/
    ├── report.json        # IterationReport { runId, iteration, pass, scenarios: Record<…> }
    ├── run.log            # this iteration's log
    ├── improvement.md     # improver finalText; "<!-- improver error: … -->" prefix on error
    ├── tests-report.json  # project-owned (e.g. Playwright); NOT harness-owned
    └── <scenario.name>/
        ├── report.json    # ScenarioReport { scenario, pass, agents: Record<…>, error? }
        └── <agent.id>/
            ├── report.json   # { testing, review }
            └── workspace/    # agentWorkspace; testing agent's cwd
```

**`<agent>/report.json` — `testing` block** (source: `src/pipeline/agent-loop.ts:196-199`):

- `testing = { duration: number (ms), tokenUsage?: TokenUsage }`.
- `tokenUsage` is **omitted** (not present at all; not `null`) when the provider did not report usage. This happens on testing-agent errors and for any provider that does not surface usage on a given path. On the `mock` provider, `tokenUsage` carries the fixed deterministic values declared at `src/providers/mock.ts:34-39` (`inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, totalTokens: 150`); users running the smoke test will see those exact numbers. Per-provider quirks live in `providers.md` (§A.5.7); the normalised shape lives here.
- **`tokenUsage` invariants** that the docs state explicitly so users do not double-count:
  - `totalTokens === inputTokens + outputTokens`.
  - `cachedInputTokens` is the **subset of** `inputTokens` served from the prompt cache, **not additive to it**. Cache reads are already inside `inputTokens` (the "gross" prompt size). `inputTokens - cachedInputTokens` is the "new tokens" the model actually processed this turn.

**`<agent>/report.json` — `review` block.** `review` is the judge's verdict, captured verbatim by the agent-loop writer (`src/pipeline/agent-loop.ts:265-280`, persisted via `writeAgentReport`). `classifyVerdict` (internal — not part of the public surface, see §A.5.9) normalises it for the matrix, but the **on-disk JSON keeps whatever the judge produced**, plus any harness-injected error shape. The chapter must illustrate every shape below with both type and JSON, with at least one passing and one failing example per shape where applicable:

1. **Verbose verdict** (judge produced rubric-by-rubric output): `{ rubrics: Record<string, { pass: boolean, notes?: string }>, acceptance: Array<{ item: string, pass: boolean, notes?: string }> }`.
2. **Simplified verdict** (judge produced collapsed output): `{ pass: boolean, failures?: string[] }`.
3. **Testing-failed → judge skipped**: `{ skipped: "testing failed: <provider error message>" }`. For key-gated providers the message is verbatim `"<env var> is not set"` (e.g. `"testing failed: ANTHROPIC_API_KEY is not set"`).
4. **Judge dispatch failed**: `{ skipped: "judge dispatch failed: <message>" }` (source: `src/pipeline/agent-loop.ts:250`). This is a *separate* skipped path from (3) — different reason string, different cause. Users writing `afterAllScenarios` branches must be able to distinguish them by the leading prefix (`"testing failed: …"` vs. `"judge dispatch failed: …"`).
5. **Judge JSON unparseable**: `{ error: "unparseable", raw: <string> }` (source: `src/pipeline/judge-agent.ts:77-84`). The literal string `"unparseable"` is a stable contract — docs must call it out so users can pattern-match on it.
6. **Judge other error**: `{ error: "judge dispatch failed: <message>", raw: <string> }` (source: `src/pipeline/judge-agent.ts:70-74`). The `error` string for this shape **also** carries the `"judge dispatch failed: …"` prefix.

**Aggregator error strings on the report shapes** are also stable contract and the docs must list them. Per-iteration / per-run aggregator (`src/reports/iteration-report.ts:38, 51, 58`) writes the following into `IterationReport.scenarios[<name>]` and into the run-root `report.json` `scenarios[<name>]` slot under the `{ error: string }` branch:

- `"missing scenario report"` — `<scenarioDirectory>/report.json` was not written.
- `"scenario report empty"` — the file existed but was empty/null after JSON parse.
- `"scenario report unparseable: <yaml-or-json-parser-message>"` — the file existed but `JSON.parse` threw.

Per-scenario aggregator (`src/reports/scenario-report.ts:59, 67, 71`) writes the following into `ScenarioAgentEntry.error`:

- `"missing agent report"` — `<scenarioDirectory>/<agent.id>/report.json` was not written.
- `"agent report unparseable: <message>"` — `JSON.parse` threw.
- `"agent report empty"` — parse succeeded but produced `null` or non-object.

All six aggregator strings are stable: users may pattern-match them in CI scripts.

**Verification-gate error composition.** When `afterAllScenarios` reports failures, the gate's `details` (or the literal default `"verification gate reported failure"`) is appended to the affected scenario's existing `error` joined by `"; "` (source: `src/improvement/verify.ts:142-145`). The compound string is what consumers read off the report. Documented as stable.

**Type vs. JSON coverage.** Each report shape must be illustrated as **both a TypeScript type and a JSON example** — TS reference where the type is most natural (typically `programmatic.md` or `run-artifacts.md`), JSON shapes (passing + failing cases per shape, including the verification-gate failure shape and the `skipped: "testing failed: <env var> is not set"` shape) in `run-artifacts.md`.

##### A.5.7. Provider catalog

| ProviderId | Env var | Backing SDK | Provider-specific knobs |
| --- | --- | --- | --- |
| `claude-code` | local CC auth (no env var) | `@anthropic-ai/claude-agent-sdk` | none parsed |
| `anthropic-api` | `ANTHROPIC_API_KEY` | `@ai-sdk/anthropic` | none parsed |
| `openai-api` | `OPENAI_API_KEY` | `@ai-sdk/openai` | none parsed |
| `gemini-api` | `GOOGLE_GENERATIVE_AI_API_KEY` | `@ai-sdk/google` | none parsed |
| `codex` | `OPENAI_API_KEY` (delegates to the OpenAI account; the `codex` CLI shares the OpenAI env var per `.env.example`) | `@openai/codex-sdk` | `effort: "minimal"\|"low"\|"medium"\|"high"\|"xhigh"`, `network: boolean`, `webSearch: "disabled"\|"cached"\|"live"` — all three optional; omitting them falls through to the SDK's defaults |
| `mock` | none | deterministic; writes test entries to `cwd` | none parsed |

**Per-role tool surface to document:**

- **Claude Code:** testing role gets `Read, Write, Edit, Glob, Grep, Bash`. Judge role gets `Read` only.
- **Codex:** testing role uses `sandboxMode: "workspace-write"`. Judge role uses `read-only`.
- **Vercel runner (anthropic-api / openai-api / gemini-api):** `fs-tools` jailed to `cwd`. Hard step cap `stepCountIs(25)` per invocation (source: `src/providers/lib/vercel-runner.ts:23, 42`). The cumulative tool-use count also trips a separate **soft warning** at `TOOL_USE_WARNING_THRESHOLD` (source: `src/pipeline/testing-agent.ts:22`) — users hitting either threshold see different log lines, so the docs name both.

**Mock provider sentinels** worth one line in `providers.md`:

- Agent id `mock-fail-testing` is a sentinel that returns `{ finalText: "", toolUseCount: 0, error: "mock testing failure" }` (source: `src/providers/mock.ts:71-72`). It is used by `agent-loop.test.ts` to exercise the testing-failed → judge-skipped branch deterministically. Users writing smoke tests should know it is a sentinel and avoid that id for normal agents.

**Missing-key behaviour:** API providers return `{ finalText: "", error: "X is not set" }` rather than throwing. Downstream effect (judge skipped, per-agent review = `{ skipped: "testing failed: X is not set" }`) is documented in §A.5.2 and §A.5.6.

**Custom providers section** closes the chapter. The section heading is reserved and deliberately a dead-end: the body states that the set of six built-in `ProviderId`s is **fixed in this version**, there is no `registerProvider()` API, and the exported `Provider` / `ProviderId` types remain useful for typing hook code that branches on `ctx.agent.provider`. No issue link required. Downstream phases **must not** expand this section beyond a single paragraph.

##### A.5.8. Environment / preconditions

- Node engine `>=20.17` (per `package.json`). `process.loadEnvFile` requires Node `>=20.12` and is satisfied by the engine pin.
- `.env.example` declares `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`. `OPENAI_API_KEY` is also used by the `codex` SDK. Shell-exported env vars win over `.env` per `process.loadEnvFile` semantics (the loader only sets variables not already present in `process.env`).
- `resolveProjectRoot` (`src/config/resolve-cwd.ts`): tries `${cwd}/skillsmith.config.ts` first, then walks **one level** into immediate child directories. Exactly one child with a config → that child becomes the project root. Zero or multiple → `PreconditionError`. **Does not recurse beyond one level.**
- `checkPaths` requires `paths.skills`, `paths.scenarios`, `paths.rubrics` to exist as directories before any iteration runs. `paths.base` only needs a non-empty string — the harness creates it. On failure, the missing-paths reasons are wrapped into a `PreconditionError` and appear as bullets inside the precondition-failure envelope documented in §A.5.2. The three reason-string formats are stable contract (source: `src/pipeline/pipeline.ts:565-583`):
  - `"paths.<key> → <abs-path> (does not exist)"`
  - `"paths.<key> → <abs-path> (not a directory)"`
  - `"paths.base is empty"`
  Each reason becomes one `- <reason>` bullet inside the `"skillsmith: precondition failed\n  - …\n  - …"` envelope described in §A.5.2; users pattern-matching on a CI build output can rely on the prefixes.

##### A.5.9. Stability and extension points — single short note

A single short note in **`programmatic.md`** (specific home assignment per §A.4) records that the supported public surface is everything re-exported from `src/index.ts`. Everything else under `src/` is internal and subject to change without notice. Internal modules **must not be deep-imported**. This is the docs' one and only acknowledgement of forks / extension authors; everything beyond it belongs in `CONTRIBUTING.md` (out of scope here).

#### A.6. Type-stability constraints — recorded in the docs

The following two field shapes become part of the public contract as a side-effect of the new re-exports in §B and must be preserved across non-major versions. Both constraints live in **one callout, in `run-artifacts.md`**, immediately after the JSON shape examples for `ScenarioAgentEntry` and `IterationReport`. The callout names both fields together, the reason each must not be tightened, and links the corresponding TypeScript exports:

- **`ScenarioAgentEntry.testing` and `ScenarioAgentEntry.review` stay typed `unknown`.** This is a deliberate hedge so the report writer can persist heterogeneous review shapes (verbose-vs-simplified judge output, `{ skipped: "..." }`, `{ error: "...", raw }`, and the testing block when present). Users narrow at the call site. Tightening to a closed union later would silently break consumers.
- **`IterationReport.scenarios` stays `Record<string, ScenarioReport | { error: string }>`.** The `{ error: string }` branch fires when a scenario report is missing or unparseable during aggregation. Lifting it into a separate `errors` map later would break every consumer.

### B. Public-surface tightening — `src/index.ts`

Six new type re-exports are added to `src/index.ts`. These are not separable from the docs — they are the typed counterpart to the on-disk JSON shapes that `docs/api/run-artifacts.md` documents.

#### B.1. Exact re-exports to add

```ts
// Report shapes (newly part of the public surface).
export type {
    IterationReport,
    IterationSummaryEntry,
    RunSummary,
} from "./reports/iteration-report";
export type {
    ScenarioAgentEntry,
    ScenarioReport,
} from "./reports/scenario-report";

// Token-usage detail (already documented in README; now typed publicly).
export type { TokenUsage } from "./providers/types";
```

Rationale per type (researcher-verified inventory):

- `ScenarioReport`, `ScenarioAgentEntry` — shape of `<scenarioDirectory>/report.json` and its `agents` rows. Needed by any hook that walks scenario reports off disk.
- `IterationReport` — shape of `<runDirectory>/iteration-N/report.json`. Needed by `afterAllScenarios` and any CI post-processor.
- `RunSummary`, `IterationSummaryEntry` — shape of `<runDirectory>/run.json`. Exporting `RunSummary` without `IterationSummaryEntry` would force consumers to re-declare the entry shape.
- `TokenUsage` — embedded under `<agent>/report.json` → `testing.tokenUsage`. Its semantics are already documented in `README.md`; typing it publicly removes the duplicate-interface drift risk for any CI script reading token spend.

#### B.2. Explicitly NOT exported in this pipeline

The following are deliberately held back (researcher-verified non-goals):

- `AggregateIterationReportParams`, `AggregateScenarioReportParams` — parameter types for internal aggregator functions whose call sites are not public.
- `PreparedSummary`, `PrintSummaryParams` — internal to the console-summary writer.
- `Cell` (verdict-classification result) and the `classifyVerdict` helper — committing to its tolerance shape now is premature. Park for a future issue.
- `InvokeParams`, `InvokeResult`, `Role` — only meaningful to a provider implementation, and there is no public registration path.

### C. `examples/skillsmith.config.ts`

A single top-comment line is added at the top of the file pointing at `docs/api/` as the canonical reference. **All existing inline comments are left unchanged.** The docs are authoritative; the example file is illustrative. When the two conflict, docs win.

The exact wording of the comment is at the code-writer's discretion, but it must (a) name `docs/api/` as the canonical reference and (b) state that the docs win when they conflict with the example. A representative phrasing is:

```ts
// Canonical reference: docs/api/. The docs are authoritative; when they
// conflict with this example, the docs win.
```

### D. `README.md` minimal edits

Scoped narrowly to two changes:

1. **Delete the sentence currently at `README.md:46`**, anchored on content not on line number (line numbers drift between spec approval and implementation):

   > `No CLI flags are supported yet; option-like arguments such as \`--scenario\` fail before a run starts.`

   This contradicts the `### CLI flags` subsection later in the README which documents the actual flags. Replace it with a one-sentence pointer to `docs/api/cli.md` (or delete it outright — both acceptable; the existing `### CLI flags` subsection already covers the topic). The implementer should `grep` for the sentence rather than rely on the line number.

2. **Add per-section link-outs** from each overlapping README subsection to the matching `docs/api/*.md` chapter. Concretely, the `### Configuration`, `### CLI flags`, `### Hooks`, and Lifecycle sections each get a one-line *"See [docs/api/...](./docs/api/...) for the full reference."*

**No** other README edits in this pipeline: no slimming, no rewriting overlapping prose, no reshuffling section order.

### E. Cross-linking requirements

- The index `docs/api/README.md` links to every chapter.
- Each chapter ends with the single callout ``Full working example: see [`examples/skillsmith.config.ts`](../../examples/skillsmith.config.ts)``.
- README sections that overlap with the reference get a one-line link-out to the matching chapter (§D.2).

### F. Source-of-truth policy — recorded as a constraint

After this pipeline lands, `docs/api/` is the canonical source of truth for every field, type, on-disk shape, default value, and exact behaviour. The README may keep:

- the conceptual narrative;
- the lifecycle overview (in the form the README already uses);
- minimal "what does it look like at a glance?" config and CLI snippets.

But every authoritative detail lives **once**, in `docs/api/`.

## Out of Scope

The following are explicitly **not** part of this pipeline and must not be undertaken:

1. **Coverage of anything outside the public surface listed in §A.5.** Internal modules (`src/pipeline/*`, `src/improvement/*`, `src/reports/*` writers, `src/progress/*`, `src/util/*`, `src/providers/*` non-types, `src/scenarios/enumerate.ts` and `skill-loader.ts` as functions, `src/config/load.ts`/`normalize.ts`/`validate.ts`/`self-improvement.ts`/`resolve-cwd.ts` as functions, and `bin/skillsmith.mjs` internals) get **only** a one-line "not part of the public API" mention in §A.5.9. No per-symbol coverage.
2. **Tutorials and getting-started narratives.** This pipeline produces **reference**, not **tutorials**. No "Welcome to Skillsmith" prose. No step-by-step walkthroughs.
3. **Provider registration / extensibility.** `Provider` is documented as a read-only type. The `providers.md` chapter's "Custom providers (not supported)" section states that no `registerProvider()` API exists in this version and stops there. Custom-provider support is a separate concern.
4. **Rewriting or slimming `README.md`.** Once `docs/api/` lands, a follow-up issue can slim README's overlapping sections — that is a separate, reviewable change. The only README edits in this pipeline are §D.
5. **TypeDoc / api-extractor / any doc-generation tooling.** All chapters are hand-authored Markdown. `src/config/types.ts` is already TSDoc-style so a future migration is unblocked, but is explicitly **not** part of this pipeline.
6. **A `docs/index.html` route for the API reference.** The reference lives at `docs/api/` and is GitHub-rendered Markdown.
7. **Contributor / fork-author / internals documentation.** That belongs in `CONTRIBUTING.md`. The reference's "Stability and extension points" note (§A.5.9) is the only acknowledgement.
8. **An automated doctest runner.** The "all snippets must be valid" requirement (§A.3) is enforced by reviewer, not by tooling.
9. **Re-exporting any type beyond the six in §B.1.** The held-back set in §B.2 is researcher-verified and deliberate.
10. **Loosening the type-stability constraints in §A.6.** `ScenarioAgentEntry.testing` / `.review` stay `unknown`; `IterationReport.scenarios` keeps its `| { error: string }` union branch.

## Acceptance Criteria

The pipeline is complete when **all** of the following are true:

### Documentation

1. The folder `docs/api/` exists at the repo root and contains exactly the nine Markdown files listed in §A: `README.md`, `configuration.md`, `agents-and-roles.md`, `providers.md`, `cli.md`, `programmatic.md`, `hooks.md`, `scenarios-and-rubrics.md`, `run-artifacts.md`. Other non-Markdown files (e.g. a future image) are not a regression on their own; only the nine Markdown chapters are mandated.
2. `docs/api/README.md` contains one orientation paragraph and a flat link table to the other eight chapters with a one-line summary of each. No duplicated chapter content.
3. Every export from `src/index.ts` listed in §A.5.1 (including the six new re-exports from §B.1) is documented somewhere in `docs/api/` with an anchored heading. `RunOptions.cwd`'s "search start, not project root" semantic is stated in `programmatic.md`.
4. Every CLI flag, positional behaviour, env-var, exit-code path, and user-visible error format from §A.5.2 is documented in `cli.md`. The verbatim strings present include: the precondition-failure block; the singular `"Unknown scenario: <id>"` and plural `"Unknown scenarios: <id1>, <id2>"` branches with their `"\n\nAvailable scenarios:\n- ..."` suffix; the empty-positional error `"Scenario IDs must not be empty."`; and the four argv-parsing strings (`parseArgs` raw message + `Usage: ...` line, `--mode must be one of "test-only", "self-improvement"`, `--iterations must be an integer >= 1`, `--scope must be one of "failed-pairs", "failed-scenarios", "all"`).
5. Every config field, default, and role-prompt semantic (`test`/`judge` appended; `improver` replaces) from §A.5.3 is documented. The defaults are sourced from `src/config/self-improvement.ts` (not `normalize.ts`); the docs name the precedence chain (overrides > config > defaults) and the `Math.max(1, …)` clamp on `maxIterations`.
6. Every hook in the firing-order block (§A.5.4) is documented with (1) when it fires, (2) its context shape, (3) its return-value behaviour if any, and (4) what happens on throw. The behavioural guarantees listed in §A.5.4 are stated explicitly, including: hook errors land in the iteration-scoped `run.log` (or run-root `run.log` for `beforeAll`/`afterAll`); non-`Error` throws are coerced to `String(err)`; the verification gate's `details`/default-note + `"; "` append semantics; the `beforeJudgeAgent`/`afterJudgeAgent` symmetric skip on testing error; the `afterIteration` post-improve fire order.
7. `scenario.yaml`, `SKILL.md`, and rubric-file shapes (§A.5.5) are documented. The dual-identity callout (scenario directory ID vs. `scenario.name`) is present. The **missing-rubric / missing-skill** behaviour is documented as "enumeration fails for that scenario with `'unresolved reference: rubric "<id>"'` / `'unresolved reference: skill "<id>"'`; agents do not run". The `"TO BE FILLED"` fallback is documented as effectively unreachable under normal flow.
8. The full run-artifact layout (§A.5.6) is documented. Every report file is illustrated as **both** a TypeScript type and a JSON example. JSON examples cover **both passing and failing cases**. All six `review` shapes from §A.5.6 (verbose, simplified, testing-failed-skipped, judge-dispatch-failed-skipped, judge-unparseable, judge-other-error) are illustrated. The six aggregator error strings (three iteration-level: `"missing scenario report"`, `"scenario report empty"`, `"scenario report unparseable: <msg>"`; three scenario-level: `"missing agent report"`, `"agent report empty"`, `"agent report unparseable: <msg>"`) are listed as stable contract. The verification-gate `"; "`-append composition and the default note `"verification gate reported failure"` are stated. The `tokenUsage` invariants (`totalTokens === inputTokens + outputTokens`; `cachedInputTokens` is a subset of `inputTokens`) and the omission rule (the field is absent, not `null`, when unavailable) are stated.
9. Every `ProviderId` in §A.5.7 is documented with its env var, backing SDK, knobs (including the "all three codex knobs optional" note), per-role tool surface, and missing-key behaviour. The Vercel runner's hard step cap (`stepCountIs(25)`) and the separate `TOOL_USE_WARNING_THRESHOLD` soft warning are both documented. The `mock-fail-testing` agent-id sentinel is documented. The `providers.md` chapter ends with a "Custom providers (not supported)" section stating that custom providers are not supported in this version; it stays a single paragraph.
10. The environment / preconditions in §A.5.8 (Node `>=20.17`, `.env` precedence via Node's `process.loadEnvFile`, `resolveProjectRoot` one-level walk, `checkPaths` directory check) are documented.
11. The "Stability and extension points" note (§A.5.9) appears in **`docs/api/programmatic.md`** and states that the public surface is `src/index.ts`.
12. The two type-stability constraints from §A.6 appear together as **one callout in `docs/api/run-artifacts.md`**, immediately after the JSON shape examples for `ScenarioAgentEntry` and `IterationReport`. The callout names both fields, gives the reason each must not be tightened, and links the corresponding TypeScript exports.
13. Each of the eight chapter files ends with the single callout ``Full working example: see [`examples/skillsmith.config.ts`](../../examples/skillsmith.config.ts)``. No inline excerpts of the canonical example appear anywhere in `docs/api/`.

### Code changes — `src/index.ts`

14. `src/index.ts` re-exports **exactly** the six types listed in §B.1: `IterationReport`, `IterationSummaryEntry`, `RunSummary`, `ScenarioAgentEntry`, `ScenarioReport`, `TokenUsage`. Source paths match §B.1 (`./reports/iteration-report` for the first three, `./reports/scenario-report` for the next two, `./providers/types` for `TokenUsage`).
15. No additional types from the held-back set in §B.2 are re-exported.
16. The project typechecks (`tsc --noEmit` is clean) and the existing test suite still passes after the re-exports are added.

### Code changes — `examples/skillsmith.config.ts`

17. A single new top-comment line points at `docs/api/` as the canonical reference and notes that docs win when they conflict with the example. All existing inline comments are unchanged.

### Code changes — `README.md`

18. The stale sentence ``No CLI flags are supported yet; option-like arguments such as `--scenario` fail before a run starts.`` is removed from the README (or replaced with a one-line pointer to `docs/api/cli.md`). Anchor the find on the sentence text, not the line number.
19. The `### Configuration`, `### CLI flags`, `### Hooks`, and Lifecycle sections each contain a one-line link-out to the matching `docs/api/*.md` chapter. No other README content is changed.

### Snippet validity (reviewer-enforced)

20. Every TypeScript snippet in `docs/api/` typechecks against the current `src/index.ts` exports (including the six new ones), imported from `"skillsmith"` as a consumer would.
21. Every YAML snippet in `scenarios-and-rubrics.md` parses against the documented schema.
22. Every JSON snippet in `run-artifacts.md` is valid JSON and matches the corresponding TypeScript shape.
23. Every shell snippet in `cli.md` is a command a user could paste and run (excluding the user-visible error blocks, which are documented as *output*, not as commands).
