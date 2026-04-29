# Run — Skill Smith

This document is the prose specification of the Skill Smith test harness. The runner will later be codified as a script that can execute the same flow programmatically; until then, the harness is driven by following these steps end-to-end.

The caller has placed you in a **project-under-test** — a directory that contains a `skill-smith.config.ts` and the per-project `skills/` and `eval/` directories. All relative paths in this document are relative to that project root.

**Locating the project-under-test.** If the current working directory contains `skill-smith.config.ts`, you are already there. Otherwise, look for a single immediate child directory that contains `skill-smith.config.ts` and `cd` into it before starting. If neither resolves, stop and report per section 0 — do not attempt to infer further.

You orchestrate; you do not write generated code yourself. The **testing agent** and the **judge agent** are sub-agents you spawn. Keep their roles strictly separate.

The harness has no opinion about what a project does inside its hooks. Hooks are the project's customization points; this document only specifies when each hook fires, what context it receives, and what the harness itself does between hooks. Anything else (scaffolding, runtimes, end-to-end verification, cleanup) is the project's concern, expressed as hooks on `config.hooks`.

---

## 0. Preconditions

Before starting, verify the following. If any are missing, report the list and stop — do not try to recover.

- `skill-smith.config.ts` exists at the project root.
- `paths.skills`, `paths.scenarios`, `paths.rubrics` resolve to existing directories (defaults: `./skills`, `./eval/scenarios`, `./eval/rubrics`).
- `paths.base` is set (default: `./.skillsmith`). The harness writes the run tree under it; the directory itself is created implicitly the first time something is written into it.

A rubric body may be stubbed (`TO BE FILLED`) — pass the rubric through anyway; the judge handles it.

---

## 1. Load config

Read `skill-smith.config.ts`. You need:

- `agents.testing: AgentConfig` — the agent under test. Provides the matrix's model axis.
- `agents.judge: AgentConfig` — the judge. Same shape as `testing`; the judge runs once per `(scenario, testing-agent)` pair.
- `paths` — merge field-by-field over `DEFAULT_PATHS`.
- `hooks` — optional record of project hooks; see section 3 for names and call order.

**Agent config shape.** Both `agents.testing` and `agents.judge` accept the same polymorphic `AgentConfig`:

- **String form** — a single full model id, e.g. `judge: "claude-opus-4-7"`. Shorthand for a single-entry matrix.
- **Object form** — a record keyed by `Agent`-tool alias (`haiku`, `sonnet`, `opus`). Each entry's value is either:
  - a string (the full model id — shorthand for `{ model: <id> }`), or
  - an `AgentSettings` object — `model` is the only typed/required field; any additional keys (e.g. `temperature`, `maxTokens`, `topP`, `thinking`, `reasoning_effort`) are passed through to whichever SDK or tool the harness eventually dispatches to. Typos pass through silently — the harness does not validate extras.

Example mixing both:

```ts
testing: {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: { model: "claude-sonnet-4-6", temperature: 0.5 },
  opus: { model: "claude-opus-4-7", maxTokens: 16000 },
}
```

