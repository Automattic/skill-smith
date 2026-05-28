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

## Deliverable shape

### Reader

Primary: a developer who has read the `README.md`, decided to adopt Skillsmith, and now needs a desk-reference — "what fields can I put in `roles`?", "what does `afterTestAgent` receive?", "is `cachedInputTokens` a subset of `inputTokens`?". Voice is terse, precise, code-and-table-heavy. Not tutorial. No "Welcome to..." prose. Assumes the reader knows the README's vocabulary (scenario, testing agent, judge, improver).

Secondary, strict superset: the **hook author** who needs behavioural guarantees, not just type shapes. Every hook entry must document **(1) when it fires, (2) what's in its context, (3) what its return value does (if any), (4) what happens on throw**. Satisfying this superset is what makes the reference useful for real work.

Explicit non-readers (no special accommodation):
- Brand-new evaluators who haven't read the README — that's the README's job.
- Fork authors extending the harness — that's `CONTRIBUTING.md` territory. The reference may include a single "Stability and extension points" note saying "the public surface is `src/index.ts`; everything else is internal" and stop there.
- Third-party provider integrators — the `Provider` interface is exported but not pluggable today (see Q3); the reference will say so and stop there.

### Physical form

A new folder `docs/api/` of hand-authored Markdown files. No TypeDoc / api-extractor / generation tooling. The project has none today (verified — `package.json` declares no doc tooling), and `src/config/types.ts` is already TSDoc-style so a future migration is unblocked but is **explicitly out of scope** for this pipeline.

Files (9 in total, including a thin index):

```
docs/api/
├── README.md                 # index: one-paragraph orientation + flat TOC, nothing more
├── configuration.md          # SkillsmithConfigInput / defineConfig / Paths / RunMode / EvaluationScope / SelfImprovementConfig / defaults
├── agents-and-roles.md       # AgentDefinitionInput / RolesInput / TestRoleInput / SingleRoleInput / role-prompt semantics
├── providers.md              # ProviderId catalog + per-provider env vars, knobs, tool surfaces, missing-key behaviour
├── cli.md                    # `skillsmith` binary: flags, positional scenario IDs, env vars (.env, SKILLSMITH_VERBOSE), exit codes, precondition errors
├── programmatic.md           # `run(options)` and RunOptions; embedding-in-a-Node-process path
├── hooks.md                  # lifecycle, Hooks fields, every context shape, the afterAllScenarios verification contract
├── scenarios-and-rubrics.md  # scenario.yaml schema, rubric file shape, SKILL.md layout + link-following rules
└── run-artifacts.md          # on-disk shapes: runDirectory layout + JSON schema for every report file
```

Constraints on each file:

- Self-contained. A reader who arrives via deep link should not need to read another page to use the surface.
- Anchor-heavy (headings for every documented symbol/field/flag so deep links work).
- If any file grows past ~800 lines, split it; until then one page per concept.

Constraints on the index (`docs/api/README.md`):

- Exactly two things: (1) one paragraph stating what the reference covers vs. what the top-level README covers; (2) a flat link table to the other 8 files with a one-line summary of each.
- No duplicated content from the chapter files.

Folder naming is `docs/api/`, not `docs/api-reference/` or `docs/reference/` — `docs/` already exists (for the landing page), and `api` is the cleanest scoped subfolder.

### Source-of-truth policy

**The API reference is the single source of truth for every field, type, on-disk shape, default value, and exact behaviour.** `README.md` may keep:

- the conceptual narrative;
- the lifecycle overview (in the form the README already uses);
- minimal "what does it look like at a glance?" config and CLI snippets.

But every authoritative detail — every field default, every hook context, every report shape — lives **once**, in `docs/api/`. README sections that overlap with the reference get a one-line "See [docs/api/...](...) for the full reference" link-out.

Explicit out-of-scope for this pipeline: rewriting/slimming the README. The README is well-written narrative; gutting it risks regressing the project's front door. Once `docs/api/` lands, a follow-up issue can slim the README's overlapping sections — but that is a separate, reviewable change, not part of issue #35.

`examples/skillsmith.config.ts` stays as the canonical end-to-end runnable example. It earns its keep by answering "show me one full working file" — a need no field-by-field reference can replace. To keep all three artifacts consistent the pipeline must:

- Add a one-line top comment to `examples/skillsmith.config.ts` pointing at `docs/api/` as the canonical reference.
- Leave the existing inline comments in `examples/skillsmith.config.ts` as-is. The docs are authoritative; the example file is illustrative. When the two conflict, docs win.

### Examples policy

