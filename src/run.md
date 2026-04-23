# Run — Skill Smith (prose harness)

You are running the Skill Smith test harness end-to-end by following this document. This is the **prose version of `src/runner.ts`**: iterate on it here until the steps are right, then we'll codify into TypeScript.

The caller has placed you in a **project-under-test** — a directory that contains a `skill-smith.config.ts` and the per-project `skills/` + `eval/` directories. All relative paths in this document are relative to that project root.

**Locating the project-under-test.** If the current working directory contains `skill-smith.config.ts`, you are already there. Otherwise, look for a single immediate child directory that contains `skill-smith.config.ts` (e.g. `testing-project/` inside the `skill-smith` repo) and `cd` into it before starting. If neither resolves, stop and report per section 0 — do not attempt to infer further.

You orchestrate; you do not write generated code yourself. The **agent under test** and the **judge** are sub-agents you spawn. Keep their roles strictly separate.

---

## 0. Preconditions

Before starting, verify the following. If any are missing, report the list and stop — do not try to recover.

- `skill-smith.config.ts` exists at the project root.
- `paths.skills`, `paths.scenarios`, `paths.rubrics` resolve to existing directories (default: `./skills`, `./eval/scenarios`, `./eval/rubrics`).
- `paths.environment` resolves to a file. Try `./eval/environment.ts` first; fall back to `./eval/environment.md` (prose form consumed as described in section 3). If neither exists, stop and report — a project with no environment spec is a configuration bug, not a normal case.

Also check, but do not fail on, empty fork-swap files (common during bootstrap):

- A rubric body may be stubbed (`TO BE FILLED`) — pass the rubric through anyway; the judge handles it.

---

## 1. Load config

Read `skill-smith.config.ts`. You need:

- `models.agentUnderTest: string[]` — the matrix's model axis.
- `models.judge: string` — single model used for every judge call.
- `defaults` — merge field-by-field over `DEFAULT_MODEL_DEFAULTS` (see `src/config/defaults.ts`).
- `paths` — merge field-by-field over `DEFAULT_PATHS`.

**Running the matrix.** Every model in `agentUnderTest` runs as its own sub-agent — you spawn one `Agent` call per `(scenario, model)` pair with the `model` parameter set. Map the config's model id to the `Agent` tool's `model` field:

| Config id                   | `Agent` tool `model` |
| --------------------------- | -------------------- |
| `claude-opus-4-7`           | `opus`               |
| `claude-sonnet-4-6`         | `sonnet`             |
| `claude-haiku-4-5-20251001` | `haiku`              |

Any model id outside this table cannot be dispatched by the prose harness — record the pair as `skipped: "model not dispatchable from prose harness"` and continue. The judge sub-agent (section 4.4) is spawned the same way, using `models.judge`.

**Always run the full matrix.** Every `(scenario, model)` pair in the config must be attempted. Do not subset for "quick iteration" or to save time — if the user wants a smaller run, they will change the config or pass a filter. Sequential execution is fine; just complete every pair.

Record the resolved config (models, defaults, paths) at the top of the run log you will build in section 7.

---

## 2. Enumerate scenarios

For every directory under `paths.scenarios/` that contains a `scenario.yaml`, load the scenario. Schema (minimum):

```yaml
name: <string> # stable id used in paths + reports
description: <string>
skills: [<skill-id>] # ids under paths.skills/
prompt: | # user message to the agent under test
  ...
acceptance: [<string>] # inline rubric items
rubrics: [<rubric-id>] # ids under paths.rubrics/ (filename without .md)
e2e: <filename> # optional; spec file the environment runs
```

Validate: `skills[*]` must resolve to `paths.skills/<id>/SKILL.md`; `rubrics[*]` must resolve to `paths.rubrics/<id>.md`. Missing references → fail this scenario with `error: "unresolved reference"` and continue to the next.

---

## 3. Environment setup (once per run)

Run the `## Setup` lifecycle stage from `paths.environment`. Two file shapes are supported:

- **`environment.ts`** — read the file and identify the shell commands inside the exported `setup()` method (`execa`, `spawn`, etc.); run them via Bash. If the commands are too abstracted to extract safely, stop and ask the user.
- **`environment.md`** — parse the Markdown and execute the relevant section (see below) as specified by that section. A section may contain:
  - an indented code block with shell commands (run them via Bash), or
  - prose steps and embedded file content in fenced code blocks with file paths as headings (run the prose steps directly — e.g. `rm -rf <path>` then write each embedded file verbatim).

`environment.md` defines three kinds of entries, all invoked by name from this runner:

