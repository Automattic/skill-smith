# Skill Testing Harness — Repository Structure

This document proposes the repository structure and contracts for the **skill testing harness**: file layout, scenario schema, rubric/environment interfaces, results layout, and the shape of the runner. The **scope is the tester only** — the self-improvement loop (agent edits a skill until its tests pass, then opens a PR) is a separate follow-up and is not part of this proposal.

## How it works

The harness runs every scenario against every configured model and reports pass/fail. A **scenario** is a prompt plus the skill(s) the agent should use to fulfil it. For each `(scenario, model)` pair the harness:

1. **Resets** the project's target environment to a clean state.
2. **Invokes the agent under test** with the skill files loaded as system context, the project's conventions (paths, slugs) appended, the scenario prompt as the user message, and a file-write tool scoped to the project's target directory. The agent writes code directly into the project.
3. **Judges** the result with an LLM judge that consults reusable rubric documents plus the scenario's inline acceptance criteria.
4. **Runs** a project-defined e2e spec against the live environment to verify actual behavior.
5. **Records** verdicts.

At the end of the run it prints a scenario × model pass/fail matrix and writes the underlying verdicts to disk.

## What's forkable and how

The harness is designed to be forked for any project that ships a skill. Two top-level directories are meant to be swapped; everything else is stable core:

- **`skills/`** — the skill(s) under test. Each skill is a directory with a `SKILL.md` + any reference files it links to. Swap wholesale for another project.
- **`eval/`** — the per-project eval content: the system preamble for the agent (`eval/orchestrator.md`), the environment implementation (`eval/environment.ts`), the test scenarios (`eval/scenarios/*.yaml`), the reusable judge reference material (`eval/rubrics/*.md`), and the specs + template the e2e step needs (`eval/e2e/`).
- **`src/`** — stable harness core. The runner, stage implementations, model adapters, and the `Environment` interface. Forks should not need to edit this; they may.

**Approach for WordPress skills** (the pilot): `skills/` holds the Interactivity API skill and later sibling WP skills (block development, data store, etc.). `eval/orchestrator.md` tells the agent to write generated code into the plugin the harness ships with. `eval/rubrics/` holds reusable references like WordPress coding standards and iAPI best practices. `eval/e2e/` holds a `@wordpress/env` configuration, a minimal plugin template, and Playwright specs that drive a real browser against the plugin the agent just built.

## Repository layout

```
/
├── package.json
├── tsconfig.json
├── skill-smith.config.ts        # harness-level config (models, defaults, paths)
├── .env.example                 # per-provider API keys
├── .gitignore                   # ignores .results/, .env, node_modules/
├── README.md                    # how to run + how to fork
├── skill-harness-pitch.md
│
├── skills/                      # FORK-SWAP: skills under test
│   └── wp-interactivity-api/
│       ├── SKILL.md
│       └── references/
│
├── eval/                        # FORK-SWAP: per-project eval content
│   ├── orchestrator.md          # system preamble for the agent under test (paths, conventions)
│   ├── environment.ts           # project-owned; implements src/environment/contract.ts
│   ├── scenarios/
│   │   └── counter.yaml
│   ├── rubrics/                 # reusable reference material the judge consults
│   │   ├── wp-interactivity-api-best-practices.md
│   │   └── wp-coding-standards.md
│   └── e2e/
│       ├── .wp-env.json
│       ├── plugin-template/     # the plugin the agent writes into
│       │   ├── iapi-eval.php
│       │   └── src/blocks/eval-block/   # AGENT'S WRITE TARGET (documented in orchestrator.md)
│       └── specs/
│           └── counter.spec.js
│
├── src/                         # STABLE HARNESS CORE — reusable across forks
│   ├── cli.ts                   # CLI entry: `skill-smith run [--scenario X] [--model Y]`
│   ├── runner.ts                # outer pipeline orchestration (scenario × model loop)
│   ├── index.ts                 # public API: defineConfig, types, defaults
│   ├── stages/
│   │   ├── agent.ts             # invoke the agent under test with skill+orchestrator+tools
│   │   ├── judge.ts             # run rubrics + acceptance checks
│   │   └── e2e.ts               # delegate to environment.verify()
│   ├── config/
│   │   ├── types.ts             # SkillSmithConfig, ModelDefaults, Paths
│   │   ├── defaults.ts          # DEFAULT_MODEL_DEFAULTS, DEFAULT_PATHS
│   │   ├── define-config.ts     # defineConfig() helper (identity + types)
│   │   ├── scenario.ts          # loads + validates scenario YAML
│   │   └── skill-loader.ts      # concatenates SKILL.md + all referenced files
│   ├── models/
│   │   ├── index.ts             # provider registry / factory
│   │   ├── types.ts             # ModelProvider interface (generate + tool-use loop)
│   │   ├── anthropic.ts
│   │   ├── openai.ts
│   │   └── google.ts
│   ├── environment/
│   │   └── contract.ts          # Environment interface that eval/environment.ts implements
│   └── report.ts                # aggregates verdicts, resolves result paths, writes summary + console table
│
└── .results/                    # git-ignored, created at runtime
    └── <run-id>/
        ├── summary.json         # scenario × model verdict matrix
        └── <model>/
            └── <scenario>/
                ├── judge-result.json    # verdicts: rubrics + acceptance (pass/fail per rule)
                ├── e2e-result.json     # runtime verification verdict (pass/fail + generic details)
                └── trace.json          # per-stage timing + token counts (project-agnostic)
```