Each chapter ships **fresh, minimal, per-section snippets** in the appropriate format — never excerpts of `examples/skillsmith.config.ts`. Snippets are the smallest valid code that exercises the surface immediately under discussion; orthogonal fields use placeholder values (`provider: "claude-code"`, `model: "claude-haiku-4-5"`).

Per format:

- **TS** — in `configuration.md`, `agents-and-roles.md`, `providers.md`, `hooks.md`, `programmatic.md`. Each imports from `"skillsmith"` as a consumer would.
- **YAML** — in `scenarios-and-rubrics.md`: at least one full valid `scenario.yaml`, one minimal rubric `<id>.md`, one minimal `SKILL.md` with a linked file demonstrating the link-following rule.
- **JSON** — in `run-artifacts.md`: every report shape illustrated with both a passing case and a failing case. The failing cases **must** include the verification-gate failure shape and the `skipped: "testing failed: <env var> is not set"` shape.
- **Shell** — in `cli.md`: one example per flag, one for positional scenario IDs, one for the precondition-error output, one for the unknown-scenario error output.
- **Hook examples** — in `hooks.md`: every hook gets a 5-15 line snippet showing typical context destructuring. This is the highest-payoff format for that chapter.

Each chapter ends with a single "Full working example: see [`examples/skillsmith.config.ts`](../../examples/skillsmith.config.ts)" callout. No inline excerpts of the canonical example anywhere.

**All snippets must be valid** — TS must typecheck, YAML must parse against the documented schema, JSON must validate, CLI snippets must run if a user pastes them. Enforcement is by reviewer (not a doctest runner), but the requirement is in the spec so reviewers know to check.

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

### Q2 — Reader, deliverable shape, source-of-truth policy, examples policy — RESOLVED

Decisions captured in §"Deliverable shape" above. Summary:

- **Reader** = experienced adopter doing lookups, with hook authors as a strict superset.
- **Form** = `docs/api/` folder, 9 hand-authored Markdown files including a thin index. No TypeDoc.
- **SoT** = API reference is canonical for every detail; README keeps narrative + lifecycle + minimal snippets and links out; `examples/skillsmith.config.ts` stays as the canonical end-to-end runnable file with a one-line pointer to the docs.
- **Examples** = fresh per-section minimal snippets, never excerpts of the canonical example; all must be valid.

Out of scope as a side-effect of these decisions:
- Rewriting/slimming the README (separate follow-up issue).
- TypeDoc / generated-doc tooling.

### Q3 — Provider interface, report shape exports, stale README — bundled

Three small follow-up decisions. Sending as Q3 so we keep momentum.

- **(a) `Provider` interface treatment.** Document it in `docs/api/providers.md` as exported-but-read-only (no registration API today), with a single forward pointer if a tracking issue gets filed for custom-provider support.
- **(b) Report shapes — re-export from `src/index.ts`?** The harness's report TypeScript interfaces (`ScenarioReport`, `ScenarioAgentEntry`, `IterationReport`, `RunSummary`) live in `src/reports/*` and are not currently re-exported. Spec-analyst lean: re-export, because hooks authors writing `afterAllScenarios` (or anyone post-processing CI) clearly need them and the WordPress reference project (`testing-project/eval/utils/verify-e2e.ts`) already imports from `"skillsmith"`. Alternative: document on-disk shapes only as inline JSON schemas in `docs/api/run-artifacts.md` and leave the TS surface unchanged.
- **(c) Stale README text.** `README.md:46` says "No CLI flags are supported yet" but `README.md:204-211` documents the flags. Tiny fix vs. separate issue?

Out for researcher.

## Confirmed requirements

(Will be populated as the open questions close.)

## Out of scope

- Anything outside the public surface listed in §1–§9. Internal modules get a one-line "not part of the public API" mention only, no per-symbol coverage.
- Tutorials and getting-started narratives. This pipeline produces **reference**, not **tutorials**.
- Provider registration / extensibility — `Provider` is documented as read-only; actual custom-provider support is a separate concern (see Q3a).
- Rewriting or slimming `README.md`. Once `docs/api/` lands, a follow-up issue can slim README's overlapping sections.
- TypeDoc / api-extractor / any doc-generation tooling. All chapters are hand-authored Markdown.
- Adding a `docs/index.html` route for the API reference. The reference lives at `docs/api/` and is GitHub-rendered.
- Contributor / fork-author / internals documentation. That belongs in `CONTRIBUTING.md`, not here.
- An automated doc-test runner. The "all snippets must be valid" requirement is enforced by reviewer.