- **Lifecycle stages** (required, every project must define them): `## Setup`, `## Verify`, `## Teardown`.
- **Hooks** (optional customization points the harness calls in a fixed order): `## beforeEachScenario`, `## afterTestingAgent`, `## afterJudgeAgent`, `## afterEachScenario`. A missing or empty hook section is a no-op — do not fail.

**Do not use `git` operations** (no `checkout --`, no `stash`) to restore state. State restoration must be achievable from `environment.md` alone — the document is authoritative for "starting state". If a project's environment spec is missing the content needed to reconstruct starting state, that's a configuration bug — stop and report per section 0.

Command substitution: in the `## Verify` command, replace `<scenario>` with the scenario name at the point of use; in `## afterTestingAgent` (and any other hook that references it), replace `<results-dir>` with `.results/<run-id>/<model>/<scenario>/`.

Record start time and any setup stdout/stderr in the run log. Do not skip this stage — `## Setup` is required.

---

## 4. Per-pair loop

For each `(scenario, model)` pair — `scenario` outer, `model` inner — run stages 4.1 → 4.8 in order. Do **not** parallelize pairs in the prose version; sequential execution keeps the log readable and the environment consistent.

The order mirrors `assets/skill-tester-workflow.png`: `beforeEachScenario` → testing agent → `afterTestingAgent` → judge → `afterJudgeAgent` → verify → `afterEachScenario` → record verdict.

### 4.1 `beforeEachScenario` hook

Run the `## beforeEachScenario` section of `environment.md` (or `beforeEachScenario()` for `environment.ts`) as described in section 3. If the section is missing or empty, skip silently — hooks are optional.

Projects typically leave this empty when `## afterEachScenario` already restores seed state between pairs; use it for per-scenario fixture prep when that pattern doesn't fit.

### 4.2 Agent under test

Spawn a sub-agent via the `Agent` tool with `model` set to the pair's model (mapped per the table in section 1) and `subagent_type: "general-purpose"`. Construct its prompt as follows:

**System context** (concatenate in this order):

1. The full contents of `paths.skills/<skill-id>/SKILL.md` for every id in `scenario.skills`.
2. Every file referenced from those `SKILL.md`s (follow Markdown links under `references/`, `MUST-HAVE KNOWLEDGE`, etc.). Load them verbatim — the skill tells the agent what to read; you honour that.
3. The contents of `eval/instructions.md` if non-empty. This contains project-specific conventions (write paths, slugs, file layout).

**User message**: `scenario.prompt` verbatim.

**Tools the sub-agent gets**: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`. Constrain writes in the sub-agent's prompt: _"Only write files under `<WRITE_TARGET>`"_, where `<WRITE_TARGET>` is the path documented by `eval/instructions.md`. If `instructions.md` is empty, default `<WRITE_TARGET>` to `eval/workspace/<scenario.name>/` and create it.

**Stop condition**: the sub-agent returns control on its own. Do not cap tool calls in the prose version; log a warning if it exceeds 50 tool uses.

Capture from the sub-agent:

- final assistant text (the agent's "answer"),
- the list of files it created or modified under `<WRITE_TARGET>`,
- a brief tool-use log.

### 4.3 `afterTestingAgent` hook

Run the `## afterTestingAgent` section of `environment.md` (or `afterTestingAgent()` for `environment.ts`). Perform `<results-dir>` substitution as described in section 3 — `.results/<run-id>/<model>/<scenario.name>/` — and create that directory first if it does not exist.

This hook typically archives whatever the agent wrote so the judge, verify, and next pair's reset cannot disturb the recorded state. If the section is missing or empty, skip.

### 4.4 Judge

Spawn a second sub-agent via `Agent` with `model` set to `models.judge` (mapped per section 1) and `subagent_type: "general-purpose"`. It must **not** see the skill files.

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
3. A short instruction: _"You are grading an implementation against the rubrics above. Do not consult any skill documentation. Return a JSON object `{ rubrics: { <rubric-id>: { pass, notes } }, acceptance: [{ item, pass, notes }] }`."_

**User message**: the files the agent wrote, concatenated with a header for each path (`=== <relative-path> ===`), plus `scenario.description` for context.

**Tools**: `Read` only (so it can re-open the files if needed). No Write/Bash.

Parse the returned JSON. If parsing fails, record `judge: { error: "unparseable", raw: <text> }` and treat the scenario as failed.

### 4.5 `afterJudgeAgent` hook

Run the `## afterJudgeAgent` section of `environment.md` (or `afterJudgeAgent()` for `environment.ts`). If missing or empty, skip. Projects use this slot for judge-output post-processing or notifications; most leave it empty.

### 4.6 E2E verify

