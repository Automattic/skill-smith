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

The harness runs every scenario against every configured testing agent by default. A **scenario** is a prompt plus the skill(s) the agent should use to fulfil it. A **testing agent** is a configured (model, tools, system) tuple. Scenarios run in parallel; within each scenario, testing agents run in parallel.

### Usage

Run all scenarios:

```sh
skillsmith
```

Run one or more targeted scenarios by directory ID under `config.paths.scenarios`:

```sh
skillsmith counter
skillsmith counter config-fetch
```

Scenario selection trims each positional/API scenario value, then matches it exactly against scenario directory names under `config.paths.scenarios`, not `scenario.name` inside `scenario.yaml`. Empty selections run all scenarios. Unknown IDs fail before any hooks or agent work runs, and the error lists the available directory IDs.

No CLI flags are supported yet; option-like arguments such as `--scenario` fail before a run starts.

Project-specific behaviour is exposed through **hooks**. Each fork implements only the hooks it needs against the harness's runtime contract.

![Skill Tester workflow diagram](assets/skill-tester-workflow.png)

### Lifecycle

1. **Init run.** Generate `runId`, load scenarios from `config.paths.scenarios`, and apply any positional scenario directory filters.
2. **`beforeAll({ config, runId, scenarios })`**. `scenarios` is the filtered list of selected scenario directory IDs and parsed scenario bodies.
3. **Iteration directory.** Create `${runDirectory}/iteration-N/`. Test-only mode runs exactly one iteration; loop mode (see below) may run more, each with its own subdirectory.
4. **Scenario loop — parallel.** For each scenario:
   1. **Init scenario.** Create the scenario directory inside the current iteration, load testing agents from `config.agents.testing` and the judge from `config.agents.judge`.
   2. **`beforeScenario({ config, runId, scenario })`**.
   3. **Agent loop — parallel.** For each testing agent:
      1. **Init agent.** Create the agent directory and `agentWorkspace`.
      2. **`beforeTestAgent({ config, runId, scenario, agentId, agentWorkspace })`**.
      3. **Testing agent.** Receives `scenario.prompt`, `scenario.skills`, and `agentWorkspace`; writes its output into the workspace.
      4. **`afterTestAgent({ config, runId, scenario, agentId, agentWorkspace })`**.
      5. **`beforeJudgeAgent({ config, runId, scenario, agentId, agentWorkspace })`**.
      6. **Judge agent.** Receives `scenario`, the rubrics it references, and `agentWorkspace`; produces a review verdict.
      7. **Agent report.** The harness writes `report.json` to the agent directory: a `testing` block with the testing agent's wall-clock `duration` (ms) and, when the provider reports it, `tokenUsage` (`inputTokens` — gross prompt size including the cache-read portion; `cachedInputTokens` — the subset that was served from the prompt cache; `outputTokens`; `totalTokens` = `inputTokens + outputTokens`); plus a `review` block — `{ pass: true }` on pass, otherwise the failing rubrics / acceptance items with the judge's notes inline.
      8. **`afterJudgeAgent({ config, runId, scenario, agentId, agentWorkspace })`**.
   4. **Scenario report.** The harness aggregates every agent's `report.json` into the scenario's `report.json`.
   5. **`afterScenario({ config, runId, scenario })`**.
5. **Iteration report.** The harness aggregates every scenario's `report.json` into `iteration-N/report.json` and writes the merged matrix across iterations to `${runDirectory}/report.json` plus an iteration roster to `${runDirectory}/run.json`.
6. **`afterAll({ config, runId, scenarios, iterations })`**.

### Hook examples

Projects opt into the hooks they need. Two examples from the WordPress reference project:

**`beforeTestAgent` — scaffold the artifact the agent will edit.** Generates a plugin skeleton inside `agentWorkspace` with a deterministic slug (`plugin-${scenario.name}-${agentId}`) so it can be activated later by `afterAll`.

**`afterAll` — run e2e tests against every artifact produced in the run.** Writes a `.wp-env.json` listing every plugin produced in this run, then boots `wp-env`. wp-env auto-activates every listed plugin on start, so the hook sets `lifecycleScripts.afterStart` to `wp plugin deactivate --all` — leaving each spec a clean slate. It then invokes Playwright only for the selected scenario specs from `scenarios`; each spec runs across the configured testing-agent projects, activates its own plugin, sets up its fixtures (e.g. a post containing the block under test), and tears them down. Finally it stops `wp-env`, removes the generated `.wp-env.json`, and writes the aggregated results to `<runDirectory>/tests-report.json`.

### Rubrics and the judge

A **rubric** is prose reference material the judge LLM consults — describing standards or best-practices — reusable across scenarios. Each scenario references one or more rubrics plus an inline `acceptance` list of per-scenario expectations.

**The judge does not read the skill.** The agent learns from the skill; the judge grades from the rubrics. Keeping them epistemically separate is what lets the harness catch a regression in the skill itself — if the judge consulted the same skill the agent did, a bad skill edit would simultaneously redefine "correct" and the regression would slip through.

## How the Self-Improvement works

