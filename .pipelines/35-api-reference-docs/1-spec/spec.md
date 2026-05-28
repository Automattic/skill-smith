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
- Third-party provider integrators — the `Provider` interface is exported but not pluggable today. The `providers.md` chapter closes with a "Custom providers" section that states this and stops there.

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
├── programmatic.md           # `run(options)` and RunOptions; embedding-in-a-Node-process path
├── hooks.md                  # lifecycle, Hooks fields, every context shape, the afterAllScenarios verification contract
├── scenarios-and-rubrics.md  # scenario.yaml schema, rubric file shape, SKILL.md layout + link-following rules
└── run-artifacts.md          # on-disk shapes: runDirectory layout + JSON schema for every report file
```

Folder naming is **`docs/api/`** (not `docs/api-reference/` or `docs/reference/`). `docs/` already exists for the project's landing page; `api` is the cleanest scoped subfolder.

#### A.1. Per-file constraints

- Each chapter is **self-contained**. A reader who arrives via a deep link to one chapter must not need to read another page to use the surface that chapter documents.
- Each chapter is **anchor-heavy**: every documented symbol, field, and flag gets a heading so deep links work.
- If any chapter grows past ~800 lines, split it; until then one page per concept.
- Each chapter ends with a single callout: `Full working example: see [`examples/skillsmith.config.ts`](../../examples/skillsmith.config.ts)`. No inline excerpts of the canonical example anywhere.

#### A.2. Index file — `docs/api/README.md`

The index contains exactly two things and nothing else:

1. **One paragraph** stating what the reference covers vs. what the top-level README covers.
2. **A flat link table** to the other eight files, with a one-line summary of each.

No duplicated content from the chapter files.

#### A.3. Examples policy — applied to every chapter

Each chapter ships **fresh, minimal, per-section snippets** in the appropriate format. Snippets are the smallest valid code that exercises the surface immediately under discussion; orthogonal fields use placeholder values (`provider: "claude-code"`, `model: "claude-haiku-4-5"`).

Per format:

- **TS** — in `configuration.md`, `agents-and-roles.md`, `providers.md`, `hooks.md`, `programmatic.md`. Each imports from `"skillsmith"` exactly as a consumer would.
- **YAML** — in `scenarios-and-rubrics.md`: at least one full valid `scenario.yaml`, one minimal rubric `<id>.md`, one minimal `SKILL.md` with a linked file demonstrating the link-following rule.
- **JSON** — in `run-artifacts.md`: every report shape illustrated with **both a passing case and a failing case**. The failing cases **must** include the verification-gate failure shape and the `skipped: "testing failed: <env var> is not set"` shape.
- **Shell** — in `cli.md`: one example per flag, one for positional scenario IDs, one for the precondition-error output, one for the unknown-scenario error output.
- **Hook examples** — in `hooks.md`: every hook gets a 5–15 line snippet showing typical context destructuring.

**All snippets must be valid**: TS must typecheck, YAML must parse against the documented schema, JSON must validate, CLI commands must run if a user pastes them. Enforcement is by reviewer — no doctest runner is added.

#### A.4. Required content per chapter

The reference must cover every surface in §A.5 below. The mapping of surfaces → chapters is non-binding (a reviewer may move a sub-topic between chapters if it reads better there), but every surface listed in §A.5 must appear somewhere in `docs/api/`.

#### A.5. Surfaces that must be documented

##### A.5.1. Programmatic JS/TS surface — every export from `src/index.ts`

The barrel is `src/index.ts`. `package.json` exposes only `"."` → `./src/index.ts`, so deep imports beyond it are not resolvable from a consuming project. The barrel is therefore definitive for the TypeScript surface.

**Values / functions to document:**

- `defineConfig` — authoring-time identity function for type-checked configs. Source: `src/config/define-config.ts:9-13`.
- `run` — returns `Promise<number>` (process exit code). Source: `src/runner.ts:29-46`.
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

**Runner:** `RunOptions` — `{ cwd?, verbose?, scenarios?, overrides? }`.

**Report types — newly added (see §B.1):** `IterationReport`, `IterationSummaryEntry`, `RunSummary`, `ScenarioAgentEntry`, `ScenarioReport`, `TokenUsage`.

**Authoring-vs-runtime nuance to call out explicitly:** users author `SkillsmithConfigInput`; hooks receive the normalized `SkillsmithConfig` (with `id` injected into each agent) via `ctx.config`. Calling this out prevents a common confusion.

##### A.5.2. CLI surface — `bin/skillsmith.mjs`

Parsed via `node:util parseArgs`. Document:

- **Positional args:** scenario directory IDs (matched against directory names under `paths.scenarios`, **not** the `name:` field inside `scenario.yaml`).
- `--verbose` / `-v` (also honours `SKILLSMITH_VERBOSE=1`).
- `--mode test-only|self-improvement`.
- `--iterations N` (integer ≥ 1; becomes `overrides.maxIterations`).
- `--scope failed-pairs|failed-scenarios|all`.
- `--final-pass` (boolean).

**Implicit behaviour to document:**

- Auto-loads `.env` from `process.cwd()` if present (shell env vars take precedence).
- `tsx/esm` is registered as a loader hook so `src/runner.ts` executes directly.

**User-visible failure formats to document verbatim** (so readers can recognise them in real failures):

- **Precondition failure:** `"skillsmith: precondition failed\n  - <reason1>\n  - <reason2>"`.
- **Unknown scenario:** `"Unknown scenarios: a, b\n\nAvailable scenarios:\n- x"`.
- **Missing API key:** testing-agent errors short-circuit the judge; the per-agent report carries `review: { skipped: "testing failed: X is not set" }`.

##### A.5.3. `skillsmith.config.ts` shape — fields, defaults, role-prompt semantics

Defaults to document (validation lives in `src/config/validate.ts`; normalization in `src/config/normalize.ts`):

- `paths`: `{ base: "./.skillsmith", skills: "./skills", scenarios: "./eval/scenarios", rubrics: "./eval/rubrics" }`.
- `mode: "test-only"`.
- `selfImprovement.maxIterations: 3` (clamped to ≥ 1).
- `selfImprovement.scope: "failed-scenarios"`.
- `selfImprovement.finalPass: false`.

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

- Every fire-and-forget hook is wrapped in `tryHook` — hook errors are logged but **never abort the run**.
- `afterAllScenarios` is the **only** hook whose return value is consumed. A throwing `afterAllScenarios` is treated as `pass=false` with `details: "verification hook threw: ..."` — **fail-safe**.
- `beforeJudgeAgent` / `afterJudgeAgent` are **skipped when the testing agent errors**.
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

**Dual identity to call out explicitly:** the **scenario directory ID** is what the CLI matches against positional args. The **`scenario.name`** YAML field is used to build iteration-side directory paths (`iteration-N/<scenario.name>/...`). They are independent and non-obvious; the docs must explain both.

**`SKILL.md`** layout (`src/scenarios/skill-loader.ts`):

- Required at `<skillsRoot>/<id>/SKILL.md`.
- Markdown links inside the skill directory are recursively followed and concatenated into one blob.
- External, mailto, fragment-only, and outside-skill-dir links are skipped. Cycles are guarded.

**Rubric files:** `<rubricsRoot>/<id>.md`. Missing rubric files do **not** fail enumeration; the judge sees `TO BE FILLED` as the body.

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

**`<agent>/report.json` details to document:**

- `testing` = `{ duration: number (ms), tokenUsage?: TokenUsage }`.
- `tokenUsage` = `{ inputTokens, cachedInputTokens, outputTokens, totalTokens }` where `inputTokens` is **gross (includes cache reads)** and `totalTokens = inputTokens + outputTokens`. `cachedInputTokens` is a **subset of**, not additive to, `inputTokens`.
- `review` is the judge's verdict. It may appear in either the verbose `{ rubrics: {...}, acceptance: [...] }` shape or the simplified `{ pass, failures? }` shape — `classifyVerdict` (internal) normalises both. Failure paths can also yield `{ skipped: "<reason>" }` (testing errored) or `{ error: "...", raw }` (judge dispatch / parse failure).

Each report shape must be illustrated as **both a TypeScript type and a JSON example** — TS reference where the type is most natural (typically `programmatic.md` or `run-artifacts.md`), JSON shapes (passing + failing cases) in `run-artifacts.md`.

##### A.5.7. Provider catalog

| ProviderId | Env var | Backing SDK | Provider-specific knobs |
| --- | --- | --- | --- |
| `claude-code` | local CC auth (no env var) | `@anthropic-ai/claude-agent-sdk` | none parsed |
| `anthropic-api` | `ANTHROPIC_API_KEY` | `@ai-sdk/anthropic` | none parsed |
| `openai-api` | `OPENAI_API_KEY` | `@ai-sdk/openai` | none parsed |
| `gemini-api` | `GOOGLE_GENERATIVE_AI_API_KEY` | `@ai-sdk/google` | none parsed |
| `codex` | `OPENAI_API_KEY` | `@openai/codex-sdk` | `effort: "minimal"\|"low"\|"medium"\|"high"\|"xhigh"`, `network: boolean`, `webSearch: "disabled"\|"cached"\|"live"` |
| `mock` | none | deterministic; writes test entries to `cwd` | none parsed |

**Per-role tool surface to document:**

- **Claude Code:** testing role gets `Read, Write, Edit, Glob, Grep, Bash`. Judge role gets `Read` only.
- **Codex:** testing role uses `sandboxMode: "workspace-write"`. Judge role uses `read-only`.
- **Vercel runner (anthropic-api / openai-api / gemini-api):** `fs-tools` jailed to `cwd`, max 25 steps per invocation.

**Missing-key behaviour:** API providers return `{ finalText: "", error: "X is not set" }` rather than throwing. Downstream effect (judge skipped, per-agent review = `{ skipped: ... }`) is documented in §A.5.2.

**Custom providers section** closes the chapter: states that the set of six built-in `ProviderId`s is fixed in this version, there is no `registerProvider()` API, and the `Provider` / `ProviderId` types remain useful for typing hook code that branches on `ctx.agent.provider`. No issue link required.

##### A.5.8. Environment / preconditions

- Node engine `>=20.17` (per `package.json`).
- `.env.example` declares `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`. Shell env wins over `.env`.
- `resolveProjectRoot` (`src/config/resolve-cwd.ts`): tries `${cwd}/skillsmith.config.ts` first, then walks **one level** into immediate child directories. Exactly one child with a config → used; zero or multiple → `PreconditionError`. **Does not recurse beyond one level.**
- `checkPaths` requires `paths.skills`, `paths.scenarios`, `paths.rubrics` to exist as directories before any iteration runs. `paths.base` only needs a non-empty string — the harness creates it.

##### A.5.9. Stability and extension points — one-paragraph note

A single short note (most naturally in `programmatic.md` or `run-artifacts.md`) records that the supported public surface is everything re-exported from `src/index.ts`. Everything else under `src/` is internal and subject to change without notice. Internal modules **must not be deep-imported**.

#### A.6. Type-stability constraints — recorded in the docs

The following two field shapes become part of the public contract as a side-effect of the new re-exports in §B and must be preserved across non-major versions. The docs (most naturally a callout in `programmatic.md` or `run-artifacts.md`) must record these so a future contributor cannot accidentally regress them:

- **`ScenarioAgentEntry.testing` and `ScenarioAgentEntry.review` stay typed `unknown`.** This is a deliberate hedge so the report writer can persist heterogeneous review shapes (verbose-vs-simplified judge output, `{ skipped: "..." }`, `{ error: "...", raw }`). Users narrow at the call site. Tightening to a closed union later would silently break consumers.
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

### D. `README.md` minimal edits

Scoped narrowly to two changes:

1. **Delete the stale sentence at `README.md:46`** — *"No CLI flags are supported yet, such as `--scenario`, fail before a run starts."* It contradicts `README.md:204-211` which documents the actual flags. Replace it with a one-sentence pointer to `docs/api/cli.md` (or delete it outright — both acceptable; the existing `### CLI flags` subsection already covers the topic).
2. **Add per-section link-outs** from each overlapping README subsection to the matching `docs/api/*.md` chapter. Concretely, the `### Configuration`, `### CLI flags`, `### Hooks`, and Lifecycle sections each get a one-line *"See [docs/api/...](./docs/api/...) for the full reference."*