If `scenario.e2e` is set and the file exists and is non-empty, run the verify stage — `environment.verify(scenario.e2e)` for `environment.ts`, or the `## Verify` command from `environment.md` with `<scenario>` substituted for the scenario name. Capture exit code, stdout, stderr. `pass = (exitCode === 0)`.

If the spec is missing or empty, record `e2e: { skipped: "no spec" }` and continue.

### 4.7 `afterEachScenario` hook

Run the `## afterEachScenario` section of `environment.md` (or `afterEachScenario()` for `environment.ts`). This is typically where a project cleans the agent's write target and restores seed state so the next pair starts fresh — but the project decides. If the section is missing or empty, skip.

Always run this hook, even if earlier stages failed. It runs **before** the next pair's `## beforeEachScenario` (section 4.1).

### 4.8 Record verdict

Write three files under `.results/<run-id>/<model>/<scenario.name>/`:

- `judge-result.json` — the parsed judge output.
- `e2e-result.json` — `{ pass, exitCode, stdout, stderr, skipped? }`.
- `trace.json` — `{ startedAt, endedAt, durationMs, model, tokens?, toolUseCount }`. Keep this project-agnostic — no plugin paths, no runtime-specific fields.

`<run-id>` is an ISO timestamp you generate at the start of the run: `YYYYMMDD-HHMMSS`. Any archive of the agent's produced files lives alongside these result files and is written by the `## afterTestingAgent` hook (section 4.3), not here.

Determine the pair's overall verdict:

- `pass` if every rubric and every acceptance item pass **and** e2e passes (or is legitimately skipped with `skipped: "no spec"`).
- `fail` otherwise — include the first failing reason in the summary row.

---

## 5. Teardown (once per run)

Run the `## Teardown` lifecycle stage of `paths.environment` — `teardown()` for `environment.ts`, or the `## Teardown` section of `environment.md`. Always run teardown, even if earlier stages failed.

---

## 6. Summary and matrix

Write `.results/<run-id>/summary.json`:

```json
{
  "runId": "<run-id>",
  "config": { "models": { ... }, "paths": { ... } },
  "matrix": {
    "<scenario.name>": {
      "<model>": { "verdict": "pass" | "fail" | "skipped", "reason"?: "<string>" }
    }
  }
}
```

Print a console-style table to your final assistant message:

```
scenario            | claude-sonnet-4-6 | claude-opus-4-7
counter-block       | PASS              | SKIPPED (other model)
```

Column widths: the longest scenario name; each model column the width of its header.

Exit signalling (in prose): if every cell is `pass`, end your final message with `RUN RESULT: PASS`. Otherwise `RUN RESULT: FAIL` plus a one-line summary of the first failure per scenario.

---

## 7. Run log

Keep an in-memory run log as you go and dump it to `.results/<run-id>/run.log` at the end. It should include, in order:

- Resolved config and paths.
- `## Setup` commands and their stdout/stderr.
- For each pair, in order: `beforeEachScenario`, agent (tool-use count, files written), `afterTestingAgent`, judge (verdict), `afterJudgeAgent`, verify (pass/fail), `afterEachScenario`, recorded files. Note when a hook was skipped because its section was missing or empty.
- `## Teardown` commands and their output.

This is the document you will read when iterating on this harness — it is the prose equivalent of the codified runner's debug output.

---

## Guardrails

- **Judge never sees the skill.** If you accidentally include skill text in the judge's prompt, the run is invalid — restart that pair.
- **Agent never sees the rubric.** Same principle in reverse. The agent sees skills + instructions + prompt, nothing from `eval/rubrics/` or `scenario.acceptance`.
- **You never write generated code.** The agent-under-test sub-agent is the only writer in `<WRITE_TARGET>`. You only write to `.results/`.
- **Do not re-enter this document recursively.** If a sub-agent asks to "run skill-smith" it is confused — decline.
- **Run autonomously.** Do not pause to ask the user about scope, environment, or project location. The config is authoritative for the matrix; `paths.environment` is authoritative for lifecycle commands; section 0 covers cwd resolution. If a precondition fails, fail fast per section 0 rather than negotiating.

---

## What this document does not cover yet

These are deliberate gaps, to be resolved in later iterations before codification:

- Judge-call shape: single consolidated call vs one-per-rubric.
- Retry policy on model errors (`defaults.retry` is read but unused in the prose form).
- Token accounting per stage — prose captures `toolUseCount` only.
- Parallel execution of pairs.
- Running multiple providers in one invocation (requires real SDKs).
- Surfacing a diff of what the agent wrote in the summary.

When you hit one of these during a run, record it in the run log under `gaps-encountered` and continue.