When a run produces failures, the harness can loop: edit the failing skill, re-run the affected scenarios, and stop when the suite passes or the iteration budget is exhausted. Loop mode is opt-in — the default behaviour is the one-shot Skill Tester described above.

### Lifecycle

Every run lives under `${paths.base}/<runId>/`. Each iteration owns its own subdirectory; the top-level `report.json` is the merged matrix across iterations, and `run.json` lists the iterations themselves.

```
.skillsmith/20260512-123456/
├── run.json                       # iteration roster + final pass verdict
├── report.json                    # merged (scenario × agent) matrix
├── summary.txt                    # plain-text mirror of the console summary
├── iteration-1/
│   ├── report.json                # what ran this iteration (failures detailed)
│   ├── run.log
│   ├── proposal.md                # proposer output (loop mode, not yet passing)
│   ├── proposal.reviewed.md       # reviewer output (when reviewer is configured)
│   ├── skills.diff                # `git diff` of the skills dir after executor runs
│   └── <scenario>/<agent>/...     # workspaces and per-agent reports
├── iteration-2/
│   └── ...
```

1. **Iteration 1** runs every scenario (same as Skill Tester).
2. After each iteration, if the merged matrix is not yet passing and `selfImprovement.mode === "loop"`, the **improvement cycle** runs:
   1. **Proposer.** Reads the failure summary plus the text of every skill referenced by a failing scenario, and the optional proposer guidelines. Writes a markdown proposal to `iteration-N/proposal.md`.
   2. **Reviewer** *(optional)*. Reads the proposal plus the failure context. Either ACKs (proposal passes through unchanged) or returns a revised version in `iteration-N/proposal.reviewed.md`.
   3. **Executor.** Applies the final proposal to files under `paths.skills`. Runs with `Read/Write/Edit/Glob/Grep/Bash` tools, jailed to the skills directory. The harness then captures `git diff` to `iteration-N/skills.diff`.
3. **Iteration N+1** runs a subset of scenarios chosen by `selfImprovement.evaluationMode`:
   - `failed-pairs` — only (scenario, agent) pairs that failed last iteration.
   - `failed-scenarios` *(default)* — every agent of every failing scenario.
   - `all` — the full matrix.
   Scenarios that were not re-evaluated keep their previous verdict in the merged matrix.
4. The loop exits early on all-pass. If `finalPass: true` and the last iteration ran a subset, the harness runs one extra full sweep at the end so the final report reflects the current state of every (scenario, agent) pair.

The proposer and reviewer run with read-only tooling. Only the executor can write — and only inside `paths.skills`. The harness never commits or pushes; the diff lives in the working tree for human review.

### Per-iteration reports

Reports are deliberately compact. The per-agent `review` block collapses to `{ pass: true }` on pass; on failure it lists only the rubrics and acceptance items that failed, with the judge's notes inline:

```json
{
  "testing": {
    "duration": 12345,
    "tokenUsage": {
      "inputTokens": 1024,
      "cachedInputTokens": 512,
      "outputTokens": 128,
      "totalTokens": 1152
    }
  },
  "review": {
    "pass": false,
    "failures": [
      {
        "kind": "rubric",
        "id": "avoids-dom-manipulation",
        "notes": "Component uses document.querySelector inside render."
      },
      { "kind": "acceptance", "id": "uses fetch" }
    ]
  }
}
```

### Configuration

```ts
// skillsmith.config.ts
export default defineConfig({
  agents: {
    testing: [...],
    judge: [...],
  },
  selfImprovement: {
    mode: "loop",                       // "test-only" (default) | "loop"
    maxIterations: 3,                   // default 3
    evaluationMode: "failed-scenarios", // "failed-pairs" | "failed-scenarios" | "all"
    finalPass: false,
    agents: {
      proposer: { id: "proposer", provider: "claude-code", model: "claude-opus-4-7" },
      reviewer: { id: "reviewer", provider: "anthropic-api", model: "claude-sonnet-4-6" },
      executor: { id: "executor", provider: "claude-code", model: "claude-sonnet-4-6" },
    },
    paths: {
      proposerGuidelines: "./eval/improvement/proposer.md",
      executorGuidelines: "./eval/improvement/executor.md",
    },
  },
});
```

When a guidelines file is not configured, the harness uses minimal built-in defaults: "keep changes as minimal as possible" for the proposer, "apply the proposal exactly; do not commit" for the executor.

### CLI flags

Flags override the config block for a single invocation:

```
skillsmith --mode loop --iterations 5 --evaluation failed-pairs --final-pass
```

### Hooks

The base hooks (`beforeAll`, `beforeScenario`, ...) still fire. Loop mode adds eight more:

| Hook | Fires |
| --- | --- |
| `beforeIteration` / `afterIteration` | around each iteration |
| `beforeProposal` / `afterProposal` | around the proposer call |
| `beforeReview` / `afterReview` | around the reviewer call (when configured) |
| `beforeExecute` / `afterExecute` | around the executor call |

Each receives the iteration number, the iteration directory, and (where applicable) `proposalPath`, `reviewedProposalPath`, and `skillsDiffPath`.