**No** other README edits in this pipeline: no slimming, no rewriting overlapping prose, no reshuffling section order.

### E. Cross-linking requirements

- The index `docs/api/README.md` links to every chapter.
- Each chapter ends with a single callout pointing to `examples/skillsmith.config.ts`.
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
3. **Provider registration / extensibility.** `Provider` is documented as a read-only type. The `providers.md` chapter's "Custom providers" section states that no `registerProvider()` API exists in this version and stops there. Custom-provider support is a separate concern.
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

1. The folder `docs/api/` exists at the repo root and contains exactly nine files: `README.md`, `configuration.md`, `agents-and-roles.md`, `providers.md`, `cli.md`, `programmatic.md`, `hooks.md`, `scenarios-and-rubrics.md`, `run-artifacts.md`.
2. `docs/api/README.md` contains one orientation paragraph and a flat link table to the other eight chapters with a one-line summary of each. No duplicated chapter content.
3. Every export from `src/index.ts` listed in §A.5.1 (including the six new re-exports from §B.1) is documented somewhere in `docs/api/` with an anchored heading.
4. Every CLI flag, positional behaviour, env-var, exit-code path, and user-visible error format from §A.5.2 is documented in `cli.md`, including the verbatim precondition-failure and unknown-scenario string formats.
5. Every config field, default, and role-prompt semantic (`test`/`judge` appended; `improver` replaces) from §A.5.3 is documented.
6. Every hook in the firing-order block (§A.5.4) is documented with (1) when it fires, (2) its context shape, (3) its return-value behaviour if any, and (4) what happens on throw. The five behavioural guarantees listed in §A.5.4 are stated explicitly.
7. `scenario.yaml`, `SKILL.md`, and rubric-file shapes (§A.5.5) are documented. The dual-identity callout (scenario directory ID vs. `scenario.name`) is present.
8. The full run-artifact layout (§A.5.6) is documented. Every report file is illustrated as **both** a TypeScript type and a JSON example. JSON examples cover **both passing and failing cases**, and the failing cases include the verification-gate failure shape and the `skipped: "testing failed: <env var> is not set"` shape.
9. Every `ProviderId` in §A.5.7 is documented with its env var, backing SDK, knobs, per-role tool surface, and missing-key behaviour. The `providers.md` chapter ends with a "Custom providers" section stating that custom providers are not supported in this version.
10. The environment / preconditions in §A.5.8 (Node `>=20.17`, `.env` precedence, `resolveProjectRoot` one-level walk, `checkPaths` directory check) are documented.
11. The "Stability and extension points" note (§A.5.9) appears in `docs/api/` and states that the public surface is `src/index.ts`.
12. The two type-stability constraints from §A.6 appear in `docs/api/` as a callout, naming the fields and the reason each must not be tightened.
13. Each of the eight chapter files ends with the single callout `Full working example: see [`examples/skillsmith.config.ts`](../../examples/skillsmith.config.ts)`. No inline excerpts of the canonical example appear anywhere in `docs/api/`.

