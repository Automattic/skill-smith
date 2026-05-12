# Skillsmith

Skills are how we teach LLMs our domains — and today we ship them based on subjective review. Skillsmith is a harness with two parts: it **tests** a skill by sending prompts to an LLM and checking whether the resulting answer actually works, end-to-end in a real runtime, across models. When a test fails, a **self-improvement loop** kicks in: an agent edits the skill, re-runs the tests, and iterates until it passes — then opens a PR for human review. For anyone who builds, improves, or maintains a skill.

## The problem

Skills are now how we teach LLMs our domains. Every skill we ship determines the quality of the code and answers our teammates and users get. As skills proliferate, their defects compound.

Today, skills are written as prose and reviewed subjectively. We cannot systematically answer the questions that actually matter:

- Does this skill produce working output, end-to-end, when a real LLM consumes it?
- Did my latest edit to a reference file break anything?
- Does the skill hold up across models and across vendors?

Prose review cannot catch this. We need a test loop.

## Two parts

**Skill Tester.** Each test case is a **prompt** — the kind of request a user or agent would send. The pipeline sends the prompt to an LLM loaded with the skill, captures the answer, and validates it by executing it in a **real runtime**. The output is a pass/fail matrix per **(skill × model × test case)**.

**Self-Improvement Harness.** When tests fail, an agent reads the failure trace, proposes edits to the skill files, re-runs the tests, and iterates (capped) until the suite passes or it gives up. It produces a branch + PR with the diff and the full evidence trail.

## How the Skill Tester works

The harness runs every scenario against every configured testing agent. A **scenario** is a prompt plus the skill(s) the agent should use to fulfil it. A **testing agent** is a configured (model, tools, system) tuple. Scenarios run in parallel; within each scenario, testing agents run in parallel.

Project-specific behaviour is exposed through **hooks**. Each fork implements only the hooks it needs against the harness's runtime contract.

![Skill Tester workflow diagram](assets/skill-tester-workflow.png)

### Lifecycle

1. **Init run.** Generate `runId`, create the run directory, load scenarios from `config.paths.scenarios`.
2. **`beforeAll({ config, runId })`**.
3. **Scenario loop — parallel.** For each scenario:
   1. **Init scenario.** Create the scenario directory, load testing agents from `config.agents.testing` and the judge from `config.agents.judge`.
   2. **`beforeScenario({ config, runId, scenario })`**.
   3. **Agent loop — parallel.** For each testing agent:
      1. **Init agent.** Create the agent directory and `agentWorkspace`.
      2. **`beforeTestAgent({ config, runId, scenario, agentId, agentWorkspace })`**.
      3. **Testing agent.** Receives `scenario.prompt`, `scenario.skills`, and `agentWorkspace`; writes its output into the workspace.
      4. **`afterTestAgent({ config, runId, scenario, agentId, agentWorkspace })`**.
      5. **`beforeJudgeAgent({ config, runId, scenario, agentId, agentWorkspace })`**.
      6. **Judge agent.** Receives `scenario`, the rubrics it references, and `agentWorkspace`; writes `judge-review.yaml` to the agent directory.
      7. **`afterJudgeAgent({ config, runId, scenario, agentId, agentWorkspace })`**.
   4. **Scenario report.** The harness aggregates every agent's `judge-review.yaml` into the scenario's `report.yaml`.
   5. **`afterScenario({ config, runId, scenario })`**.
4. **Run report.** The harness aggregates every scenario's `report.yaml` into a top-level `report.yaml`.
5. **`afterAll({ config, runId })`**.

### Hook examples

Projects opt into the hooks they need. Two examples from the WordPress reference project:

**`beforeTestAgent` — scaffold the artifact the agent will edit.** Generates a plugin skeleton inside `agentWorkspace` with a deterministic slug (`plugin-${scenario.name}-${agentId}`) so it can be activated later by `afterAll`.

**`afterAll` — run e2e tests against every artifact produced in the run.** Writes a `.wp-env.json` listing every plugin produced in this run, then boots `wp-env`. wp-env auto-activates every listed plugin on start, so the hook sets `lifecycleScripts.afterStart` to `wp plugin deactivate --all` — leaving each spec a clean slate. It then invokes `npx playwright test` once across the (scenario × agent) project matrix; each spec is responsible for activating its own plugin, setting up its fixtures (e.g. a post containing the block under test), and tearing them down. Finally it stops `wp-env`, removes the generated `.wp-env.json`, and writes the aggregated results to `<runDirectory>/tests-report.json`.

### Rubrics and the judge

A **rubric** is prose reference material the judge LLM consults — describing standards or best-practices — reusable across scenarios. Each scenario references one or more rubrics plus an inline `acceptance` list of per-scenario expectations.

**The judge does not read the skill.** The agent learns from the skill; the judge grades from the rubrics. Keeping them epistemically separate is what lets the harness catch a regression in the skill itself — if the judge consulted the same skill the agent did, a bad skill edit would simultaneously redefine "correct" and the regression would slip through.

## Providers

The harness dispatches each (scenario, agent) pair to a **provider** — the binding between Skillsmith and a specific model vendor or runtime. Pick one per agent in `skillsmith.config.ts`.

| Provider id | Summary | Docs |
|---|---|---|
| `claude-code` | Anthropic's Claude Agent SDK with full Read/Write/Edit/Glob/Grep/Bash tool surface and built-in sandboxing. | [docs/providers/claude-code.md](docs/providers/claude-code.md) (forthcoming) |
| `codex` | OpenAI Codex CLI via `@openai/codex-sdk`. Workspace-write sandbox; reads `OPENAI_API_KEY`. | [docs/providers/codex.md](docs/providers/codex.md) (forthcoming) |
| `openai-api` | Direct OpenAI Responses API with a local function-calling tool loop. Reads `OPENAI_API_KEY`. | [docs/providers/openai-api.md](docs/providers/openai-api.md) (forthcoming) |
| `gemini` | Google Gemini via `@google/genai`. Owns the function-calling loop, enforces path containment in-process. Reads `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). | [docs/providers/gemini.md](docs/providers/gemini.md) |
| `mock` | Deterministic provider for hermetic tests and dry runs. Drops a sentinel file and returns a passing YAML verdict. | — |

## How the Self-Improvement works

TBD
