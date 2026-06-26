# Design Doc: Reusable rubrics and a leaner, human-language live-judge setup

## Overview

Skillsmith is a scenario-based evaluation harness for coding agents. In the merged base model, each scenario is two prose files in its folder — `TESTING-AGENT.md` (drives the testing agent) and `JUDGE.md` (drives the judge) — both passed through verbatim as agent prompts; the only structure Skillsmith parses is a `# Skills` section in `TESTING-AGENT.md`. The judge is a *live* behavioral verifier: before it runs, the harness copies the testing agent's `workspace/` to a sibling `judge-workspace/`, the judge runs against that copy with project-configured capabilities (Bash + a Playwright MCP server for `testing-project`), and it returns a single `{ pass, notes }` verdict. The consuming `testing-project` owns its WordPress environment via the per-pair `beforeJudgeAgent` / `afterJudgeAgent` hooks. This design refines the *judge side* of that base; it does not redesign the base.

This review (review-1) makes three refinements plus the one core capability that supports the first of them:

1. **Reusable rubrics referenced by id** (the only Skillsmith-core change). A `JUDGE.md` may name shared grading criteria by id instead of pasting them, so the same rubric is authored once and reused across scenarios — and different scenarios can select different rubrics.
2. **The WordPress environment is stood up once per run** in `testing-project`, kept warm, instead of booted and torn down per (scenario, agent) pair.
3. **Human-language, judge-driven setup** in `testing-project`. Each `JUDGE.md` reads like a plain-language e2e test (activate the plugin, insert the produced block(s), open the page, check behavior), the env helper is simplified, and the fixed block name is no longer enforced.

The work splits into two tracks that meet only at the judge's system prompt: **Track A** (Skillsmith core — rubrics-by-id) and **Track B** (`testing-project` — env-once, human-language judge, free block names, plus the conversion that exercises Track A end to end). It **refines, not reverts** the base: the judge brief stays freeform, the verdict stays `{ pass, notes }`, the project still owns its env, judges stay serial, and there is no backward-compatibility burden (pre-1.0). Per the unchanged testing posture, full behavioral verification is manual; the deterministic gates (typecheck, lint, unit tests, `check:config`, changeset) stay green, and the pipeline does not run the self-improvement loop or depend on a full-suite green run.

## Approach

The implementer works from two independent tracks that compose only inside `buildJudgeSystemPrompt`.

### Track A — Skillsmith core: rubrics-by-id

A `JUDGE.md` gains an optional `# Rubrics` section, parsed **exactly like** `TESTING-AGENT.md`'s `# Skills` section. The pipeline already has every seam this needs; the change is additive and mirrors the skills path at each step:

1. **Parse** (`enumerate.ts`, at enumeration). Today `parseSkillsSection` finds the `# Skills` heading in the testing brief and extracts list-item ids. Generalize its inner machinery to be heading-parameterized so a sibling `parseRubricsSection` parses `# Rubrics` from the *judge* brief with identical grammar (any heading depth, deeper sub-headings nest, backtick/link unwrap, empty-section valid, first heading wins). An absent `# Rubrics` section yields no rubrics — referencing rubrics is optional.

2. **Validate** (`scenarioFromBriefs`, at enumeration). After parsing rubric ids, validate each against the configured rubrics root with `existsSync(<rubricsRoot>/<id>.md)`, and append any unresolved ids to the **same** `problems[]` array that unknown skills use, as `unresolved reference: rubric "<id>"`. No throw. The existing keep-but-skip-and-fail-aggregate flow handles it unchanged: an errored scenario survives selection, runs no agents, aggregates `pass: false`, and shows as skipped — identical observability to an unknown skill. Parsed ids are stored on a new explicit `Scenario.rubrics?: string[]` field, paralleling `skills`.

3. **Load + inject** (`judge-agent.ts`, at judge dispatch). The rubric *content* loads lazily at dispatch, mirroring how the testing agent loads skill content (it is **not** read eagerly into `Scenario` at enumeration). A new `loadRubric(id, rubricsRoot)` mirrors `loadSkill`: read the rubric file plus any md-linked companion files inside the rubrics root, concatenated with `=== <rel> ===` headers. `runJudgeAgent` (which already receives `config`, `projectRoot`, and `scenario`) resolves the rubrics root, builds the rubric blob, and hands it to `buildJudgeSystemPrompt`, which pushes it into its existing `sections` array under a clear heading. The filesystem read stays in `runJudgeAgent` so `buildJudgeSystemPrompt` remains a pure string builder — consistent with how `runTestingAgent` assembles its skill blob before building its prompt.

4. **Verdict unchanged.** Rubrics are reusable *content*, not a structured scoring grid. The judge still emits exactly `{ pass, notes }`; there is no per-rubric machine-readable result.

The only new public config surface is an **optional** `paths.rubrics`, required to exist only when a project uses it. The base run deliberately removed `paths.rubrics` and `Scenario.rubrics` and left guard tests pinning their absence; this review re-introduces them as optional, so those guards must be updated to the new "optional, restored" contract (see Key Decisions and Failure Modes).

### Track B — testing-project: env-once, human-language judge, free block names, conversion

**Env booted once.** `testing-project` boots wp-env a single time in the run-level `beforeAllScenarios` hook and stops it in `afterAllScenarios`, keeping it warm across all pairs. The install-into-a-warm-env primitive is a **live Docker bind-mount**: `.wp-env.json` maps the whole `wp-content/plugins` directory to a host staging dir (`mappings`, which mounts *without* auto-activating, unlike `plugins`). Because a bind mount is live, a plugin copied into the host staging dir after boot is immediately visible inside the container with no restart. Per pair, under the existing serial judge lock, the harness builds the plugin from the judge copy, copies the built plugin into `<staging>/<slug>/`, runs `wp plugin deactivate --all` (clean slate), then `wp plugin activate <slug>`. The deterministic slug (`plugin-<scenario>-<agent>`) stays the activation key. No env start/stop happens per pair; the env stays warm. The serial lock already brackets the whole `beforeJudgeAgent` → judge → `afterJudgeAgent` span, so the shared env's active-plugin state is never raced.

