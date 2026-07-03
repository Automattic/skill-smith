# Design Research: Reusable rubrics and a leaner, human-language live-judge setup

This review refines the merged base implementation (two-file scenarios + live judge,
project-owned env) along three lines: rubrics-by-id (the only Skillsmith-core change),
wp-env booted once per run, and human-language judge-driven setup. It designs the
*increment* on top of the merged base — it does not redesign the base.

## Research

### wp-env `mappings` — the install-into-warm-env primitive (analyst read of @wordpress/env 11.4.0 README)

`testing-project/node_modules/@wordpress/env` is v11.4.0. Its README documents the
mechanism that makes env-once feasible:

- **`mappings`** (README:611) mounts host dirs into the WordPress container WITHOUT
  auto-activating them — unlike `plugins`, which activates everything listed on start
  (README:777-786 shows exactly this pattern: mount a test plugin via `mappings` to avoid
  auto-activation, then activate it explicitly when wanted).
- Mappings are Docker bind mounts → the host dir's **contents are live-visible** inside the
  container without a restart. So: boot once with a stable host mount dir mapped to
  `wp-content/plugins` (or a subdir), then per-pair drop the built plugin into that host dir
  and `wp plugin activate <slug>` — no `.wp-env.json` rewrite or re-`start` per pair.
- RESOLVED in the next section ("Install-into-warm-env, SOLVED"): map ONE stable parent dir
  (`wp-content/plugins`) to a host staging dir; per pair copy the built plugin slug into it,
  `deactivate --all`, `activate <slug>`. The bind-mount is live, so a plugin copied in after boot
  is visible to `wp plugin activate <slug>` without restart.

### Install-into-warm-env, SOLVED (researcher, Topic 2)

The load-bearing unknown is resolved against the installed @wordpress/env 11.4.0 source:

- **wp-env mounts are Docker bind-mounts, established once at boot and STATIC for the
  container lifetime — but a bind-mount is LIVE.** Host file changes under a mounted path
  appear in the container immediately, no restart. Evidence:
  `@wordpress/env/lib/runtime/docker/build-docker-compose-config.js:38-50` maps `mappings` →
  `${source.path}:/var/www/html/${wpDir}` and `plugins` →
  `.../wp-content/plugins/${basename}`, all assembled into container `volumes` at boot
  (build-docker-compose-config.js:70-79); nothing re-reads `.wp-env.json` after `wp-env start`.
- **`mappings` mounts WITHOUT auto-activating** (README:775-786 — the documented pattern for a
  "test plugin that should not be activated all the time"). `plugins` auto-activates; `mappings`
  does not. This is the clean-slate primitive.
- **`wp plugin activate <slug>` over the warm env via `wp-env run cli wp ...` is already proven
  in this codebase** (wp-env-judge.ts:114-119 `wpCli`, used at :184).
- **The judge copy is NOT in the container** — only `core`/`plugins`/`themes`/`mappings`
  sources are mounted (build-docker-compose-config.js:70-79). So we cannot "point wp at the
  judge-workspace path"; we must COPY the built plugin into a mounted staging dir.
- **Run-level lifecycle confirmed:** `beforeAllScenarios`/`afterAllScenarios` fire once per
  iteration; `test-only` forces exactly 1 iteration (pipeline.ts:127-130) → fire exactly once.
  `afterAllScenarios` fires even when scenarios errored/were skipped (runs after the
  `Promise.all`), but is SKIPPED if the sweep throws uncaught (pipeline.ts:406-409 rethrows).
  Returning nothing from `afterAllScenarios` is treated as pass (types.ts:318-324) — safe for
  teardown as long as it doesn't return `false`/`{pass:false}`/failures and doesn't throw.
- **Module singleton works:** all hooks are closures in the single `skillsmith.config.ts`
  module; the harness `import()`s the config once (config/load.ts:21) and runs hook bodies
  in-process (providers spawn subprocesses, hooks do not). Scenario fan-out is `Promise.all`
  in ONE process (pipeline.ts:389), not worker threads. So a `let booted = false` + port const
  in `wp-env-judge.ts` is shared across all hooks. With `concurrency: 'serial'`, per-pair hook
  bodies are serialized (no singleton race).

### Judge-driven setup + bridge + block discovery (researcher, Topic 3)

- **The bridge: `wp-env --config "<abs .wp-env.json>" run cli`, cwd-independent.** wp-env's
  running-instance identity is `md5(configFilePath)`, NOT cwd
  (`@wordpress/env/lib/init-config/load-config.js:54-74`; `--config` is a global flag,
  cli.js:103-105; parse-config.js:185-186 resolves it to an absolute path). So a bare
  `wp-env run cli` from the judge's cwd (judge-workspace) would resolve `.wp-env.json` relative
  to that cwd (`path.resolve('.')`, commands/run.js:34) and miss the warm instance; passing
  `--config <PROJECT_ROOT>/.wp-env.json` (the same file the boot hook used) reaches it from any
  cwd. There is no host-config-relocating flag other than `--config` (`--env-cwd` only sets the
  cwd INSIDE the container). So the bridge = `SKILLSMITH_PROJECT_ROOT` env var (propagates to the
  judge, proven) + `--config "$SKILLSMITH_PROJECT_ROOT/.wp-env.json"`.
- **Post-create recipe (judge runs it):** `wp post create --post_type=post
  --post_status=publish --post_title='...' --post_content='<!-- wp:NS/NAME /-->' --porcelain`
  → stdout is the numeric id; open `http://localhost:<port>/?p=<id>`. `?p=<id>` is robust
  (plain-permalink-independent; the current code uses it deliberately, wp-env-judge.ts:52-54).
  Block delimiter forms: self-closing `<!-- wp:ns/name /-->` (correct for these
  dynamic/server-rendered blocks), attribute form `<!-- wp:ns/name {"k":"v"} /-->`, inner-html
  form `<!-- wp:ns/name -->...<!-- /wp:ns/name -->`.
- **Block discovery in the judge's OWN cwd:** the build runs against `judgeWorkspace`
  (wp-env-judge.ts:142-160), so `<slug>/build/blocks/*/block.json` exists in the judge copy.
  wp-scripts 32.2.0 copies `**/block.json` to `build/` with `name` intact (only rewrites
  script/module fields, webpack.config.js:328-390). The judge globs
  `<slug>/build/blocks/*/block.json` (slug from `$SKILLSMITH_PLUGIN_SLUG`, already exported, or
  `*/build/blocks/*/block.json`), reads each `name`, inserts each. No PROJECT_ROOT needed for the
  read.
