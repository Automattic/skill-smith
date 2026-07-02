# Design Research: Restore full trunk judging coverage in the JUDGE.md briefs, without task repetition

Design phase record for review-3 of pipeline `55-flexible-scenarios-and-judge-verification` (issue #55 / PR #56). Spec: `.pipelines/55-flexible-scenarios-and-judge-verification/review-3-restore-coverage-and-drop-task-intro/1-spec/spec.md`.

Standing directive (spec R10): every load-bearing claim below is verified against current `origin/trunk` (coverage facts) or the current branch code (mechanism facts), not against prior run artifacts.

## Research

<!-- Non-trivial findings from the design-doc-researcher, with sources cited. -->

### Judge prompt assembly on the branch (Topic 1 evidence)

Verified this session by the design-doc-researcher against branch code, the unit suite, and a live assembly experiment (`node --import tsx` running `stripSkillsSection` + `loadAllRubrics` + `buildJudgeSystemPrompt` over the real `counter` files). Nothing rests on prior-run artifacts.

**Assembly order** — `buildJudgeSystemPrompt` (`src/pipeline/judge-agent.ts:201–234`) joins with `\n\n`:

1. `scenario.judgeBrief` verbatim (JUDGE.md; read opaquely by `src/scenarios/enumerate.ts:237–253`). First section, no framing header above it.
2. `# Testing task` + skill-stripped `scenario.testingBrief` — always present (`judge-agent.ts:78, 221`).
3. `# Output format` (`{ "pass": <bool>, "notes": "<string>" }`, strict JSON) + `# Recursion guard` (lines 207–217).
4. `# Grading rubrics` — only when non-empty (lines 224–227): selection lead-in + `loadAllRubrics(resolve(projectRoot, config.paths.rubrics))`.
5. `# Role instructions` + `config.roles.judge.prompt` when set (lines 229–232).

Caller: `src/pipeline/agent-loop.ts:257–283` — copies the workspace for the judge; user message is only the inlined produced files (`buildUserMessage`, `judge-agent.ts:312–331`), `cwd` = judge workspace copy. The task never rides the user message (`src/__tests__/judge-agent.test.ts:798`).

**`# Skills` stripping** (`src/scenarios/enumerate.ts:125–151`; tests `src/__tests__/strip-skills-section.test.ts`): line endings LF-normalized; first heading whose text is exactly `Skills` (case-insensitive, depth 1–6) through the next same-or-shallower heading (or EOF) is removed, including sub-headings and prose (no skill-name leak). No-op when absent, but enumeration errors such scenarios ("missing required # Skills section", `enumerate.ts:305–309`), so runnable scenarios always have one. Boundary: only the first `Skills` heading is stripped (irrelevant for the 11 briefs — one each).

**Rubric loading** (`src/scenarios/rubric-loader.ts:86–128`): every top-level `*.md` under `paths.rubrics`, filename-sorted, md-link expansion within the root, each wrapped `# Rubric: <id>`; `undefined` (section omitted) when dir missing/empty. Testing-project: `paths.rubrics: './eval/rubrics'` (`testing-project/skillsmith.config.ts:77–79`), containing exactly one file, `wp-interactivity-api-best-practices.md`.

**Exact rubric lead-in** (`RUBRIC_SELECTION_LEAD_IN`, `judge-agent.ts:167–171`), verbatim:

> The rubrics below are shared, reusable grading criteria. Apply ONLY the
> rubric(s) this scenario's brief refers to; the others are provided for
> reference and must not affect the verdict.

**Load-bearing R2 interaction:** the lead-in makes the per-brief rubric instruction the *activation key* — a brief that fails to name the rubric gets its text supplied but flagged reference-only. The rubric blob header carries the id (`# Rubric: wp-interactivity-api-best-practices`); naming the bare id in the brief is unambiguous.

**Counter end-to-end trace:** stripped task = exactly the trunk prompt paragraph (the `# Skills` block gone). Observed H1 sequence: [judgeBrief body] → `# Testing task` → `# Output format` → `# Recursion guard` → `# Grading rubrics` (lead-in + rubric) → `# Role instructions` → `# Judge environment manual`. Unit-suite coverage of the chain: `judge-agent.test.ts:747` (auto-supply, skills removed), `:633` (rubrics from `paths.rubrics`), `:689/:719` (section omitted when empty), `:198/:224` (task placement/always present), `:443/:472` (cwd = judge copy).

**Caveats surfaced:**
- `# Testing task` comes *after* the judgeBrief — redone briefs must not say "the task above"; refer to "the testing task" neutrally.
- With the narrative opener dropped (R5), the system prompt opens directly with judging material; the only generic judge framing is `# Role instructions` at the end. Design call, not an R6 failure.
- Workspace content has **no mechanism in core today**; the only shared-content channels are `paths.rubrics` (auto-loaded blob) and `roles.judge.prompt`/`roles.test.prompt`. R6's "(plus workspace content)" clause activates only if R7 adopts workspaces.

**`roles.judge.prompt`** (`testing-project/eval/prompts/judge.md`, appended last under `# Role instructions`; optional — `judge-agent.test.ts:184`): the "Judge environment manual" — env vars (`$SKILLSMITH_PROJECT_ROOT`, `$SKILLSMITH_WP_PORT`, `$SKILLSMITH_PLUGIN_SLUG`), the WP-CLI bridge (`eval/utils/judge-wp.mjs`), the post-create recipe, the rendered-post URL shape. Already the de-facto shared home for judge-side environment specifics — direct precedent for R7.

### Workspace channels and the repeated-information inventory (Topic 2 evidence)

Verified this session by the design-doc-researcher against branch code, trunk, git history, and the live GitHub issue/PR (full reads of all 22 briefs; grep-verified counts).

**Testing-agent prompt assembly** (`src/pipeline/testing-agent.ts:35–107`), sections joined with `\n`: (1) skill blob from `paths.skills`; (2) `# Workspace constraint`; (3) `# Workspace contents` — every pre-existing workspace file inlined as `=== <rel> ===` blocks from a pre-run snapshot (`buildWorkspaceContents`, :109–126); (4) `# Recursion guard`; (5) `# Role instructions` + `roles.test.prompt` when set. User message = `scenario.testingBrief` verbatim, `# Skills` included (:77). **No rubric channel exists for the testing agent** — rubrics are judge-only today. cwd: `<scenarioDir>/<agentId>/workspace`, created by the loop (`agent-loop.ts:161–165`), populated by the project's `beforeTestAgent` hook (`scaffoldPlugin`); pre-seeded files land on disk AND in-prompt, and in the `before` snapshot so `filesWritten` never misattributes them. `roles.test.prompt` = `eval/prompts/testing-agent.md` (8-line "# Workspace instructions": work inside scaffold, starter name non-binding, keep `get_block_wrapper_attributes`).

**Repeated-information inventory:**
- *(a) Already de-duplicated:* rubric content (`paths.rubrics`); judge environment manual (`roles.judge.prompt` = `eval/prompts/judge.md`, 48 lines); testing scaffold instructions (`roles.test.prompt`); skill content (`paths.skills`). The conformance test even asserts scaffold instructions are NOT duplicated into TESTING-AGENT.md (`testing-project-scenarios.test.ts:195–201`).
- *(b) Repeated across the current 11 JUDGE.md (11–20 lines each):* "Decide whether it satisfies the task…" — 11/11 verbatim; "Also grade the produced code against the WordPress Interactivity API best-practices rubric." — 11/11 verbatim; the `## Environment` base paragraph — 8/11 identical, 3 scenario variants (independent-counters/shared-state: insert block twice; paginated-list: create extra posts). Net ~5 scenario-common lines per brief (~25–45%); ~55 scenario-common lines total, of which ~44 already have shared homes.
- *Drift bug caused by the duplication:* all 11 briefs instruct "Activate the plugin", but the judge hook already activates it (`wp-env-judge.ts:281–282`) and the manual says so — the briefs contradict the shared manual they duplicate.
- *(c) Irreducible per-brief residue in the redone briefs:* the 1-line rubric instruction (R2 — must stay per-brief; it is the activation key under the lead-in), plus the 3 genuine scenario-specific environment deltas. The base environment paragraph needs no per-brief copy — `roles.judge.prompt` already carries it.
- TESTING-AGENT.md: zero repeated prose beyond the parsed `# Skills` structure.

**Candidate workspace mechanisms assessed:**
- *(a) New optional `paths.workspace` dir, prompt-injected into both roles:* feasible and non-breaking (optional `Paths` key next to `rubrics?:` in `src/config/types.ts:146–155`; `validate.ts` doesn't validate paths; loader mirrors `loadAllRubrics`; new section in both prompt builders; CONTRIBUTING bump table: new optional config field = minor). But for the judge it duplicates what `roles.judge.prompt` already provides; the net-new capability (file-based shared content reaching the testing agent) has no present content to carry.
- *(b) Shared dir materialized on disk into each role's cwd:* testing side buys nothing over (a) (pre-seeded files are inlined into the prompt anyway) and pollutes the artifact of record + `judge-workspace` (`workspace-snapshot.ts:109–115` copies recursively); judge side needs an extra copy step plus tool-call Reads instead of in-prompt content. **Historical precedent against:** PR #5 (commit 6ac4044) wrote a shared `AGENTS.md` into the agent workspace; later migrated OUT to `roles.test.prompt` — the repo tried disk-materialized shared info and settled on the prompt channel.
- *(c) Status quo as the workspace:* every currently-repeated item already has a shared home; no currently-repeated content needs BOTH roles (env manual is judge-only material, scaffold instructions test-only, rubrics judge-only by design). Honest gap: no single channel hands the same content to both roles from one place — but no present content needs that.

**Generic-core constraint documented:** README:270 ("No WordPress/browser vocabulary lives in core"), README:222, `testing-project/skillsmith.config.ts:42–44`. `check:config` merely imports the config; `collectConfigErrors` ignores `paths` today.

**Prior art:** PR #5 rollback (above) is the strongest in-repo signal. No "workspace" mechanism appears in issue #55 body, PR #56 body, or PR #56 comments (gh-verified). Judge filesystem access today: cwd = full recursive copy of the produced workspace only; everything shared arrives via the system prompt.

**Rubric/lead-in interaction if rubrics moved into a both-roles workspace:** (1) selection semantics lost — the lead-in scopes rubric application per-scenario; a generic workspace has no selection convention; (2) testing-agent contamination — the agent under test would receive the grading rubric, changing what the eval measures vs trunk (rubrics were judge-only there too); (3) the intent's keep-list names "load-all rubrics" as a review-2 keeper. So under any adoption, rubrics stay a separate judge-only channel and R2's per-brief naming stays regardless.

### Trunk coverage shape and judge capability (Topic 3 evidence)

All trunk facts read directly from `git show origin/trunk:testing-project/eval/scenarios/<id>/{scenario.yaml,e2e.spec.mjs}` this session (R10-clean); all 11 specs read in full by the design-doc-researcher.

**Shape survey** (all 55 acceptance bullets across the 11 scenarios are check-shaped, none narrative):

| scenario | bullets | e2e tests | e2e observable assertions (paraphrase) |
|---|---|---|---|
| async-fetch | 5 | 2 | click "Fetch joke" → (mocked) joke renders; exactly 1 request to the stub URL; text absent pre-click, present post-click |
| config-fetch | 8 | 1 | click → request to `/wp-json/wp/v2/posts/1` with non-empty `X-WP-Nonce`; (mocked) title renders |
| counter | 4 | 2 | `[data-wp-text]` initially "5"; Increment → "6"; Decrement ×2 → "4" |
| derived-double | 5 | 2 | initial {1,2}; clicks → {2,4}, {3,6}, {5,10} — double invariant every click |
| focus-trap-menu | 9 | 4 | initial `aria-expanded="false"` + drawer hidden; click → "true" + items visible; Escape → closes + focus returns to Menu button; Tab wraps Contact→Home; Shift+Tab wraps Home→Contact |
| fruit-list-each | 6 | 3 | 3 `<li>` server-rendered in order Apple, Banana, Cherry; Add Mango → 4th "Mango" at end; twice → 5 items |
| independent-counters | 5 | 2 | two instances both "0"; first ×2 → 2/0; second ×1 → 2/1 |
| minimal-scaffold | 3 | 2 | page shows "Hello from iAPI" AND console logs "iapi-ready"; wrapper has non-empty `data-wp-interactive` |
| paginated-list | 7 | 2 | page 1 = 3 newest posts, "Previous" absent from a11y tree; Next → page 2 swap without full reload (window sentinel survives) + URL `?pg=2` |
| shared-state | 6 | 2 | two instances both "0"; either button updates BOTH in lockstep |
| toggle-visibility | 5 | 2 | hidden + `aria-expanded="false"`; click → visible + "true"; click → hidden + "false" |

Harness mechanics common to all 11 specs (NOT coverage): plugin de/activation, host-post creation, `page.goto`, teardown, poll timeouts, locator scoping — all owned today by the hooks + `roles.judge.prompt` manual. Coverage-relevant fixture facts (environment deltas): independent-counters & shared-state embed the block **twice** in one post; paginated-list creates **5 extra posts** (6 total, 3/page → 2 pages). Trickiest specs quoted in full by the researcher: paginated-list (a11y-tree absence of "Previous" — either server-omitted or `data-wp-bind--hidden` via a derived getter; no-reload proof via a `window` sentinel surviving the click + URL `?pg=2`), focus-trap-menu (drawer-hidden via ancestor `el.hidden` walk, not visual visibility; focus-wrap via Tab/Shift+Tab key presses), async-fetch (`page.route` mocks + request-count assertion).

**Judge-capability check** (judge = `tools: [Read, Bash]` + `npx @playwright/mcp@latest` with **no `--caps` flag**, `skillsmith.config.ts:45–52`; tool tiers from microsoft/playwright-mcp README @ main, npm latest 0.0.77): available core tools include navigate/click/type/press_key/snapshot/wait_for, `browser_console_messages`, `browser_evaluate`, `browser_network_requests`. **NOT available:** `browser_route`/`browser_unroute` (request mocking — opt-in `--caps=network`). Per-scenario verdict: 9 of 11 fully performable live (counter, derived-double, fruit-list-each, independent-counters, shared-state, toggle-visibility trivially; minimal-scaffold via `browser_console_messages` + `curl` of the rendered post; focus-trap-menu via `browser_press_key` + `browser_evaluate`/a11y snapshot; paginated-list after the judge creates the extra posts via the WP-CLI bridge). Exceptions:
- **async-fetch:** the stub `https://jsonplaceholder.example/joke` (.example TLD) never resolves and the judge cannot mock. Achievable live observables: text absent pre-click; on click, exactly one request attempt to the exact stub URL (`browser_network_requests`). The "joke text renders" outcome is only provable with a mock → the live section needs an explicit conditional falling back to the code-level display wiring (independently covered by trunk's acceptance bullets).
- **config-fetch:** endpoint is real in the judge env — click → real title renders; request URL observable. Live capture of the `X-WP-Nonce` header via `browser_network_request` is unverified; the wiring is independently a trunk code check (bullet 4). *(Model-knowledge caveat, unverified: wp-env default content ships post ID 1 "Hello world!".)*

**R5 screening of trunk bullets:** no task-narrative bullets; no environment text; task facts (5, 0, Apple/Banana/Cherry, button labels) appear only as expected values — check content, not narrative. One wrinkle: **derived-double bullet 1** contains "(this is the static-derived-state pattern **from the Interactivity API skill**)" — a skill reference the deliberately skill-agnostic judge must not see (the `# Skills` strip exists for exactly this; README:141); it also carries a legitimate grading allowance ("Seeding the doubled value alongside the counter … is acceptable"). Transcription note: config-fetch, paginated-list, minimal-scaffold bullets are YAML-quoted scalars — unescape when transcribing. Mode: no bullet is behavior-only; the "Server-rendered HTML includes/seeds …" family (9 of 11 scenarios) is code-mode per spec A3/R1, corroborable via `curl` pre-hydration.

**Trunk verdict semantics:** trunk had a source-only judge (rubric blob + `# Scenario acceptance` bullets; per-item JSON verdict `{ rubrics: {…}, acceptance: [ { item, pass, notes } ] }`); live behavior was a separate hard gate (`afterAllScenarios` ran the real Playwright suite; a spec failure failed the pair even when the judge passed). **Decision rule was mechanical all-must-pass** (`origin/trunk:src/reports/verdict.ts` `classifyVerdict`: pair passes only when every rubric and every acceptance item passes). The branch states no decision rule anywhere: `# Output format` is shape-only; `roles.judge.prompt` is environment mechanics only; the current briefs' generic "Decide whether it satisfies the task it was given…" is the only decision-rule-ish line. With R7 not adopted, `roles.*.prompt` and `skillsmith.config.ts` are frozen (spec Out of Scope), so **the per-brief template is the only permitted home for a decision rule this revision**.

**Branch constraints on structure:** core parses nothing from JUDGE.md (grep: `enumerate.ts` verbatim read + `judge-agent.ts:220` only) — any heading scheme is core-safe. The only structural constraint is the conformance test (current assertions inventoried under Topic 4's evidence). 9 of 11 current briefs use `## What to check` (unasserted by the test). Shape conclusion: every scenario reduces to (a) 3–9 source-level check bullets, (b) 1–4 live behavior sequences, (c) the rubric naming line, (d) an optional env-delta step (3 scenarios), (e) an optional live-fallback conditional (async-fetch; optionally config-fetch's nonce header) — **one template fits all 11 with no scenario-specific structure**.

### Conformance test inventory and guardrail surface (Topic 4 evidence)

All verified this session on the branch by the design-doc-researcher.

**`src/__tests__/testing-project-scenarios.test.ts`** — node:test flat `test()` calls. Discovery: hardcoded `SCENARIO_IDS` array of the 11 ids (:38–50); reads the real testing-project (:27–29); helpers `scenarioDir()`/`readScenarioFile()`; runs the real `enumerateScenarios`. Constants: `RUBRIC_SENTINEL` (:67, distinctive rubric sentence), `RUBRIC_PROSE_REFERENCE` = 'Interactivity API best-practices rubric' (:76), `ANCHORS` (:84–132) mapping each id → `{ prompt: <verbatim task fragment>, liveChecks: [<fragments "derived from the deleted e2e.spec.mjs">] }`.

Six tests, with fate under the Topic 3 template:
- **T1** (:134) two-file briefs exist, no scenario.yaml/e2e.spec.mjs → survives unchanged.
- **T2** (:156) all 11 enumerate cleanly, `skills == ['wp-interactivity-api']` → survives unchanged.
- **T3** (:176) `keys(ANCHORS) == SCENARIO_IDS` → survives only if ANCHORS is retained in some form.
- **T4** (:183) TESTING-AGENT.md: `/^#+\s+Skills$/im` present; contains `anchor.prompt` fragment; does NOT contain 'get_block_wrapper_attributes' (scaffold non-duplication) → survives unchanged (TESTING-AGENT.md out of scope). Complete TESTING-AGENT.md set.
- **T5** (:204) JUDGE.md contract, per item: (1) no `# Rubrics` heading — passes, still meaningful; (2) no `## Scenario requirements` heading — passes mechanically but contract-obsolete (its documented rationale is the rejected contract); (3) contains the rubric prose title — **fails** under bare-id naming; (4) `RUBRIC_SENTINEL` absent — survives (AC3 no-inlining proof); (5) `Environment` heading required — **fails** (section dropped); (6) `Live checks` heading required — **fails** (renamed); (7) no `$SKILLSMITH_JUDGE_URL`/`$SKILLSMITH_POST_ID` — passes, still meaningful; (8) `$SKILLSMITH_PLUGIN_SLUG` required — **fails** (slug lives in the frozen manual); (9) per-scenario `liveChecks` fragments — coverage-encoding, must die; (10) no `{ "pass"` pre-statement — survives. T5's header comment (:9–25) documents the rejected conversion contract and needs rewriting regardless.
- **T6** (:278) `_candidates.yaml` free of legacy-shape references → survives unchanged.

**Other repo surfaces affected by the brief rewrite:**
- **`src/__tests__/testing-project-e2e-removal.test.ts:115`** walks EVERY file under `testing-project/` and fails on `/e2e\.spec\.mjs/`, `/@playwright\/test/`, `/playwright\.config/`, `/playwright test/` (lowercase), `/verify-e2e/`. **The new JUDGE.md files must not contain the literal strings "e2e.spec.mjs" or lowercase "playwright test".** Scan scope excludes `.pipelines/`.
- `testing-project-judge-config.test.ts` (config/manual wiring — frozen files), bridge/scaffold/lifecycle tests, fixture-based scenario tests: all unaffected. No snapshot tests exist.
- **README:149–160** has an example JUDGE.md snippet modeling rubric naming by human title + a "Decide whether the produced block satisfies the task…" opening — diverges from the decided bare-id convention; docs-phase flag (README.md IS in the changeset gate's `changedFilePatterns`; empty/'none' changeset escape exists).
- Improver prompt does not hardcode brief structure (read in full) — nil risk. No markdown lint exists (biome lints js/ts only).

**Guardrail + changeset facts:** gate = `scripts/validate-changesets.ts` (shape: front-matter fence at line 1, package `@automattic/skillsmith`, bump ∈ {patch,minor,major,none}, pre-1.0 rejects major, non-empty body) + `changeset status --since=origin/<base>` firing only on `changedFilePatterns` = `["src/**","bin/**","package.json","examples/**","README.md","!src/__tests__/**"]`. **This revision needs no changeset** — briefs are not in the patterns; the test file is explicitly negated; CONTRIBUTING.md:41 exempts "tests, … pipeline artefacts (`.pipelines/**`), … the `testing-project/` fixture", :48 "Tests-only changes (`src/__tests__/**`) do not require a changeset". AC8 commands all exist: `typecheck` = `tsc --noEmit`, `lint` = `biome lint .`, `test` = `node --import tsx --test src/__tests__/*.test.ts`, `check:config` = tsx-import of `skillsmith.config.ts` (runs `collectConfigErrors` + normalization).

**R8 boundary evidence per candidate assertion:** (a) uniform `## Code checks`/`## Behavior checks` heading assertions — format, not coverage; (b) literal rubric id per brief — uniform R2 activation-key guard, successor of `RUBRIC_PROSE_REFERENCE`; (c) rubric-sentinel absence — uniform anti-inlining guard (AC3); (d) no `{ "pass"` pre-statement — uniform harness-contract guard; (e) **liveChecks anchors confirmed coverage-encoding** — a per-scenario coverage floor persisted in the codebase, precisely what A2/R8 reject (T4's `prompt` anchors, by contrast, guard preservation of the out-of-scope task text, not judging coverage — keeping them is defensible under AC7's "coverage parity" wording); (f) decision-rule line — uniform template contract; style caution: the test asserts short stable fragments, not long verbatim strings.

## Topics

<!-- One entry per design topic: spec link, options, trade-offs, decision, rationale. -->

### Topic 1: Does the branch judge-agent mechanism satisfy R6 (auto-supplied judge inputs)?

- **Spec link:** R6, acceptance criterion 5.
- **Question sent to researcher:** end-to-end verification of `src/pipeline/judge-agent.ts` — prompt assembly order and sources, `# Skills` stripping semantics and edge cases, rubric loading from `paths.rubrics` and the exact lead-in wording (matters for R2), full chain trace for `counter`, gaps vs R6, and the role of `roles.judge.prompt`.
- **Findings:** see "Judge prompt assembly on the branch (Topic 1 evidence)" under `## Research`.
- **Options:**
  1. No core change — the mechanism already auto-supplies the skill-stripped task and the rubric content.
  2. Core change to close a gap (none was found for the task+rubrics part).
- **Decision:** **Option 1 — no core change for the task+rubrics half of R6.** The branch mechanism satisfies "the judge automatically receives the testing-agent prompt without its `# Skills` section, plus the rubrics", verified end-to-end (live assembly for `counter` + unit suite). The R6 clause "(plus workspace content, if R7 adopts workspaces)" is the only part with no existing mechanism; it is decided in Topic 2 and, if adopted, is the sole R6-driven core change.
- **Rationale:** every element of R6 was traced to code and confirmed by tests and a live experiment; changing a working mechanism would violate the spec's "changed only where it falls short" clause.
- **Consequences for the brief design (feed into the JUDGE.md structure topic):**
  1. Every redone brief must explicitly name the rubric — preferably by id, `wp-interactivity-api-best-practices` — because the rubric lead-in tells the judge to apply ONLY brief-named rubrics (R2 is the activation key, not decoration).
  2. Briefs must not use positional references like "the task above"; the auto-injected `# Testing task` lands *after* the brief.
  3. Briefs open the system prompt directly, so their first heading is the de-facto opener; it must be judging material (R5), not a task narrative.

### Topic 2: R7 — shared workspace for judge and testing agent: adopt or stay on existing channels?

- **Spec link:** R7, acceptance criterion 6; R6's "(plus workspace content, if adopted)" clause.
- **Question sent to researcher:** testing-agent prompt assembly and channels; inventory of scenario-repeated information across the 22 briefs and `eval/prompts/*` (already de-duplicated vs still repeated vs newly needed by the redone briefs); 2–3 candidate workspace mechanisms with feasibility against the real code (prompt-injected shared dir, disk-materialized shared dir, status quo channels); prior art; interaction with the rubric "apply ONLY brief-named" lead-in.
- **Findings:** see "Workspace channels and the repeated-information inventory (Topic 2 evidence)" under `## Research`.
- **Options:**
  1. New optional `paths.workspace` directory, contents prompt-injected into both roles' system prompts (mirror of rubric loading).
  2. Shared directory materialized on disk into each role's working directory.
  3. **Not adopted:** the existing channels — `paths.rubrics` (judge-only, auto-injected), `roles.judge.prompt` (judge-side shared environment manual), `roles.test.prompt` (test-side shared instructions), `paths.skills` (skill content) — already are the workspace, and the redone briefs simply stop duplicating what those channels carry.
- **Trade-offs:**
  - Option 1 is feasible and non-breaking, but it would ship an empty mechanism: after the briefs stop restating the environment manual, the only irreducible per-brief shared residue is the 1-line rubric instruction, which *cannot* move to a shared channel (it is the per-scenario activation key under the rubric lead-in). Judge-side shared content already has a home (`roles.judge.prompt`); testing-side shared content already has a home (`roles.test.prompt`); nothing present needs to reach both roles from one place. A second unconditional-prose channel for the judge also creates a "which home does this line live in?" ambiguity with `roles.judge.prompt`.
  - Option 2 is strictly worse than option 1 here: pre-seeded testing-workspace files are prompt-inlined anyway, shared files would pollute the artifact of record and the judge workspace copy (`workspace-snapshot.ts:109–115`), and the repo already tried disk-materialized shared instructions (PR #5's `AGENTS.md`) and migrated them out to the role-prompt channel.
  - Option 3 adds no capability, but the evidence shows no present content needs the missing capability; it keeps core untouched (spec out-of-scope: "unconditional core changes") and avoids diluting rubric-selection semantics or contaminating the testing agent with grading material.
- **Decision:** **R7 is NOT adopted — no new workspace mechanism.** The revision stays on the existing rubric-supply and role-prompt channels. The "workspace" need the owner identified is real but already served: the harness already hands each role its scenario-common material automatically (`paths.rubrics` → judge prompt; `roles.judge.prompt` → judge prompt; `roles.test.prompt` → testing-agent prompt). What was broken is that the briefs duplicated that material on top — and the duplication had already drifted (all 11 briefs say "Activate the plugin" while the hook activates it and the manual says so). The fix is in the briefs (stop restating shared material), not in core.
- **Rationale:**
  1. **The inventory shows no homeless content.** ~44 of ~55 scenario-common brief lines already have shared homes; the residue is the per-brief rubric naming (must stay per-brief — activation key) and 3 genuinely scenario-specific environment deltas (not shared material by definition).
  2. **Nothing needs a both-roles channel.** Environment manual is judge-only material, scaffold instructions are test-only, and rubrics must remain judge-only (moving them to a both-roles workspace would hand grading criteria to the agent under test, changing what the eval measures relative to trunk, and would break the lead-in's per-scenario selection semantics).
  3. **Prior art points the same way.** PR #5 tried disk-materialized shared instructions and the repo settled on the prompt channel (`roles.*.prompt`).
  4. **Spec discipline.** Out of scope: "Unconditional core changes — Skillsmith core changes only as required by R6 (mechanism falls short) or R7 (workspaces adopted)". The mechanism does not fall short (Topic 1), and adopting a mechanism with no content to carry would be change for its own sake.
- **Consequences:**
  - R6's "(plus workspace content, if adopted)" clause is inert; **this revision ships zero Skillsmith core changes**. The change surface is: 11 `JUDGE.md` rewrites + the conformance test (R9). `testing-project/skillsmith.config.ts` and the role prompts stay unchanged (spec out-of-scope holds).
  - The redone briefs must NOT restate the base environment paragraph or the "Activate the plugin" instruction — `roles.judge.prompt` carries the environment; briefs carry only scenario-specific environment deltas (independent-counters/shared-state: insert the block twice; paginated-list: extra posts) plus checks and the rubric instruction. This also fixes the activate-drift bug as a side effect.
  - If a future project accumulates content that genuinely must reach both roles from one place, option 1 (`paths.workspace`, prompt-injected, rubrics kept separate) is the recorded recommended shape — logged under Open Questions for a future issue, not this revision.

### Topic 3: The new JUDGE.md structure (template + conversion rules for all 11 briefs)

- **Spec link:** R1–R5, acceptance criteria 1–4; R10 (coverage from trunk).
- **Question sent to researcher:** trunk shape survey of all 11 scenarios (acceptance-bullet counts/character; e2e observable assertions vs harness mechanics); judge-capability check for every trunk e2e assertion against the branch judge environment (Read+Bash, Playwright MCP, WP-CLI bridge, warm wp-env); whether any trunk bullets carry task-narrative text (R5 tension) or are behavioral rather than source-level (R1 mode question); trunk verdict semantics and what `# Output format`/`roles.judge.prompt` already say about the decision rule; worked raw material for `counter`; anything on the branch constraining headings.
- **Findings:** see "Trunk coverage shape and judge capability (Topic 3 evidence)" under `## Research`.
- **Options (heading scheme):**
  1. Keep the review-2 heading vocabulary (`## What to check` / `## Live checks` / `## Environment`).
  2. Adopt the spec's vocabulary: `## Code checks` / `## Behavior checks`, no `## Environment` section (deltas live inside the behavior section as setup steps).
- **Decision — the template.** Option 2. Every one of the 11 briefs follows this exact structure (core parses nothing from JUDGE.md, so this is convention, enforced only by the R9 conformance test):

  ```markdown
  Judge the produced work against the checks below, using both the produced
  source files and the live, running site. Pass only if every check is
  satisfied.

  ## Code checks

  Verify in the produced source files:

  - <trunk acceptance bullet 1>
  - <trunk acceptance bullet 2>
  - …

  Also check the produced code against the `wp-interactivity-api-best-practices`
  rubric.

  ## Behavior checks

  Verify on the live, running site:

  - <optional setup step(s) — only the 3 scenarios with environment deltas>
  - <live behavior check derived from e2e observable assertion 1>
  - …
  ```

  Element decisions:
  - **Opening line (decision rule).** One fixed, task-free sentence pair, identical across all 11. It restores trunk's all-must-pass strictness (`classifyVerdict` folded the verdict mechanically on trunk; on the branch nothing states a decision rule, and the per-brief template is the only permitted home this revision since `roles.*.prompt` is frozen). It is judging material, not task narrative — R5-safe: it never names what was built. It also replaces the current 11/11 "Decide whether it satisfies the task it was given…" line.
  - **`## Code checks`** carries every trunk `acceptance:` bullet (R1), one check per bullet, and closes with the fixed rubric sentence naming the bare id `wp-interactivity-api-best-practices` in backticks (R2; the id matches the `# Rubric: <id>` blob header, making the lead-in's "brief-named" selection unambiguous). The rubric sentence lives here because the owner framed the rubric as a code-mode check ("check the iapi-best-practices against the generated code").
  - **`## Behavior checks`** carries the trunk e2e observable assertions (R3) as action → expected-observation bullets against the live site. Scenario-specific setup steps open the section where trunk's fixtures demanded them (insert the block twice ×2 scenarios; create 5 extra posts ×1) — these are coverage-relevant environment deltas, not harness mechanics.
  - **No `## Environment` section and no base environment prose.** The manual (`roles.judge.prompt`) owns activation, URLs, env vars, the WP-CLI bridge; restating it caused the activate-drift bug (Topic 2). Briefs may reference manual affordances (e.g. "create posts via the WP-CLI bridge") but never restate them.
  - **Heading depth:** H2, consistent with current brief convention; the brief's internal headings sit visually under the assembled prompt's injected H1 sections and core is indifferent.
- **Decision — the conversion rules** (per-scenario derivation happens in the code phase, direct from trunk per R10; reviewers verify parity per R8):
  1. **Sources of truth:** `origin/trunk:testing-project/eval/scenarios/<id>/scenario.yaml` (`acceptance:`) and `<id>/e2e.spec.mjs`, read fresh at implementation time. Never derived from prior pipeline artifacts.
  2. **Code checks:** transcribe every acceptance bullet, preserving wording and expected values; unescape YAML-quoted scalars (config-fetch, paginated-list, minimal-scaffold). Exactly one permitted edit class: remove skill attributions — derived-double bullet 1 drops "from the Interactivity API skill" (the judge is skill-agnostic by design; the `# Skills` strip exists to keep skill identity from the judge) while keeping the check and its grading allowance. No bullets added, none dropped, none merged (R1: "no bullet may be omitted on the grounds that it duplicates the task, the rubric, or a live check").
  3. **Behavior checks:** one bullet per observable assertion of each trunk e2e test, expressed as what the judge does on the live site and what it must observe. Include assertion-bearing techniques where trunk's assertion depends on them (paginated-list: no-full-reload proven via a window sentinel surviving the click; "Previous" absent from the accessibility tree; focus-trap-menu: focus-return and Tab/Shift+Tab wrap). Exclude harness mechanics (activation, host-post creation, navigation plumbing, teardown, poll timeouts) — hook/manual-owned.
  4. **Overlaps (R4):** a behavior in both trunk sources appears in both sections, each in its mode — no dedup (counter: bullet "Server-rendered HTML includes the initial counter value (5)" AND live check "the block initially displays 5").
  5. **Unperformable live assertions:** where the judge environment cannot reproduce a mock-dependent observation, the behavior check states the closest achievable observable plus an explicit conditional fallback to the code checks. Applies to async-fetch only (live: text absent pre-click; on click exactly one request attempt to exactly `https://jsonplaceholder.example/joke` via the browser's network-request log; the rendered-joke outcome is unobservable because the stub host does not resolve and no mocking is available → verify the display wiring in the code checks). config-fetch stays live (real endpoint; click → title renders; request URL observable) with the nonce-header wiring anchored in its code check; the live bullet may instruct inspecting the request's headers if the tooling exposes them.
  6. **No task restatement (R5):** no "You are grading…" or narrative lead-in; refer to "the produced work"/"the block"; task facts appear only as expected values inside checks; never reference the testing task positionally ("above"/"below" — it is injected after the brief).
  7. **Banned literal strings (existing CI constraint, found in Topic 4 research):** `src/__tests__/testing-project-e2e-removal.test.ts:115` scans every file under `testing-project/` — the new briefs must not contain "e2e.spec.mjs", "@playwright/test", "playwright.config", lowercase "playwright test", or "verify-e2e". Behavior-check bullets therefore never cite their e2e origin; they just state the live check.
- **Worked example — `counter/JUDGE.md` (complete target content):**

  ```markdown
  Judge the produced work against the checks below, using both the produced
  source files and the live, running site. Pass only if every check is
  satisfied.

  ## Code checks

  Verify in the produced source files:

  - Has increment and decrement actions that modify the counter state
  - Uses data-wp-on--click on both increment and decrement buttons
  - Uses data-wp-text or equivalent to display the counter value reactively
  - Server-rendered HTML includes the initial counter value (5)

  Also check the produced code against the `wp-interactivity-api-best-practices`
  rubric.

  ## Behavior checks

  Verify on the live, running site:

  - The block initially displays the counter value 5.
  - Clicking the increment button updates the displayed value to 6.
  - Clicking the decrement button twice from there updates the displayed value to 4.
  ```

  (R4's overlap instance is visible: initial value 5 in both sections, each in its mode. The four code checks are trunk's four bullets verbatim.)
- **Rationale:** the template mirrors the three trunk coverage sources one-to-one (acceptance → code checks; rubric reference → rubric sentence; e2e → behavior checks), uses the spec's own section vocabulary, fits all 11 scenarios with no scenario-specific structure (shape survey), keeps every check performable in the verified judge environment (capability check), and removes all shared-channel duplication (Topic 2). Restoring the all-must-pass rule keeps verdict semantics trunk-faithful now that the mechanical `classifyVerdict` fold no longer exists.

### Topic 4: R9 — the conformance test under the new contract, and the guardrail surface

- **Spec link:** R8, R9, acceptance criteria 7–8.
- **Question sent to researcher:** complete assertion inventory of `src/__tests__/testing-project-scenarios.test.ts` (file-level, TESTING-AGENT.md, JUDGE.md, other) with survive/fail/obsolete status per assertion; any other repo surface breaking when the briefs change (tests, docs, improver prompt, markdown lint); changeset-gate facts and whether this revision requires a changeset; R8-boundary read on candidate assertions for the new test.
- **Findings:** see "Conformance test inventory and guardrail surface (Topic 4 evidence)" under `## Research`.
- **Options:**
  1. Delete the JUDGE.md contract test entirely (T5) and keep only file-shape tests.
  2. Rewrite T5 as a uniform, scenario-independent template-contract test; keep T1/T2/T4/T6; remove the coverage-encoding pieces.
- **Decision:** **Option 2 — the test becomes a template-contract test, never a coverage checker.** Concretely:
  - **Keep unchanged:** T1 (two-file model, no legacy `scenario.yaml`/`e2e.spec.mjs`), T2 (all 11 enumerate cleanly with `skills == ['wp-interactivity-api']`), T4 (TESTING-AGENT.md: `# Skills` heading present, per-scenario `prompt` anchor fragment present, no scaffold-instruction duplication), T6 (`_candidates.yaml` legacy-free).
  - **`ANCHORS` loses its `liveChecks` arrays entirely** — confirmed coverage-encoding (a per-scenario coverage floor "derived from the deleted e2e.spec.mjs"), exactly what R8/AC7 reject. It keeps only the per-scenario `prompt` fragments, which guard the out-of-scope TESTING-AGENT.md task text (task preservation, not judging coverage). T3 survives as `keys(ANCHORS) == SCENARIO_IDS`.
  - **T5 rewritten** to assert, for every one of the 11 briefs, only uniform template-contract invariants:
    1. has a `## Code checks` heading and a `## Behavior checks` heading (regex over headings);
    2. contains the literal rubric id `wp-interactivity-api-best-practices` (R2 activation-key guard; replaces the prose-title `RUBRIC_PROSE_REFERENCE`);
    3. does NOT contain `RUBRIC_SENTINEL` (no rubric inlining — AC3);
    4. does NOT pre-state the `{ "pass"` output shape (harness owns `# Output format`);
    5. does NOT reference the dead env vars `$SKILLSMITH_JUDGE_URL`/`$SKILLSMITH_POST_ID`;
    6. contains a short stable fragment of the fixed decision-rule opener (e.g. `pass only if every check` case-insensitively — fragment, not the full sentence, per the file's own short-fragment style);
    7. no `# Rubrics` heading (opaqueness holds).
  - **Dropped assertions:** the `## Scenario requirements` ban (rejected-contract relic), the `Environment` heading requirement, the `Live checks` heading requirement, the `$SKILLSMITH_PLUGIN_SLUG` requirement, and all `liveChecks` fragments. The T5 header comment (:9–25) is rewritten to describe the new contract (template shape + auto-supply division of labor), not the rejected conversion story.
  - **R5 is not mechanically asserted.** "No task restatement" is a semantic property; encoding it (e.g. banning "You are grading") would be brittle and would drift into content policing. It is reviewer-verified, like coverage parity (R8's model).
- **Rationale:** every retained assertion is scenario-independent and guards a mechanism contract (template shape, rubric activation, no inlining, harness-owned output format) — none encodes what any scenario's coverage is, so AC7's "no test asserting per-scenario coverage parity" holds while the suite still fails loudly if a future brief breaks the two-section format or drops the rubric key. The one retained per-scenario datum (`prompt` anchors) protects files this revision is explicitly not touching.
- **Guardrails/changeset:** no changeset for this revision — the diff (testing-project briefs + `src/__tests__/**`) matches no `changedFilePatterns` entry and CONTRIBUTING exempts both categories explicitly. All AC8 commands verified to exist; `check:config` is unaffected (config frozen).

### Topic 5: Approach, components, data flow, dependencies, failure modes

- **Spec link:** whole-spec synthesis (Overview; R1–R10; AC1–8).
- **Approach (the implementer's mental model):** this revision is a *content* change riding an already-verified mechanism. The judge's system prompt is assembled as [JUDGE.md verbatim] + [auto-injected skill-stripped task] + [output format] + [rubric blob gated by brief naming] + [environment manual]. Trunk defined each scenario's judging coverage in three sources (acceptance bullets, rubric reference, e2e spec). The work is a per-scenario, trunk-faithful transcription of those three sources into the brief's two sections plus the rubric sentence — dropping everything the harness already supplies (task, rubric text, environment base) and keeping everything that is judging coverage. Core is untouched; the conformance test is realigned to the new template contract.
- **Components:**
  - *Changed:* the 11 `testing-project/eval/scenarios/<id>/JUDGE.md` files (rewritten to the Topic 3 template); `src/__tests__/testing-project-scenarios.test.ts` (Topic 4 contract).
  - *Untouched but load-bearing:* `src/pipeline/judge-agent.ts` (assembly + rubric lead-in), `src/scenarios/enumerate.ts` (opaque brief read + skill strip), `src/scenarios/rubric-loader.ts`, `testing-project/skillsmith.config.ts`, `eval/prompts/judge.md` + `eval/prompts/testing-agent.md` (frozen role prompts), `eval/rubrics/wp-interactivity-api-best-practices.md`, the wp-env hooks (`wp-env-judge.ts` — plugin activation, warm env), `src/__tests__/testing-project-e2e-removal.test.ts` (bans e2e vocabulary in briefs).
- **Interfaces and data flow:** unchanged. JUDGE.md remains an opaque markdown contract consumed verbatim as prompt section 1; the only interface-like couplings the briefs must honor are (i) the rubric id string ↔ `# Rubric: <id>` blob header (activation), (ii) no positional reference to the injected task, (iii) the banned-strings scan, (iv) the conformance test's template invariants.
- **Dependencies:** no new dependencies, no core changes, no config changes, no changeset. External-tool dependency of the *checks themselves*: Playwright MCP core tools + WP-CLI bridge (verified sufficient for 10 of 11 scenarios live; async-fetch degrades by design).
- **Failure modes and observability:**
  - *Brief regression (format):* conformance test fails (`npm test`) — headings, rubric key, inlining, output-shape, dead env vars, decision-rule fragment.
  - *Brief regression (coverage):* deliberately NOT machine-detected (R8) — reviewer-verified against trunk at review time; the pipeline's reviewers are the named control.
  - *Banned vocabulary:* `testing-project-e2e-removal.test.ts` fails.
  - *Judge-side failure at run time:* unchanged from the branch mechanism — judge verdicts land in `{ pass, notes }`; a brief-induced misgrade surfaces as implausible notes (e.g. claiming it could not find the rubric or the task), which is the same observability the harness has today. The template's fixed decision rule makes borderline verdicts legible: notes must account for every check.
  - *Environment assumptions:* config-fetch's target-post existence and MCP capability drift are logged risks with mitigations (bridge recipe; conservative fallback).
- **Decision:** adopt this change surface as the complete scope: 11 brief rewrites + 1 test rewrite, nothing else. (Docs divergence — README's example brief — is flagged to the docs phase, not silently included here, since the spec scopes this revision to briefs + test and README edits trip the changeset gate.)
- **Rationale:** matches the spec's Out of Scope exactly; every changed artifact traces to R1–R5 (briefs) or R9 (test); every untouched artifact that the design depends on was verified this session.

## Open Questions

<!-- Unresolved sub-questions deferred to the implementation phases. -->

- If a future project accumulates content that genuinely must reach both the judge and the testing agent from one place, the recorded recommended shape is a new optional `paths.workspace` directory whose contents are prompt-injected into both roles (rubrics kept as a separate judge-only channel). Deliberately not this revision — file as a future issue if the need materializes.
- **Exact wording of the async-fetch fallback conditional** (and whether config-fetch's live bullet mentions optional header inspection) is drafted in the code phase within Topic 3's conversion rule 5; reviewers verify it preserves trunk's assertion intent without coverage drift.
- **config-fetch target post existence**: verify once against the real warm wp-env whether post ID 1 exists by default; word the brief's setup accordingly (see Risks).
- **README example brief divergence (docs phase):** README:149–160 models rubric naming by human title plus a "Decide whether the produced block satisfies the task…" opening — both superseded by the Topic 3 template (bare id, fixed decision rule). Nothing breaks mechanically; the docs phase should update the example. Note README.md is in the changeset gate's `changedFilePatterns` (a `none` changeset satisfies the gate for prose-only edits).
- **Decision-rule fragment wording for the T5 assertion** (Topic 4 item 6): the exact short fragment is chosen in the code phase together with the final opener wording; it must stay short and stable per the test file's own style.

## Risks

<!-- Anything worth flagging to the design-doc-writer and downstream phases. -->

- **Playwright MCP capability facts may drift.** The judge-capability check used the microsoft/playwright-mcp README @ main (npm latest 0.0.77); the shipped release may differ slightly, and the config runs `@playwright/mcp@latest` (unpinned). The design's only capability-load-bearing conclusions are: no request mocking without `--caps=network` (drives the async-fetch fallback), and `browser_network_requests`/`browser_console_messages`/`browser_evaluate`/`browser_press_key` available in core. If mocking ever becomes available, the async-fetch fallback conditional is merely conservative, not wrong.
- **wp-env default content assumption (config-fetch).** "Fresh wp-env ships post ID 1 (Hello world!)" is model knowledge, unverified this session. The config-fetch behavior check must not silently depend on it: the judge manual's WP-CLI bridge lets the judge confirm/create the post. Implementation phase should verify once against the real warm env or word the brief's check to tolerate creating the target post.
- **The opening decision-rule line is new relative to the current briefs.** It restores trunk's mechanical all-must-pass fold (`origin/trunk:src/reports/verdict.ts`) at the prompt level. This is verdict semantics, not judging *coverage* — record it so reviewers don't misread it as coverage inflation (R8 review compares checks, not the decision rule).
- **Duplication-drift class of bug.** The activate-drift bug (briefs contradicting the manual) is fixed as a side effect of Topic 2's decision, but the same class returns if future briefs restate manual content; the conformance test (Topic 4) is the only mechanical guard the codebase will carry, and per R8 it stays structural, so reviewer discipline remains the real control.