**Human-language, judge-driven setup.** The judge performs the live e2e itself from a slim, plain-language `JUDGE.md`: it discovers the produced block name(s) from `block.json`, creates a published post embedding the block(s), opens the page, and checks behavior. The harness keeps only the deterministic infrastructure (boot, build, copy-install, clean-slate guarantee, and a reliable WP-CLI bridge) and stops pre-creating the post or handing over a URL. The judge reaches the warm env through a **`--config`-based WP-CLI bridge** wrapped in a tiny `judge-wp.mjs` script, with the exact command templates supplied by a judge role-prompt "environment manual."

**Free block names.** The scaffold keeps a buildable, name-neutral starter block; the testing agent may name/structure block(s) freely. The judge discovers actual names from the built `block.json` and inserts each. The plugin slug stays deterministic.

**Conversion.** The shared best-practices rubric (currently inlined identically in all 11 `JUDGE.md` files) moves to `eval/rubrics/wp-interactivity-api-best-practices.md`, every `JUDGE.md` references it by id via `# Rubrics`, the inlined text is deleted, and each brief is slimmed to its human-language setup + rubric id. This exercises Track A end to end.

### What does NOT change

The two-file scenario model, the live-judge model, the `{ pass, notes }` verdict, the copied-workspace no-modify guarantee, project-owned env, the serial-judge constraint and its run-wide mutex, the per-provider capability descriptor, and the manual testing posture (no full-suite-green gate). This review is an increment on the merged base.

## Components

### Skillsmith core

**Modified**

- **`src/scenarios/enumerate.ts`** — Generalize the `# Skills` parser so its body is shared with a `# Rubrics` parser. Today `parseSkillsSection` already splits the heading match (`HEADING_RE`) from the heading-text predicate (`SKILLS_HEADING_RE`); factor the section-collection loop into a helper parameterized by the heading-text predicate, then expose `parseRubricsSection(judgeBrief)` (predicate `/^Rubrics$/i`) alongside `parseSkillsSection`. In `scenarioFromBriefs`, parse `# Rubrics` from the judge brief, validate each id against `<rubricsRoot>/<id>.md`, append unresolved ids to the same `problems[]`, and store the parsed ids on `Scenario.rubrics`. `scenarioFromBriefs` and `stubScenario` must populate the new `rubrics` field (e.g. `[]` for the stub). `scenarioFromBriefs` needs the resolved rubrics root, so `enumerateScenarios` resolves it from `paths.rubrics` (when set) the same way it resolves `skillsRoot`, and threads it in — or omits validation when `paths.rubrics` is unset (see Key Decision: optional path).
- **`src/scenarios/rubric-loader.ts`** *(new)* — `loadRubric(id: string, rubricsRoot: string): string`, mirroring `skill-loader.ts`'s `loadSkill`: read `<rubricsRoot>/<id>.md`, follow md-links that resolve inside the rubrics root, concatenate with `=== <rel> ===` headers, ignore cycles and external/absolute links. The one structural difference from `loadSkill` is the entry file: a flat `<id>.md` rather than `<id>/SKILL.md` (rubrics are single-file content; see Key Decision: rubric file layout).
- **`src/pipeline/judge-agent.ts`** — In `runJudgeAgent`, when `config.paths.rubrics` is set and `scenario.rubrics` is non-empty, resolve `rubricsRoot = resolve(projectRoot, config.paths.rubrics)`, build the blob `scenario.rubrics.map((id) => loadRubric(id, rubricsRoot)).join('\n\n')`, and pass it to `buildJudgeSystemPrompt`. `buildJudgeSystemPrompt` gains a parameter for the rubric blob and pushes it into its `sections` array under a clear heading (e.g. `# Grading rubrics`) when non-empty; the builder stays filesystem-free. Verdict shape, output instruction, and `# Role instructions` handling are untouched.
- **`src/config/types.ts`** — Add optional `rubrics?: string` to the `Paths` interface; add `rubrics?: string[]` to `Scenario`. (`Scenario` already has an open index signature, but an explicit field is clearer and parallels `skills`.)
- **`src/config/normalize.ts` / `src/config/defaults.ts`** — Decide whether `paths.rubrics` gets a conventional default. The chosen approach (see Key Decision) is to leave `DEFAULT_PATHS` without `rubrics` and let the optional field stay `undefined` unless a project declares it; `normalizeConfig` already spreads `{ ...DEFAULT_PATHS, ...input.paths }`, so a declared `paths.rubrics` flows through with no change to the merge.
- **`src/pipeline/pipeline.ts` (`checkPaths`)** — `checkPaths` today existence-checks only `['skills', 'scenarios']`. The chosen contract leaves `checkPaths` validating those two only and does **not** add `rubrics` to the loop: a referenced-but-missing rubrics dir or file already surfaces as a per-scenario unknown-rubric error at enumeration, mirroring how unknown skills are validated per-id (not by existence-checking the skills dir in `checkPaths`). This keeps `checkPaths` simple and the failure model uniform with skills.

**Untouched-but-relevant (core)**