- **Minimal buildable scaffold for free names:** `getWebpackEntryPoints` discovers blocks via
  `glob('**/block.json', {cwd: src})` (config.js:255-258); JS/module entries come ONLY from
  `file:`-prefixed script/module fields (config.js:285-306). A block.json with no script fields
  (like today's, only `render: 'file:./render.php'`) still builds (just no JS entry); fallback is
  `src/index.*` (config.js:226). ⇒ the ONLY hard requirement for a buildable block is
  `src/<anydir>/block.json` — name free, view JS optional (agent adds when needed).
- **Coupling:** free names (Q4) ⇒ judge discovers names from built block.json in its own copy
  (Q3) ⇒ judge creates the post itself (Q2) ⇒ judge needs the WP-CLI bridge to reach the warm
  env from its cwd (Q1). Harness keeps deterministic parts (boot, build, copy-install,
  deactivate-all/activate, export PROJECT_ROOT+port+slug); judge owns behavioral parts (discover,
  insert, open, check) via human-language JUDGE.md + a role-prompt command manual.

### wp-scripts build does NOT depend on a fixed block name (analyst read of @wordpress/scripts)

`testing-project` has @wordpress/scripts ^32.2.0, no custom webpack config. `wp-scripts build`
discovers entry points by scanning `src/**/block.json` + the JS each references
(`getWebpackEntryPoints`, utils/config.js:225-226, 232, 255; falls back to `src/index.*`), and
copies every `**/block.json` into `build/` with the `name` field intact (webpack.config.js:331,
339). So: (1) the build works for blocks of ANY name under `src/` — no fixed-name dependency;
(2) after build, `build/blocks/<dir>/block.json` carries the produced `name`, so the judge can
glob `build/blocks/*/block.json` in its judge copy (the build ran against `judgeWorkspace`,
wp-env-judge.ts:142-160) and read `name`(s). The scaffold's `index.php` already
`register_block_type`s every dir under `build/blocks/*` (or `src/blocks/*` fallback),
name-agnostic (scaffold-plugin.ts:54-66). ⇒ free block naming needs only: drop the pinned
`name` in the scaffold's block.json + drop the "don't rename the block" constraint in
testing-agent.md; everything downstream already handles arbitrary names.

### Judge env propagation (analyst read of claude-code provider)

`testing-project` uses `provider: 'claude-code'`. The provider passes
`env: claudeCodeEnv(process.env)` to the SDK (claude-code.ts:163), and `claudeCodeEnv`
returns a copy of ALL `process.env` minus only `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`
(claude-code.ts:98-116). So any `SKILLSMITH_*` env var a hook sets via `process.env[...]`
propagates to the judge subprocess — the current bridge relies on exactly this
(wp-env-judge.ts:203-207 → counter/JUDGE.md `$SKILLSMITH_JUDGE_URL`). The judge's Bash/Read
tools operate with `cwd = params.cwd = judgeWorkspace` (claude-code.ts:158). So the judge can
`cd "$SKILLSMITH_PROJECT_ROOT"` (env propagates) before running `npx wp-env run cli ...`
(which reads `.wp-env.json` from cwd). This confirms the env-var + role-prompt-manual bridge
is mechanically sound; the wrapper-script alternative is a robustness nicety, not a necessity.

### Boot-once reference: historical `verify-e2e.ts` (git `03535e0^`)

The pre-merge branch had `testing-project/eval/utils/verify-e2e.ts` (removed by commit
`03535e0`, recoverable via `git show 03535e0^:testing-project/eval/utils/verify-e2e.ts`).
It is the proven boot-once pattern the brief cites. Shape:

- Ran as an `afterAllScenarios`-style verification over a whole iteration directory.
- Collected **every** produced `plugin-*` workspace, wrote ONE `.wp-env.json` listing all
  plugins, booted wp-env **once**, and used
  `lifecycleScripts.afterStart: 'npx wp-env run cli wp plugin deactivate --all'` to start
  from a clean slate. Each e2e spec then activated exactly the plugin it exercised.
- Tore down once in a `finally` (env:stop + rm `.wp-env.json`).
- Used Playwright specs + a JSON report parsed into `VerificationFailure[]`.

**Key divergence for our design:** that pattern listed all plugins in `.wp-env.json` at boot
because every workspace already existed before the e2e phase (it ran after the whole sweep).
Our review-1 model runs the **judge per-pair, interleaved** with testing (judge is a
per-pair hook, not a final sweep). So at boot time the per-pair plugin may not yet exist.
The brief therefore says boot a warm env in `beforeAllScenarios`, then **per pair install
the built plugin into the warm env + deactivate-all + activate**. The open question is the
exact install mechanism into an already-running wp-env (see Topic: env-once). The
clean-slate primitive already exists: `wp-cli.mjs::deactivateAllPlugins()` (currently
unused).

### Rubrics-by-id seams, traced end-to-end (researcher, Topic 1)

Sources are file:line under WT. Summary of the decisive findings:

- **Two separate seams.** Skill *validation* happens at enumeration
  (`scenarioFromBriefs` validates ids via `existsSync(<skillsRoot>/<id>/SKILL.md)`,
  enumerate.ts:220-221, stores only the id list). Skill *content loading* happens later, at
  dispatch: `loadSkill` is called in `testing-agent.ts:42-45` (→ testing agent **system
  prompt**) and `improvement/context.ts:64` (improver). **The judge never receives skill
  content** — `loadSkill` is not imported in judge-agent.ts.
- **Judge prompt is purely additive.** `buildJudgeSystemPrompt` (judge-agent.ts:150-172)
  injects only: `scenario.judgeBrief` (the sole scenario-derived text), a static output
  instruction, and optional `config.roles.judge.prompt` under `# Role instructions`. No
  rubric/skill/acceptance content today. A resolved rubric blob would be pushed into the same
  `sections` array. The judge already receives `config` (so `config.paths.rubrics` is in scope).
- **`EnumeratedScenario.error` is the single per-scenario error channel.** Problems are
  joined with `'; '` in `scenarioFromBriefs` (enumerate.ts:213, 241). Downstream: selection
  KEEPS errored scenarios (select-scenarios.ts:46); `runScenario` guards
  `if (error === undefined) runAgents(...)` (pipeline.ts:522-537) so a non-empty error ⇒ **no
  testing agents and no judge run**; `aggregateScenarioReport` forces `pass=false` and records
  `body.error` (scenario-report.ts:85-101); surfaced via `tracker.scenarioSkipped`
  (pipeline.ts:320-322). Unknown skill reads `unresolved reference: skill "ghost"`; unknown
  rubric would read `unresolved reference: rubric "ghost"`, appended to the same `problems[]`.
- **JUDGE.md is parsed for NOTHING today** — only read verbatim into `judgeBrief`
  (enumerate.ts:158-160 → 235), whose sole consumer is `buildJudgeSystemPrompt`. Adding a
  `# Rubrics` parse over the judge brief is purely additive. `parseSkillsSection` is generic
  except the hardcoded `/^Skills$/i` heading regex (enumerate.ts:13); `normalizeSkillId` is
  already id-agnostic and reusable as-is.
- **Config/paths — the base work already removed `rubrics` and left guard tests.**
  `DEFAULT_PATHS` (defaults.ts:3-7) has no `rubrics`; guard test `check-paths.test.ts:35-45`
  asserts that. `checkPaths` (pipeline.ts:575-596) only `existsSync`-validates `skills` and
  `scenarios`; guard test `check-paths.test.ts:47-64` asserts rubrics is NOT required. These
  two tests encode the spec's "optional, required only when used" intent and must be
  updated/extended. `paths` defaults are merged in `normalizeConfig`
  (`{ ...DEFAULT_PATHS, ...input.paths }`, normalize.ts:45) — the one place a default would
  live. `collectConfigErrors` (validate.ts:19-42) does **not** validate `paths` at all, so an
  extra `paths.rubrics` already flows through. `Paths` (types.ts:146-150) is currently
  all-required flat keys. `Scenario` has an open index signature and a `skills: string[]`
  field — a parallel `rubrics?: string[]` is the clean place for parsed ids.
- **`check:config` is the testing-project script** (`testing-project/package.json:10`:
  `node --import tsx -e "await import('./skillsmith.config.ts')"`) — it just confirms the
  config module loads/typechecks. Adding `paths.rubrics` there must keep the type accepting it.
- **Load fork:** rubric content can load **eagerly at enumeration** (read into `Scenario`) or
  **lazily at judge dispatch** (mirroring `loadSkill`). Skill precedent is lazy.

### Hook lifecycle + serial lock (analyst read of pipeline.ts / agent-loop.ts)

Confirmed independently before the researcher's env-once reply:

- **`test-only` ⇒ exactly one iteration.** `maxIterations` is hard-set to `1` when
  `selfImprovement.mode === 'test-only'` (pipeline.ts:127-130). testing-project is
  `mode: 'test-only'` (config.ts:19), so the iteration loop runs once.
- **`beforeAllScenarios`/`afterAllScenarios` fire once per ITERATION** (pipeline.ts:366-372
  fire `beforeAllScenarios`; pipeline.ts:428-433 fire `afterAllScenarios`). For `test-only`
  that's once per run. NOTE: `beforeAllScenarios` is NOT gated by `fireBeforeAll` — that flag
  gates the run-level `beforeAll` hook (pipeline.ts:344-352), which fires exactly once across
  ALL iterations. So `beforeAll`/`afterAll` are the genuinely run-once hooks; `beforeAllScenarios`
  re-fires every iteration in self-improvement mode. Since we're test-only this is moot, but
  flag it: if the project ever switches to self-improvement, env boot belongs in
  `beforeAll`/`afterAll`, not `beforeAllScenarios`. (The brief specifies
  `beforeAllScenarios`/`afterAllScenarios`; fine for test-only — recorded as a risk.)
- **`afterAllScenarios` is the verdict hook** (pipeline.ts:428-440) — its return folds into
  the report via `applyVerification`. Returning `undefined`/nothing is treated as pass
  (types.ts:322-324, `AfterAllScenariosHookFn` allows `void`). So teardown there is safe as
  long as the hook returns nothing (or a pass). Risk: a throw in teardown would propagate;
  must wrap `env:stop` in try/catch (the existing `tearDownJudgeEnv` already does).
- **Serial lock brackets the whole judge phase.** When `roles.judge.concurrency === 'serial'`,
  `agent-loop.ts:250-251` acquires a run-wide `SerialMutex` before
  `copyWorkspaceForJudge → beforeJudgeAgent → runJudgeAgent → afterJudgeAgent`, released in
  `finally` (agent-loop.ts:341-343). The mutex is one instance per iteration constructed above
  both fan-outs (pipeline.ts:385). So per-pair `deactivate-all → install → activate → grade`
  cannot race another pair's active-plugin state on the shared warm env. This is the
  correctness guarantee env-once relies on.

### Current JUDGE.md structure (analyst read of counter + minimal-scaffold)

Uniform across files: (1) a one-line "you are grading X" intro; (2) `## Environment`
describing the three `SKILLSMITH_*` env vars and a pre-made post URL that *already renders
the block*; (3) `## Scenario requirements` (code-level asserts, scenario-specific);
(4) `## Live checks` (load `$SKILLSMITH_JUDGE_URL`, click, assert — already human-language
but assumes the harness inserted the block); (5) `## Best-practices rubric` (lines 23-59,
identical across all 11). Implication for the human-language topic: the judge-driven shift
mainly rewrites `## Environment` (drop the pre-made post URL; give a base URL + the WP-CLI
bridge + the deterministic plugin slug) and adds "activate the plugin, discover the block
name from block.json, insert it on a page, open it" to the setup — the `## Live checks`
behavioral asserts mostly survive. After conversion, sections 2+5 collapse into a slim
human-language setup + a `# Rubrics` id.

### Changeset state (researcher, Req 13)

One base changeset exists: `.changeset/flexible-scenarios-judge-verification.md` (no
`testing-project/.changeset/`; changesets live at repo root, `baseBranch: trunk`). Frontmatter
bump `@automattic/skillsmith: minor`; summary `BREAKING: Redefine scenarios as TESTING-AGENT.md
+ JUDGE.md and run the judge live against an isolated workspace copy.` Body (lines 5-24) already
documents `Paths` DROPPING `paths.rubrics` — so re-adding optional `paths.rubrics` is a coherent
amendment to the SAME entry, not a contradiction. `.changeset/config.json:15-22`
`changedFilePatterns` bumps only on `src/**`, `bin/**`, `package.json`, `examples/**`, `README.md`
(excluding `src/__tests__/**`) → testing-project changes don't bump; only the core rubric support
does. Pre-1.0 policy: breaking = `minor` + `BREAKING:` prefix (matches).

### Prior rubrics folder (git `03535e0^`)

`testing-project/eval/rubrics/wp-interactivity-api-best-practices.md` existed pre-merge
(same commit removed it). This is the shared best-practices rubric to restore. The inlined
text now in every JUDGE.md (counter/JUDGE.md lines 24-60) is the same content. Confirmed all
**11** JUDGE.md files carry the `Best-practices rubric` heading → clean lift to one file.

## Topics

### Topic: Approach (end-to-end mental model)

- **Spec link:** Overview; ties Reqs 1-14 together.
- **Mental model the implementer works from:** Two independent tracks that meet only at the
  judge prompt.
  - **Track A — Skillsmith core (rubrics-by-id, the only core change):** JUDGE.md gains an
    optional `# Rubrics` section (parsed exactly like TESTING-AGENT.md's `# Skills`). At
    enumeration, rubric ids are parsed and validated against the configured rubrics root, with
    unknown ids surfaced through the SAME per-scenario `error` channel as unknown skills (no
    throw, scenario skipped + fails aggregate). At judge dispatch, the resolved rubric file
    content is loaded (lazily, mirroring `loadSkill`) and injected into the judge's system
    prompt alongside the verbatim judge brief. The verdict stays `{ pass, notes }`. The only new
    config surface is an OPTIONAL `paths.rubrics`, required to exist only when used.
  - **Track B — testing-project (env-once + human-language judge + free block names):** wp-env
    boots once per run via a run-level hook, kept warm, with the whole `wp-content/plugins` dir
    bind-mounted to a host staging dir (live bind-mount, no auto-activate). Per pair (under the
    existing serial judge lock): build the plugin, copy it into the staging dir, deactivate-all
    + activate the deterministic slug. The judge then performs the live e2e itself from a slim,
    human-language JUDGE.md — discover the produced block name(s) from `block.json`, insert them
    on a page, open it, check behavior — using a WP-CLI/env bridge (env vars + an "environment
    manual" in the judge role-prompt). The fixed block name is no longer enforced; the slug
    stays deterministic. The shared best-practices rubric moves to `eval/rubrics/` and every
    scenario references it by id (Track A), removing the 11x inlined duplication.
- **What does NOT change:** the two-file scenario model, the live-judge model, the
  `{ pass, notes }` verdict, project-owned env, the serial-judge constraint, the manual testing
  posture (no full-suite-green gate). This review refines the increment; it does not redesign
  the base.

### Topic: Components (new / modified / untouched-but-relevant)

- **Spec link:** Reqs 1-12.
- **Skillsmith core:**
  - *Modified* `src/scenarios/enumerate.ts` — generalize `parseSkillsSection` into a
    heading-parameterized section parser; add `# Rubrics` parsing over the judge brief in
    `scenarioFromBriefs`; validate rubric ids against the rubrics root; append unresolved ids to
    the same `problems[]`; store on `Scenario.rubrics`.
  - *New* `src/scenarios/rubric-loader.ts` — `loadRubric(id, rubricsRoot)` mirroring
    `skill-loader.ts` (flat `<id>.md` + md-linked files; link-following inside the rubrics root).
  - *Modified* `src/pipeline/judge-agent.ts` — `runJudgeAgent` resolves the rubrics root and
    builds a rubric blob (when `paths.rubrics` set and `scenario.rubrics` non-empty); pass it to
    `buildJudgeSystemPrompt`, which pushes it into the `sections` array under a clear heading.
    Keep the builder filesystem-free (do the read in `runJudgeAgent`, mirroring how
    `runTestingAgent` builds `skillBlob`).
  - *Modified* `src/config/types.ts` — add optional `rubrics?: string` to `Paths`; add
    `rubrics?: string[]` to `Scenario`.
  - *Modified* `src/config/defaults.ts` / `src/config/normalize.ts` — conventional default for
    `paths.rubrics` (or leave undefined; see Open Questions).
  - *Modified* `checkPaths` (in `src/pipeline/pipeline.ts`) — conditional existence check for
    rubrics ("required only when used"); update guard tests `check-paths.test.ts:35-45`, `47-64`.
  - *Untouched-but-relevant:* selection (`select-scenarios.ts`), `runScenario` skip path
    (pipeline.ts:522), `aggregateScenarioReport` (scenario-report.ts) — all already handle the
    per-scenario `error` correctly; rubric errors ride that path for free.
- **testing-project:**
  - *Modified* `skillsmith.config.ts` — move env hooks from `beforeJudgeAgent`/`afterJudgeAgent`
    pair to a run-level `beforeAllScenarios`/`afterAllScenarios` boot/stop plus per-pair
    install/clean-slate; add `paths.rubrics`; add the judge "environment manual" to
    `roles.judge.prompt`.
  - *Heavily simplified* `eval/utils/wp-env-judge.ts` — boot-once + per-pair install + clean
    slate; sheds per-pair boot/teardown/post-creation/URL export and the fixed block name.
  - *Modified* `eval/utils/scaffold-plugin.ts` — stop pinning the block name.
  - *Reused* `eval/utils/wp-cli.mjs` — `deactivateAllPlugins()` (currently unused) becomes the
    clean-slate primitive.
  - *New* `eval/rubrics/wp-interactivity-api-best-practices.md` — restored shared rubric.
  - *Modified* all 11 `eval/scenarios/*/JUDGE.md` — slim to human-language setup + `# Rubrics` id.
  - *Modified* `eval/prompts/testing-agent.md` — drop the block-name constraint.
  - *Possibly new* a tiny WP-CLI wrapper script (if env-var bridge alone proves insufficient;
    see Topic 3 decision).

### Topic: Rubrics-by-id — parse, load, inject, validate (Skillsmith core)

- **Spec link:** Requirements 1-5, 12; Acceptance criteria 1-4.
- **Status:** DECIDED (on researcher evidence above).

- **Decisions:**
  1. **Parse `# Rubrics` from JUDGE.md.** Generalize `parseSkillsSection` into a
     section-id parser parameterized by the heading regex (so `parseSkillsSection` and a new
     `parseRubricsSection` share one implementation), reusing `normalizeSkillId` as-is. Parse
     the judge brief for the `# Rubrics` section; absent section ⇒ no rubrics (optional). This
     keeps the proven backtick/link-unwrap + nested-heading semantics identical to skills.
  2. **Validate at enumeration, mirroring the unknown-skill path exactly.** In
     `scenarioFromBriefs`, after parsing rubric ids, validate each against the resolved
     rubrics root with `existsSync`; push any unresolved ids onto the SAME `problems[]` array
     as `unresolved reference: rubric "<id>"`. No throw; the existing
     keep-but-skip-and-fail-aggregate flow handles it unchanged (AC 3). Store parsed ids on a
     new explicit `Scenario.rubrics?: string[]` field paralleling `skills`.
  3. **Load rubric content lazily at judge dispatch** (mirror `loadSkill` in
     testing-agent.ts), NOT eagerly at enumeration. A new `loadRubric(id, rubricsRoot)` mirrors
     `loadSkill`'s shape (read the rubric file + md-linked files, `=== <rel> ===` blocks).
     Enumeration validates id existence; the judge-dispatch path reads the bytes — keeping
     enumeration cheap and the validate/load split identical to skills.
  4. **Inject into the judge system prompt** in `buildJudgeSystemPrompt`: resolve
     `rubricsRoot = resolve(projectRoot, config.paths.rubrics)` (guarded on `paths.rubrics`
     being set), `scenario.rubrics.map(id => loadRubric(id, rubricsRoot)).join('\n\n')`, and
     push the blob into the `sections` array under a clear heading (e.g.
     `# Grading rubrics`). buildJudgeSystemPrompt gains access to `projectRoot` (already
     available to `runJudgeAgent`, judge-agent.ts:60) — pass it in, or compute the blob in
     `runJudgeAgent` and hand it to the builder. Prefer the latter (keep the pure-string
     builder filesystem-free; do the FS read in `runJudgeAgent`, consistent with how
     `runTestingAgent` builds `skillBlob` before assembling its prompt). Verdict stays
     `{ pass, notes }` (AC 4) — rubrics are content, not a scoring grid.
  5. **`paths.rubrics` is OPTIONAL with a conventional default location but required to
     exist only when used.** Add `rubrics?: string` to the `Paths` interface (optional). Set a
     conventional default in `normalizeConfig` so authors who follow convention need no
     config (`rubrics: './eval/rubrics'` for testing-project-style layout) — BUT keep the
     *existence* requirement conditional in `checkPaths`: only require the rubrics dir to exist
     when at least one selected scenario references a rubric (or, simpler and sufficient: when
     `paths.rubrics` resolves to an existing dir, fine; the per-scenario unknown-id error
     already covers missing rubric files). Update the two guard tests
     (`check-paths.test.ts:35-45`, `47-64`) to the new "optional, required-when-used" contract.
  6. **Leave the `# Rubrics` section in `judgeBrief` (do NOT strip it).** Mirrors the skills
     precedent (the `# Skills` list stays in the testing brief). The injected resolved content
     is what the judge grades against; the literal id list is harmless and stripping is net-new
     code with no benefit. (Recorded as a deliberate fidelity-to-precedent choice.)
  7. **Rubric file naming:** flat `<rubricsRoot>/<id>.md` (the shared rubric id
     `wp-interactivity-api-best-practices` → `eval/rubrics/wp-interactivity-api-best-practices.md`,
     matching the historical file). This is simpler than skills' `<id>/SKILL.md` directory form
     and matches what existed pre-merge. A rubric that needs companion files can still md-link
     them and `loadRubric` follows links inside the rubrics root (mirror `loadSkill`'s
     link-following). Validation checks `existsSync(<rubricsRoot>/<id>.md)`.

- **Options considered & trade-offs:**
  - *Eager (enumerate-time) vs. lazy (dispatch-time) load:* chose lazy to mirror skills, keep
    enumeration cheap, and keep the validate/load split. Eager would centralize FS work but
    bloat `Scenario` and diverge from precedent.
  - *Add `rubrics` to `DEFAULT_PATHS` (always-set) vs. optional `rubrics?`:* chose optional
    field + conditional existence check, because "required only when used" (Req 5) maps
    literally to optional, and the guard tests already encode that contract.
  - *Strip vs. leave `# Rubrics` in the brief:* chose leave (precedent fidelity).
  - *Flat `<id>.md` vs. `<id>/RUBRIC.md` dir:* chose flat to match the historical file and
    because rubrics are single-file content; link-following preserves multi-file capability.
- **Rationale:** Every choice mirrors an existing, tested seam (skills parse/validate/load,
  the unknown-skill error path, the lazy content-blob assembly) so the increment is minimal,
  additive, and consistent. The only genuinely new surface is the optional `paths.rubrics`
  and the conditional existence check — and the base work already left guard tests staking out
  that exact contract.
- **Open sub-questions → logged:** exact `checkPaths` trigger for "required when used"
  (declared-dir vs. any-scenario-references-a-rubric); see Open Questions.

### Topic: wp-env booted once per run (testing-project)

- **Spec link:** Requirements 6-8; Acceptance criterion 5.
- **Status:** DECIDED (install-into-warm-env solved against @wordpress/env 11.4.0).

- **Decision — boot-once via live bind-mount + staging dir:**
  - **`beforeAllScenarios` (run-level, once):** create an empty host staging dir
    `<PROJECT_ROOT>/.wp-env-plugins/` BEFORE boot; write `.wp-env.json` with `"plugins": []`
    and `"mappings": { "wp-content/plugins": "<PROJECT_ROOT>/.wp-env-plugins" }` (map the whole
    plugins dir so each pair gets its own `<slug>` subdir and activation stays keyed on the real
    deterministic slug); `wp-env start` once on fixed port 8987; set a module-level `booted`
    flag.
  - **`beforeJudgeAgent` (per pair, under the serial lock):** build the plugin from the judge
    copy (existing `wp-scripts build`), COPY the built plugin dir into
    `<PROJECT_ROOT>/.wp-env-plugins/<slug>/` (live bind-mount → visible in container), then
    `wp plugin deactivate --all` (clean slate) + `wp plugin activate <slug>`. Export the
    minimal env/bridge facts the judge needs (see Topic: human-language setup). Do NOT pre-create
    the post — the judge does that (Topic 3).
  - **`afterJudgeAgent` (per pair):** `wp plugin deactivate --all` and remove
    `.wp-env-plugins/<slug>/` so the next pair is clean. NO env stop (stays warm).
  - **`afterAllScenarios` (run-level, once):** `wp-env stop`, remove staging dir + `.wp-env.json`.
    Wrap stop in try/catch (log, don't throw) and return nothing (treated as pass).
  - Judges stay `serial` (the lock brackets deactivate→activate→grade so the shared env's
    active-plugin state is never raced).
  - The simplified `wp-env-judge.ts` keeps: `wp-scripts build`, the `wpCli` transport, the
    `judgePluginSlug` re-export. It SHEDS: per-pair `.wp-env.json` write/rewrite, per-pair
    `env:start`/`env:stop`, the per-pair post creation + `SKILLSMITH_JUDGE_URL`/`SKILLSMITH_POST_ID`
    (those move to the judge). Reuse the existing-but-unused `deactivateAllPlugins()` from
    `wp-cli.mjs` for the clean-slate step.

- **Options considered & trade-offs:**
  - *Map whole `wp-content/plugins` (per-slug subdirs) vs. map one fixed sub-path (one reused
    slot):* chose whole-dir so activation stays keyed on the real deterministic
    `plugin-<scenario>-<agent>` slug (matches `judgePluginSlug`) and multiple plugins could
    coexist. One fixed slot is simpler clean-slate but loses per-slug determinism. Mapping the
    whole dir replaces the container's default plugins dir, so the staging dir MUST exist (empty)
    before boot.
  - *Bind-mount-live + copy vs. per-pair `.wp-env.json` rewrite + `wp-env start`:* chose
    bind-mount-live. The rewrite-and-restart fallback is effectively the per-pair boot we're
    eliminating (it re-resolves sources and recreates containers). Only needed if a plugin must
    mount at a path not covered by the boot-time mapping — which whole-dir mapping prevents.
  - *Teardown in `afterAllScenarios` vs. `afterAll`:* the brief specifies
    `beforeAllScenarios`/`afterAllScenarios`. For `test-only` both fire exactly once, so this is
    correct. `afterAll` is the genuinely run-once hook (would matter only under self-improvement).
    Recorded as a risk + mitigation (idempotent boot / backstop) since `afterAllScenarios` is
    skipped if the sweep throws.

- **Rationale:** A live bind-mount with `mappings` is the documented, source-verified way to
  add a plugin to a running wp-env without restart; it reuses the codebase's proven `wpCli`
  transport and the historical boot-once spirit (one env, clean-slate, per-unit activate) while
  fitting the per-pair interleaved judge model. The serial lock already guarantees no two pairs
  race the shared env. The helper genuinely shrinks (no per-pair boot/teardown/post).
- **Open sub-questions / risks → logged:** Docker availability assumption; teardown-on-throw
  backstop; first-pair latency (the one boot is paid up front, kept warm). See Risks.
- **Current model (per-pair, to be replaced):**
  - `skillsmith.config.ts` wires `beforeJudgeAgent: setUpJudgeEnv` /
    `afterJudgeAgent: tearDownJudgeEnv` (config.ts:69-73). Judge role is `serial`.
  - `setUpJudgeEnv` (wp-env-judge.ts:142) per pair: builds the plugin, writes a
    single-plugin `.wp-env.json` on fixed port 8987, `npm run env:start` (boots +
    activates), creates a published post embedding `<!-- wp:skillsmith/testing-block /-->`,
    exports `SKILLSMITH_JUDGE_URL` / `SKILLSMITH_POST_ID` / `SKILLSMITH_PLUGIN_SLUG`.
  - `tearDownJudgeEnv` (wp-env-judge.ts:220) per pair: `env:stop`, removes `.wp-env.json`,
    clears env vars.
  - `wp-cli.mjs` already has `deactivateAllPlugins()` (clean-slate building block) but it
    is currently UNUSED — the per-pair `.wp-env.json` loads exactly one plugin.
- **Target model (per spec + brief):** boot once in `beforeAllScenarios`, stop in
  `afterAllScenarios`; per pair install built plugin into the warm env + deactivate-all +
  activate; judges stay serial; simplify `wp-env-judge.ts`. Hooks `beforeAllScenarios` /
  `afterAllScenarios` exist (types.ts:382-391); `afterAllScenarios` is the verdict hook —
  using it for teardown must not clobber the verdict it may return.
- **Open sub-questions to research:** how is a plugin installed into an already-running
  wp-env without a `.wp-env.json` restart (mount vs. copy into the container vs.
  `wp plugin install` from path)? How does the run-level boot share state with the per-pair
  hook (module-level singleton in the helper)? Does `beforeAllScenarios` run once per run or
  once per iteration (we are `test-only`, maxIterations effectively 1, but confirm)?

### Topic: Human-language, judge-driven setup + WP bridge (testing-project)

- **Spec link:** Requirement 9; Acceptance criterion 6.
- **Status:** DECIDED.

- **Decision — judge owns the behavioral e2e; harness owns deterministic infra; bridge via
  `--config` + wrapper script:**
  1. **Bridge.** Boot hook exports `SKILLSMITH_PROJECT_ROOT` (and the fixed port) via
     `process.env` (propagates to the judge subprocess — proven). The judge reaches the warm
     wp-env with `npx wp-env --config "$SKILLSMITH_PROJECT_ROOT/.wp-env.json" run cli wp <args>`
     (cwd-independent because wp-env keys the instance on `md5(configFilePath)`). **Ship a tiny
     wrapper** `eval/utils/judge-wp.mjs` (resolves PROJECT_ROOT from its own `import.meta.url`
     like `wp-cli.mjs`, shells `npx wp-env --config <abs> run cli wp "$@"`) so the judge's
     memorized command is a single robust form: `node "$SKILLSMITH_PROJECT_ROOT/eval/utils/judge-wp.mjs" <args>`.
     Chosen over raw templates to remove the LLM-omits-`--config` failure mode.
  2. **Environment manual in `roles.judge.prompt`.** Currently unset (config.ts:53). Add a
     project-level role prompt (injected under `# Role instructions` by `buildJudgeSystemPrompt`,
     judge-agent.ts:167-170) carrying the reusable runtime mechanics: the `judge-wp.mjs` command
     form, the `wp post create ... --porcelain` template, the `?p=<id>` URL shape + port, and the
     "discover block names from `$SKILLSMITH_PLUGIN_SLUG/build/blocks/*/block.json`" instruction.
     This keeps WP/runtime vocabulary OUT of core (per spec) and out of the per-scenario briefs.
  3. **Slim, human-language JUDGE.md.** Each brief states the behavioral steps in plain language
     ("activate the plugin, find the produced block, put it on a published post, open the page,
     check X") + the scenario-specific asserts + a `# Rubrics` id. No env-var catalog, no
     mechanical recipes (those live in the manual).
  4. **Harness keeps deterministic parts:** boot-once, `wp-scripts build`, copy-install into the
     staging dir, `deactivate-all` + `activate <slug>`, and exporting `SKILLSMITH_PROJECT_ROOT`,
     the port, and `SKILLSMITH_PLUGIN_SLUG`. It STOPS pre-creating the post / exporting
     `SKILLSMITH_JUDGE_URL` / `SKILLSMITH_POST_ID` — the judge creates the post itself.

- **Options considered & trade-offs:**
  - *Bridge form:* (i) `cd $PROJECT_ROOT && wp-env run cli`, (ii) `wp-env --config <abs> run cli`,
    (iii) wrapper script. All work; chose the wrapper wrapping (ii) for LLM robustness. (i) is
    fine but more fragile to quoting/cd mistakes.
  - *Where the mechanics live:* per-scenario JUDGE.md vs. shared role-prompt manual. Chose the
    shared manual (reusable, keeps briefs human-language and scenario-specific, keeps core clean).
- **Rationale:** This realizes the owner's "everything in human-friendly language like the e2e
  tests" while keeping the flaky parts (LLM following prose) backed by exact, reusable command
  templates and a wrapper that removes the most likely failure mode. The deterministic infra the
  judge can't be trusted to do reliably stays in the harness.
- **Current:** harness pre-creates the post and hands a URL via `SKILLSMITH_JUDGE_URL`.
  JUDGE.md (counter) already reads fairly human ("Load the post... click Increment") but
  relies on the harness having inserted the block. Target: judge itself activates plugin,
  inserts the produced block(s), opens the page, checks — all from JUDGE.md, with a reliable
  WP-CLI/env bridge (env vars + shared judge role-prompt "environment manual" with exact
  command templates). Harness keeps boot/build/install/clean-slate deterministic.
- **To research:** what does the judge need to reliably run `wp-env run cli wp ...` from its
  cwd (judge copy) — does the judge cwd have access to `npx wp-env`/the project root? What is
  the minimal env-var set after env-once (no per-pair post id; instead slug + base URL +
  a way to create/open a page)? Where does the "environment manual" live — `roles.judge.prompt`
  (config.ts) injected via `buildJudgeSystemPrompt` `# Role instructions`.
- **Bridge constraint (analyst-confirmed):** the judge runs with `cwd = judgeWorkspace =
  <agent-dir>/judge-workspace` (agent-loop.ts:162), NOT the testing-project root where
  `node_modules/.bin/wp-env` and `.wp-env.json` live. So a raw `npx wp-env run cli wp ...` from
  the judge's cwd would not resolve the project. The bridge must give the judge a
  cwd-independent way to run WP-CLI. Options: (a) export `SKILLSMITH_PROJECT_ROOT` and tell the
  judge (in the role-prompt "environment manual") to `cd` there or pass it as the working dir
  for its Bash commands; (b) ship a tiny wrapper script (absolute path exported as an env var,
  e.g. `SKILLSMITH_WP_CLI`) that internally `cwd`s to the project root and runs
  `wp-env run cli wp "$@"` — the judge calls `"$SKILLSMITH_WP_CLI" plugin activate <slug>` etc.;
  (c) tell the judge to invoke `wp-env run cli` with an explicit project-root via wp-env's
  `--` / cwd flags. Currently NO JUDGE.md invokes wp-env/wp at all — the harness does it. This
  is a genuine new capability surface for the judge. Decision pending researcher confirmation of
  what wp-env supports cleanly.

### Topic: Block-name un-enforcement + slug determinism (testing-project)

- **Spec link:** Requirement 10; Acceptance criterion 7.
- **Status:** DECIDED.

- **Decision:**
  1. **Scaffold the plugin SHELL + a name-neutral starter block, but stop pinning the block
     name.** Keep `index.php` (already name-agnostic — globs `build/blocks/*` then `src/blocks/*`,
     scaffold-plugin.ts:54-66) and `package.json` (slug-named, deterministic). Keep scaffolding a
     starter `src/blocks/<dir>/block.json` so `wp-scripts build` has a discoverable entry, but
     either (a) give it a generic placeholder `name` the agent is free to change, or (b) leave the
     `name` for the agent to set. Preference: keep a starter block dir (lowers agent burden,
     keeps "implement inside this scaffold" framing) with a placeholder name the agent MAY rename;
     do not enforce it. The plugin **slug** (`plugin-<scenario>-<agent>`) stays deterministic and
     unchanged (used for `wp plugin activate`).
  2. **Drop the block-name constraint in `testing-agent.md`** (lines 5-7 currently forbid renaming
     the block / changing registration). Reword to: implement inside the scaffold, keep the plugin
     as-is, but you may name/structure the block(s) as the task needs. Keep the
     `get_block_wrapper_attributes()` guidance (it's name-independent and still good practice).
  3. **Judge discovers block name(s) from `block.json` and inserts each.** After build, the judge
     globs `build/blocks/*/block.json` in its judge copy, reads each `name`, and inserts a
     `<!-- wp:NAME /-->` (or attribute form) per block. Supports multiple blocks. (Covered
     operationally in Topic 3.)
  4. **Remove the harness's fixed-name post creation.** `testPostContent()` /
     `TESTING_BLOCK_NAME` (wp-env-judge.ts:19-20, 105-107) are deleted — the judge inserts blocks
     by discovered name instead.

- **Why this works (grounded):** `wp-scripts build` discovers blocks by scanning `src/**/block.json`
  (no fixed-name dependency) and copies `block.json` to `build/` preserving `name`; `index.php`
  registers any block dir name-agnostically. So nothing downstream depends on the fixed name once
  the scaffold and brief stop imposing it. The slug stays the deterministic activation key.
- **Trade-off:** keeping a starter block dir (option a) vs. scaffolding only the plugin shell
  (agent creates all blocks). Chose keep-a-starter to minimize agent variance and keep the build
  reliably non-empty; the placeholder name is explicitly non-binding.
- **Current:** `scaffold-plugin.ts` hard-codes `BLOCK_NAME = 'skillsmith/testing-block'`
  in `block.json` (line 4, 71-85) and scaffolds `src/blocks/testing-block/`. testing-agent.md
  forbids renaming the block. `testPostContent()` (wp-env-judge.ts:105) embeds the fixed block
  name. Plugin **slug** is `plugin-<scenario>-<agent>` (scaffold-plugin.ts:21) — keep deterministic.
- **Target:** stop forcing the block name; judge discovers produced block name(s) from
  `block.json` and inserts them; support multiple blocks; slug stays deterministic for activation.
  Touches: scaffold (don't pin block name / maybe don't pre-create a block dir at all?),
  testing-agent.md (drop the name constraint), wp-env-judge `testPostContent` (judge inserts
  instead of harness), JUDGE.md (discover + insert).
- **To research:** does the scaffold still need to create a block at all, or just the plugin
  index.php + package.json? How does the judge discover block name(s) — glob `block.json`
  under the built plugin and read `name`? Does index.php's `register_block_type` loop already
  support multiple/any-named blocks (yes — it globs `build/blocks/*`)?

### Topic: testing-project conversion (rubrics folder + slim JUDGE.md)

- **Spec link:** Requirement 11; Acceptance criterion 8.
- **Status:** DECIDED — depends on the rubrics-by-id core decision (Topic 1).

- **Decision:**
  1. **Restore `testing-project/eval/rubrics/wp-interactivity-api-best-practices.md`** from git
     `03535e0^` (content already verified identical to the inlined block). Rubric id =
     `wp-interactivity-api-best-practices` (matches the filename → flat `<id>.md`).
  2. **Configure `paths.rubrics`** in `testing-project/skillsmith.config.ts` to `./eval/rubrics`
     (or rely on the conventional default if it matches). `check:config` must stay green (the
     optional `paths.rubrics` type must accept it — covered by Topic 1's `Paths.rubrics?: string`).
  3. **Each JUDGE.md gets a `# Rubrics` section** listing `- wp-interactivity-api-best-practices`,
     and the inlined `## Best-practices rubric` block (the ~37 lines) is DELETED from all 11.
  4. **Slim each JUDGE.md** to: a short grading intro, a human-language setup/`## Live checks`
     section (activate plugin / discover block from block.json / insert / open / check — per
     Topics 2-3), the scenario-specific behavioral asserts, and the `# Rubrics` id. Drop the
     `## Environment` env-var list that references the now-removed pre-made-post vars; replace with
     the new bridge facts (Topic 3).
- **Rationale:** This is a near-mechanical restore + reference-swap; the rubric content already
  existed and is uniform, so lifting it to one file and referencing by id removes the 11x
  duplication exactly as the spec intends. It exercises the new core rubrics-by-id path end to end
  (proving AC 1/8).
- **Note:** AC 9 / Req 14 — full behavioral verification is MANUAL; the pipeline does at most a
  single scenario × single agent sanity check. The conversion's correctness (rubric injected,
  block discovered/inserted, env booted once) is validated manually, with deterministic gates
  (typecheck, lint, unit, `check:config`, changeset) green. Do NOT design a full-suite-green gate.
- **Current:** the best-practices rubric (counter/JUDGE.md lines 24-60) is inlined identically
  across all 11 JUDGE.md files. Target: restore to `rubrics/` folder, every scenario references
  by id, inlined text removed, JUDGE.md slimmed to human-language setup + rubric id(s).
- **To research:** confirm all 11 JUDGE.md inline the same rubric block (so it lifts cleanly to
  one shared rubric file); identify any per-scenario rubric divergence.
- **Confirmed:** all 11 JUDGE.md carry the same `Best-practices rubric` heading/body; the
  historical `eval/rubrics/wp-interactivity-api-best-practices.md` (git `03535e0^`) is the
  same content with a cleaner intro. Conversion = restore that file + replace each JUDGE.md's
  inlined rubric with a `# Rubrics` id reference. Decision: the shared rubric id is
  `wp-interactivity-api-best-practices` (matches the historical filename).

### Topic: Interfaces and data flow

- **Spec link:** Reqs 1-5, 9; ACs 1-7.
- **Core interfaces (the only public-surface changes):**
  - `Paths` gains `rubrics?: string` (optional). `Scenario` gains `rubrics?: string[]`.
  - New `# Rubrics` section in JUDGE.md (Markdown, same grammar as `# Skills`): a heading
    `# Rubrics` followed by list items, each a rubric id (backtick/link unwrap supported).
    Optional — absent section ⇒ no rubrics.
  - Rubric file format: `<paths.rubrics>/<id>.md` (plain Markdown; md-links followed inside the
    rubrics root). Example id `wp-interactivity-api-best-practices` →
    `eval/rubrics/wp-interactivity-api-best-practices.md`.
  - `loadRubric(id: string, rubricsRoot: string): string` (new; mirrors `loadSkill`).
  - `buildJudgeSystemPrompt` signature gains the resolved rubric blob (or `runJudgeAgent`
    assembles it and passes it through) — internal, not user-facing.
  - Verdict shape UNCHANGED: `{ pass: boolean, notes: string }` (AC 4).
- **Core data flow (rubrics):** JUDGE.md `# Rubrics` → `parseRubricsSection` (enumeration) →
  validate ids vs. `<rubricsRoot>/<id>.md` → `Scenario.rubrics` (ids) → (judge dispatch)
  `loadRubric` per id → rubric blob → `buildJudgeSystemPrompt` `sections` → judge system prompt.
  Unknown id → appended to `EnumeratedScenario.error` → scenario skipped + fails aggregate.
- **testing-project bridge interface (project-level, not core):**
  - Env vars exported by the per-pair hook to the judge: `SKILLSMITH_PROJECT_ROOT`,
    `SKILLSMITH_PLUGIN_SLUG`, and the wp-env port (e.g. `SKILLSMITH_WP_PORT`). DROPPED:
    `SKILLSMITH_JUDGE_URL`, `SKILLSMITH_POST_ID` (judge derives these itself).
  - `eval/utils/judge-wp.mjs` (new wrapper): `node judge-wp.mjs <wp args>` →
    `npx wp-env --config "<PROJECT_ROOT>/.wp-env.json" run cli wp <args>`.
  - `.wp-env.json` (hook-owned, gitignored): `{ "plugins": [], "mappings": { "wp-content/plugins":
    "<PROJECT_ROOT>/.wp-env-plugins" }, "port": 8987 }`.
- **testing-project data flow (per pair):** testing agent writes plugin into agentWorkspace →
  judge copy made → hook builds (`wp-scripts build` in judge copy) → copies `<slug>/` into the
  bind-mounted staging dir → `wp plugin deactivate --all` + `wp plugin activate <slug>` → judge
  reads `<slug>/build/blocks/*/block.json` (own cwd) → `wp post create ... --porcelain` →
  open `http://localhost:8987/?p=<id>` → checks → emits `{ pass, notes }`.

### Topic: Dependencies

- **Spec link:** Boundaries (Req 12); Out-of-scope (no runtime swap).
- **No NEW external dependencies.** Everything uses what's already present:
  - Core: Node `fs`/`path` only (mirrors `skill-loader.ts`/`enumerate.ts`). No new npm packages.
  - testing-project: `@wordpress/env ^11.4.0` and `@wordpress/scripts ^32.2.0` (already deps),
    Playwright MCP + Bash/Read for the judge (already configured, config.ts:36-43). Docker (already
    required by wp-env).
- **Internal dependencies the design leans on (unchanged contracts):** the per-scenario `error`
  channel + skip-and-fail-aggregate flow; the `SerialMutex` judge lock; the run-level
  `beforeAllScenarios`/`afterAllScenarios` and per-pair `beforeJudgeAgent`/`afterJudgeAgent`
  hooks; the claude-code provider's `process.env` passthrough; wp-env's `--config`/`mappings`
  behavior. All verified against the installed source / current code.
- **Call out:** the only core surface ADDED is optional `paths.rubrics` + `Scenario.rubrics` +
  `loadRubric` + the `# Rubrics` parse/inject. No core run-lifecycle change (Req 12).

### Topic: Failure modes and observability

- **Spec link:** Reqs 3, 9; ACs 3, 6, 9.
- **Unknown rubric id:** surfaced as a per-scenario `error` (`unresolved reference: rubric
  "<id>"`), logged via `tracker.scenarioSkipped` + `[error: ...]` (pipeline.ts:320-322, 377), no
  throw, scenario runs no agents and fails aggregate (AC 3). Same observability as unknown skill.
- **Missing rubrics dir while a rubric is referenced:** manifests as every referenced id failing
  `existsSync` → per-scenario unknown-rubric error (graceful). If `checkPaths` is given a
  conditional rubrics check, a declared-but-missing dir fails fast at run start with a clear path
  error (consistent with skills/scenarios path checks).
- **wp-env boot failure (Docker down / port busy):** thrown from the run-level
  `beforeAllScenarios`; surfaces at run start before any pair. Stale instance on the fixed port:
  the `booted` singleton + idempotent boot should detect/reuse-or-restart.
- **Per-pair install/activate failure:** `wp plugin activate` non-zero throws in
  `beforeJudgeAgent` (under the serial lock) — fails that pair's judge phase; the existing
  judge-phase error classification records it. The diff-guard (agent-loop.ts:294-306) still
  protects the canonical workspace.
- **Judge fails to discover/insert/open (LLM flakiness):** the judge's `{ pass: false, notes }`
  (or unparseable → `{ error: 'unparseable', raw }`) records it; notes explain. Mitigated by the
  role-prompt manual + wrapper.
- **Teardown failure (`wp-env stop` errors):** wrapped in try/catch, logged not thrown, so
  `afterAllScenarios` returns nothing (pass) and the run isn't failed by teardown noise. Risk:
  teardown skipped entirely if the sweep throws uncaught (see Risks).
- **Observability of rubric injection:** the resolved rubric content is part of the judge system
  prompt; the judge's stored review (notes) reflects grading against it. No separate per-rubric
  structured output (AC 4) — by design.

### Spec coverage cross-check

Every spec requirement and acceptance criterion is served by a decision/component above:

- **Req 1 / AC 1** (rubric resolution + injection) → Topic: Rubrics-by-id, decisions 1-4.
- **Req 2 / AC 2** (optional) → Rubrics-by-id decision 1 (absent `# Rubrics` ⇒ no rubrics).
- **Req 3 / AC 3** (unknown id → per-scenario error) → Rubrics-by-id decision 2 (mirrors
  unknown-skill path).
- **Req 4 / AC 4** (verdict unchanged) → Rubrics-by-id decision 4 (verdict stays `{pass,notes}`).
- **Req 5** (optional rubrics path, required when used) → Rubrics-by-id decision 5 + Open Q1/Q2.
- **Req 6 / AC 5** (boot once) → Topic: env-once, run-level `beforeAllScenarios` boot.
- **Req 7** (per-pair install + clean slate, judges serial) → env-once `beforeJudgeAgent`
  install/deactivate-all/activate under the serial lock.
- **Req 8** (helper simplified) → env-once decision (helper sheds per-pair boot/teardown/post).
- **Req 9 / AC 6** (judge-driven setup) → Topic: human-language setup, decisions 1-4.
- **Req 10 / AC 7** (free block name, multiple blocks, deterministic slug) → Topic: block-name
  un-enforcement, decisions 1-4.
- **Req 11 / AC 8** (testing-project conversion) → Topic: testing-project conversion, decisions
  1-4.
- **Req 12** (only core change is rubric support) → Components (core changes are rubric-only;
  env-once is testing-project hooks); Dependencies.
- **Req 13** (changeset extends existing) → Open Q7 (resolved instruction) + Research/changeset.
- **Req 14 / AC 9** (manual testing posture, deterministic gates green) → conversion note +
  Risk 5; no full-suite-green gate designed.

## Open Questions

These are sub-questions deferred to the implementation/plan phases — flagged, not blocking.

1. **`checkPaths` trigger for "rubrics required only when used."** Two candidate contracts:
   (a) require the rubrics dir to exist only when at least one selected scenario references a
   rubric (precise but couples `checkPaths` to enumeration results); (b) don't existence-check
   the dir at all in `checkPaths` and rely solely on the per-scenario unknown-rubric-id error
   (simpler; an unknown id already fails its scenario clearly). Leaning (b) — it matches the
   unknown-skill model (which validates per-id at enumeration, not the skills dir in
   `checkPaths`) and keeps `checkPaths` simple. The plan should pick one and update the two
   guard tests accordingly.
2. **Default value of `paths.rubrics`.** Set a conventional default in `normalizeConfig`
   (e.g. `./eval/rubrics`) so convention-following projects need no config, OR leave it
   `undefined` and require projects that use rubrics to declare it. Leaning: provide a
   conventional default but keep existence conditional (so a project that never uses rubrics and
   has no such dir still passes). Interacts with Q1.
3. **Rubric injection heading + whether to strip `# Rubrics` from the brief.** Decided: leave
   the section in the brief (precedent), inject under a clear heading (e.g. `# Grading rubrics`).
   The exact heading text is a writer/plan detail.
4. **WP-CLI bridge form: env-var manual vs. wrapper script.** Decided to lead with env vars +
   role-prompt manual (confirmed mechanically sound). Whether a tiny wrapper script is also
   shipped for robustness is a plan-phase call, pending the researcher's confirmation of
   `npx wp-env run cli` cwd/flag behavior (Topic 3, in flight).
5. **Starter block in the scaffold: placeholder-named block dir vs. plugin-shell-only.** Decided
   keep a starter block dir with a non-binding placeholder name; the plan may revisit if the
   testing agent reliably creates blocks from scratch.
6. **Multiple-block insertion semantics in JUDGE.md.** The judge inserts every discovered block;
   for scenarios that expect exactly one, the human-language brief should say so. Per-scenario
   brief wording is a writer detail.
7. **Changeset (RESOLVED to a concrete instruction):** extend the existing base changeset
   `.changeset/flexible-scenarios-judge-verification.md` (bump `@automattic/skillsmith: minor`,
   summary `BREAKING: Redefine scenarios as TESTING-AGENT.md + JUDGE.md ...`). It already
   documents `Paths` DROPPING `paths.rubrics`, so the review's edit folds in coherently: amend
   that sentence to "drops then restores `paths.rubrics` as OPTIONAL" + add the reusable
   rubrics-by-id note. Keep it `minor`. Note: only `src/**` core changes trigger a version bump
   (`.changeset/config.json:15-22` `changedFilePatterns`); the testing-project env-once /
   human-language / free-block-name changes are testing-project-only and do NOT bump the package
   — so the rubric support is the only release-relevant change. Do NOT add a second, contradicting
   changeset.

## Risks

1. **`afterAllScenarios` teardown skipped if the scenario sweep throws uncaught.** The sweep's
   `catch` rethrows (pipeline.ts:406-409), bypassing `afterAllScenarios` and leaving wp-env
   running. Mitigation: make boot idempotent (a stale container on the fixed port is detected and
   reused/restarted), and/or add a backstop stop in `afterAll`/`afterIteration`, and/or document
   a manual `wp-env stop`. Per-scenario errors do NOT trigger this (they're caught) — only an
   uncaught throw out of a hook/agent does.
2. **`beforeAllScenarios` re-fires per iteration under self-improvement.** Safe today
   (`test-only` ⇒ 1 iteration), but if the project ever switches to self-improvement, booting in
   `beforeAllScenarios` would double-boot. The brief specifies `beforeAllScenarios`; mitigation is
   the `booted` singleton flag (idempotent boot) — which also covers Risk 1's restart case. The
   genuinely run-once hooks are `beforeAll`/`afterAll`.
3. **Docker availability / first-pair latency.** Env-once pays one boot up front, kept warm —
   better aggregate cost but the first pair waits for the boot. wp-env requires Docker; absence is
   a hard failure surfaced at boot. Acceptable per the manual posture.
4. **Live bind-mount + WP plugin discovery timing.** The design relies on a plugin copied into the
   bind-mounted host dir being immediately visible to `wp plugin activate <slug>`. Source-verified
   as a live Docker bind-mount, but not empirically booted in this phase (manual posture).
   Mitigation: the plan should include a single-scenario manual sanity check booting wp-env and
   activating a copied-in plugin.
5. **Judge reliability for human-language setup.** Shifting block-insertion + page-open from the
   deterministic harness to the LLM judge trades determinism for simplicity. A flaky judge could
   fail to insert/open correctly. Mitigation: precise command templates in the role-prompt
   "environment manual"; keep the deterministic infra (boot/build/install/clean-slate) in the
   harness. This is an explicit, owner-requested trade (intent.md).
6. **Stale `.wp-env.json` / staging dir from a crashed prior run.** The run-level boot writes
   `.wp-env.json` and a staging dir; a crash could leave them. Mitigation: boot should clean/recreate
   the staging dir and overwrite `.wp-env.json` defensively (the old per-pair code already treated
   `.wp-env.json` as hook-owned and gitignored).
7. **Two-track coupling at the judge prompt.** The rubric injection (Track A, core) and the
   human-language brief (Track B, project) meet in the judge system prompt. The rubric content and
   the brief must compose cleanly (no heading collisions, no contradictory instructions). Low risk
   (additive sections) but the writer should sanity-check the assembled prompt order.