Results are **intentionally project-agnostic** — no plugin snapshots, no runtime-specific artifacts. Just verdicts. Projects that want to inspect what the agent produced should do so from the working tree (the agent wrote to paths documented in their `orchestrator.md`); results are for the matrix, not for diffing generated code.

## Scenario format

`eval/scenarios/counter.yaml`:

```yaml
name: counter
description: A counter block with + / - buttons; independent instances via data-wp-context.
skills:
  - wp-interactivity-api
  - wp-block-development
prompt: |
  Build a counter block with +/- buttons using the Interactivity API.
  Multiple instances on the same page must be independent (use data-wp-context).
acceptance:
  - uses the data-wp-text directive to display the count
  - defines initial state on the server via wp_interactivity_state()
  - uses getContext() to read per-instance state
rubrics:
  - wp-interactivity-api-best-practices
  - wp-coding-standards
e2e: counter.spec.js
```

Resolution rules:
- `skills: [X]` → concatenates `skills/X/SKILL.md` and every file referenced from it.
- `rubrics: [Y]` → `eval/rubrics/Y.md`.
- `e2e: Z` → the project's environment decides how to execute `eval/e2e/specs/Z`.
- `acceptance` → a YAML list of per-scenario expectations, evaluated as an inline anonymous rubric.

## Rubric example

`eval/rubrics/wp-coding-standards.md`:

```markdown
# WordPress coding standards

Evaluate the produced PHP and JavaScript against the official WordPress coding
standards published at https://developer.wordpress.org/coding-standards/.

Flag in particular:

- PHP: Yoda conditions, short array syntax, spacing around control structures,
  function and hook naming conventions, proper escaping (`esc_html`, `esc_attr`,
  `wp_kses_post`) at output boundaries, and nonce / capability checks.
- JavaScript: `@wordpress/eslint-plugin` defaults — const/let over var, no
  unused imports, consistent quotes, JSDoc on exported functions.
- Translations: user-facing strings wrapped in `__()` / `_e()` with the correct
  text domain.

Treat violations that would fail a strict `phpcs` or `eslint` run as `error`
severity; treat style-only preferences as `warning`.
```

A rubric is plain prose the judge LLM consults; it can link to authoritative external sources and it can stay opinionated. Rubrics are meant to be **reusable across scenarios** — any scenario that lists `wp-coding-standards` gets this exact evaluation context.

## Harness config

The config is a TypeScript module — `skill-smith.config.ts` — that default-exports the result of `defineConfig()`. TS over YAML because the harness stack is already TS, it lets forks use env vars or helpers to compute values, and it plays nicely with the ecosystem (`defineConfig()` is the same idiom as Vite / Vitest / Playwright).

`skill-smith.config.ts`:

```ts
import { defineConfig } from "skill-smith";

export default defineConfig({
  models: {
    agentUnderTest: [
      "claude-sonnet-4-6",
      "claude-opus-4-7",
      "gpt-5",
    ],
    judge: "claude-opus-4-7",
  },
  // Optional — these are the defaults. Override any subset.
  defaults: {
    temperature: 0,
    maxTokens: 8000,
    retry: { maxAttempts: 3, backoff: "exponential" },
  },
  paths: {
    skills: "./skills",
    scenarios: "./eval/scenarios",
    rubrics: "./eval/rubrics",
    environment: "./eval/environment.ts",
  },
});
```

- `models.agentUnderTest` is a list → the runner iterates and produces the `(model × scenario)` matrix.
- `models.judge` is a single model (deterministic evaluation stage).
- `defaults` apply to every model call (agent and judge). Merged field-by-field with `DEFAULT_MODEL_DEFAULTS`.
- `paths` tell the harness where each fork-swappable piece lives. Merged field-by-field with `DEFAULT_PATHS`, so a fork that keeps the conventional layout can omit the block entirely.
- The harness dynamically imports `paths.environment` at startup and checks the default-export conforms to `Environment`.

## Rubric contract

A rubric file (e.g. `eval/rubrics/wp-interactivity-api-best-practices.md`) is **prose reference material the judge LLM consults** when evaluating a scenario's output. It is not itself a judge — the judge is a model call; the rubric is an input document. Rubrics are reusable across scenarios because they describe standards/best-practices, not scenario-specific behavior.

Inputs to the judge per scenario:
- the rubric content(s) referenced by the scenario + the `acceptance` list
- the files the agent produced
- the scenario description (for context)

**The judge does not read the skill.** The agent learns from the skill; the judge grades from the rubrics. Keeping them epistemically separate is what lets the harness catch a regression in the skill itself — if the judge consulted the same skill the agent did, a bad skill edit would simultaneously redefine "correct" and the regression would slip through. Rubrics must therefore be self-contained or point at stable external sources (official specs, docs); they must not reference the skill under test.