- Selection (`select-scenarios.ts`), the `runScenario` skip path, and `aggregateScenarioReport` (`scenario-report.ts`) already handle the per-scenario `error` correctly — unknown-rubric errors ride that path for free.
- `buildUserMessage`, `parseJudgeJson`, `classifyVerdict`, the reporting/improver wiring — unchanged. Rubric content reaches the judge through the *system prompt*, not the user message or the verdict.

### testing-project

**Modified**

- **`eval/utils/wp-env-judge.ts`** — Heavily simplified. **Sheds:** the per-pair `.wp-env.json` write, per-pair `env:start`/`env:stop`, post creation, the `judgeUrl` / `judgeEnvVars` / `testPostContent` / `wpEnvConfig` helpers, `TESTING_BLOCK_NAME`, and the `SKILLSMITH_JUDGE_URL` / `SKILLSMITH_POST_ID` env-var exports. **Gains:** a run-level `bootJudgeEnv` (create the empty staging dir, write the warm-env `.wp-env.json`, `wp-env start` once, set a module-level `booted` flag) and `stopJudgeEnv` (stop wp-env, remove the staging dir + `.wp-env.json`, wrapped in try/catch); a per-pair `installPluginForPair` (build, copy into staging, `deactivate --all`, `activate <slug>`) and `cleanUpPair` (`deactivate --all`, remove the pair's staging subdir). **Keeps:** the `wp-scripts build` step, the `wpCli` transport (now `--config`-pinned), `judgePluginSlug` re-export, and the fixed port.
- **`skillsmith.config.ts`** — Move the env lifecycle from the per-pair `beforeJudgeAgent`/`afterJudgeAgent` boot/stop to a run-level `beforeAllScenarios` boot + `afterAllScenarios` stop, with per-pair install in `beforeJudgeAgent` and clean-up in `afterJudgeAgent`. Add `paths.rubrics: './eval/rubrics'`. Add the judge "environment manual" to `roles.judge.prompt`. Export `SKILLSMITH_PROJECT_ROOT`, the wp-env port, and `SKILLSMITH_PLUGIN_SLUG` to the judge; drop `SKILLSMITH_JUDGE_URL` / `SKILLSMITH_POST_ID`. Judge concurrency stays `serial`.
- **`eval/utils/scaffold-plugin.ts`** — Stop pinning the block name. Drop the fixed `BLOCK_NAME` from the scaffolded `block.json` (give it a non-binding placeholder name the agent may rename, or leave the name for the agent to set). Keep the name-agnostic `index.php` (already globs `build/blocks/*` then `src/blocks/*`) and the deterministic slug-named `package.json` unchanged.
- **`eval/prompts/testing-agent.md`** — Drop the block-name constraint (currently lines 3–5 forbid renaming the block / changing registration). Reword to: implement inside the scaffold, keep the plugin as-is, but name/structure the block(s) as the task needs. Keep the `get_block_wrapper_attributes()` guidance (name-independent, still good practice).
- **All 11 `eval/scenarios/*/JUDGE.md`** — Slim to a short grading intro + human-language setup/live checks + scenario-specific asserts + a `# Rubrics` section listing `- wp-interactivity-api-best-practices`. Delete the inlined `## Best-practices rubric` block. Replace the `## Environment` env-var catalog (which named the now-removed pre-made-post vars) with the new bridge facts, or move all runtime mechanics into the role-prompt manual and keep the brief purely behavioral.

**New**

- **`eval/rubrics/wp-interactivity-api-best-practices.md`** — The restored shared rubric (the same content currently inlined in every `JUDGE.md`). Rubric id = `wp-interactivity-api-best-practices`, matching the filename.
- **`eval/utils/judge-wp.mjs`** — A tiny WP-CLI wrapper the judge calls: resolves `PROJECT_ROOT` from its own `import.meta.url` (like `wp-cli.mjs`) and shells `npx wp-env --config "<PROJECT_ROOT>/.wp-env.json" run cli wp "$@"`, so the judge's memorized command is a single robust form regardless of the judge's cwd.

**Reused**

- **`eval/utils/wp-cli.mjs`** — `deactivateAllPlugins()` (currently defined but unused) becomes the per-pair clean-slate primitive. Its `wpCli` runs from `PROJECT_ROOT`; when invoked by the run-level/per-pair hooks (which already run in the config module from the project root) this works as-is, but to be cwd-robust it should also pin `--config` (the warm env's `.wp-env.json`).

**Build/config**

- **Root `.gitignore`** — Add the new host staging dir (e.g. `testing-project/.wp-env-plugins/`) alongside the existing `testing-project/.wp-env.json` entry (line 26). The staging dir is hook-owned, created at boot, and removed at teardown.

### Changeset

- **`.changeset/flexible-scenarios-judge-verification.md`** *(extend the existing base entry; do not add a second)* — Amend the sentence documenting that `Paths` drops `paths.rubrics` to read that it drops then **restores** `paths.rubrics` as optional, and add a note for reusable rubrics-by-id (a `JUDGE.md` may reference rubrics by id under a `# Rubrics` section, resolved from the optional `paths.rubrics` location). Keep the bump `minor` with the `BREAKING:` prefix. Only `src/**` changes bump the package (per `.changeset/config.json` `changedFilePatterns`), so the core rubric support is the only release-relevant change; the `testing-project` env-once / human-language / free-block-name changes do not bump.

## Interfaces and Data Flow

### Core type additions

```ts
// src/config/types.ts
interface Paths {
  base: string;
  skills: string;
  scenarios: string;
  rubrics?: string;        // NEW — optional; required to exist only when used
}

interface Scenario {
  name: string;
  skills: string[];
  rubrics?: string[];      // NEW — rubric ids parsed from JUDGE.md's `# Rubrics`
  testingBrief: string;
  judgeBrief: string;
  [ key: string ]: unknown;
}
```

### `# Rubrics` section format (in `JUDGE.md`)

Same grammar as `# Skills`: a heading whose text is exactly `Rubrics` (case-insensitive, any depth) opens the section; lines are collected until the next heading of the same-or-shallower depth (deeper sub-headings nest inside); only Markdown list items contribute ids; each id is unwrapped from surrounding backticks and from a `[id](...)` link, then trimmed; prose and blank lines are ignored; an empty section is valid; the first matching heading wins. Absent section ⇒ no rubrics (optional).

```markdown
# Rubrics

- wp-interactivity-api-best-practices
```

### Rubric file format

`<paths.rubrics>/<id>.md`, plain Markdown. Md-links that resolve inside the rubrics root are followed and inlined (mirroring `loadSkill`). Example: id `wp-interactivity-api-best-practices` → `eval/rubrics/wp-interactivity-api-best-practices.md`.

### Core function signatures

```ts
// src/scenarios/enumerate.ts  (additive; existing parseSkillsSection unchanged in behavior)
export function parseRubricsSection( judgeBrief: string ): string[] | undefined;

// src/scenarios/rubric-loader.ts  (new; mirrors loadSkill)
export function loadRubric( id: string, rubricsRoot: string ): string;

// src/pipeline/judge-agent.ts  (buildJudgeSystemPrompt gains the resolved rubric blob)
export function buildJudgeSystemPrompt(
  scenario: Scenario,
  config: SkillsmithConfig,
  rubricBlob?: string          // resolved in runJudgeAgent; injected under a clear heading
): string;
```

Verdict shape is **unchanged**: `{ pass: boolean, notes: string }`.

### Core data flow (rubrics)

```
JUDGE.md `# Rubrics`
  → parseRubricsSection (enumeration)
  → validate each id vs. <rubricsRoot>/<id>.md (enumeration)
       ├─ unknown id → appended to EnumeratedScenario.error
       │               → scenario kept, runs no agents, aggregates pass:false
       └─ all resolve → Scenario.rubrics = [ ...ids ]
  → (judge dispatch) loadRubric per id → rubric blob
  → buildJudgeSystemPrompt sections → judge system prompt
  → judge grades → { pass, notes }
```

### testing-project bridge interface (project-level, not core)

- **Env vars exported by the hooks to the judge:** `SKILLSMITH_PROJECT_ROOT`, `SKILLSMITH_PLUGIN_SLUG`, and the wp-env port (e.g. `SKILLSMITH_WP_PORT`). **Dropped:** `SKILLSMITH_JUDGE_URL`, `SKILLSMITH_POST_ID` (the judge derives these itself). Env vars set via `process.env` in a hook propagate to the claude-code judge subprocess (the provider passes all of `process.env` minus the API-key vars), which is the same mechanism the base bridge relied on.
- **`eval/utils/judge-wp.mjs`:** `node "$SKILLSMITH_PROJECT_ROOT/eval/utils/judge-wp.mjs" <wp args>` → `npx wp-env --config "<PROJECT_ROOT>/.wp-env.json" run cli wp <args>`. The `--config` flag is what makes this cwd-independent: wp-env keys a running instance on `md5(configFilePath)`, not cwd, so passing the same absolute `.wp-env.json` the boot hook used reaches the warm instance from the judge's `judge-workspace` cwd.
- **`.wp-env.json`** (hook-owned, gitignored): `{ "plugins": [], "mappings": { "wp-content/plugins": "<PROJECT_ROOT>/.wp-env-plugins" }, "port": 8987 }`. Mapping the whole plugins dir (not one fixed slot) keeps activation keyed on the real deterministic slug and lets each pair own a `<slug>` subdir. Because `mappings` replaces the container's default plugins dir, the staging dir MUST exist (empty) before boot.
- **Judge "environment manual"** (`roles.judge.prompt`): the reusable runtime mechanics the judge memorizes — the `judge-wp.mjs` command form; the post-create template `wp post create --post_type=post --post_status=publish --post_title='...' --post_content='<!-- wp:NS/NAME /-->' --porcelain` (stdout is the numeric id); the URL shape `http://localhost:<port>/?p=<id>` (permalink-independent); and "discover block names by reading `$SKILLSMITH_PLUGIN_SLUG/build/blocks/*/block.json` and inserting one block comment per discovered `name`." This keeps WP/runtime vocabulary out of core and out of the per-scenario briefs.

### testing-project data flow (per pair, under the serial lock)

```
testing agent writes plugin into agentWorkspace
  → harness copies workspace → judge-workspace (base behavior)
  → beforeJudgeAgent: wp-scripts build (in judge copy)
                      copy <slug>/ into <PROJECT_ROOT>/.wp-env-plugins/<slug>/  (live bind-mount)
                      wp plugin deactivate --all
                      wp plugin activate <slug>
                      export SKILLSMITH_PROJECT_ROOT, port, SKILLSMITH_PLUGIN_SLUG
  → judge (cwd = judge copy):
        read <slug>/build/blocks/*/block.json → block name(s)
        wp post create ... --porcelain → post id
        open http://localhost:<port>/?p=<id>
        run live checks → { pass, notes }
  → afterJudgeAgent: wp plugin deactivate --all; remove .wp-env-plugins/<slug>/
```

The build runs against the judge copy, so `<slug>/build/blocks/*/block.json` exists in the judge's own cwd; wp-scripts copies every `block.json` into `build/` with `name` intact, so the discovery glob is reliable. The block delimiter is the self-closing `<!-- wp:ns/name /-->` form (correct for these dynamic / server-rendered blocks).

### Lifecycle hooks used (all pre-existing in core; no run-lifecycle change)

`beforeAllScenarios` (run-level boot) → per pair: `beforeTestAgent` → testing agent → `afterTestAgent` → `beforeJudgeAgent` (per-pair install) → judge → `afterJudgeAgent` (per-pair clean-up) → … → `afterAllScenarios` (run-level stop). For `mode: 'test-only'` (testing-project), the iteration loop runs exactly once, so `beforeAllScenarios`/`afterAllScenarios` fire exactly once. `afterAllScenarios` may return a verdict; teardown returns nothing, which the harness treats as a pass. All hooks are closures in the single config module run in one process, so a module-level `booted` flag is shared across them, and the serial judge lock serializes the per-pair hook bodies.

## Key Decisions

### Decision: Parse `# Rubrics` from `JUDGE.md` by generalizing the `# Skills` parser

- **Choice:** Add an optional `# Rubrics` section to `JUDGE.md`, parsed by a `parseRubricsSection` that shares the existing `# Skills` section-collection machinery (parameterized by the heading-text predicate). Reuse the existing id-normalization (backtick/link unwrap). Absent section ⇒ no rubrics.
- **Alternatives:** A bespoke rubric grammar; a generic include mechanism for arbitrary shared snippets.
- **Trade-offs:** Mirroring `# Skills` reuses a proven, tested parser and gives authors one consistent mental model; a bespoke grammar or generic include is net-new surface the spec explicitly scopes out (rubrics-by-id specifically, out of scope: a generic include mechanism). The judge brief is parsed for nothing today, so adding one section parse over it is purely additive.
- **Traces to:** Requirement 1, 2; Acceptance criteria 1, 2.

### Decision: Validate rubric ids at enumeration through the existing per-scenario `error` channel

- **Choice:** In `scenarioFromBriefs`, validate each parsed rubric id with `existsSync(<rubricsRoot>/<id>.md)` and append unresolved ids to the same `problems[]` array as unknown skills, formatted `unresolved reference: rubric "<id>"`. No throw. Store parsed ids on `Scenario.rubrics`.
- **Alternatives:** Throw on an unknown rubric id; defer all validation to load time at judge dispatch.
- **Trade-offs:** Riding the existing error channel means an unknown rubric behaves *exactly* like an unknown skill — the scenario is kept, runs no agents, aggregates `pass: false`, surfaces as skipped, and one bad scenario doesn't mask the rest. Throwing would abort the run and diverge from the established model; deferring to dispatch would let a typo'd id reach the judge phase before failing. Validating id-existence at enumeration while loading bytes lazily at dispatch keeps the validate/load split identical to skills.
- **Traces to:** Requirement 3; Acceptance criterion 3.

### Decision: Load rubric content lazily at judge dispatch via a `loadRubric` mirroring `loadSkill`

- **Choice:** A new `loadRubric(id, rubricsRoot)` reads the rubric file (and md-linked companions inside the rubrics root) at judge dispatch, not eagerly at enumeration. Enumeration validates id existence; dispatch reads the bytes.
- **Alternatives:** Read rubric content eagerly into `Scenario` at enumeration.
- **Trade-offs:** Lazy load mirrors the skill precedent, keeps enumeration cheap, and keeps the `Scenario` record holding ids (not blobs). Eager load would centralize FS work but bloat `Scenario` and diverge from the skills path the rest of this change deliberately mirrors.
- **Traces to:** Requirement 1; Acceptance criterion 1.

### Decision: Inject the resolved rubric blob into the judge system prompt; keep the builder pure

- **Choice:** `runJudgeAgent` resolves the rubrics root, builds the rubric blob from `scenario.rubrics`, and passes it to `buildJudgeSystemPrompt`, which pushes it into its `sections` array under a clear heading (e.g. `# Grading rubrics`). The FS read stays in `runJudgeAgent`; the builder stays a pure string function. Leave the `# Rubrics` id list in the judge brief (do not strip it), mirroring how the `# Skills` list stays in the testing brief.
- **Alternatives:** Do the FS read inside `buildJudgeSystemPrompt` (passing it `projectRoot`); strip `# Rubrics` from the brief before injection.
- **Trade-offs:** Keeping the builder filesystem-free matches how `runTestingAgent` assembles its skill blob and keeps the builder unit-testable without a filesystem. Leaving the literal id list in the brief is harmless, matches the skills precedent, and avoids net-new stripping code with no benefit. The injected resolved content (not the id list) is what the judge grades against.
- **Traces to:** Requirement 1, 4; Acceptance criteria 1, 4.

### Decision: Verdict stays `{ pass, notes }` — rubrics are content, not a scoring grid

- **Choice:** Rubrics supply grading *material* to the judge's system prompt. The recorded verdict remains a single `{ pass, notes }` with no per-rubric structured result.
- **Alternatives:** A per-rubric pass/fail breakdown in the verdict.
- **Trade-offs:** Per-rubric structured scoring is explicitly out of scope and would change the verdict shape the whole report/improver pipeline expects. Keeping `{ pass, notes }` means no change to `parseJudgeJson`, `classifyVerdict`, reporting, or the improver wiring.
- **Traces to:** Requirement 4; Acceptance criterion 4.

### Decision: `paths.rubrics` is optional, with no `DEFAULT_PATHS` entry and no `checkPaths` existence gate

- **Choice:** Add `rubrics?: string` to `Paths` (optional). Do **not** add it to `DEFAULT_PATHS`. Do **not** add `rubrics` to the `checkPaths` existence loop. A project that uses rubrics declares `paths.rubrics`; an unknown/missing rubric file is surfaced per-scenario at enumeration (the same per-id model skills use), so a referenced-but-missing rubrics dir or file fails its scenario clearly without a separate path gate. The base run removed `paths.rubrics` and left two kinds of guard tests pinning the removal; both must be updated to the restored-optional contract.
- **Alternatives:** (a) Add `rubrics` to `DEFAULT_PATHS` (always-set) and to the `checkPaths` loop. (b) Add a conditional `checkPaths` check that requires the rubrics dir only when a selected scenario references a rubric.
- **Trade-offs:** "Required only when used" maps literally to an optional field with no mandatory existence check; the per-scenario unknown-id error already gives a clear failure when a referenced rubric is missing, so a `checkPaths` gate is redundant and would couple `checkPaths` to enumeration results (alt. b) or force every project to own a rubrics dir (alt. a). Cost: the guard tests that currently assert `rubrics` is absent from `Paths`/`DEFAULT_PATHS` and that `checkPaths` ignores it must be rewritten — these are `core-types.test.ts` (`@ts-expect-error` on `paths.rubrics` and a `deepEqual` of `Paths` keys; an analogous `@ts-expect-error` on `scenario.rubrics`) and `check-paths.test.ts` (asserts `checkPaths` passes when `rubrics/` is absent — which stays true under this choice, but the "no rubrics key" intent must be re-stated as "optional"). The `testing-project-e2e-removal.test.ts` guard that asserts `eval/rubrics` does **not** exist also flips, since the conversion restores that directory.
- **Traces to:** Requirement 5; Acceptance criteria 2, 8.

### Decision: Rubric file layout is flat `<id>.md` (not `<id>/RUBRIC.md`)

- **Choice:** A rubric resolves to `<rubricsRoot>/<id>.md`. Validation is `existsSync(<rubricsRoot>/<id>.md)`; `loadRubric` reads that file and follows md-links inside the rubrics root.
- **Alternatives:** A per-rubric directory `<id>/RUBRIC.md`, mirroring skills' `<id>/SKILL.md`.
- **Trade-offs:** Flat single-file matches the historical pre-merge `eval/rubrics/wp-interactivity-api-best-practices.md` exactly and is simpler — rubrics are single-file content. A directory form would mirror skills' shape but is overkill; the md-link-following in `loadRubric` preserves multi-file capability for a rubric that ever needs companions.
- **Traces to:** Requirement 1, 11; Acceptance criteria 1, 8.

### Decision: Boot wp-env once via a live bind-mount + per-slug staging dir

- **Choice:** `beforeAllScenarios` creates an empty host staging dir, writes `.wp-env.json` mapping the whole `wp-content/plugins` to that dir (`mappings`, no auto-activate) on the fixed port, and runs `wp-env start` once, setting a module-level `booted` flag. Per pair (`beforeJudgeAgent`, under the serial lock): build, copy the built plugin into `<staging>/<slug>/`, `deactivate --all`, `activate <slug>`. `afterJudgeAgent`: `deactivate --all` + remove the pair's staging subdir (no env stop). `afterAllScenarios`: `wp-env stop` + remove the staging dir and `.wp-env.json`, wrapped in try/catch, returning nothing.
- **Alternatives:** (a) Map one fixed sub-path reused per pair. (b) Per-pair `.wp-env.json` rewrite + `wp-env start` (the base model). (c) Boot once in `beforeAll` instead of `beforeAllScenarios`.
- **Trade-offs:** Mapping the whole plugins dir keeps activation keyed on the real deterministic slug and lets each pair own a subdir; a single fixed slot loses per-slug determinism. The live bind-mount avoids a per-pair restart entirely — the rewrite-and-restart fallback (alt. b) *is* the per-pair boot this review eliminates. `beforeAllScenarios` fires exactly once under `test-only` (alt. c, `beforeAll`, is the genuinely run-once hook and would only matter under self-improvement — recorded as a risk). The serial lock already guarantees no two pairs race the shared env's active-plugin state.
- **Traces to:** Requirements 6, 7, 8; Acceptance criterion 5.

### Decision: Judge owns the behavioral e2e; harness owns deterministic infra; bridge via `--config` + wrapper

- **Choice:** The judge discovers block name(s), creates the post, opens it, and checks — from a slim human-language `JUDGE.md` plus a shared role-prompt "environment manual" carrying exact command templates. It reaches the warm env through `judge-wp.mjs`, which shells `npx wp-env --config "<PROJECT_ROOT>/.wp-env.json" run cli wp ...` (cwd-independent). The harness keeps boot, build, copy-install, clean-slate, and exports `SKILLSMITH_PROJECT_ROOT` / port / `SKILLSMITH_PLUGIN_SLUG`; it stops pre-creating the post and exporting `SKILLSMITH_JUDGE_URL` / `SKILLSMITH_POST_ID`.
- **Alternatives:** (i) Raw `wp-env --config <abs> run cli` templates in the brief (no wrapper). (ii) `cd $PROJECT_ROOT && wp-env run cli` (cwd-based). (iii) Keep the harness pre-creating the post and handing a URL (the base model).
- **Trade-offs:** A judge running with cwd = `judge-workspace` cannot resolve the project's `node_modules/.bin/wp-env` or `.wp-env.json` from a bare `wp-env run cli`; `--config` with an absolute path fixes this from any cwd. The wrapper removes the most likely LLM failure mode (omitting `--config`) and gives the judge a single memorized command; raw templates (i) and the cd form (ii) both work but are more fragile to quoting/omission. Putting the mechanics in a shared role-prompt manual (not per-scenario briefs) keeps the 11 briefs human-language and scenario-specific and keeps WP vocabulary out of core. The trade is determinism for simplicity — block-insertion and page-open move from the harness to the LLM judge (Risk: judge reliability).
- **Traces to:** Requirement 9; Acceptance criterion 6.

### Decision: Stop enforcing the block name; the judge discovers names from built `block.json`; the slug stays deterministic

- **Choice:** The scaffold keeps a buildable, name-neutral starter block (placeholder or agent-set name, non-binding); the testing agent may name/structure block(s) freely. The judge globs `<slug>/build/blocks/*/block.json` in its own copy, reads each `name`, and inserts one block comment per discovered block. The plugin slug (`plugin-<scenario>-<agent>`) stays deterministic and is the activation key.
- **Alternatives:** Keep the pinned `skillsmith/testing-block` name; scaffold only the plugin shell (agent creates all blocks from scratch); enforce a new globally-unique naming scheme.
- **Trade-offs:** `wp-scripts build` discovers blocks by scanning `src/**/block.json` (no fixed-name dependency) and copies `block.json` to `build/` with `name` intact, and `index.php` registers any block dir name-agnostically — so nothing downstream needs the fixed name once the scaffold and brief stop imposing it. Keeping a starter block dir (rather than shell-only) minimizes agent variance and keeps the build reliably non-empty; the placeholder name is explicitly non-binding. Imposing a new naming scheme is out of scope (the change is to *stop* enforcing, not re-impose).
- **Traces to:** Requirement 10; Acceptance criterion 7.

### Decision: Restore the shared rubric to `eval/rubrics/` and reference it by id in every `JUDGE.md`

- **Choice:** Restore `eval/rubrics/wp-interactivity-api-best-practices.md` (id = filename); add a `# Rubrics` section listing that id to all 11 `JUDGE.md` files; delete the inlined `## Best-practices rubric` block from each; slim each brief to a grading intro + human-language setup + scenario-specific asserts + the rubric id. Set `paths.rubrics: './eval/rubrics'` in the config.
- **Alternatives:** Keep the rubric inlined per `JUDGE.md` (the base model); keep a generator that stamps a source-of-truth rubric into each brief.
- **Trade-offs:** This is a near-mechanical restore + reference-swap that removes the 11× duplication exactly as the spec intends and exercises Track A end to end (proving Acceptance criteria 1 and 8). Inlining was the base's choice *because* the base had no rubrics-by-id mechanism; review-1 adds that mechanism, so referencing by id is now the robust, self-contained option. `check:config` must stay green, which the optional `paths.rubrics` type accepts.
- **Traces to:** Requirement 11; Acceptance criterion 8.

### Decision: Extend the existing changeset; only core changes bump

- **Choice:** Amend the existing `.changeset/flexible-scenarios-judge-verification.md` (bump stays `minor`, `BREAKING:` prefix): change the `paths.rubrics`-dropped note to "drops then restores as optional," and add the rubrics-by-id note. Do not add a second changeset.
- **Alternatives:** A separate new changeset for review-1.
- **Trade-offs:** This layers onto the same unmerged PR, so the base entry already documents the `Paths` change; folding review-1's restoration into that same sentence is coherent and avoids a contradicting second entry. Only `src/**` changes bump the package, so the core rubric support is the sole release-relevant change; the testing-project changes do not bump.
- **Traces to:** Requirement 13.

## Dependencies

### No new external dependencies

- **Core:** Node `fs`/`path` only (mirrors `skill-loader.ts` / `enumerate.ts`). No new npm package — the `# Rubrics` parser reuses the `# Skills` machinery and `loadRubric` mirrors `loadSkill`.
- **testing-project:** `@wordpress/env ^11.4.0` and `@wordpress/scripts ^32.2.0` (already deps); the Playwright MCP server + Bash/Read for the judge (already configured on the judge agent); Docker (already required by wp-env). `judge-wp.mjs` is a thin wrapper around the existing wp-env CLI.

### Internal contracts the design leans on (all unchanged)

- The per-scenario `error` channel + keep-but-skip-and-fail-aggregate flow (rubric errors ride it).
- The `SerialMutex` judge lock that brackets `beforeJudgeAgent` → judge → `afterJudgeAgent` (env-once correctness rests on it).
- The run-level `beforeAllScenarios`/`afterAllScenarios` and per-pair `beforeJudgeAgent`/`afterJudgeAgent` hooks, and `AgentContext` (`scenario`, `agent`, `agentWorkspace`, `judgeWorkspace`).
- The claude-code provider's `process.env` passthrough to the judge subprocess.
- wp-env's `mappings` (mount-without-activate) and `--config` (instance keyed on `md5(configFilePath)`) behavior.

### The only core surface added

Optional `paths.rubrics` + `Scenario.rubrics` + `loadRubric` + the `# Rubrics` parse/validate/inject. No core run-lifecycle change (env-once is testing-project hooks only).

## Failure Modes and Observability

- **Unknown rubric id** → per-scenario `error` (`unresolved reference: rubric "<id>"`), logged via the scenario-skipped path, no throw; the scenario runs no agents and fails its aggregate — identical observability to an unknown skill (Acceptance criterion 3).
- **Missing rubrics dir while a rubric is referenced** → every referenced id fails `existsSync`, surfacing as per-scenario unknown-rubric errors (graceful). Because `checkPaths` does not gate the rubrics dir, this is the sole failure path — clear and per-scenario.
- **Guard tests pinning the base removal** → re-adding optional `paths.rubrics` / `Scenario.rubrics` and restoring `eval/rubrics/` will fail the existing guards (`core-types.test.ts` `@ts-expect-error` + `Paths`-keys `deepEqual`; `check-paths.test.ts` "no rubrics key" intent; `testing-project-e2e-removal.test.ts` asserting `eval/rubrics` is absent). These must be updated as part of the change so the deterministic gates stay green.
- **wp-env boot failure (Docker down / port busy / stale instance)** → thrown from `beforeAllScenarios` at run start before any pair. The module-level `booted` flag + idempotent/defensive boot (clean and recreate the staging dir, overwrite `.wp-env.json`) handles a stale container or staging dir from a crashed prior run.
- **Per-pair install/activate failure** → `wp plugin activate` non-zero throws in `beforeJudgeAgent` (under the serial lock), failing that pair's judge phase; the existing judge-phase error classification records it, and the diff-guard still protects the canonical workspace.
- **Judge fails to discover/insert/open (LLM flakiness)** → the judge's `{ pass: false, notes }` (or an unparseable output → `{ error: 'unparseable', raw }`) records it with explanatory notes. Mitigated by the role-prompt manual's exact command templates and the `judge-wp.mjs` wrapper.
- **Teardown failure (`wp-env stop` errors)** → wrapped in try/catch, logged not thrown, so `afterAllScenarios` returns nothing (treated as pass) and the run isn't failed by teardown noise. Risk: teardown is skipped entirely if the scenario sweep throws uncaught (see Risks).
- **Rubric injection observability** → the resolved rubric content is part of the judge system prompt; the judge's stored notes reflect grading against it. No separate per-rubric structured output (by design, Acceptance criterion 4).
- **Two-track composition at the judge prompt** → the rubric blob (Track A) and the human-language brief (Track B) both land in `buildJudgeSystemPrompt`'s `sections` array. They must compose cleanly — distinct headings (`# Rubrics` id list in the brief, the resolved blob under `# Grading rubrics`, `# Output format`, `# Recursion guard`, `# Role instructions`), no contradictory instructions. Low risk (additive sections); the assembled prompt order should be sanity-checked.

## Risks and Open Questions

Carried forward from the design research for the plan/implementation phases. None is load-bearing for the architecture.

### Risks

1. **`afterAllScenarios` teardown skipped on an uncaught sweep throw.** The scenario sweep's `catch` rethrows, bypassing `afterAllScenarios` and leaving wp-env running. Mitigation: idempotent/defensive boot (detect and reuse/restart a stale container on the fixed port; clean and recreate the staging dir; overwrite `.wp-env.json`) so the next run self-heals, and/or document a manual `wp-env stop`. Per-scenario errors do **not** trigger this (they are caught) — only an uncaught throw out of a hook/agent does.
2. **The live-bind-mount claim should be empirically sanity-checked once.** The design relies on a plugin copied into the bind-mounted host staging dir being immediately visible to `wp plugin activate <slug>` with no restart. This is source-verified against `@wordpress/env` 11.4.0 as a live Docker bind-mount but was not booted in this phase (manual posture). The plan should include a single-scenario manual sanity check: boot wp-env once, copy a plugin into the staging dir, activate it, confirm it registers.
3. **`beforeAllScenarios` re-fires per iteration under self-improvement.** Safe today (`test-only` ⇒ one iteration), but if the project ever switches to self-improvement, booting in `beforeAllScenarios` would double-boot. The `booted` singleton flag (idempotent boot) covers it; the genuinely run-once hooks are `beforeAll`/`afterAll`.
4. **Docker availability / first-pair latency.** Env-once pays one boot up front, kept warm — better aggregate cost, but the first pair waits for the boot. wp-env requires Docker; absence is a hard failure surfaced at boot. Acceptable under the manual posture.
5. **LLM-judge flakiness for human-language setup.** Moving block-insertion + page-open from the deterministic harness to the LLM judge trades determinism for simplicity; a flaky judge could fail to insert/open correctly. Mitigation: precise command templates in the role-prompt "environment manual" + the `judge-wp.mjs` wrapper; the deterministic infra (boot/build/install/clean-slate) stays in the harness. This is an explicit, owner-requested trade.
6. **Stale `.wp-env.json` / staging dir from a crashed prior run.** A crash could leave them behind. Mitigation: the boot hook cleans/recreates the staging dir and overwrites `.wp-env.json` defensively (both are hook-owned and gitignored).

### Open questions (deferred to plan/implementation)

1. **Exact `# Grading rubrics` heading text** and the precise section ordering inside `buildJudgeSystemPrompt`. A writer/plan detail; the constraint is distinct, non-colliding headings.
2. **Whether `judge-wp.mjs` is the sole bridge or env-var + cd is also documented.** The design leads with the wrapper for robustness; whether to also document the bare `--config` form is a plan call.
3. **Starter-block shape in the scaffold:** placeholder-named block dir vs. plugin-shell-only. The design keeps a non-binding placeholder block dir; the plan may revisit if the testing agent reliably creates blocks from scratch.
4. **Multiple-block insertion semantics per scenario.** The judge inserts every discovered block; scenarios expecting exactly one should say so in their human-language brief. Per-scenario wording is a writer detail.
5. **Exact env-var name for the port** (e.g. `SKILLSMITH_WP_PORT`) and whether the port is also embedded in the role-prompt manual. Trivial; pin in the plan.
6. **Whether `wp-cli.mjs`'s `deactivateAllPlugins()` needs `--config` pinning** when called from the per-pair hooks (it runs from `PROJECT_ROOT` today). Confirm during implementation; pin `--config` for cwd-robustness.

### Testing posture (unchanged from base)

Full behavioral verification across the suite is **manual**; acceptance is not "the full suite passes in CI" (Acceptance criterion 9). The pipeline does at most a single scenario × single agent sanity check and does not exercise the self-improvement loop. The deterministic gates — typecheck, lint, unit tests, `check:config`, changeset — must stay green, including the updated rubric guard tests. Do not design a full-suite-green gate.
