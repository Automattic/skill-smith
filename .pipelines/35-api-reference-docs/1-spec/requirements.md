# Requirements — Complete API reference docs for skill developers

Source: GitHub issue [#35](https://github.com/Automattic/skillsmith/issues/35).

## Original prompt

> Skill developers using Skillsmith to test and improve their skills need complete reference documentation covering every public API.

## Working summary

The goal is to ship complete reference documentation that covers every public API surface a skill developer needs when they install Skillsmith and wire it into their own project. The current `README.md` explains *how* Skillsmith works conceptually, but it is not a reference: a developer cannot land on a single page and look up "what does `defineConfig` take?", "what fields does `scenario.yaml` have?", "what are all the hooks and their signatures?", "what providers exist and what options do they accept?".

This pipeline produces that reference.

## Confirmed inventory of public APIs to document

The reference must cover every surface a skill developer can reach without diving into harness internals. Confirmed with `researcher`:

### 1. Programmatic JS/TS surface — everything exported from `src/index.ts`

- **Functions / values:** `defineConfig`, `run`, `DEFAULT_PATHS`.
- **Config types:** `SkillsmithConfig`, `SkillsmithConfigInput`, `Paths`, `RunMode`, `EvaluationScope`, `SelfImprovementConfig`, `AgentDefinition`, `AgentDefinitionInput`, `RolesInput`, `TestRoleInput`, `SingleRoleInput`, `NormalizedRoles`.
- **Runtime contexts:** `RunContext`, `ScenarioContext`, `AgentContext`, `IterationHookContext`, `IterationCompleteHookContext`, `ImproveHookContext`, `IterationInfo`, `RunScenario`, `Scenario`.
- **Hook types:** `Hooks`, `HookFn<Ctx>`, `AfterAllScenariosHookFn`, `VerificationFailure`, `VerificationResult`, `VerificationReturn`.
- **Provider types:** `Provider`, `ProviderId`.
- **Runner:** `RunOptions`.

### 2. CLI surface — `bin/skillsmith.mjs`

- Positional scenario directory IDs (matched against directory names under `config.paths.scenarios`, **not** the `name:` field inside `scenario.yaml`).
- Flags: `--verbose`, `--mode`, `--iterations`, `--scope`, `--final-pass`.
- Auto-loads `.env` from cwd before booting the runner.

### 3. `skillsmith.config.ts` shape

Every field a user can put in their config — including provider-specific options that flow through the `[key: string]: unknown` index on `AgentDefinitionInput` (e.g. `effort` on `codex`). Defaults to document:

- `mode: "test-only"`
- `paths`: `{ base: "./.skillsmith", skills: "./skills", scenarios: "./eval/scenarios", rubrics: "./eval/rubrics" }`
- `selfImprovement.maxIterations: 3`, `selfImprovement.scope: "failed-scenarios"`, `selfImprovement.finalPass: false`
- Semantics of `roles.test.prompt` / `roles.judge.prompt` (appended as `# Role instructions`) vs. `roles.improver.prompt` (replaces the built-in instructions entirely).

### 4. Hook contracts

The full hook menu (`beforeAll`, `beforeScenario`, `beforeTestAgent`, `afterTestAgent`, `beforeJudgeAgent`, `afterJudgeAgent`, `afterScenario`, `beforeIteration`, `beforeAllScenarios`, `afterAllScenarios`, `beforeImprove`, `afterImprove`, `afterIteration`, `afterAll`), each one's context payload type, firing order, and crucially `afterAllScenarios`'s consumed return value (and the fail-safe behaviour: a throwing `afterAllScenarios` is treated as a verification failure).

### 5. On-disk contracts (authored by the developer)

- `scenario.yaml` schema (per scenario directory under `paths.scenarios`).
- Rubric markdown files (`<id>.md` under `paths.rubrics`).

### 6. On-disk contracts (produced by the harness)

The run directory layout under `${paths.base}/<runId>/`:

- `run.json` — iteration roster.
- `report.json` — merged (scenario × agent) matrix.
- `summary.txt`, `run.log`.
- `iteration-N/report.json`, `iteration-N/improvement.md` (self-improvement mode only).
- `iteration-N/<scenario>/<agent>/report.json` — per-agent `testing` + `review` block.

### 7. Provider catalog

Each `ProviderId`: `claude-code`, `anthropic-api`, `openai-api`, `gemini-api`, `codex`, `mock`. For each: accepted options, required env vars, and any provider-specific behaviour callers need to know.

### 8. Environment / preconditions

- Node engine (`>=20.17` per `package.json`).
- `.env.example` declarations.
- `resolveProjectRoot` behaviour: walks one level — cwd → `cwd/*/skillsmith.config.ts` — so a monorepo can `cd` to its root and the harness finds the one child with a config.

## Open questions

(Each question is asked one at a time to the researcher. As answers land they get summarized into the sections above.)

### Q1 — What counts as a "public API" for this project? — RESOLVED

The inventory above is the agreed surface. One follow-up flagged: see Q2 on the `Provider` interface.

### Q2 — How should we treat the `Provider` interface? (open)

`Provider` is exported from `src/index.ts` but the project has no public registration path — users can read the type but cannot plug in a custom provider through the public API. The researcher asked us to decide whether to document it (as read-only) here, or defer until a registration path exists.

Awaiting answer.

## Confirmed requirements

(Populated as each Q&A round closes — see "Confirmed inventory" above for round 1.)

## Out of scope

(Populated as we identify what *not* to do.)
