# Requirements — Complete API reference docs for skill developers

Source: GitHub issue [#35](https://github.com/Automattic/skillsmith/issues/35).

## Original prompt

> Skill developers using Skillsmith to test and improve their skills need complete reference documentation covering every public API.

## Working summary

The goal is to ship complete reference documentation that covers every public API surface a skill developer needs when they install Skillsmith and wire it into their own project. The current `README.md` explains *how* Skillsmith works conceptually, but it is not a reference: a developer cannot land on a single page and look up "what does `defineConfig` take?", "what fields does `scenario.yaml` have?", "what are all the hooks and their signatures?", "what providers exist and what options do they accept?".

This pipeline produces that reference.

## Confirmed inventory of public APIs to document

The reference must cover every surface a skill developer can reach without diving into harness internals. Source-confirmed by `researcher` with file/line citations.

The barrel is `src/index.ts`. `package.json` exposes only `"."` → `./src/index.ts`, so deep imports beyond it are not resolvable from a consuming project. The barrel is therefore definitive for the TypeScript surface; three additional "soft contracts" live outside it and need to be documented anyway (see §5, §6, §9).

### 1. Programmatic JS/TS surface — everything re-exported from `src/index.ts`

**Values / functions:**

- `defineConfig` — `src/config/define-config.ts:9-13`. Authoring-time identity function for type-checked configs.
- `run` — `src/runner.ts:29-46`. Returns `Promise<number>` (process exit code).
- `DEFAULT_PATHS` — `src/config/defaults.ts:3-8`.

**Config types** (defined in `src/config/types.ts`):

- `SkillsmithConfig` — normalized config carried through the pipeline.
- `SkillsmithConfigInput` — raw user-authored shape.
- `Paths`, `RunMode` (`"test-only" | "self-improvement"`), `EvaluationScope` (`"failed-pairs" | "failed-scenarios" | "all"`), `SelfImprovementConfig`.
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

**Runner:** `RunOptions` — `{ cwd?, verbose?, scenarios?, overrides? }`.

**Authoring-vs-runtime nuance to document explicitly:** users author `SkillsmithConfigInput`; hooks receive the normalized `SkillsmithConfig` (with `id` injected into each agent) via `ctx.config`. Calling this out prevents a common confusion.

### 2. CLI surface — `bin/skillsmith.mjs`

Parsed via `node:util parseArgs`:

- Positional args: scenario directory IDs (matched against directory names under `paths.scenarios`, **not** the `name:` field inside `scenario.yaml`).
- `--verbose` / `-v` (also honours `SKILLSMITH_VERBOSE=1`).
- `--mode test-only|self-improvement`.
- `--iterations N` (integer ≥ 1; becomes `overrides.maxIterations`).
- `--scope failed-pairs|failed-scenarios|all`.
- `--final-pass` (boolean).

**Implicit behaviour to document:**

- Auto-loads `.env` from `process.cwd()` if present (shell env vars take precedence).
- `tsx/esm` is registered as a loader hook so `src/runner.ts` executes directly.

**CLI error paths users will encounter and need to recognise:**

- Precondition failure format: `"skillsmith: precondition failed\n  - <reason1>\n  - <reason2>"`.
- Unknown-scenario format: `"Unknown scenarios: a, b\n\nAvailable scenarios:\n- x"`.
- Missing-API-key path: testing agent errors short-circuit the judge; the per-agent report carries `review: { skipped: "testing failed: X is not set" }`.

### 3. `skillsmith.config.ts` shape

Validation lives in `src/config/validate.ts`; normalization in `src/config/normalize.ts`. Defaults to document:

- `paths`: `{ base: "./.skillsmith", skills: "./skills", scenarios: "./eval/scenarios", rubrics: "./eval/rubrics" }`.
- `mode: "test-only"`.
- `selfImprovement.maxIterations: 3` (clamped to ≥ 1).
- `selfImprovement.scope: "failed-scenarios"`.
- `selfImprovement.finalPass: false`.

**Role prompt semantics to document explicitly:**

- `roles.test.prompt` and `roles.judge.prompt` are **appended** to the harness-built system prompt as a `# Role instructions` section.
- `roles.improver.prompt` **replaces** the built-in improver instructions entirely. When omitted, the built-in default at `src/improvement/improver.ts:17-35` applies.

### 4. Hook contracts

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

**Guarantees the docs must spell out:**

- Every fire-and-forget hook is wrapped in `tryHook` — hook errors are logged but **never abort the run**.
- `afterAllScenarios` is the **only** hook whose return value is consumed. A throwing `afterAllScenarios` is treated as `pass=false` with `details: "verification hook threw: ..."` — **fail-safe**.
- `beforeJudgeAgent` / `afterJudgeAgent` are **skipped when the testing agent errors**.
- `afterIteration` fires **after** the improver in self-improvement mode, so its context reflects the post-improve state.
- `runDirectory` and `iterationDirectory` are absolute paths. Users may write into the iteration directory (and the reference WordPress project does — e.g. `tests-report.json`); the harness owns everything else there.

### 5. On-disk contracts — authored by the developer

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

The duality between **scenario directory ID** (CLI selector) and **`scenario.name`** (in-YAML field used to build iteration-side directory names) is non-obvious and must be called out.

**`SKILL.md`** layout (`src/scenarios/skill-loader.ts`):

- Required at `<skillsRoot>/<id>/SKILL.md`.
- Markdown links inside the skill directory are recursively followed and concatenated into one blob.
- External, mailto, fragment-only, and outside-skill-dir links are skipped. Cycles are guarded.

**Rubric files:** `<rubricsRoot>/<id>.md`. Missing rubric files do **not** fail enumeration; the judge sees `TO BE FILLED` as the body.

### 6. On-disk contracts — produced by the harness

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

**`<agent>/report.json` detail to document:**

- `testing` = `{ duration: number (ms), tokenUsage?: TokenUsage }`.
- `tokenUsage` = `{ inputTokens, cachedInputTokens, outputTokens, totalTokens }` where `inputTokens` is **gross (includes cache reads)** and `totalTokens = inputTokens + outputTokens`. `cachedInputTokens` is a **subset of**, not additive to, `inputTokens`.
- `review` is the judge's verdict, which may appear in either the verbose `{ rubrics: {...}, acceptance: [...] }` shape or the simplified `{ pass, failures? }` shape — `classifyVerdict` normalises both. Failure paths can also yield `{ skipped: "<reason>" }` (testing errored) or `{ error: "...", raw }` (judge dispatch / parse failure).

### 7. Provider catalog

| ProviderId | Env var | Backing SDK | Provider-specific knobs |
| --- | --- | --- | --- |
| `claude-code` | local CC auth (no env var) | `@anthropic-ai/claude-agent-sdk` | none parsed |
| `anthropic-api` | `ANTHROPIC_API_KEY` | `@ai-sdk/anthropic` | none parsed |
| `openai-api` | `OPENAI_API_KEY` | `@ai-sdk/openai` | none parsed |
| `gemini-api` | `GOOGLE_GENERATIVE_AI_API_KEY` | `@ai-sdk/google` | none parsed |
| `codex` | `OPENAI_API_KEY` | `@openai/codex-sdk` | `effort: "minimal"\|"low"\|"medium"\|"high"\|"xhigh"`, `network: boolean`, `webSearch: "disabled"\|"cached"\|"live"` |
| `mock` | none | deterministic; writes test entries to `cwd` | none parsed |

**Per-role tool surface to document:**

- Claude Code testing role: `Read, Write, Edit, Glob, Grep, Bash`. Judge role: `Read` only.
- Codex testing role: `sandboxMode: "workspace-write"`. Judge role: `read-only`.
- Vercel runner (anthropic-api / openai-api / gemini-api): `fs-tools` jailed to `cwd`, max 25 steps per invocation.

**Missing-key behaviour:** API providers return `{ finalText: "", error: "X is not set" }` rather than throwing. Downstream effect (judge skipped, per-agent review = `{ skipped: ... }`) is documented in §2.

### 8. Environment / preconditions

- Node engine `>=20.17` (per `package.json`).
- `.env.example` declares `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`. Shell env wins over `.env`.
- `resolveProjectRoot` (`src/config/resolve-cwd.ts`): tries `${cwd}/skillsmith.config.ts` first, then walks **one level** into immediate child directories. Exactly one child with a config → used; zero or multiple → `PreconditionError`. **Does not recurse beyond one level.**
- `checkPaths` requires `paths.skills`, `paths.scenarios`, `paths.rubrics` to exist as directories before any iteration runs. `paths.base` only needs a non-empty string — the harness creates it.

### 9. Reference materials and supporting assets

- **`examples/skillsmith.config.ts`** — heavily commented reference config showing every provider, every role shape, every `selfImprovement` knob, and example hooks. This is the single best touchpoint for users and the docs should cite it directly.
- **`testing-project/`** — working WordPress reference project (consumed by the smoke test). Contains `skillsmith.config.ts`, `eval/scenarios/<id>/scenario.yaml`, `eval/rubrics/<id>.md`, `eval/prompts/{improver,testing-agent}.md`, and project-owned `eval/utils/*` (scaffold + Playwright verify). Users are **not** expected to copy this verbatim, but its directory layout matches the defaults — the docs should reference it as the end-to-end working example.
- **`assets/skill-tester-workflow.png`** and **`assets/self-improvement-loop.png`** — workflow diagrams the README already embeds.
- **`docs/index.html`** (GitHub Pages landing page) — separate from the API reference, but is the project's public marketing surface and the README links to it.

## Modules explicitly out of the public surface

The following are **internal** — forks may read them for understanding, but the docs should state they are not part of the supported public API and should not be deep-imported:

- `src/pipeline/*` — orchestration internals.
- `src/improvement/*` — improver implementation (the `afterAllScenarios` **hook** is public; the verification helpers are not).
- `src/reports/*` — writer functions. **The on-disk report shapes ARE public** (§6); the writers that produce them are not.
- `src/progress/*` — live dashboard internals.
- `src/util/*` — pure internals. Note: `PreconditionError` and `UserFacingError` are thrown by `run()` but are not exported as types; their **string output formats** are the documented contract (see §2).
- `src/providers/*` non-types — registry plus per-provider implementations. The `Provider` and `ProviderId` **types** are public; the registration mechanism is not (see Q3 below).
- `src/scenarios/enumerate.ts`, `src/scenarios/skill-loader.ts` — the on-disk shapes they parse are public contracts; the loaders are not.
- `src/config/load.ts`, `normalize.ts`, `validate.ts`, `self-improvement.ts`, `resolve-cwd.ts` — the types they consume/produce are exported; the functions are not.
- `bin/skillsmith.mjs` — the binary itself is the public surface; the file's internals are not.

## Open questions

### Q1 — What counts as a "public API" for this project? — RESOLVED

The inventory in §1–§9 is the agreed surface. Internal modules listed in the section above.

### Q2 — Reader, deliverable shape, source-of-truth policy, examples policy

Sent to researcher. Sub-questions:

- (a) Target reader: experienced adopter looking up specifics — confirm vs. add tutorial readers / fork authors / brand-new evaluators.
- (b) Physical form: single markdown file vs. `docs/api/` folder of per-surface files vs. TSDoc-generated vs. README extension vs. routes under `docs/index.html`. Spec-analyst's nudge: per-surface folder.
- (c) Single source of truth: README links out to reference for every detail, duplicate independently, or thin out README. Spec-analyst's nudge: link out.
- (d) Examples policy: hand-authored excerpts of `examples/skillsmith.config.ts` (single canonical file) vs. fresh per-section minimal snippets.

Awaiting answer.

### Q3 — `Provider` interface: document as read-only, or defer?

`Provider` is exported from `src/index.ts` but no public registration hook exists — users can read the type but cannot plug in a custom provider via the public API. Three options:

- (i) Document it in the reference but mark it explicitly read-only ("not a registration API").
- (ii) Omit from the reference and open a separate issue to add a registration hook.
- (iii) Both — document with a "non-goal of this pipeline; tracked in issue #X" pointer.

To be raised after Q2 lands.

### Q4 — Report shapes: document inline, or re-export them from the barrel?

The harness's report types (`ScenarioReport`, `ScenarioAgentEntry`, `IterationReport`, `RunSummary`) are defined in `src/reports/*` and consumed on disk by anyone post-processing CI runs or writing an `afterAllScenarios` hook. They are **not** re-exported from `src/index.ts`. Researcher's recommendation: re-export, because the WordPress reference project already imports `from "skillsmith"`. Two options:

- (i) Document the shapes as inline JSON schemas only (keep the source of truth as on-disk JSON).
- (ii) Re-export the TypeScript interfaces from `src/index.ts` and document them as part of the programmatic surface, in addition to as on-disk JSON.

Spec-analyst's lean: (ii). To be raised after Q2 lands.

### Q5 — Stale README text: fix as part of this pipeline, or leave for a follow-up?

`README.md:46` says "No CLI flags are supported yet", contradicted by `README.md:207` which documents the flags. Option A: spec includes a small README fix as a sub-deliverable. Option B: leave for a separate issue. To be raised after Q2 lands.

## Confirmed requirements

(Will be populated as the open questions close.)

## Out of scope

- Anything outside the public surface listed in §1–§9. Internal modules (listed above) get a one-line "not part of the public API" mention only, no per-symbol coverage.
- Tutorials and getting-started narratives (those belong in the README or a separate `docs/getting-started.md`). This pipeline produces **reference**, not **tutorials** — pending Q2(a) confirmation.
- Provider registration / extensibility (tracked separately — see Q3).