### Code changes — `src/index.ts`

14. `src/index.ts` re-exports **exactly** the six types listed in §B.1: `IterationReport`, `IterationSummaryEntry`, `RunSummary`, `ScenarioAgentEntry`, `ScenarioReport`, `TokenUsage`. Source paths match §B.1 (`./reports/iteration-report` for the first three, `./reports/scenario-report` for the next two, `./providers/types` for `TokenUsage`).
15. No additional types from the held-back set in §B.2 are re-exported.
16. The project typechecks and the existing test suite still passes after the re-exports are added.

### Code changes — `examples/skillsmith.config.ts`

17. A single new top-comment line points at `docs/api/` as the canonical reference. All existing inline comments are unchanged.

### Code changes — `README.md`

18. The stale sentence at `README.md:46` ("No CLI flags are supported yet…") is removed (or replaced with a one-line pointer to `docs/api/cli.md`).
19. The `### Configuration`, `### CLI flags`, `### Hooks`, and Lifecycle sections each contain a one-line link-out to the matching `docs/api/*.md` chapter. No other README content is changed.

### Snippet validity (reviewer-enforced)

20. Every TypeScript snippet in `docs/api/` typechecks against the current `src/index.ts` exports (including the six new ones), imported from `"skillsmith"` as a consumer would.
21. Every YAML snippet in `scenarios-and-rubrics.md` parses against the documented schema.
22. Every JSON snippet in `run-artifacts.md` is valid JSON and matches the corresponding TypeScript shape.
23. Every shell snippet in `cli.md` is a command a user could paste and run.
