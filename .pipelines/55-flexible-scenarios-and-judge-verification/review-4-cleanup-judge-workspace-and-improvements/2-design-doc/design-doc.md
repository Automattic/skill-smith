# Design Doc: Unified cleanup, judge library, and centralized decision rule

## Overview

Skillsmith (this repository, published as `@automattic/skillsmith`) evaluates coding agents: per scenario, a testing agent builds against a task brief (`TESTING-AGENT.md`) and a judge agent grades the result against a judge brief (`JUDGE.md`). Today the judge's system prompt is assembled from five sources in `src/pipeline/judge-agent.ts`: the verbatim brief, the skill-stripped testing task, a `{ pass, notes }` output instruction, every rubric loaded from `paths.rubrics` behind a selection lead-in ("apply only the rubric(s) the brief refers to"), and `roles.judge.prompt` — an environment manual that lands last. All 11 bundled briefs open with a byte-identical all-must-pass decision-rule line, pinned per brief by a conformance test. The branch (issue #55 / PR #56) also carries churn residue from four pipeline runs: dead code, and tombstone tests that pin repository *history* rather than behavior — one of which is guaranteed to break CI on unrelated future work.

This revision does three mandated things and two opportunistic ones. Mandated: (1) a verified, behavior-neutral cleanup of every audited churn finding; (2) replacement of the two judge-material channels (`roles.judge.prompt` + `paths.rubrics`) with a single judge-scoped directory, `roles.judge.library`, supplied to every judge via a two-tier mechanism (entry `README.md` inlined as the manual; the whole directory copied per pair into the judge's working directory); (3) the all-must-pass decision rule stated once, in the harness output instruction, as an overridable default — the 11 briefs drop their repeated opener. Opportunistic, riding the same breaking wave: removal of the write-only `RunScenario.dirName` alias, and a `judging: { duration, tokenUsage? }` block in the per-pair report. Every one of the audit's twelve improvement proposals (plus the `dirName` question) receives an explicit disposition; the design's disposition table is the system of record for them.

## Approach

The revision is three independent tracks that share files but not behavior, plus two small riders:

1. **Cleanup (behavior-neutral).** Delete dead code (`setUpJudgeEnv`/`tearDownJudgeEnv`, `testing-project/eval/utils/wp-cli.mjs`), the tombstone tests that pin them, the history-scanning test files (`feature-changeset.test.ts`, `testing-project-e2e-removal.test.ts`, `selection-duplicate-name-guard-removed.test.ts` — its one live test relocated), the negative-assertion cohort, stale pivot-era wording, and the orphaned workflow PNG. Apply the verification-confirmed core simplifications (shared skills-section scanner, dead judge params, merged enumeration tests, unified comparator and file-inlining helper, `judgePluginSlug` alias removal). Every finding was re-verified against the code before this plan was fixed; where verification refuted or corrected a report claim, the corrected verdict is recorded below. Nothing observable changes — the one behavior change the spec sanctioned (the `loadAllRubrics` self-reparse fix) goes **unused**, because the library track retires the rubric loader entirely.

2. **The judge library.** A new config key `roles.judge.library` names a project-relative directory that users fill with anything — environment manual, rubrics, reference docs, helper scripts. Its entry file `README.md` (optional) is inlined into every judge prompt as the environment manual, replacing `roles.judge.prompt`. The whole directory is copied per pair into the judge's working directory at `judge-workspace/judge-library/`, announced by a sorted manifest in the prompt, replacing `paths.rubrics` and its load-everything inlining. Briefs opt into specific material by naming exact relative paths (e.g. `judge-library/rubrics/wp-interactivity-api-best-practices.md`). Judges with no file-reading tool get the whole library inlined instead. The two removed config keys are rejected **loudly** at validation time with a migration message. The bundled testing-project migrates: manual → `eval/judge/README.md`, rubric → `eval/judge/rubrics/`, config swapped to `library: './eval/judge'`; the wp-cli bridge script deliberately stays at `eval/utils/judge-wp.mjs`.

3. **The centralized decision rule.** The all-must-pass rule moves from 11 brief openers into the harness output instruction, phrased as a default with an explicit override clause: a brief stating its own decision rule in prose wins. The briefs drop the entire opener line; their check content is otherwise untouched. The conformance test follows the new contract and stays a format contract, never a coverage checker.

**Riders:** `RunScenario`/`EnumeratedScenario`/`ScenarioRunRecord` lose the never-read `dirName` field (small mechanical breaking change on the already-mandatory breaking wave), and the per-pair `report.json` gains `judging: { duration, tokenUsage? }` beside `testing` (the judge's token usage is currently dropped on the floor and its duration is tracker-only).

**Standing constraints, restated for every downstream phase:**

- **Coverage parity is untouchable (R6, AC6).** Each brief's code checks, behavior checks (including the two conditional-fallback bullets and three setup bullets), and the rubric check remain the same check set as review-3's, verified by the pipeline's reviewers against `origin/trunk` sources — never encoded in tests or mapping artifacts. The only brief edits this design permits are: delete line 1 (the opener), and re-point the rubric sentence to the path form (same sentence slot, same check).
- **Grading material reaches judges only (R3, AC3).** The testing agent's prompt assembly (`src/pipeline/testing-agent.ts`) is untouched; it has zero references to rubrics, judge briefs, or the judge manual today, and the library adds no path to it.
- **Cleanup is behavior-neutral (AC2).** Comparing behavior before/after the cleanup commits, nothing observable changes — including the sanctioned rubric-loader fix, which is superseded by the loader's retirement rather than applied.
- **Pre-1.0 breaking policy (R7, AC8).** Breaking changes are recorded as `minor` changesets with a `BREAKING:` summary prefix; `major` is rejected pre-1.0.

## Components

### New

- **`src/pipeline/judge-library.ts`** (+ its test) — owns the library mechanics: the tool-less predicate, the per-pair copy with collision guard, and building the `# Judge library` prompt section (inlined README + manifest or inline fallback + selection/failure instruction). Interface sketch under "Interfaces and Data Flow".

### Modified

- **`src/config/types.ts`** — judge input type becomes `{ agent, library?, concurrency? }`; improver keeps `{ agent, prompt? }`; test keeps `prompt` (the shared `SingleRoleInput` can no longer express judge and improver truthfully, so the input type splits). `Paths` loses `rubrics`. `RunScenario` / `EnumeratedScenario` / `ScenarioRunRecord` lose `dirName`.
- **`src/config/validate.ts`** — gains explicit rejection of the two removed keys (`paths.rubrics`, `roles.judge.prompt`) with a migration message pointing at `roles.judge.library`; gains a string check for `library`.
- **`src/config/normalize.ts`** — judge role carries `library` through normalization.
- **`src/pipeline/pipeline.ts`** — `checkPaths` gains the library existence gate (configured `roles.judge.library` must exist and be a directory).
- **`src/pipeline/judge-agent.ts`** — prompt assembly per the new section layout; the decision-rule default added to the output instruction; `RunJudgeAgentParams.agentWorkspace` (never read) and `buildUserMessage`'s unused scenario param removed; the internal `loadAllRubrics` call replaced by a section-text parameter; returns judge usage so the report can persist it. Stays a pure prompt assembler.
- **`src/pipeline/agent-loop.ts`** — performs the per-pair library copy inside the judge mutex bracket (beside the existing workspace copy, before `beforeJudgeAgent`); writes `judging: { duration, tokenUsage? }` into `report.json`.
- **`src/index.ts`** — exported type surface follows the config changes.
- **`src/scenarios/enumerate.ts`** — shared `findSkillsSectionBounds` extracted; `dirName` construction removed; comparator unified on `compareScenarioIds`.
- **`src/__tests__/testing-project-scenarios.test.ts`** (conformance test) — new invariant set and rewritten header (see Key Decisions).
- **Testing-project** — `skillsmith.config.ts`, the 11 `JUDGE.md` briefs, `eval/` layout (see the migration decision).
- **Test refits** — the blast radius identified in research: `judge-agent.test.ts` (role-instructions pair, rubric-section trio, `paths.rubrics` trio die; testing-task placement, no-rubric scaffolding, output-instruction content refit), `check-paths.test.ts` (library gate), `testing-project-judge-config.test.ts` (library key), `core-types.test.ts` (Paths shape), plus the cleanup-cohort reframes.

### Deleted

- `src/scenarios/rubric-loader.ts` + `rubric-loader.test.ts` — orphaned by the library (its only non-test caller was the judge agent's load-all call). Implementation verifies whether any of its symbols are re-exported via `src/index.ts`; if so, the removal is named in the breaking changeset.
- `src/__tests__/feature-changeset.test.ts`, `testing-project-e2e-removal.test.ts`, `selection-duplicate-name-guard-removed.test.ts` (live test relocated first).
- `testing-project/eval/utils/wp-cli.mjs`; the dead `setUpJudgeEnv`/`tearDownJudgeEnv` pair; `testing-project` `env:start`/`env:stop` npm scripts; `assets/skill-tester-workflow.png`.
- `RUBRIC_SELECTION_LEAD_IN` (its surviving semantics move into the library section's instruction line).

### Untouched but relevant

- `src/pipeline/testing-agent.ts` — the grading-leak invariant lives here; no library material flows in.
- `src/pipeline/workspace-snapshot.ts` — `copyWorkspaceForJudge` (recursive `cpSync`) and `snapshotWorkspace` (recursive file walker) are reused as-is for the library copy and manifest.
- Providers (`claude-code`, `codex`, fs-tools-backed API providers) — no capability-semantics change; the tool-less predicate reads existing `capabilities.tools` only.
- Verdict parsing (`src/reports/verdict.ts`) and scenario aggregation (`scenario-report.ts`) — the `judging` block flows through aggregation with zero changes.

## Interfaces and Data Flow

### Config surface (before → after)

```ts
// BEFORE
roles: { judge: { agent, prompt?, concurrency? } }   // prompt = environment manual, inlined last
paths: { base, skills, scenarios, rubrics? }          // rubrics dir: every .md loaded + inlined

// AFTER
roles: { judge: { agent, library?, concurrency? } }  // library: project-relative dir path
paths: { base, skills, scenarios }                    // rubrics gone
```

`library` is a project-relative path string resolved against `projectRoot` at point of use — the same convention every `paths.*` value follows today. A config that still sets `paths.rubrics` or `roles.judge.prompt` fails `collectConfigErrors` with a migration message; a configured `library` that is missing or not a directory fails the `checkPaths` start-up gate.

### `prepareJudgeLibrary` (new module's core)

```ts
type JudgeLibrarySection = { text: string; mode: 'mounted' | 'inline' };

// called from agent-loop inside the judge bracket, before beforeJudgeAgent
prepareJudgeLibrary(opts: {
  projectRoot: string;
  libraryPath: string;        // roles.judge.library
  judgeWorkspace: string;     // copy destination parent (the judge cwd)
  capabilities: JudgeCapabilities;  // drives mounted vs inline
}): JudgeLibrarySection | undefined  // undefined: library has no files and no README
```

Division of labor: `agent-loop.ts` owns the per-pair disk lifecycle and passes the built section text into `runJudgeAgent`; `judge-agent.ts` remains a pure string assembler with no filesystem access of its own.

### Judge system prompt (sections joined `\n\n`, conservative order — same slots as today)

1. `scenario.judgeBrief` verbatim (unchanged, still first).
2. `# Testing task` — the skill-stripped testing brief (unchanged).
3. Output instruction — the existing strict-JSON `{ pass, notes }` text, **plus the new decision-rule default**, plus the existing `# Recursion guard`.
4. **`# Judge library`** (present only when `roles.judge.library` is configured; replaces both `# Grading rubrics` and `# Role instructions`):
   - (a) the library `README.md` body inlined verbatim (when present) — the environment manual;
   - (b) the **manifest**: a fixed lead-in naming `judge-library/` in the working directory, plus the sorted list of relative file paths (`judge-library/<rel>`, derived via `snapshotWorkspace`);
   - (c) the **selection-and-failure instruction**: apply only the library items the brief names; if a brief-named item is missing from the manifest or unreadable, fail the verdict and name the missing path in `notes`.
   - In inline-fallback mode (tool-less judge), (b) is replaced by each file's body as `judge-library/<rel>`-labelled blocks.

The judge's user message is unchanged: the testing result's `filesWritten` inlined as `=== <rel> ===` blocks. Because `filesWritten` is computed on the canonical workspace *before* the judge copy is made, the library can never leak into "files written".

### Brief reference form

Briefs name library items by relative path from the judge cwd. The 11 bundled briefs' rubric sentence becomes:

> As a further code check, verify the produced code against `judge-library/rubrics/wp-interactivity-api-best-practices.md`.

Same sentence slot (closing line of `## Code checks`), same check — the R6 check set is untouched. Paths are prose to core: no parsing, no extraction; briefs stay fully opaque (mechanical enough for a future `lint` command, dispositioned separately).

### Data flow (per pair)

testing agent runs in `workspace/` → `filesWritten` computed on the canonical workspace → judge mutex bracket: `workspace/` copied to `judge-workspace/` → **library copied to `judge-workspace/judge-library/` (pair fails loudly on a top-level `judge-library` collision in the artifact)** → `beforeJudgeAgent` (hooks see both directories) → judge invoked with cwd `judge-workspace/`, system prompt as above, user message = `filesWritten` inlined → verdict parsed → `report.json` = `{ testing, judging, review }` → `afterJudgeAgent` / `cleanUpPair`.

### Per-pair report (`report.json`)

```jsonc
{
  "testing": { "duration": ..., "tokenUsage": ... },   // unchanged
  "judging": { "duration": ..., "tokenUsage": ... },   // NEW; tokenUsage optional (provider-dependent)
  "review":  { "pass": ..., "notes": ... }             // unchanged
}
```

## Key Decisions

### Decision: Config key is `roles.judge.library`, not "workspace", not under `paths`

- **Choice:** `roles.judge.library` — a project-relative path string; the on-disk per-pair copy is named `judge-library/`.
- **Alternatives:** (1) `roles.judge.workspace` — the owner's literal word; (2) `paths.judgeLibrary` — keeps path-valued config under `paths`.
- **Trade-offs / evidence:** The owner delegated the name with the collision concern on record, and research showed the collision is real, not hypothetical: `judgeWorkspace` is a prominently author-facing identifier — a public exported type field (`AgentContext.judgeWorkspace`, `src/config/types.ts`) that every hook author destructures, used in 11 author-facing README lines (hook signatures, isolation-guarantee prose, examples), destructured in both judge hooks of `examples/skillsmith.config.ts`, and read by the reference implementation (`wp-env-judge.ts`). A config key named "workspace" would denote a *different* directory with a *different* lifecycle in the very same sentences. `library` (and the dirname `judge-library/`) is unclaimed across src/, README, docs/, and examples, describes the content (a library of reference material), and lets config, prompt, briefs, and docs share one word. Placement under `roles.judge` (not `paths`) groups the key with the judge's other knobs and puts the replacement exactly where the replaced `roles.judge.prompt` lived — the migration reads as a substitution. Nothing structural binds path resolution to the `paths` parent: all path values resolve at point of use against `projectRoot`.
- **Consequence:** the config input type splits — judge `{ agent, library?, concurrency? }`, improver keeps `{ agent, prompt? }`, test keeps `prompt`. Without the split, TypeScript would keep accepting `roles.judge.prompt`, contradicting the loud validate-time rejection.
- **Traces to:** R3 open point 1; AC3.

### Decision: Two-tier supply, copied per pair *inside* the judge cwd

- **Choice:** Tier 1 — the library's entry file `README.md` is always inlined into the judge system prompt (the environment manual, replacing `roles.judge.prompt`; optional like the prompt it replaces — absent means the manual portion is simply omitted). Tier 2 — the *whole* library directory (README included; a faithful mirror is simpler than an exclusion rule) is copied per pair to `<agent-dir>/judge-workspace/judge-library/` using the existing `copyWorkspaceForJudge` mechanics, inside the serial-mutex bracket beside the existing workspace copy and before `beforeJudgeAgent` so hooks see it. A generated manifest section lists the library's sorted relative paths so the judge knows what exists without globbing. If the copied artifact already contains a top-level `judge-library` entry, the pair fails loudly at copy time rather than silently merging.
- **Alternatives:**
  1. *Inline everything* — uniform across providers, but token cost scales with library size × pairs, inlined helper scripts are dead weight, and it resurrects the need for a selection lead-in.
  2. *Mount only* — zero eager tokens, but the load-bearing environment manual becomes skippable; a judge that never reads the entry file grades blind.
  3. *Two-tier with a sibling copy at `<agent-dir>/judge-library/`* — the improvements reviewer's recommendation, **infeasible as specified**: every fs-tools file operation goes through `resolveInside(cwd, p)`, which rejects any path resolving outside cwd ("a hard jail, not a prompt rule" — verified experimentally by running the verbatim `resolveInside` logic: `../judge-library/...` and absolute paths throw `path escapes workspace`). API-provider judges (anthropic/openai/gemini) always get exactly `{ Read }` with no Bash escape hatch and ignore `capabilities` entirely, so a sibling is *permanently unreachable* for that whole provider class — and because those judges always have a file tool, the tool-less inline fallback would never rescue them. claude-code/codex sibling reads rest on unverified SDK/sandbox behavior.
  4. *Per-run copy instead of per-pair* — ruled out twice: scenario ids can be nested (`blocks/counter`), so a run-level copy has scenario-dependent `../` depth (no uniform brief reference form); and default judge concurrency is parallel while write-capable judges (allowWrite, or any Bash judge) could corrupt a shared copy invisibly — the diff-guard covers only the canonical workspace. Per-pair cost is trivial at current library size.
- **Trade-offs:** Inside-cwd placement means a cwd-globbing judge sees `judge-library/` beside the artifact — the reviewer's stated reason for the sibling. Accepted because the risk is bounded (the user message names exactly the produced files, computed pre-copy, so the library can never appear in "files written"; the manifest section explains what `judge-library/` is) while the sibling's cost is hard infeasibility for a provider class plus SDK uncertainty for the rest. Copying the README twice (inline + disk) costs nothing and keeps the copy rule trivial. Inside-cwd is the only placement every provider can read with zero jail changes, and it makes the brief reference form identical for every provider and every scenario nesting depth.
- **Traces to:** R3 (single judge-scoped directory; supply mechanism open point); AC3, AC4.

### Decision: Tool-less degradation rule

- **Choice:** When the judge cannot read files, the whole library is inlined (each file as a `judge-library/<rel>`-labelled section) instead of copied-and-manifested. Predicate: `capabilities.tools` is an explicit array containing neither `Read` nor `Bash` (the two file-capable tool names in the passthrough vocabulary). When `tools` is unset, provider defaults always include file reading (claude-code defaults to `['Read']`; fs-tools API providers always supply `{ Read }`; the codex read-only sandbox always reads). No new config knob.
- **Alternatives:** a provider-declared capability flag (cleaner, but requires the capability-honesty work dispositioned as a future issue); an explicit config knob (user burden for a corner case).
- **Trade-offs:** The name heuristic is provider-vocabulary-coupled; false positives (e.g. an fs-tools judge with an exotic `tools` list the provider ignores) degrade *harmlessly* to inlining — the judge still receives all material. Documented, and superseded if proposal 11 later gives providers declared capabilities.
- **Traces to:** R3 ("a judge whose capabilities include no file-reading tool still receives the material"); AC4.

### Decision: The selection lead-in dies; its semantics move into the library section

- **Choice:** `RUBRIC_SELECTION_LEAD_IN` is deleted. Its reason to exist — mitigating the load-everything mechanism — is gone: nothing unnamed is inlined anymore. Its surviving semantic content ("apply only what the brief names") becomes one instruction line in the `# Judge library` section, now paired with a new duty: a brief-named item that is missing or unreadable ⇒ fail the verdict and name the path in `notes`.
- **Alternatives:** keep a lead-in over the manifest (redundant with the instruction line); move selection semantics into briefs (would re-multiply a shared rule across briefs, the exact anti-pattern R4 removes).
- **Trade-offs:** none material — no brief references the lead-in wording (verified), so the deletion is invisible to brief content. The upgrade is behavioral: today a mistyped rubric name fails *silently* (the lead-in just deselects it); under this design the same typo produces a manifest mismatch the judge is instructed to report.
- **Traces to:** R3 open point 4 (lead-in fate), R3 missing-item clause; AC4.

### Decision: Observable failure for missing items is layered, earliest-first

- **Choice:** three layers. (1) Config time: `roles.judge.library` pointing at a missing/non-directory path fails the run at the `checkPaths` gate — the directory is opt-in, but once configured it must exist (unlike today's ungated `paths.rubrics`). (2) Validation time: configs still setting the removed keys (`paths.rubrics`, `roles.judge.prompt`) fail `collectConfigErrors` with a migration message — today validation never rejects unknown keys and `paths` is not validated at all, so without this the breaking change would be *silent* (stale keys ignored, judges silently degraded). (3) Judge time: the library section instructs the judge to fail the verdict and name the missing path in `notes` when a brief-named item is absent from the manifest or unreadable. Core parses nothing — briefs stay opaque; no path extraction or lint pass in core (a `lint` command is dispositioned separately).
- **Alternatives:** core-side brief parsing to pre-validate references (breaks the opaque-brief architecture that four runs have preserved and the conformance test's philosophy depends on); relying on the judge's spontaneous mention of read failures (non-deterministic reporting).
- **Trade-offs:** layer 3 depends on instruction-following, but the read failure itself is the detection mechanism — the instruction makes the report deterministic instead of hopeful. Satisfies "verdict notes or earlier" with independent layers.
- **Traces to:** R3 ("must fail observably … never silently"); AC3, AC4.

### Decision: The decision rule lives in the harness output instruction; brief prose overrides

- **Choice:** the default all-must-pass rule is added to the existing output-instruction block in `judge-agent.ts`, phrased as a default with an explicit override clause. Sketch (wording finalized in implementation): *"Decision rule: unless the brief states its own decision rule, return `"pass": true` only if every check the brief asks for — including any rubric check — is satisfied; otherwise return `"pass": false`."* A brief stating a different rule in its own prose wins by construction — the instruction defers to it. The two coverage-protected conditional-fallback bullets (`async-fetch`, `config-fetch`) are *check-level* semantics — they define what satisfying that one check means — and compose cleanly with the default; they are not overrides and are untouched.
- **Alternatives:** (1) the library `README.md` — user-supplied and optional, so projects without a library would silently have no rule; the rule is verdict *semantics* (a harness contract), not project content. (2) A new standalone prompt section — one more section for one sentence, no benefit over the output instruction.
- **Trade-offs:** none found — research confirmed today's output instruction contains no decision-rule sentence (zero redundancy), and no downstream consumer reads the brief-stated rule (verdict handling reads only judge output; improver context carries judge `notes`, not brief text). Eleven copies collapse to one; drift becomes impossible; a brief keeps the last word.
- **Traces to:** R4; AC5.

### Decision: The 11 briefs drop the entire opener line; the framing sentence relocates to the manual

- **Choice:** all 11 briefs delete line 1 wholesale — both sentences of the byte-identical opener ("Judge the produced work against the checks below, using both the produced source files and the live, running site. Pass only if every check, including the rubric check, is satisfied."). The decision-rule sentence is replaced by the core default above. The framing sentence's methodological content ("using both the produced source files and the live, running site") is project-specific judging guidance — a "live, running site" is a WordPress-project fact, not a harness fact — and merges into the testing-project's library `README.md`, whose intro already half-states it ("Use it to verify the block's real behavior in addition to reading the produced source files"). Check content below the opener is untouched.
- **Alternatives:** drop only the second (rule) sentence — leaves a scenario-invariant boilerplate line in 11 briefs, which is the pattern being removed.
- **Trade-offs:** the relocation is flagged explicitly for the pipeline's coverage reviewers (the opener was never a check, so the check set is unaffected; reviewers verify against `origin/trunk` as always).
- **Traces to:** R4, R6; AC5, AC6.

### Decision: Conformance test — new invariant set, still a format contract

- **Choice:** in `src/__tests__/testing-project-scenarios.test.ts`:
  - **Keep** tests 1–4 wholesale (files exist / no legacy files; all 11 enumerate with skills `['wp-interactivity-api']`; anchors match the scenario set; TESTING-AGENT invariants) and template invariants 1 (check headings), 3 (rubric-body sentinel not inlined), 4 (no `{ "pass" }`-shaped JSON pre-statement), 7 (no `# Rubrics` heading).
  - **Tighten** invariant 2 from a bare-id `includes()` to the path form (`judge-library/rubrics/wp-interactivity-api-best-practices.md`) — same strength of template contract, new reference form. (The old assertion would still *pass* against the path form, but its "bare id" meaning goes stale — tightening keeps the assertion honest.)
  - **Remove** invariant 6 (the opener regex — the only code asserting the opener; the rule no longer lives in briefs), and invariant 5 + test 6 (cleanup tombstones: removed-env-var scan, `_candidates.yaml` scan).
  - **No inverse assertions are added.** "Briefs do not contain the opener" would be a new negative/tombstone test — the exact pattern the cleanup purges; the opener's absence is verified once by this revision's reviewers.
  - **Rewrite the file header** to describe the new template: path-form rubric reference, decision rule owned by the harness output instruction, manual/library supplied at judge time.
- **Alternatives:** relocate the opener invariant to assert the rule's presence in the harness output instruction — that belongs in `judge-agent.test.ts` (unit test of the assembler), not the scenario format contract.
- **Traces to:** R4 ("the conformance test follows the new contract … remains a format contract — never a coverage checker"); AC5.

### Decision: Testing-project migration — layout, merges, and the bridge that stays

- **Choice:**
  - `eval/judge/` is the library (`roles.judge.library: './eval/judge'`):
    - `eval/prompts/judge.md` → `eval/judge/README.md`. Content edit: merge the briefs' dropped framing sentence into the intro line that already half-states it — a merge, not an append. Everything else (env-var list, `## Running WP-CLI` bridge usage, post-publish walkthrough, rendered-post loading) is unchanged; the manual contains no decision-rule/verdict/rubric text, so nothing clashes with the new prompt sections.
    - `eval/rubrics/wp-interactivity-api-best-practices.md` → `eval/judge/rubrics/wp-interactivity-api-best-practices.md`. The rubric is self-contained (zero markdown links — the retired loader's BFS expansion was a no-op for it), so a plain move is behavior-identical. `eval/rubrics/` is then deleted.
  - `skillsmith.config.ts`: drop the `judgePrompt` `readFileSync` boilerplate and `prompt: judgePrompt`; add `library: './eval/judge'`; drop `paths: { rubrics: … }` — with `rubrics` gone the testing-project sets no `paths` overrides, so the whole `paths` block goes. `check:config` executes the config, so a missed edit throws loudly (a built-in tripwire).
  - The 11 briefs: opener line deleted; rubric sentence re-pointed to the path form. No other brief edits.
  - **The bridge script stays at `eval/utils/judge-wp.mjs`.** The reviewer's "optionally move it into the library" amendment is **rejected**: the script self-locates its project root via `import.meta.url` and derives `WP_ENV_CONFIG_PATH` from it — load-bearing because wp-env identifies the warm instance by the md5 of the exact config file path. A per-pair copy breaks that derivation (wrong file, wrong md5); fixing it would require an env-var-based root rewrite plus reworking a live behavior test (`judge-wp-bridge.test.ts` pins exactly the self-location property), and the copy's `npx` resolution would silently depend on `paths.base` nesting inside the project. The library holds *reference material*; executable tooling that must run against project infrastructure legitimately lives with the project and stays reachable via `$SKILLSMITH_PROJECT_ROOT` exactly as today. (User libraries *can* carry self-contained scripts — nothing forbids it; this one is not self-contained.)
  - Env plumbing (`SKILLSMITH_PROJECT_ROOT`/`WP_PORT`/`PLUGIN_SLUG`) unchanged — `SKILLSMITH_PROJECT_ROOT` is read by no code; its only consumer is the manual's Bash interpolation, which survives this arrangement. `eval/prompts/testing-agent.md` and `improver.md` unchanged, still wired via `roles.test.prompt`/`roles.improver.prompt`.
- **Alternatives:** relocating the bridge with an env-var root rewrite (cost detailed above, for zero functional gain); keeping the manual at `eval/prompts/` and pointing `library` there (would drag the testing-agent and improver prompts into the judge library).
- **Traces to:** R3 bullet 4; AC3–AC6, AC8.

### Decision: Cleanup plan — per-finding verdicts (verified, behavior-neutral)

Every finding was re-verified against the code; the reports are inventories, not gospel. Verdicts ("delete" = this revision; corrections over the reports are marked):

**Pollution findings (all eleven confirmed, four with corrections/nuances):**

1. **Delete** the dead `setUpJudgeEnv`/`tearDownJudgeEnv` pair and the now-unused `execSync` import (`testing-project/eval/utils/wp-env-judge.ts`) — zero production callers.
2. **Delete** the legacy-export tombstone block in `testing-project-judge-config.test.ts` and its two negative regexes; **keep** the live wiring positives in the same test (a real contract).
3. **Delete** dead `wp-cli.mjs`, its sentinel test, and the stale comment clause (the sentinel's "clean-slate primitive" claim is false in practice — the real call path is `commands.wpCli(...)`).
4. **Delete `feature-changeset.test.ts` outright** (not reduce): every block is a pivot/prose tombstone, guaranteed future CI breakage (fails on first release; its "exactly one feature changeset" assertion is tripped by *this very revision's* mandatory changesets), or redundant — `changeset-gate.yml` runs the real validator over `.changeset/` on every PR, and the validator has its own test. Nothing durable is lost.
5. **Delete `testing-project-e2e-removal.test.ts`** whole file — pure negative space; its only non-duplicated content pins the `env:start`/`env:stop` scripts as "must be retained", which would cement finding 1's dead consumers.
6. **Delete** the retired-symbol scans and env-var negative assertions in `wp-env-judge-lifecycle.test.ts`; the positive assertions fully specify the contract (including the port fact, asserted behaviorally).
7. **Delete** orphaned `assets/skill-tester-workflow.png` (zero references); **keep** `self-improvement-loop.png` (live in README).
8. **Move** the one live nested-leaf selection test to **`scenario-filter-selection.test.ts`** — a *correction* of the report's suggested target (`scenario-selection.test.ts` is CLI-level; the live test is unit-level with the same import) — then **delete** `selection-duplicate-name-guard-removed.test.ts`.
9. **Fix wording** in `scaffold-plugin.ts` (activation is `installPluginForPair`'s job, not "the e2e run").
10. **Rewrite** the `testing-project-judge-config.test.ts` header to the run-level warm-env model; drop its negative greps, keep its positives.
11. Cohort: **delete** the removed-env-var invariant + `_candidates.yaml` test in the conformance file (folded into the conformance refit); **delete** the negative half of `core-types.test.ts` (the positive `Paths` shape test refits under the type change — a library-track casualty, not a tombstone); **keep-with-reframe** the `check-paths.test.ts` key-set assertion (a live defaults contract; positive title; drop the rubrics-undefined probe); `scaffold-block-name.test.ts`: delete the pure source-text tombstones, **reframe the one negatively-phrased-but-behavioral scaffold-output assertion positively** (assert the derived block name, not the absence of the legacy one) or fold it into an existing positive; **delete** the dead-param tombstone in `judge-agent.test.ts` (dies with simplification 9; live payload covered elsewhere); **keep-with-reframe `enumerate-rubrics.test.ts`** — a *correction* of the report's "delete" verdict, with recorded keep-reason: its opaqueness tests encode the live never-validate-briefs-at-enumeration contract, which remains true and load-bearing under the library model. Rename it as an opaque-brief-contract file, dedupe its duplicated pair, drop the pivot framing (its `PATHS_WITH_RUBRICS` fixture dies with the type removal regardless).
- **`env:start`/`env:stop`: delete both.** After findings 1 and 5, their only consumers are the definitions themselves; zero doc references; each is a thin alias of `npx wp-env start|stop` run from the testing-project root (identical cwd-based config resolution). `env:stop` has a real crash-recovery use, which survives as a one-line manual command — **phase 5 adds that line to the docs where the warm-env lifecycle is described.**

**Core simplifications:**

- **Finding 6 (apply):** extract a shared `findSkillsSectionBounds(lines)` in `enumerate.ts`; both the parser and the stripper consume it; drop the unused predicate parameter. 19+8 existing tests pin the behavior.
- **Finding 7 (moot — superseded, correction):** the `loadAllRubrics` self-reparse fix is *not applied as a fix*; the library track retires `rubric-loader.ts` entirely (its only non-test caller was the judge agent's load-all call; `loadRubric`'s only non-test caller was `loadAllRubrics`). The latent bug dies with the module. The spec's one-permitted-behavior-change allowance goes unused, and the ordering question dissolves: no interim fix.
- **Finding 8 (apply):** drop the `judgePluginSlug` alias, its tautological test, and the source-regex pin; re-import `pluginSlug` from `scaffold-plugin` at the six lifecycle-test sites (mechanical; diff larger than the report's estimate).
- **Finding 9 (apply):** remove `RunJudgeAgentParams.agentWorkspace` (documented "kept for logging and parity", never read) and `buildUserMessage`'s unused scenario param — subsumed by the judge-agent rework.
- **Finding 10 (apply):** merge the overlapping enumeration tests' unique assertions; extract the duplicated `makeProject`/`writeScenario` into a shared helper; fold the *third* copy (in `enumerate-rubrics.test.ts`, missed by the report) onto the same helper during its reframe.
- **Finding 13 (apply, byte-parity constraint):** unify the sort comparator on `compareScenarioIds` (byte-equivalent today); unify the `=== <rel> ===` file-inlining helper **parameterized by separator and fallback** — the two call sites differ (`'\n\n'` + `'(empty workspace)'` vs `'\n'` + `'=== (no files written) ==='`) and both outputs must stay byte-identical (no prompt-text change); leave the `checkPaths` export as-is (test-only, not public surface).
- **Simplification 2's optional extra (rejected, correction):** collapsing `runWpCli` onto shelling `judge-wp.mjs` is **not behavior-equivalent** — `runWpCli` pins `cwd: PROJECT_ROOT` while the bridge inherits the caller's cwd, and the harness cwd may be a *parent* directory where `npx` cannot resolve wp-env. Equivalence needs a cwd fix and buys ~15 lines for a node hop × 3 per pair plus a TS→mjs coupling.
- Finding 12 (`dirName`) is dispositioned with the proposals below.

- **Traces to:** R1, R2; AC1, AC2.

### Decision: `dirName` removal (ship now, breaking)

- **Choice:** remove `dirName` from `RunScenario`, `EnumeratedScenario`, and `ScenarioRunRecord`. Nothing in src/ ever *reads* it — every non-test occurrence is construction (always `dirName: id`) or copying; the record field is write-only. It *is* public API (`RunScenario` is exported; the README documents the alias; a target-project fixture destructures it in a hook), hence breaking. Update sites: 3 src files (~9 lines), ~10 test/fixture sites, one README line. `scenario.name` stays — always equal to `id` today but load-bearing as the key for artifact paths, report keys, tracker scopes, re-run matching, filters, and improver context. The triplet reduces to a documented pair.
- **Alternatives:** defer to a future breaking wave (forces a second `BREAKING:` release for a field nothing reads); remove `name` too (refuted — load-bearing).
- **Trade-offs:** external hook code that destructures `dirName` breaks with typecheck-only detection (no runtime warning); covered by the `BREAKING:` changeset and README migration note.
- **Traces to:** R2 finding 12 via R5; AC7, AC8.

### Decision: `judging: { duration, tokenUsage? }` report block (ship now, scoped)

- **Choice:** persist a `judging` block beside `testing` in the per-pair `report.json`, carrying the judge's `duration` and (when the provider reports it) `tokenUsage`. Verified baseline: the judge's `InvokeResult.usage` is *never read* today, and judge duration is computed but tracker-only — both are dropped on the floor. `runJudgeAgent` returns usage; `agent-loop` (which already measures the duration) writes the block. Scenario aggregation passes it through with zero changes.
- **Alternatives:** full judge observability including transcript persistence — explicitly deferred (needs a provider-stream capture design); recorded as the residual future direction inside proposal 6's disposition.
- **Trade-offs:** none material — additive, near-zero marginal cost while `runJudgeAgent`/`agent-loop` are already being rewritten. Gets its own non-breaking changeset.
- **Traces to:** R5 (proposal 6 ship-now scope); AC7, AC8.

### Decision: Dispositions for the twelve proposals + `dirName` (R5's record)

Owner set no hard bounds; revision size was weighed honestly — the mandated tracks already make this a large revision, so **ship now** is reserved for items that are mandated, near-zero marginal cost on top of code already being rewritten, or that avoid a second breaking wave. Future issues are recorded here only (no tracker issues are created — out of scope). None is silently dropped.

| # | Proposal | Disposition | Reason |
|---|----------|-------------|--------|
| 1 | Judge library | **Ship now** (mandated, R3) | Adopted with two amendments over the reviewer's shape: the copy lands **inside** the judge cwd (`judge-workspace/judge-library/`) because the fs-tools path jail makes the proposed sibling permanently unreachable for API judges (verified experimentally); and the bridge script is **not** moved into the library (a per-pair copy breaks its wp-env config-path identity). Name `roles.judge.library` per the reviewer; two-tier supply + manifest + inline fallback per the reviewer. |
| 2 | Slot-pool judge concurrency | **Future issue** | Real wall-clock value, but its own design: semaphore + `judgeSlot` context + fixing the confirmed-racy global `process.env` pattern by letting `beforeJudgeAgent` return an env map applied per invocation. Additive; lands independently of this wave. |
| 3 | Centralized decision rule | **Ship now** (mandated, R4) | Home = harness output instruction; override = brief prose wins (decision above). |
| 4 | `inspect`/`new`/`lint` CLI verbs | **Future issue** | Valuable (`inspect` would have helped this very revision), but the CLI has no subcommand routing and positionals already mean scenario filters (`skillsmith counter` = "run counter") — verb dispatch needs its own small compatibility design. Not free to ride along. |
| 5 | Per-check verdicts | **Future issue** | Breaking, medium effort, and shifts judge *output* behavior in a revision already changing the judge prompt; parse-failure risk needs its own bake-off. Pre-1.0 policy makes a later breaking wave cheap. `summarizeFailures`' legacy dead prefix branches go with it. |
| 6 | Judge-phase observability | **Ship now, scoped** to `judging: { duration, tokenUsage? }` | Usage is verifiably dropped and duration is tracker-only; the scoped block is near-zero marginal cost during the rewrite. Transcript persistence explicitly deferred (provider-stream capture design) — the residual future direction inside this disposition. |
| 7 | Capability manifest injection | **Future issue** | Injects a new prompt section and invites brief edits conditioned on capabilities — off-mandate brief changes are exactly what R6 scrutiny forbids this revision; needs a coverage-safe rollout of its own. |
| 8 | `repeats` + `compare` | **Future issue** | Medium effort; `compare` also lands on the unsolved CLI-verb question (see #4). |
| 9 | Improver memory | **Future issue** | Self-contained improvement-loop feature; no interaction with this wave. |
| 10 | Scenario seed workspaces | **Future issue** | Complements the library on the *testing* side (deliberately asymmetric, per the reviewer's own answer); independent design. |
| 11 | Provider capability honesty | **Future issue** | Requires a warnings channel validation doesn't have today. Noted linkage: a provider-declared file-tool capability would replace the library's Read/Bash name heuristic. |
| 12 | Cache-friendly prompt assembly | **Future issue** | The reviewer's own condition — re-baselining the 11-scenario suite — is out of this revision's budget; the prompt design above deliberately chose the conservative section order. Revisit with a planned re-baseline. |
| 13 | `dirName` removal (simplification finding 12) | **Ship now** | Small mechanical breaking change riding the already-mandatory `BREAKING:` wave instead of forcing a second one later (decision above). `scenario.name` stays (load-bearing). |

No proposal is rejected outright; the rejected *shapes within* adopted proposals — sibling placement, bridge relocation, the `runWpCli` collapse — are recorded with reasons in the decisions above.

- **Traces to:** R5; AC7.

### Decision: Changeset plan — three actions

- **Choice:**
  1. **Update** the existing `.changeset/flexible-scenarios-judge-verification.md` (stays `minor` + `BREAKING:`): its prose describes the load-all rubric model ("Skillsmith loads **all** rubrics from the optional `paths.rubrics` location…") and the selection lead-in — falsified by this revision. Rewrite those paragraphs to describe the judge-library model so the eventual release notes describe what actually ships.
  2. **Add** one new `minor` changeset with a `BREAKING:` summary prefix covering this revision's breaking wave: `roles.judge.prompt` and `paths.rubrics` removed (replaced by `roles.judge.library`, with the migration recipe), the decision rule centralized into the harness output instruction (brief authors drop the opener; brief prose overrides), `RunScenario.dirName` removed (use `id`), plus any `rubric-loader` symbol that turns out to be re-exported via `src/index.ts`.
  3. **Add** one new `minor` (non-breaking) changeset for the additive `judging: { duration, tokenUsage? }` report block.
- Cleanup carries no changeset: tests, briefs, testing-project scripts, and assets sit outside the release-relevant surface; the behavior-neutral src refactors are folded into the wave above where visible at all.
- **Baseline facts:** trunk carries *both* removed surfaces, so the removals are genuinely breaking relative to trunk; the package has never been released (no git tags; 5 changesets pending). AC8's gates (validator + `changeset status`) pass by construction — the deleted `feature-changeset.test.ts` is precisely what would have failed on the new changesets.
- **Alternatives:** one omnibus changeset (hides the additive/breaking split in release notes); leaving the stale feature changeset untouched (release notes would lie about the shipped model).
- **Traces to:** R7; AC8.

## Dependencies

- **No new external dependencies.** The library mechanism reuses `copyWorkspaceForJudge`-style recursive `cpSync` and the existing `snapshotWorkspace` walker (files-only, recursive, error-tolerant; sorted-keys manifest is the established pattern).
- Internal dependencies: the judge mutex bracket in `agent-loop.ts` (copy ordering: workspace copy → library copy → `beforeJudgeAgent`); `judgeCapabilities()` for the tool-less predicate; `checkPaths` for the start-up gate; `collectConfigErrors` for the removed-key rejection.
- Testing-project migration adds no tooling; `check:config` (existing) doubles as the migration tripwire.
- Release tooling: existing `changeset-gate.yml` + `validate-changesets.ts` cover changeset validation; nothing new needed.

## Failure Modes and Observability

| Failure | Detection | Surface |
|---|---|---|
| Config still sets `paths.rubrics` / `roles.judge.prompt` | `collectConfigErrors` rejection (new) | run refuses to start; migration message names `roles.judge.library` |
| `roles.judge.library` path missing / not a directory | `checkPaths` gate (new) | precondition error at run start |
| Brief names a library item that is missing/unreadable | judge follows the library-section failure instruction | verdict `pass: false`, `notes` names the path (in `report.json.review`) |
| Artifact contains a top-level `judge-library` entry | copy-time collision guard (new) | pair fails loudly, recorded as a pair error |
| Library copy I/O failure | copy throws inside the judge bracket | pair error, not silent |
| Library configured but empty (no files, no README) | `prepareJudgeLibrary` returns `undefined` | section omitted — mirrors today's empty-rubrics behavior; not an error |
| Tool-less judge | Read/Bash capability heuristic | inline supply; parity of material guaranteed |

**Observability additions:** `judging: { duration, tokenUsage? }` persisted per pair. Everything else logs through the existing tracker/log scopes.

**Invariant restated for reviewers:** grading material flows only through the judge-agent / judge-workspace paths; the testing agent's prompt assembly is untouched (the verified baseline shows zero leak paths today, and this design adds none).

## Risks and Open Questions

### Risks

- **Judge behavior shift from prompt-assembly changes.** The library redesign necessarily changes the judge's system prompt (rubrics no longer all-inlined; manifest section added; manual relocated from `# Role instructions` into `# Judge library`). Coverage parity is a text-level check-set property and survives, but judge *behavior* on the 11 scenarios should be spot-verified in the code phase — at minimum, assembled-prompt inspection for a sample scenario; a full re-baseline run is out of this revision's budget.
- **The tool-less heuristic is provider-vocabulary-coupled.** The `tools`-array Read/Bash name check lives in core but speaks claude-code/fs-tools vocabulary; codex never triggers it (its sandbox always reads). Documented; a provider-declared capability (proposal 11's direction) is the clean long-term home. Failure direction is safe: false positives inline.
- **The fs-tools jail experiment ran standalone**, not through a live API-provider invocation. The `resolveInside` logic was executed verbatim so confidence is high, but the code phase's unit tests around library supply should cover the jail interaction directly.
- **Reviewer burden on the brief edits.** Each of the 11 briefs loses line 1 and changes one sentence (rubric reference form). Both edits are designed to be check-set-neutral, but the pipeline's reviewers must still diff every brief's checks against `origin/trunk` sources; the framing sentence's relocation into the manual is flagged for them explicitly.
- **`dirName` removal breaks hook code that destructures it** (the target-project fixture demonstrates the pattern) — covered by the `BREAKING:` changeset and README migration note, but external consumers get typecheck-only detection, no runtime warning.
- **The three changeset actions must stay mutually consistent** (updated feature changeset + two new ones) — the docs phase should read them together so the retired load-all model is described nowhere.

### Open questions (deferred to implementation, semantics fixed here)

- Exact user-facing wording of the decision-rule sentence and the library manifest lead-in (semantics fixed above; the code phase polishes phrasing).
- Whether any `rubric-loader.ts` symbol is re-exported through `src/index.ts` — implementation verifies; if so, the removal is named in the `BREAKING:` changeset.
- `scaffold-block-name.test.ts`'s one behavioral negative assertion: reframe positively vs fold into an existing positive assertion — implementation judges which is less redundant.