**Open decision:** whether the judge runs as a single consolidated call (all rubrics + acceptance together) or as N+1 separate calls (one per rubric + one for acceptance). To be resolved in the implementation plan.

## Environment: `contract.ts` vs `environment.ts`

These are two files with complementary roles. The split is the whole mechanism that makes the harness forkable.

### `src/environment/contract.ts` (harness-owned, stable)

A TypeScript interface definition. Describes **what** methods an environment must implement and their signatures. Ships in the core and is not expected to change per project.

```ts
export interface Environment {
  /** Boot the environment. Called once per harness run, before any scenarios. */
  setup(): Promise<void>;

  /** Restore the agent's write target to a clean pristine state.
   *  Called before each scenario so the agent never sees another scenario's output. */
  reset(): Promise<void>;

  /** Run the named spec against the current environment.
   *  The agent has already written its files; the spec verifies behavior. */
  verify(spec: string): Promise<{ pass: boolean; details: unknown }>;

  /** Tear down the environment. Called once at the end of the harness run. */
  teardown(): Promise<void>;
}
```

### `eval/environment.ts` (project-owned, swappable)

A TypeScript module that default-exports an object conforming to `Environment`. For iAPI it wraps `@wordpress/env` + Playwright + WP-CLI:

```ts
import type { Environment } from "skill-smith";
import { execa } from "execa";
import fs from "node:fs/promises";

const BLOCK_DIR = "eval/e2e/plugin-template/src/blocks/eval-block";
const SEED_BLOCK_JSON = `{ "name": "iapi-eval/eval-block" }`;  // minimal stub

const environment: Environment = {
  async setup() {
    await execa("npx", ["wp-env", "start"], { stdio: "inherit" });
  },

  async reset() {
    await fs.rm(BLOCK_DIR, { recursive: true, force: true });
    await fs.mkdir(BLOCK_DIR, { recursive: true });
    await fs.writeFile(`${BLOCK_DIR}/block.json`, SEED_BLOCK_JSON);
    // activate / reactivate the plugin via WP-CLI if needed
  },

  async verify(spec) {
    const result = await execa("npx", ["playwright", "test", `specs/${spec}`], {
      reject: false,
      cwd: "eval/e2e",
    });
    return { pass: result.exitCode === 0, details: { stdout: result.stdout, stderr: result.stderr } };
  },

  async teardown() {
    await execa("npx", ["wp-env", "stop"]);
  },
};

export default environment;
```

The harness loads this file at startup via `import()` using `paths.environment` from `skill-smith.config.ts`. A non-WP fork swaps this file for whatever makes sense (pytest + virtualenv, cargo test, a Docker container, nothing at all for pure-prose skills). The harness core never imports wp-specific code.

## Report

`src/report.ts` is responsible for:
- Resolving per-(run, model, scenario) result paths.
- Writing the per-scenario verdicts (`judge-result.json`, `e2e-result.json`, `trace.json`).
- After all pairs finish: aggregating into `.results/<run-id>/summary.json` (the scenario × model verdict matrix).
- Printing a console table at end-of-run:
  ```
  scenario    | claude-sonnet-4-6 | claude-opus-4-7 | gpt-5
  counter     | PASS              | PASS            | FAIL (acceptance)
  ```

## Pipeline flow (what `src/runner.ts` does)

Per harness run:

1. `environment.setup()` (once).
2. For each `(scenario, model)` pair, in sequence:
   1. `environment.reset()` — restore the write target to a clean stub.
   2. **agent stage** — build system prompt = concatenated skill files + `eval/orchestrator.md`. Invoke the model with:
      - that system prompt,
      - `scenario.prompt` as the user message,
      - a file-write tool scoped to the path the project documented in `orchestrator.md`,
      - a tool-use loop that runs until the model stops calling tools or a cap is hit.
   3. **judge stage** — evaluate rubrics + acceptance. Write `judge-result.json`.
   4. **e2e stage** — `environment.verify(scenario.e2e)`. Write `e2e-result.json`.
   5. Write `trace.json` (timings, token counts, tool-use log — all project-agnostic).
3. `environment.teardown()` (once).
4. `report.ts` writes `summary.json` + prints the console table.

Exit code: `0` if every pair passes, `1` otherwise.

## Fork reuse pattern

To reuse the harness for a non-WP project:

1. Fork the repo.
2. Replace `skills/` with the new skill set.
3. Replace `eval/`:
   - write a new `orchestrator.md` describing the project's conventions (write paths, slugs, file layout),
   - author scenarios in `eval/scenarios/`,
   - author reusable rubrics in `eval/rubrics/`,
   - implement `eval/environment.ts` against `Environment`, drop specs + seed layout alongside it.
4. Update `skill-smith.config.ts` with the models you want to exercise (and override any paths that don't match the defaults).
5. `npm install && npx skill-smith run`.

`src/` should not need edits. Forks are free to patch it but the goal is that they don't have to.
