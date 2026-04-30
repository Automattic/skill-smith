# SPEC — skillsmith runtime

## §G Goal

Codify `src/run.md` into TS runtime: load config, fan out (scenario × testing-agent) via `@anthropic-ai/claude-agent-sdk`, judge per pair, aggregate reports. Project-side hook bodies ⊥ scope.

## §C Constraints

- C1: TS, Node ≥ 20, ESM (per `package.json`).
- C2: lint/format = Biome (`biome.json`).
- C3: agent dispatch ! via `@anthropic-ai/claude-agent-sdk` (Claude Code local).
- C4: harness ⊥ project hook bodies — only fires contract @ `src/config/types.ts:Hooks`.
- C5: preserve existing exports @ `src/index.ts` (`defineConfig`, `DEFAULT_PATHS`, types).
- C6: no opinion on what hooks do (run.md §3) — pass `RunContext`/`ScenarioContext`/`AgentContext` per types.ts verbatim.
- C7: cwd-resolution per run.md §0 — already-in-project | single child w/ `skillsmith.config.ts` | fail.
- C8: run autonomously — no user prompts mid-run (run.md Guardrails).

## §I Interfaces

- cli: `skillsmith` bin → cwd-resolve → run pipeline → print summary, exit 0|1.
- cfg: `skillsmith.config.ts` @ project root → `defineConfig({ agents, paths?, hooks? })`.
- pkg: published as `skillsmith`; projects do `import { defineConfig } from "skillsmith"`.
- exports: `src/index.ts` — `defineConfig`, `DEFAULT_PATHS`, types unchanged + new runner export.
- sdk: `@anthropic-ai/claude-agent-sdk` — `query()` w/ `model`, `allowedTools`, `permissionMode`, `cwd`, system prompt, user prompt.
- fs: writes ⊆ `${paths.base}/${runId}/` (run.md §7).
  - `runDirectory/report.yaml`
  - `runDirectory/run.log`
  - `runDirectory/${scenario.name}/report.yaml`
  - `runDirectory/${scenario.name}/${agentId}/judge-review.yaml`
  - `runDirectory/${scenario.name}/${agentId}/workspace/` (only dir explicitly mkdir'd)
- alias-table: `claude-opus-4-7→opus`, `claude-sonnet-4-6→sonnet`, `claude-haiku-4-5-20251001→haiku`.
- scenario.yaml schema: `name`, `description`, `skills[]`, `prompt`, `acceptance[]`, `rubrics[]` (+ project extras passthrough).
- hook ctx shapes: `RunContext`, `ScenarioContext`, `AgentContext` per `src/config/types.ts`.

## §V Invariants

- V1: judge prompt ⊥ skill text. leak → run invalid, restart pair.
- V2: testing-agent prompt ⊥ rubric & `scenario.acceptance`.
- V3: harness ⊥ write generated code. only writers = report files, run.log, hook bodies (under their own discretion), testing sub-agent (in workspace).
- V4: `agentWorkspace` ! mkdir'd before `beforeTestAgent` fires.
- V5: ∀ (scenario, normalized-entry) pair → attempted. no subsetting.
- V6: `runId` stable ∀ run lifetime, format `YYYYMMDD-HHMMSS`.
- V7: scenarios run parallel; (scenario, agent) pairs run parallel; no cross-task fs writes.
- V8: hook undefined → noop. hook throws → capture in run.log, continue.
- V9: `afterTestAgent`, `afterJudgeAgent`, `afterScenario` always fire if defined, even on prior failure.
- V10: judge YAML unparseable → write raw + `error: "unparseable"`, ⊥ silent drop.
- V11: scenario w/ unresolved skill|rubric ref → fail that scenario w/ `error: "unresolved reference"`, other scenarios continue.
- V12: empty normalized agent slot → all (scenario, slot) pairs `skipped: "empty agent config"`, run continues.
- V13: `agents.judge` normalized-list len > 1 → use `[0]`, log warning under `gaps-encountered`.
- V14: alias key ∉ {haiku, sonnet, opus} → entry skipped w/ reason `"unknown alias <key>"`.
- V15: string-form model id ∉ alias-table → skipped `"model not dispatchable"`.
- V16: `settings.model` empty|missing → skipped `"missing model"`.
- V17: testing sub-agent writes ⊆ `agentWorkspace`. enforced via prompt + `cwd: agentWorkspace`.
- V18: judge sub-agent tools = {Read} only. ⊥ Write, ⊥ Bash.
- V19: testing sub-agent tools = {Read, Write, Edit, Glob, Grep, Bash}.
- V20: tool-use > 50 → log warning, ⊥ abort.
- V21: §0 precondition fail → list missing & exit. ⊥ recover.
- V22: ⊥ recurse — sub-agent asking "run skillsmith" → decline. enforced via prompt.
- V23: scenario report = mechanical aggregation of `${scenarioDirectory}*/judge-review.yaml`. missing → `error: "missing judge-review"`.
- V24: run report = mechanical aggregation of `${runDirectory}*/report.yaml`. missing → `error: "missing scenario report"`.
- V25: console summary cols = longest scenario name + per-agent header width. cells ∈ {PASS, FAIL, SKIPPED (\<reason>)}.
- V26: exit signal = `RUN RESULT: PASS` if ∀ cells pass, else `RUN RESULT: FAIL` + first-failure-per-scenario one-liner.
- V27: SDK passthrough — `model` ! mapped to SDK; extras (temperature, maxTokens, thinking, effort, …) passed where SDK accepts. unsupported → log under `gaps.unplumbedSettings`.
- V28: skill system context = `paths.skills/<id>/SKILL.md` + every md-linked file under skill dir, verbatim, ∀ id ∈ `scenario.skills`.
- V29: judge user msg = workspace files concatenated w/ `=== <relative-path> ===` headers + `scenario.description`.
- V30: judge instruction ! demand YAML w/ `rubrics: { <id>: { pass, notes } }` & `acceptance: [{ item, pass, notes }]`.

## §T Tasks

| id  | status | task                                                                                                                                                                                              | cites                                          |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| T1  | x      | bootstrap: add deps (`@anthropic-ai/claude-agent-sdk`, `yaml`, `glob`); `bin` entry @ `package.json`; `src/runner.ts` entrypoint; cwd resolve + precondition checks; `runId` + `runDirectory` derive; export runner from `src/index.ts` | C1,C3,V6,V21,C7,I.cli,I.exports                |
| T2  | x      | config loader: dynamic-import `skillsmith.config.ts` (defaults already merged in `define-config.ts`)                                                                                              | I.cfg                                          |
| T3  | x      | run-log accumulator: in-memory struct → dump to `${runDirectory}run.log` @ end                                                                                                                    | V8                                             |
| T4  | x      | hook invoker util: try/catch wrap → log `invoked`\|`noop`\|`error`. always-fire variant for `after*` hooks                                                                                         | V8,V9,C4,C6                                    |
| T5  | .      | scenario enumeration: walk `paths.scenarios/*/scenario.yaml`, parse, validate `skills[*]` & `rubrics[*]` refs; bad ref → fail that scenario, continue                                              | V11,I.scenario.yaml                            |
| T6  | .      | scenario loop (parallel): derive `scenarioDirectory`, fire `beforeScenario`/`afterScenario`                                                                                                       | V7,I.fs                                        |
| T7  | .      | agent loop (parallel) + agent normalization: flatten `string\|object` config → `(alias, settings)[]`; apply skip rules; derive `agentDirectory` + mkdir `agentWorkspace`; fire all 4 agent hooks   | V4,V5,V7,V12,V14,V15,V16,I.alias-table,I.fs   |
| T8  | .      | skill loader: read `SKILL.md` + follow md-links to files under skill dir, verbatim                                                                                                                 | V28                                            |
| T9  | .      | SDK passthrough mapper: model + extras (temperature, maxTokens, thinking, effort, …) → SDK options; unsupported → `gaps.unplumbedSettings`                                                          | V27,C3                                         |
| T10 | .      | testing-agent dispatch via SDK `query()`: model=alias, allowedTools={Read,Write,Edit,Glob,Grep,Bash}, cwd=`agentWorkspace`, system=skill blob, user=`scenario.prompt`; workspace pre/post diff for files-written list; tool-use > 50 warn; recursion-decline note in prompt | V2,V3,V17,V19,V20,V22,C3                       |
| T11 | .      | judge dispatch via SDK `query()`: model=`agents.judge[0]` alias, allowedTools={Read}; system = rubric bodies (read `paths.rubrics/<id>.md` ∀ id) + inline acceptance + YAML-shape instruction; user = workspace files concat w/ `=== <path> ===` headers + `scenario.description`; output → `${agentDirectory}judge-review.yaml`; unparseable → raw + `error: "unparseable"`; recursion-decline note | V1,V10,V13,V18,V22,V29,V30,I.fs                |
| T12 | .      | scenario report aggregator: walk `${scenarioDirectory}*/judge-review.yaml` → `${scenarioDirectory}report.yaml`; missing → `error: "missing judge-review"`                                          | V23,I.fs                                       |
| T13 | .      | run report aggregator: walk `${runDirectory}*/report.yaml` → `${runDirectory}report.yaml`; missing → `error: "missing scenario report"`                                                            | V24,I.fs                                       |
| T14 | .      | console summary printer + exit signal: dyn col widths; cells PASS\|FAIL\|SKIPPED; `RUN RESULT: PASS\|FAIL` + first-failure-per-scenario one-liner                                                  | V25,V26                                        |
| T15 | .      | smoke test against `testing-project/` fixture: full matrix, assert reports + summary shape                                                                                                         | V5,V25                                         |

## §B Bugs

| id  | date | cause | fix |
| --- | ---- | ----- | --- |

---

spec OK? suggest edits or invoke build.