**Normalization.** Reduce each `AgentConfig` to a list of `(alias, settings)` entries, where `alias` is one of `haiku` / `sonnet` / `opus` (the `Agent` tool's accepted values) and `settings` is an `AgentSettings` object:

- **Object form** — iterate entries in declared order. For each `(key, value)`:
  - If `key` is not in the alias table below, skip the entry with `skipped: "unknown alias <key>"` and continue. This is also how the runner rejects mistakes like `judge: { model: "claude-opus-4-7", thinking: "high" }` — the user meant `{ opus: { model: "...", thinking: "high" } }`; the literal keys `model`/`thinking` aren't aliases and get skipped, leaving an empty matrix that fails the next check.
  - Else, if `value` is a string, produce `(key, { model: value })`. If `value` is an object, produce `(key, value)` as-is.
- **String form** — look up the alias from the table below; produce a single `(alias, { model: <string> })` entry. A model id outside the table is skipped with `skipped: "model not dispatchable"`.

After normalization, validate each entry: `settings.model` must be a non-empty string. If missing, skip the entry with `skipped: "missing model"`.

If a slot's normalized list is empty (e.g. `testing: {}`, or every entry was skipped), record the slot as `skipped: "empty agent config"` and treat every `(scenario, slot)` pair as `skipped` with that reason — do not fail the run, just record and continue.

| Full model id               | `Agent` tool `model` (alias) |
| --------------------------- | ---------------------------- |
| `claude-opus-4-7`           | `opus`                       |
| `claude-sonnet-4-6`         | `sonnet`                     |
| `claude-haiku-4-5-20251001` | `haiku`                      |

(This table is consulted only by the string form. The object form takes the alias from the user's key directly — but the key must still be one of `haiku` / `sonnet` / `opus` per the rule above.)

**Plumbing limits.** Claude Code's `Agent` tool accepts `model` only, so any extra `AgentSettings` keys are captured into the run log for visibility but not passed through. Whenever a normalized entry has any non-`model` key, log it under `gaps.unplumbedSettings` in the run log. They become live when the harness is codified to call SDKs directly.

**Running the matrix.** Spawn one agent call per `(scenario, entry)` pair from `agents.testing`'s normalized list, with the `Agent` tool's `model` field set to the entry's alias. The judge sub-agent (section 5.3) is spawned the same way using `agents.judge`; if the judge resolves to multiple entries, use the first entry in the normalized list and log a warning under `gaps-encountered` — judging across models is undefined here.

**Always run the full matrix.** Every `(scenario, entry)` pair in the config must be attempted. Do not subset for "quick iteration" or to save time — if the user wants a smaller run, they will change the config or pass a filter.

Record the resolved config (agents, paths, which hooks are defined) at the top of the run log you will build in section 8.

---

## 2. Enumerate scenarios

For every directory under `paths.scenarios/` that contains a `scenario.yaml`, load the scenario. Schema (minimum):

```yaml
name: <string> # stable id used in paths + reports
description: <string>
skills: [<skill-id>] # ids under paths.skills/
prompt: | # user message to the testing agent
  ...
acceptance: [<string>] # inline rubric items
rubrics: [<rubric-id>] # ids under paths.rubrics/ (filename without .md)
```

Validate: `skills[*]` must resolve to `paths.skills/<id>/SKILL.md`; `rubrics[*]` must resolve to `paths.rubrics/<id>.md`. Missing references → fail this scenario with `error: "unresolved reference"` and continue to the next.

Projects may add their own fields to `scenario.yaml`; the harness ignores extras and exposes the full object to hooks via `ScenarioContext.scenario`.

---

## 3. Hooks

The harness exposes eight project-customization points, all optional. They live on `config.hooks` and are typed in `src/config/types.ts`:

- `beforeAll(ctx: RunContext)` / `afterAll(ctx: RunContext)`
- `beforeScenario(ctx: ScenarioContext)` / `afterScenario(ctx: ScenarioContext)`
- `beforeTestAgent(ctx: AgentContext)` / `afterTestAgent(ctx: AgentContext)`
- `beforeJudgeAgent(ctx: AgentContext)` / `afterJudgeAgent(ctx: AgentContext)`

Where:

- `RunContext = { runId, config }`
- `ScenarioContext = RunContext & { scenario }`
- `AgentContext = ScenarioContext & { agentId, agentWorkspace }`

**Call order** (mirrors `assets/skill-tester-workflow.png`):

```
beforeAll
  for each scenario (parallel):
    beforeScenario
      for each testing agent (parallel):
        beforeTestAgent
          [testing agent runs]
        afterTestAgent
        beforeJudgeAgent
          [judge agent runs]
        afterJudgeAgent
      [scenario report aggregated by harness]
    afterScenario
  [run report aggregated by harness]
afterAll
```

A missing or empty hook is a no-op — do not fail. If a defined hook throws, capture the error in the run log and continue with the next harness step; the project's hook contract is that exceptions surface but do not abort the run.

The harness never inspects the bodies of hooks and never substitutes placeholders into them. Hooks receive their context object directly and do whatever they want with it, including reading files under `agentWorkspace`, writing alongside `agentDirectory`, or calling out to external tooling. The harness's only guarantees are the call order above and the fields on the context.

Hooks are not the place for the harness's own bookkeeping. The harness owns `runId` generation, directory derivation, scenario enumeration, agent dispatch, and report aggregation (sections 4–7); hooks layer project behavior around those steps.

---

## 4. Init run and `beforeAll`

1. **Generate `runId`**: an ISO-style timestamp the harness picks at start, e.g. `YYYYMMDD-HHMMSS`. Stable for the life of the run.
2. **Derive `runDirectory`**: `${config.paths.base}/${runId}/`. Do not pre-create — the directory is implicitly created the first time the harness writes into it (an agent workspace, a report file, etc.).
3. **Enumerate scenarios** per section 2.
4. Build `RunContext = { runId, config }`.
5. Invoke `hooks.beforeAll?.(ctx)` if defined.

Record the resolved config and the list of scenarios at the top of the run log.

---

## 5. Scenario loop (parallel)

Run every scenario concurrently, each in its own task. The concurrency contract:

- Each scenario task owns its own `scenarioDirectory` and its own subtree under it. The harness does not write outside that subtree from within a scenario task.
- Each agent task within a scenario owns its own `agentDirectory` and `agentWorkspace`. Agents within a scenario do not share files with each other.
- Hooks may not assume serialization across scenarios. If a project needs cross-scenario serialization (a shared resource, a process, etc.), it must implement that itself inside its hooks.
- Reports (`scenarioDirectory/report.yaml`, `runDirectory/report.yaml`) are written by the harness once their inputs are complete — sequentially with respect to that scenario, but in parallel across scenarios.

For each scenario the harness:

1. Derives `scenarioDirectory = ${config.paths.base}/${runId}/${scenario.name}/`.
2. Reads `agents.testing` and `agents.judge` from config, normalizing each per section 1.
3. Builds `ScenarioContext = { runId, config, scenario }`.
4. Invokes `hooks.beforeScenario?.(ctx)` if defined.
5. Runs the **agent loop** below.
6. Aggregates the **scenario report** below.
7. Invokes `hooks.afterScenario?.(ctx)` if defined. Always run this hook, even if earlier steps failed.

### 5.1 Agent loop (parallel)

Run every normalized testing-agent entry concurrently. Each `(scenario, agent)` pair gets its own `agentDirectory` and `agentWorkspace`, so parallel execution is safe at the harness level — projects with cross-pair coupling must serialize inside their hooks.

For each agent the harness:

1. Picks `agentId` — the alias key from the normalized entry (`haiku` / `sonnet` / `opus`). This is the stable id used in directory names and reports.
2. Derives:
   - `agentDirectory = ${scenarioDirectory}${agentId}/`
   - `agentWorkspace = ${agentDirectory}workspace/`
3. **Creates** `agentWorkspace` (this is the one directory the harness explicitly mkdirs — sub-agents and hooks rely on it existing).
4. Builds `AgentContext = { runId, config, scenario, agentId, agentWorkspace }`.
5. Invokes `hooks.beforeTestAgent?.(ctx)` if defined.
6. Runs the **testing agent** (section 5.2).
7. Invokes `hooks.afterTestAgent?.(ctx)` if defined.
8. Invokes `hooks.beforeJudgeAgent?.(ctx)` if defined.
9. Runs the **judge agent** (section 5.3), which writes `${agentDirectory}judge-review.yaml`.
10. Invokes `hooks.afterJudgeAgent?.(ctx)` if defined.

`afterTestAgent` and `afterJudgeAgent` always run if defined, even if the corresponding agent failed — they are the project's chance to archive partial output. The harness then proceeds to the next step regardless.

### 5.2 Testing agent

Spawn a sub-agent via the `Agent` tool with `model` set to `agentId` (the alias) and `subagent_type: "general-purpose"`. Construct its prompt as follows.

**System context** (concatenate in this order):

1. The full contents of `paths.skills/<skill-id>/SKILL.md` for every id in `scenario.skills`.
2. Every file referenced from those `SKILL.md`s (follow Markdown links to files under the skill directory). Load them verbatim — the skill tells the agent what to read; you honour that.

**User message**: `scenario.prompt` verbatim.

**Tools the sub-agent gets**: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`. Constrain writes in the sub-agent's prompt: _"Only write files under `<agentWorkspace>`"_, with `<agentWorkspace>` substituted. The harness already created that directory in step 3 of section 5.1.

**Stop condition**: the sub-agent returns control on its own. Do not cap tool calls; log a warning if it exceeds 50 tool uses.

Capture from the sub-agent:

- final assistant text (the agent's "answer"),
- the list of files it created or modified under `agentWorkspace`,
- a brief tool-use log.

The harness never inspects what the sub-agent wrote beyond enumerating the file list — interpretation belongs to the judge (section 5.3) and to the project's hooks.

### 5.3 Judge agent

Spawn a second sub-agent via `Agent` with `model` set to the alias of the first entry in the normalized `agents.judge` list (per section 1) and `subagent_type: "general-purpose"`. It must **not** see the skill files.

**System context**:

1. Every rubric body in `scenario.rubrics` (read `paths.rubrics/<id>.md`).
2. An inline anonymous rubric built from `scenario.acceptance` — format:
   ```
   # Scenario acceptance
   Evaluate whether the produced code satisfies each item below.
   - <acceptance[0]>
   - <acceptance[1]>
   ...
   ```
3. A short instruction: _"You are grading an implementation against the rubrics above. Do not consult any skill documentation. Return a YAML document with `rubrics: { <rubric-id>: { pass, notes } }` and `acceptance: [{ item, pass, notes }]`."_

**User message**: the files the agent wrote (under `agentWorkspace`), concatenated with a header for each path (`=== <relative-path> ===`), plus `scenario.description` for context.

**Tools**: `Read` only (so it can re-open files under `agentWorkspace` if needed). No `Write`/`Bash`.

The judge's output is written to `${agentDirectory}judge-review.yaml`. If the document is unparseable as YAML, write the raw text to the same file with a top-level `error: "unparseable"` field — do not silently drop it; downstream aggregation needs to see something.

### 5.4 Scenario report

After every agent in the scenario has finished (success or failure), the harness aggregates `${scenarioDirectory}*/judge-review.yaml` into `${scenarioDirectory}report.yaml`. The aggregation is mechanical — list each `agentId`, copy its judge verdict, mark missing files as `error: "missing judge-review"`. No model is in the loop; this is pure file shuffling.

Then `hooks.afterScenario?.(ctx)` fires.

---

## 6. Run report and `afterAll`

Once every scenario task has completed, the harness aggregates `${runDirectory}*/report.yaml` into `${runDirectory}report.yaml`. Same mechanical shape as the scenario report — list each scenario, copy its report, mark missing files as `error: "missing scenario report"`.

Then `hooks.afterAll?.(ctx)` fires with the original `RunContext`. This is where projects do cross-scenario verification (e.g. spinning up a runtime that exercises every produced artifact at once); the harness itself does not run any verification step.

Finally print a console-style summary to your final assistant message, e.g.:

```
scenario            | haiku | sonnet | opus
counter-block       | PASS  | PASS   | FAIL
```

Column widths: the longest scenario name; each agent column the width of its header. Cells reflect what's in `runDirectory/report.yaml` — `PASS`, `FAIL`, or `SKIPPED (<reason>)`.

Exit signalling: if every cell is `pass`, end your final message with `RUN RESULT: PASS`. Otherwise `RUN RESULT: FAIL` plus a one-line summary of the first failure per scenario.

---

## 7. Directory layout

Everything the harness writes lives under `runDirectory`. Canonical paths:

```
${config.paths.base}/${runId}/                        runDirectory
├── report.yaml                                       aggregated run report
└── ${scenario.name}/                                 scenarioDirectory
    ├── report.yaml                                   aggregated scenario report
    └── ${agentId}/                                   agentDirectory
        ├── workspace/                                agentWorkspace (harness-created)
        └── judge-review.yaml                         judge verdict for this pair
```

Notes:

- `runDirectory` is implicitly created by the first write into it. The harness need not pre-create it.
- `agentWorkspace` is the only directory the harness explicitly creates (section 5.1, step 3) because both the testing agent and downstream hooks rely on it existing before they run.
- Hooks may write anything they like inside `agentDirectory`, `scenarioDirectory`, or `runDirectory`; just don't collide with the harness-owned filenames above.

---

## 8. Run log

Keep an in-memory run log as you go and dump it to `${runDirectory}run.log` at the end. It should include, in order:

- Resolved config and paths, and which hook names are defined on `config.hooks`.
- `beforeAll` invocation and any output the hook returned.
- For each scenario (in completion order, since they run in parallel):
  - `beforeScenario` invocation.
  - For each `(scenario, agentId)` pair, in order: `beforeTestAgent`, testing agent (tool-use count, files written), `afterTestAgent`, `beforeJudgeAgent`, judge (verdict), `afterJudgeAgent`.
  - Scenario report aggregation.
  - `afterScenario` invocation.
- Run report aggregation.
- `afterAll` invocation.

For every hook step, note one of: `invoked` (with optional output), `noop` (hook not defined), or `error` (hook threw, with the message). This is the document read when iterating on the harness — it is the prose equivalent of the codified runner's debug output.

---

## Guardrails

- **Judge never sees the skill.** If skill text leaks into the judge's prompt, the run is invalid — restart that pair.
- **Testing agent never sees the rubric.** Same principle in reverse. The testing agent sees skills + prompt, nothing from `paths.rubrics/` or `scenario.acceptance`.
- **The harness never writes generated code.** The testing sub-agent is the only writer in `agentWorkspace`. The harness only writes its own report files (section 7) and its run log.
- **Hooks are the project's surface, not the harness's.** Don't smuggle scaffolding, runtime setup, or verification logic into the harness flow itself; that belongs in `config.hooks`.
- **Do not re-enter this document recursively.** If a sub-agent asks to "run skill-smith" it is confused — decline.
- **Run autonomously.** Do not pause to ask the user about scope, environment, or project location. The config is authoritative for the matrix and for hooks; section 0 covers cwd resolution. If a precondition fails, fail fast per section 0 rather than negotiating.

---

## What this document does not cover yet

These are deliberate gaps, to be resolved in later iterations before codification:

- Judge-call shape: single consolidated call vs one-per-rubric.
- Retry policy on model errors (no config slot exists yet — when this lands, it likely wants a top-level `run.retry` rather than living under model defaults).
- Token accounting per stage — prose captures `toolUseCount` only.
- Running multiple providers in one invocation (requires real SDKs).
- Surfacing a diff of what the agent wrote in the summary.
- Hook error policy beyond "log and continue" — e.g. whether a `beforeAll` failure should abort the whole run before any scenario starts.
- Concurrency caps. Parallel scenario and agent execution are in the design; an explicit max-concurrency knob is not.
