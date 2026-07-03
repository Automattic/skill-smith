# Design Research: Leaner judge briefs — natural-language rubrics and an auto-supplied task

> Phase 2 (design doc) research record for the **review-2** run of the #55 pipeline.
> Authoritative input: `1-spec/spec.md`. This record captures the design decisions
> (HOW), their rationale, and the trade-offs considered. It is written to be a
> standalone basis for the phase-2 design-doc writer.

## Research

<!-- Non-trivial findings from the design-doc-researcher, with sources cited. -->

### Baseline map of the current machinery (branch + trunk)

Source: design-doc-researcher, cross-checked against files read directly by the analyst.
All `path:line` are on the branch (`worktree-55-...`) unless marked `origin/trunk`.

**Task supply — what "the task" is and where it lives (spec req 6–7):**
- The testing agent's task is `scenario.testingBrief` **verbatim** — it is passed as the testing agent's *user message* (`src/pipeline/testing-agent.ts:77`).
- The `# Skills` the testing agent actually *uses* is loaded separately from the skills directory into the testing agent's **system prompt** (`testing-agent.ts:42-45`), **not** from the brief's `# Skills` list. Consequence: the `# Skills` section inside `TESTING-AGENT.md` is a *reference list* that Skillsmith parses (`parseSkillsSection`) to know which skills to load; stripping it from the copy handed to the judge does not change what the testing agent did — it only hides skill identity from the judge (exactly what req 7 wants).
- `runJudgeAgent` already receives the **full `scenario`** (so `scenario.testingBrief` is in hand today) plus `config` and `projectRoot` — **no new plumbing** is needed to reach the task. Today `buildUserMessage`'s scenario param is deliberately unused (`_scenario`, `judge-agent.ts:293`) and the judge is **not** told the task.
- Net work for req 6–7: strip the `# Skills` section from `testingBrief`, then inject the remainder into the judge prompt.

**`# Skills` section boundary logic is reusable for stripping (spec req 7):**
- `parseListSection` / `SKILLS_HEADING_RE` (`enumerate.ts:39-99`, `:13`) already locate the `# Skills` section's boundaries: first heading whose text is exactly `Skills` (case-insensitive, any depth), ending at the next same-or-shallower heading (or EOF). A new **section-removal** helper can reuse this exact boundary logic — the existing parser only returns *ids* (list items), not the span, so a small new helper is warranted.

**Rubric machinery to remove — full surface (spec req 1):**
- `src/scenarios/enumerate.ts`: `parseRubricsSection` + `RUBRICS_HEADING_RE`, and the rubric parse+validate block at `:311-325`; the `rubricsRoot` plumbing into `enumerateScenarios`/`scenarioFromBriefs`; the `Scenario.rubrics` write.
- `src/pipeline/judge-agent.ts`: `resolveRubricBlob` (`:65`, `:122-138`), the `loadRubric` import (`:10`), and the `# Grading rubrics` injection in `buildJudgeSystemPrompt` (`:207-209`).
- `src/scenarios/rubric-loader.ts` (`loadRubric`) — **decision point**: delete, or repurpose to load *all* rubrics from the path. Note it already resolves md-linked sub-files, which is useful for a "load all rubrics" mechanism.
- `Scenario.rubrics?` in `src/config/types.ts:196-202` (and the JSDoc referencing it).
- Tests to update/remove: `rubrics-section.test.ts`, `enumerate-rubrics.test.ts`, `rubric-loader.test.ts` (if `loadRubric` is deleted), the rubric cases in `judge-agent.test.ts` (~`:170-227`, `:528-633`), and `core-types.test.ts` (`:66`, `:112`).

**Config (spec req 4) — already in the desired state on the branch:**
- `paths.rubrics?` optional (`types.ts:154`); **no** `rubrics` entry in `DEFAULT_PATHS` (`defaults.ts`); `checkPaths` gates only `['skills','scenarios']` (`pipeline.ts:580`) — **no existence gate**. So **no config change is needed for req 4** on the branch.
- `origin/trunk` differs: `paths.rubrics` is **required**, defaulted to `./eval/rubrics`, and existence-gated in `checkPaths` over `['skills','scenarios','rubrics']`. We deliberately do **not** adopt trunk's required/gated shape (settled in spec Q4).

**Verdict (spec req 8 — out of scope to change):**
- `classifyVerdict` (`src/reports/verdict.ts`) already handles `{ pass, notes }` (`:30`, `:47`); the `{ rubrics, acceptance }` handling (`:60-91`) is a legacy fallback, left untouched. The live `{ pass, notes }` judge and the self-improvement loop stay as-is.

**`testing-project` (spec req 9):**
- 11 scenarios under `testing-project/eval/scenarios/*/`. Each `JUDGE.md` has a `## Scenario requirements` block (duplicates the task) + a `# Rubrics` id-list (both to be removed), plus `## Environment` and `## Live checks` (to keep). Config sets `paths.rubrics: './eval/rubrics'` (`testing-project/skillsmith.config.ts:75`).
- Sample (`counter/JUDGE.md`): opening prose, `## Environment` (uses `$SKILLSMITH_PLUGIN_SLUG`), `## Scenario requirements` (4 bullet checks that restate the task), `## Live checks`, then `# Rubrics` → `- wp-interactivity-api-best-practices`. Its `TESTING-AGENT.md` carries `# Skills` → `- wp-interactivity-api`.

### Exact removal surface + touched tests (cited)

Source: design-doc-researcher (Topic 1 full inventory). Branch paths unless prefixed `origin/trunk:`.

**Production sites to remove/change (spec req 1):**
- `enumerate.ts`: `RUBRICS_HEADING_RE` (`:15`), `parseRubricsSection` (`:122-128`), its sole caller in `scenarioFromBriefs` (`:313`), the rubric existence-validation block (`:311-325`), and the `rubricsRoot` plumbing (computed `:204-207`, passed `:235`, param `:288`). After removal `enumerateScenarios` no longer computes/threads `rubricsRoot`.
- `Scenario.rubrics?` declaration (`types.ts:196-202`); writes at `enumerate.ts:327-333` (build) and `:359` (`stubScenario`).
- `judge-agent.ts`: `resolveRubricBlob` (def `:122-138`, sole caller `:65`), `loadRubric` import (`:10`), and the `# Grading rubrics` injection in `buildJudgeSystemPrompt` (`:207-209`). The **only** production read of `scenario.rubrics` is `resolveRubricBlob:128`.
- `rubric-loader.ts` (`loadRubric`): its **only** production caller is `resolveRubricBlob`. Once that's gone, `loadRubric` is orphaned **unless** repurposed for load-all (it already BFS-resolves in-tree md-linked companion files, `:18-58`, `MD_LINK_RE:4`).

**Tests touched:**
- Delete: `rubrics-section.test.ts` (dedicated to the removed parser).
- Rewrite: `enumerate-rubrics.test.ts` (encodes the id-validation behavior req 4/5 removes — the "ghost/never-validated" cases at `:121`, `:216`).
- `rubric-loader.test.ts` (fixtures `fixtures/rubrics/multi.md` + `sub/helper.md`): keep only if `loadRubric` is repurposed; else delete.
- `judge-agent.test.ts` rubric cases: `:170-227` (`buildJudgeSystemPrompt` rubric-blob), `:528-633` (`runJudgeAgent` rubric resolution). Sets `scenario.rubrics` at `:541`, `:610`.
- `core-types.test.ts:64-66`, `:110-112` (assert the `rubrics` field on the type).
- **Stays valid unchanged:** `check-paths.test.ts:44` asserts `DEFAULT_PATHS` has **no** `rubrics` — corroborates "no config change for req 4".
- Comments-only (no code change): `agent-loop.ts:233-234,320,388`, `scenario-report.ts:21` mention "rubrics" only re: the legacy verdict.

**Docs/changeset references to the removed model (flag for docs/plan phases):**
- `README.md` — the whole "Reusable rubrics" section (`:139`, `:147-166`) plus `:26`, `:308`, `:310`, `:340-342` document the `# Rubrics` id-list + `# Grading rubrics` injection being replaced.
- `examples/skillsmith.config.ts:187-197` — comment says a scenario "opts in by listing rubric ids under a `# Rubrics` heading"; still sets `rubrics: './eval/rubrics'`.
- `.changeset/flexible-scenarios-judge-verification.md` — the **existing review-1 changeset** documents the rubric-by-id model this revision reverses. **Design/plan must decide: amend this changeset vs. add a new one** (see Open Questions).

### Trunk precedents worth borrowing (owner directive req 9)

Source: design-doc-researcher. `origin/trunk` paths.

- **Config (do NOT re-adopt):** trunk's `Paths.rubrics: string` is required (`origin/trunk:src/config/types.ts:83-88`), defaulted (`DEFAULT_PATHS`), and existence-gated (`checkPaths` over `['skills','scenarios','rubrics']`). The branch is already in the spec's desired optional/un-gated state — no change (settled Q4).
- **Skill-agnostic judging is pre-existing intent:** trunk's judge instruction (`origin/trunk:src/pipeline/judge-agent.ts:119`): *"You are grading an implementation against the rubrics above. Do not consult any skill documentation."* — and its JSDoc (`:25`) says the judge "never sees the skill text." So req 6/7's skill-agnostic posture is the established design intent, not new.
- **Task auto-supply precedent (key find):** trunk **already** appends the task to the judge's **user message**: `buildUserMessage` ends with `sections.push( '\n--\n', scenario.description )` (`origin/trunk:src/pipeline/judge-agent.ts:181`) → user message = `[produced files] -- [task]`. Nuance: trunk's `Scenario` had **both** `description` (short summary) and `prompt` (full task) as separate fields (`origin/trunk:src/config/types.ts:123-131`); the judge got only the short `description`. On the **branch** those fields are gone — the full task is `scenario.testingBrief`. So our design supplies `testingBrief` **minus `# Skills`** (richer than trunk's `description`, and stripped for skill-agnosticism, which trunk didn't need since the short description carried no skills). We borrow trunk's **placement pattern** (task in the user message after a `--` separator).
- **Verdict:** trunk returns the structured `{ rubrics, acceptance }` grader verdict (`origin/trunk:src/pipeline/judge-agent.ts:116-152`); we keep the branch's `{ pass, notes }` (settled Q5).

### Rubric delivery — mechanism evidence (Topic 2)

Source: design-doc-researcher, cross-checked by analyst against the files.

- **Layout/size:** `testing-project/eval/rubrics/` holds exactly ONE file, `wp-interactivity-api-best-practices.md` (4,370 bytes / 37 lines / ~1,090 tokens), no sub-dirs, **no md-links** (so `loadRubric`'s link-expansion pulls in nothing today). Its H1 is `# WordPress Interactivity API Best Practices`.
- **Prompt budget:** linear in file count; ~1.1k tokens/rubric of this size; ~9–11k even at 8–10 rubrics — modest against the judge's produced-files + WP environment prompt. **Not** the deciding axis; reliability is.
- **`loadRubric` (`src/scenarios/rubric-loader.ts`):** single-id only — resolves `<root>/<id>.md`, **throws** if missing (`:18-24`); BFS-follows in-tree relative md-links to arbitrary depth, dedupes via a visited set, skips external/absolute/anchor/mailto, strips `#fragments` (`:29-72`, `MD_LINK_RE:4`); emits each file as `=== <rel-path> ===\n<text>` joined by blank lines. It does **not** enumerate a directory. **No** existing "read all `*.md` in a dir" helper anywhere (`readdirSync` used in 6 unrelated places). A load-all is new code: `readdirSync` → filter `.md` → **sort** → `loadRubric` per top-level id (keeps link-expansion for free) → dedupe by resolved path.
- **Determinism:** `readdirSync` is unordered — a load-all MUST `.sort()` (filename ascending), matching the id-sort at `enumerate.ts:263`.
- **Reliability (crux of req 3):** at N=1 (today) trivially reliable — nothing to confuse the single rubric with. Future N>1 failure modes: cross-contamination, wrong-rubric selection, and (sharpest) **over-application** (load-all reads as "all mandatory"). Mitigations chosen: G1 self-identifying per-rubric header (surfaces id + the file's H1) and G2 a one-line selection instruction ("apply ONLY the rubric(s) the brief names").
- **Trunk phrasing:** trunk's judge said *"You are grading an implementation against the rubrics above. Do not consult any skill documentation."* (`origin/trunk:judge-agent.ts:119`) — the skill-agnostic clause is directly reusable (reinforces req 6); but trunk only ever injected the scenario's own id-selected rubrics, so it has **no** proven "apply only what the prose names" wording — G2 is new. Per-rubric header pattern `# Rubric: <id>` borrowed from `origin/trunk:judge-agent.ts:105`. Neither trunk nor branch models a rubric *title* distinct from its id/filename; the file's own H1 serves as the human name.

### `## Scenario requirements` conversion audit (Topic 3)

Source: design-doc-researcher (all 11 `TESTING-AGENT.md` + `JUDGE.md` + full rubric). Classification: (a) duplicates task, (b) UNIQUE judge check (not in task, not in rubric — lost on wholesale delete), (c) covered by rubric. The rubric preamble (`rubric.md:3`) states its criteria apply to every iAPI scenario and should not be duplicated in scenario acceptance lists — so (c) bullets are redundant by design.

- **All 11** reference exactly `wp-interactivity-api-best-practices` (one each; zero extra, zero missing).
- **Category-(b) present in 9 of 11.** Per-scenario (b) residue (the scenario-specific mechanism the task states only at outcome level):
  - `async-fetch`: weak — exact URL literal (already in the auto-task).
  - `config-fetch`: HIGH — `wp_interactivity_config()` (not state/context), `getConfig()` read, `X-WP-Nonce` from config, exact server APIs.
  - `counter`: NONE — reduces cleanly to task+rubric.
  - `derived-double`: HIGH — derived getter vs stored mutable field; action mutates only counter; directive references the getter.
  - `focus-trap-menu`: HIGHEST — single boolean drives drawer+aria-expanded; Tab/Shift+Tab trap via directives not addEventListener; Escape close; instance-scoped focus return; real server-rendered anchors.
  - `fruit-list-each`: HIGH — `data-wp-each` + `<template>` not PHP foreach; in-place `.push()` not reassign.
  - `independent-counters`: MODERATE — local context via `getContext()`, not global (rubric only "prefers").
  - `minimal-scaffold`: HIGH — `console.log` inside a store init callback (not top-level/handler/watch); `data-wp-init="callbacks.<name>"`.
  - `paginated-list`: HIGHEST — `data-wp-router-region`; `withSyncEvent`; generator + `import('@wordpress/interactivity-router')` + `navigate`; server `$_GET['pg']` slice; `clientNavigation` nuance; SDP-gotcha on Prev/Next omission.
  - `shared-state`: MODERATE — global `state.*`, not context (mirror of independent-counters).
  - `toggle-visibility`: MODERATE — single boolean drives both aria-expanded and hidden/negation.
- **Conclusion:** wholesale-deleting the block loses judge signal in 9/11. Defensible rule: drop (a)+(c), preserve (b) under a non-`Scenario requirements` heading (satisfies AC8's letter, honors the intent).

## Topics

<!-- One decision per topic, each traced to a spec requirement / acceptance criterion. -->

### Topic: Baseline mapping (resolved)

- **Spec link:** Requirements 1–9; owner directive req. 9.
- **Decision:** Captured in `## Research › Baseline map` above. Key takeaways that shape the design: (a) `runJudgeAgent` already has `scenario` (with `testingBrief`), `config`, and `projectRoot` in scope — no new plumbing to reach the task; (b) the brief's `# Skills` list is a *reference list* Skillsmith parses, not the source of the skill the testing agent uses, so stripping it from the judge copy is safe and achieves skill-agnosticism; (c) config (req 4) is already correct on the branch; (d) the section-boundary logic in `parseListSection` is reusable for a strip helper; (e) `loadRubric` already resolves md-linked sub-files.

### Topic: End-to-end approach (the implementer's mental model)

- **Spec link:** Requirements 1, 3, 6, 7, 8 (the whole feature).
- **Decision:** Three cohesive, mostly-independent changes, all inside the judge/enumeration boundary; the judge invocation, verdict shape, reporting, and loop are untouched.
  1. **Make `JUDGE.md` opaque (removal).** Delete the `# Rubrics` parser, its enumeration-time validation, the `Scenario.rubrics` field, `resolveRubricBlob`, and the id-matched `# Grading rubrics` path. Enumeration keeps parsing only the testing brief's `# Skills` (for skill loading) and reads `JUDGE.md` verbatim into `judgeBrief`.
  2. **Deliver rubric content by "load-all-from-path".** When `config.paths.rubrics` is set, load every rubric under it and inject the concatenation into the judge system prompt under a single heading; the `JUDGE.md` prose names which rubric(s) apply and the judge selects. When unset/empty → no rubric section, no error (req 4). (Mechanism decided in its own topic below.)
  3. **Auto-supply the skill-agnostic task.** Strip the `# Skills` section from `scenario.testingBrief` and inject the remainder into the judge prompt on every run, so `JUDGE.md` need not restate the task and the judge never learns the skill identity.
- **Rationale:** Each change is small, deterministic, and unit-testable in isolation (satisfies req 12's testing posture). None touches the provider invocation, the `{ pass, notes }` contract, `classifyVerdict`, reporting, or the loop (req 8). The two "inject" changes (rubrics, task) both land in `judge-agent.ts`'s prompt assembly, which already has everything they need in scope.
- **Trade-offs / alternatives considered:** An alternative "big-bang" refactor of the judge prompt was rejected — the three concerns are orthogonal and are cleaner (and more testable) kept separate. Whether the rubric goes in the system prompt vs. user message, and whether the task goes in system vs. user message, are decided in the interfaces topic below.

### Topic: Components — new, modified, untouched-but-relevant

- **Spec link:** Requirements 1, 3, 4, 6, 7, 8.
- **Decision:**
  - **Modified — `src/scenarios/enumerate.ts`:** remove `RUBRICS_HEADING_RE`, `parseRubricsSection`, the rubric parse+validate block and `rubricsRoot` plumbing; stop setting `Scenario.rubrics`. **New export:** a section-strip helper (working name `stripSkillsSection(brief)` or the more general `stripSection(brief, isHeading)`) reusing `parseListSection`'s boundary logic (open at first `# Skills` heading any depth, close at next same-or-shallower heading or EOF; `\r\n?`→`\n` normalized). Natural home here — co-located with `SKILLS_HEADING_RE`/`HEADING_RE`. Responsibility: return the testing brief with its `# Skills` section removed, brief unchanged when absent.
  - **Modified — `src/pipeline/judge-agent.ts`:** remove `resolveRubricBlob` and the `loadRubric` single-id import; add **rubric load-all** (enumerate + sort + concat, dedupe by path — see mechanism topic) and **task injection** (strip `# Skills` from `scenario.testingBrief`, inject the remainder). `buildJudgeSystemPrompt` gains the task section and the guardrail-wrapped `# Grading rubrics` section; `runJudgeAgent` calls the new rubric loader instead of `resolveRubricBlob`.
  - **Modified — `src/scenarios/rubric-loader.ts` (`loadRubric`):** **repurposed, not deleted** — called per top-level `*.md` for the load-all, keeping its in-tree md-link expansion. (Or a thin new `loadAllRubrics(rubricsRoot)` wrapper here that enumerates + sorts + calls `loadRubric` per file + dedupes; keeps `judge-agent.ts` lean. Placement is a plan-phase nicety.)
  - **Modified — `src/config/types.ts`:** remove `Scenario.rubrics?` and its JSDoc. (`paths.rubrics?` stays as-is.)
  - **Untouched-but-relevant:** `src/pipeline/agent-loop.ts` (call site already passes `scenario`/`config`/`projectRoot` — no signature change); `src/reports/verdict.ts` (`classifyVerdict` — `{ pass, notes }` path unchanged); reporting, console/progress output, and the self-improvement loop (req 8); `src/pipeline/testing-agent.ts` (the testing agent's `# Skills` come from its system prompt via `loadSkill`, not the brief's list — so stripping the brief's `# Skills` for the judge does not affect testing behavior).
  - **`testing-project`:** the 11 `JUDGE.md` files (content conversion — see conversion topic); `eval/rubrics/*.md` **unchanged** (req 10); `skillsmith.config.ts` keeps `paths.rubrics: './eval/rubrics'`.
- **Rationale:** The change is contained to enumeration (removal + strip helper) and judge-prompt assembly (load-all + task inject). No new module, no new dependency, no call-site plumbing.

### Topic: Interfaces and data flow

- **Spec link:** Requirements 1, 3, 6, 7; acceptance criteria 1, 2, 5, 6.
- **Data flow (after change):**
  1. **Enumeration:** `JUDGE.md` read verbatim → `scenario.judgeBrief` (nothing parsed out of it — req 1). `TESTING-AGENT.md` read verbatim → `scenario.testingBrief`; its `# Skills` list still parsed for skill *loading* only (unchanged).
  2. **Judge invocation (`runJudgeAgent`, unchanged signature):** has `scenario` (incl. `judgeBrief`, `testingBrief`), `config`, `projectRoot` in scope.
  3. **Rubric content:** `loadAllRubrics(resolve(projectRoot, config.paths.rubrics))` → sorted, concatenated, guardrail-wrapped blob; `undefined` when path unset/empty.
  4. **Task content:** `stripSkillsSection(scenario.testingBrief)` → task-minus-`# Skills`.
  5. **Prompt assembly (`buildJudgeSystemPrompt`):** sections = `[ judgeBrief, taskSection, outputFormat(+recursion guard), gradingRubrics?, roleInstructions? ]`.
  6. **User message (`buildUserMessage`):** unchanged — only the produced files (the artifact). The `_scenario` param stays unused; the task goes in the *system prompt*, not here.
- **Key interface decisions:**
  - **Task placement — system prompt vs. user message.** *Decision:* **system prompt**, as a dedicated section (working heading `# Testing task` or `# Task under evaluation`) placed right after `judgeBrief` (so the judge reads the brief's checks in the context of what was asked). *Alternative considered:* the user message with a `--` separator (trunk's `origin/trunk:judge-agent.ts:181` precedent). *Rationale for system prompt:* the task is grading *context/instructions*, not the *artifact*; keeping the user message purely the produced files preserves the branch's clean "what the judge reads == what it verifies" invariant (JSDoc `judge-agent.ts:290-291`) and keeps `buildUserMessage` a pure file-inliner (no `scenario` dependency). Both are functionally valid; system-prompt placement is the cleaner fit for this branch's structure.
  - **`# Skills` strip granularity.** Strip the `# Skills` *section* (heading + its list/prose through the next same-or-shallower heading), not just the list items — so no skill identity leaks via surrounding prose (req 7 / AC6). If a brief has no `# Skills` heading, pass it through unchanged.
  - **Section builder stays pure.** `buildJudgeSystemPrompt` remains a pure string builder; the caller (`runJudgeAgent`) does the filesystem work (rubric load) and the strip, then passes strings in — mirroring today's `rubricBlob` param pattern, keeping the builder unit-testable (req 12).
- **Failure of neither breaks the run:** unset rubrics path → no rubric section; a `JUDGE.md` naming a nonexistent rubric → simply not present in the loaded set, no enumeration error (req 4/5, AC 3/4); a `TESTING-AGENT.md` with no `# Skills` heading → task passed through whole.

### Topic: `testing-project` conversion — the `## Scenario requirements` rule (RESOLVED)

- **Spec link:** Requirement 9 (remove `## Scenario requirements` + `# Rubrics` id-list; reference rubric in prose; keep environment/live-checks); acceptance criterion 8.
- **Analyst finding + researcher audit:** The `## Scenario requirements` blocks are **not** pure task restatements. A per-scenario audit (all 11: `TESTING-AGENT.md` task vs `JUDGE.md` block vs the rubric) classified each bullet as **(a)** duplicates the task, **(b)** UNIQUE judge check — a scenario-specific mechanism, not in the task and not in the rubric — or **(c)** already covered by the rubric. The rubric's own preamble (`rubric.md:3`) says its criteria "apply to every Interactivity API scenario and should not be duplicated in scenario-level acceptance lists" — so (c) bullets are redundant *by design*, safe (indeed intended) to drop.
- **Result:** Category-(b) content exists in **9 of 11** scenarios. Wholesale-deleting the block would lose real judge signal. (b) residue by scenario:
  - **Highest (b):** `focus-trap-menu` (a11y/focus-trap mechanics: single boolean drives drawer+aria-expanded, Tab/Shift+Tab trap via directives not addEventListener, Escape close, instance-scoped focus return, real anchors), `paginated-list` (router-region, `withSyncEvent`, generator + `import('@wordpress/interactivity-router')` + `navigate`, server `$_GET['pg']` slice, `clientNavigation` nuance, SDP-gotcha on Prev/Next omission), `config-fetch` (`wp_interactivity_config()` vs state/context, `getConfig()` read, `X-WP-Nonce`), `derived-double` (derived getter vs stored mutable field; action mutates only counter), `minimal-scaffold` (console.log inside a store **init callback**, not top-level/handler/watch; `data-wp-init="callbacks.<name>"`), `fruit-list-each` (`data-wp-each` + `<template>` not PHP foreach; in-place `.push()` not reassign).
  - **Moderate (b):** `independent-counters` (local context via `getContext()`, **not** global — rubric only "prefers"), `shared-state` (global `state.*`, **not** context — the mirror), `toggle-visibility` (single boolean drives both aria-expanded and hidden/negation).
  - **Minimal/none (b):** `counter` (reduces cleanly to task+rubric), `async-fetch` (one weak URL-literal check the auto-task already carries).
  - **Rubric usage:** all 11 reference exactly `wp-interactivity-api-best-practices`, one each — zero extra, zero missing.
- **Decision — the conversion rule.** For each of the 11 `JUDGE.md`:
  1. **Drop** the `# Rubrics` id-list and **reference the rubric in prose** instead (e.g. "grade the produced code against the WordPress Interactivity API best-practices rubric").
  2. **Drop** category-(a) bullets (now auto-supplied via the task) and category-(c) bullets (now covered by the auto-loaded rubric).
  3. **Preserve** category-(b) bullets — the scenario-specific mechanism checks — **re-homed** under a checks heading that is **not** named `## Scenario requirements` (e.g. `## What to check`, or folded into `## Live checks`). This satisfies AC8's literal "no `## Scenario requirements` block" while keeping the "specific things to check" the intent requires.
  4. **Keep** `## Environment` and `## Live checks` (the plain-language setup and live-behavior checks) as-is (req 9).
- **Rationale:** This reconciles the AC8 literal wording ("drop the block by that name + the id-list") with the intent ("keep the specific things to check"). A blanket wholesale-delete would satisfy AC8's letter but violate its intent and weaken judging in 9/11 scenarios. The (b) residue is exactly "the things to check," so it must survive under a renamed heading. Dropping (a)/(c) removes the duplication the revision targets. This is a `testing-project`-only content change (no bump — req 11).
- **Flag for design-writer / docs-writer / plan:** the design doc must state the conversion rule explicitly and instruct downstream **not** to interpret AC8 as "delete everything but Environment/Live checks."
- **Heading guidance (from worked examples):** re-home source-inspection (b) checks under a new `## What to check` heading (keeps the "read the source" vs "exercise the site" distinction the files already draw — "Confirm … in the produced code" vs "Open the published post"); keep genuinely live steps in `## Live checks`; add `## What to check` **only when there is (b) residue** (omit it in the clean case). Reword each intro that referenced the removed list ("requirements below" → "the task it was given"). Add one prose rubric-reference sentence naming the rubric by its human title, e.g. *"Also grade the produced code against the WordPress Interactivity API best-practices rubric."* (ordinary prose; Skillsmith parses nothing from it — req 1/2). All 11 `TESTING-AGENT.md` carry `# Skills` as a top-level `#` heading, last section (verified) — a clean strip target.

#### Worked conversion examples (anchor for the docs-writer)

Faithful to existing wording — only (a)/(c) bullets + the `# Rubrics` list are dropped, (b) checks re-homed, one prose rubric sentence added, `## Environment`/`## Live checks` kept.

**Example 1 — `minimal-scaffold` (HIGH-(b): init-callback + `data-wp-init` survive).** AFTER:
```
You are grading the smallest correctly-wired WordPress Interactivity API block. Decide whether it satisfies the task it was given, using both the produced source files and the live, running site.

Also grade the produced code against the WordPress Interactivity API best-practices rubric.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, insert them on a published post, then open that post in the browser to run the live checks below.

## What to check

- The `console.log("iapi-ready")` call lives inside an init callback registered on the store (e.g. `store("<namespace>", { callbacks: { <name>() { console.log("iapi-ready"); } } })`) — not as a top-level statement in `view.js`, not inside a `data-wp-on--*` handler, and not inside a `data-wp-watch` callback.
- The wrapper element rendered by `render.php` carries `data-wp-init="callbacks.<name>"` referencing that init callback so the runtime invokes it on hydration.

## Live checks

Open the published post. Confirm the page shows the text "Hello from iAPI". Watch the browser console while the page hydrates: the message "iapi-ready" must be logged (this only happens if the runtime actually picked the block up via its `data-wp-init` callback). Also confirm the block wrapper carries a non-empty `data-wp-interactive` namespace attribute.
```
Dropped: `# Rubrics` list; the (a)/(c) bullet "Hello from iAPI emitted by render.php server-side" (its outcome is in the auto-task; the surviving live-check confirms the text renders). *Judgment call flagged:* if the server-vs-client emission emphasis is wanted, keep it as a `## What to check` bullet — a docs-writer discretion point, not load-bearing.

**Example 2 — `counter` (CLEAN: ~zero (b); the minimal floor).** AFTER:
```
You are grading a WordPress interactive counter block that an agent produced. Decide whether it satisfies the task it was given, using both the produced source files and the live, running site.

Also grade the produced code against the WordPress Interactivity API best-practices rubric.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, insert them on a published post, then open that post in the browser to run the live checks below.

## Live checks

Open the published post. Confirm the rendered counter shows 5. Click the "Increment" button; the number must become 6. Click "Decrement" twice; the number must become 4.
```
All four `## Scenario requirements` bullets were (a) (named increment/decrement actions; initial 5) or (c) (data-wp-on--click; data-wp-text reactivity — both generic rubric criteria), so the block is dropped entirely and **no** `## What to check` is added. Demonstrates the clean floor: intro + rubric-reference + `## Environment` + `## Live checks`.

The other 9 follow the `minimal-scaffold` pattern (re-home their (b) set from the Topic-3 inventory); `counter` (and near-`async-fetch`) is the only near-empty case.

### Topic: Rubric delivery mechanism (RESOLVED — the one decision the spec defers)

- **Spec link:** Requirement 3 (judge **reliably** grades against the prose-named rubric); Requirement 4 (optional path, no error when unset/empty); acceptance criteria 2 & 3.
- **Options:**
  1. **A — Load-all-from-path, prose selects.** When `config.paths.rubrics` is set, load *every* top-level `*.md` rubric under it and inject them all into the judge system prompt; the `JUDGE.md` prose names which rubric(s) to apply and the judge selects. (Owner's candidate direction.)
  2. **B — Scoping/selection mechanism.** Skillsmith itself selects which rubric(s) to inject per scenario — either by re-introducing a parsed selector in `JUDGE.md`, or by fuzzy-matching the prose to rubric filenames in code, and injecting only the match(es).
- **Trade-offs:**
  - *Prompt budget:* Non-deciding. One rubric ≈ 1.1k tokens (the sole file today is 4,370 bytes / ~1,090 tokens, no md-links to expand); growth is linear (~9–11k tokens even at 8–10 rubrics) — modest against a judge that already receives the produced files and a full environment prompt. Reliability, not budget, is the deciding axis.
  - *Reliability:* At **N=1** (today's real, unchanging state per req 10) A is trivially reliable — there is nothing to confuse the single rubric with. As N grows, A's failure modes are: cross-contamination (blending a non-named rubric's criteria), wrong-rubric selection when titles are similar, and — the sharpest — **over-application** (a "here are the rubrics, grade against them" prompt reads as *all mandatory*, failing code for a rubric the scenario never named). Two cheap guardrails cover these (below). B avoids over-application but **re-adds the id-matching friction req 1/Q3 removed** (selector variant) or introduces brittle NL-matching code with its own failure modes (fuzzy variant), fighting the "fully-opaque `JUDGE.md`, fewer restrictions" intent for little gain at current scale.
  - *Multi-rubric future:* A scales by dropping files into the path — zero authoring ceremony, matching the owner's "eventually multiple rubrics, each scenario picks one/another" vision. If over-application ever bites at large N, a future revision can add scoping; pre-committing to B now is premature.
- **Decision:** **Mechanism A + two guardrails.**
  - **Load-all:** enumerate top-level `*.md` files under `resolve(projectRoot, config.paths.rubrics)`, **sorted by filename ascending** (determinism — `readdirSync` is unordered; matches the `enumerate.ts:263` id-sort convention), and concatenate. Reuse `loadRubric(<basename-without-.md>, rubricsRoot)` per top-level file so in-tree md-linked companions are still expanded for free; **dedupe** by resolved path (a companion that is also a top-level `.md` must not appear twice — or adopt the convention that companions live in a sub-dir, so only top-level files are enumerated). `loadRubric` is thus **repurposed, not deleted**.
  - **G1 — self-identifying per-rubric header.** Inject each rubric under a stable, matchable label carrying its **id** (filename without `.md`, the string an author sees) so prose→rubric matching is unambiguous; the rubric file's own H1 (e.g. `# WordPress Interactivity API Best Practices`) travels verbatim inside the body, giving authors a human name to reference too. Suggested label: `# Rubric: <id>` (borrows trunk's `judge-agent.ts:105` pattern).
  - **G2 — selection instruction.** Prepend one lead-in line to the rubric section instructing the judge to apply **only** the rubric(s) the brief names and treat the rest as reference-only, e.g.: *"The rubrics below are shared, reusable grading criteria. Apply ONLY the rubric(s) this scenario's brief refers to; the others are provided for reference and must not affect the verdict."* This is **new** phrasing (trunk never loaded extras, so has no precedent for it), but the adjacent skill-agnostic line is reusable from trunk (`:119`).
  - **Section:** keep the existing `# Grading rubrics` heading name (`buildJudgeSystemPrompt:208`) so the change is minimal and consistent; when the path is unset/empty, emit **no** `# Grading rubrics` section and **no** error (req 4 — mirrors today's `undefined`-blob behavior at `:207`).
- **Rationale:** A + G1 + G2 is the minimal design that meets req 3's reliability bar without re-adding structure to `JUDGE.md`. It honors the owner's leaning, satisfies the firm requirements (drop id-matching, reference in prose, reliably grade), is trivially reliable at today's N=1, and defends the one real future risk (over-application) with a single instruction line rather than new machinery. Determinism (sorted load) keeps the assembled prompt unit-testable (req 12).

### Topic: Dependencies

- **Spec link:** Requirements 1, 3, 8 (no new surface); req 12 (testability).
- **Decision:** **No new external dependencies.** Load-all uses `node:fs` (`readdirSync`, `existsSync`, `readFileSync`, `statSync` — all already used, incl. by `rubric-loader.ts`) and `node:path` (`resolve`, `join`). The strip helper reuses in-repo regexes/logic in `enumerate.ts`. Internal dependencies: `judge-agent.ts` → `rubric-loader.ts` (repurposed) and → `enumerate.ts` (new strip helper export). Removed dependency: `judge-agent.ts` no longer needs `Scenario.rubrics`. No change to providers, config schema (beyond removing `Scenario.rubrics`), or the WordPress `testing-project` runtime.
- **Rationale:** The design is a rearrangement of existing primitives; keeping the dependency surface flat matches the pre-1.0, minimal-footprint posture and avoids new failure modes.

### Topic: Failure modes and observability

- **Spec link:** Requirements 3, 4, 5, 8; acceptance criteria 1, 3, 4, 7.
- **Decision / analysis:**
  - **Rubrics path unset or empty:** `loadAllRubrics` returns `undefined`/empty → no `# Grading rubrics` section, run completes, **no error** (req 4, AC3). Same code path as today's `undefined` rubricBlob.
  - **`JUDGE.md` names a rubric with no file:** the reference is ordinary prose; the file simply isn't in the loaded set. No enumeration error, scenario still runs (req 5, AC4). The judge grades against whatever *is* loaded; if the named rubric is absent, its criteria are silently unavailable — an **accepted trade** (spec Out-of-Scope; no Skillsmith detection). *Observability note:* this silent miss is the main "surprise" surface; the design does not add detection (per spec), but the docs phase should tell authors that a mistyped rubric name is not reported.
  - **Over-application at large N (future):** mitigated by guardrail G2 (selection instruction). Not present today (N=1). Residual risk logged below.
  - **Rubric file unreadable / a linked companion missing:** `loadRubric` skips non-existent/non-file queue entries (`rubric-loader.ts:35-36`); a top-level entry that exists but errors on read is a pre-existing `loadRubric` behavior — the load-all should not let one bad file abort the whole judge run. *Design note for the plan:* wrap per-file loads so one unreadable rubric degrades to skipping that file (log at `log.info`), not throwing. (Today `resolveRubricBlob`→`loadRubric` would throw on a missing entry, but only for explicitly-listed ids; load-all enumerates existing files, so the missing-entry throw is largely mooted — still, guard the read.)
  - **Task with no `# Skills` section:** strip is a no-op; whole brief supplied. No error.
  - **Verdict/reporting/loop:** unchanged. `{ pass, notes }` flows through `classifyVerdict` and into the report and self-improvement context exactly as before (req 8, AC7). No new failure surface downstream.
  - **Logging:** reuse the existing `log.info` scope in `runJudgeAgent` (`judge:<scenario>@<agent>`). Optional (plan-phase) additions for debuggability: log the count of rubrics loaded and whether the task was supplied (kept minimal; no new log *contract*, since observability output is not a spec requirement to change).
- **Rationale:** Every failure path is a graceful degradation to "run with less context, no error," matching the spec's optionality and fewer-restrictions intent. The only silent-miss (mistyped rubric name) is an explicitly accepted trade.

### Topic: Spec coverage traceability (every requirement → a decision)

- **Spec link:** all requirements 1–12, acceptance criteria 1–9.
- **Requirements:**
  - **R1 (opaque `JUDGE.md`, remove `# Rubrics` parser/validation/selection):** Components topic (enumerate.ts removals) + removal surface in Research. → AC1, AC8.
  - **R2 (author references rubric in prose):** conversion rule (prose reference) + mechanism A (prose selects among loaded rubrics).
  - **R3 (judge reliably grades against prose-named rubric):** mechanism topic (A + G1 + G2). → AC2. Reliability caveat R3 (risk).
  - **R4 (rubrics path optional, no gate, unset/empty → no context, no error):** already-correct config (Research) + mechanism "no section, no error when empty". → AC3.
  - **R5 (no id-validation of prose references):** removal of enumeration validation (Components/Research). → AC4.
  - **R6 (auto-supply task on every run, unconditional):** interfaces/data-flow (task injection in `buildJudgeSystemPrompt`, always on). → AC5.
  - **R7 (task excludes `# Skills`):** strip helper (Components/interfaces). → AC6.
  - **R8 (judge/verdict/reporting/loop unchanged):** Components untouched list + failure-modes. → AC7.
  - **R9 (convert all 11 `JUDGE.md`):** conversion rule topic. → AC8.
  - **R10 (rubric file content unchanged; keep `paths.rubrics`):** Components (`eval/rubrics/*` untouched; config keeps `paths.rubrics`).
  - **R11 (changeset — core `minor`, testing-project no bump):** Open Question (amend vs add).
  - **R12 (testing posture — deterministic unit/integration; behavioral manual; ≤1 scenario×1 agent):** Open Question (deterministic coverage list) + risks R1/R3. → AC9.
  - **Owner directive (consult `origin/trunk`):** Research "Trunk precedents" section.
- **Gap check:** every requirement and acceptance criterion maps to a recorded decision or component. No requirement is un-addressed; no decision designs beyond the spec.

## Open Questions

<!-- Unresolved sub-questions deferred to the implementation phases. -->

- **Changeset: amend vs. add (spec req 11).** The existing `.changeset/flexible-scenarios-judge-verification.md` (review-1) documents the rubric-by-id model this revision reverses. Options: (a) amend that changeset to describe the final natural-language model, or (b) add a second `minor` changeset for this revision. Both satisfy "a `minor` changeset is recorded, pre-1.0." Recommendation for the plan phase: **amend the existing changeset** so the PR ships one coherent release note describing the final shape (natural-language rubric reference + auto-supplied skill-agnostic task), rather than a note describing rubric-by-id followed by a note reversing it. Deferred to the code-plan/docs phases; not a design blocker.

- **Exact heading strings (cosmetic, plan/writer discretion).** Working names used in this record: task section `# Testing task` (or `# Task under evaluation`); rubric section keeps `# Grading rubrics`; per-rubric header `# Rubric: <id>`; G2 lead-in line. Final wording is a plan/writer nicety; the *structure* and *placement* are the load-bearing decisions.

- **Deterministic test coverage to specify in the plan (req 12 / AC9).** Unit/integration tests should cover: (1) `# Rubrics` parser fully removed — no code parses it (AC1, AC8); (2) `stripSkillsSection` — strips the section, no-op when absent, handles `# Skills` as last section and `\r\n`; (3) `loadAllRubrics` — sorted, concatenated, deduped, `undefined`/empty on unset/empty path (AC3); (4) `buildJudgeSystemPrompt` — includes task (minus `# Skills`), includes `# Grading rubrics` with G1/G2 when rubrics present, omits it when none, still emits output-format/recursion-guard/role sections (AC1, AC5, AC6); (5) enumeration does not error on a prose rubric reference with no file (AC4); (6) verdict/report wiring unchanged (`classifyVerdict` `{ pass, notes }`) (AC7). Full behavioral reliability (does the judge *act* on the named rubric) stays manual/owner-run.

## Risks

<!-- Anything worth flagging to the design-doc-writer and downstream phases. -->

- **R1 — Over-application of rubrics at large N (reliability, req 3).** With load-all, a future project with many rubrics could see the judge apply criteria from rubrics the scenario never named, biasing the verdict. *Mitigation:* guardrail G2 (selection instruction) + G1 (self-identifying headers). *Not present today* (N=1). If it ever bites, a future revision can add scoping. Behavioral verification of G2's effectiveness is manual/owner-run (req 12).
- **R2 — Silent mistyped-rubric reference (accepted).** A `JUDGE.md` naming a nonexistent rubric produces no error; that rubric's criteria are silently unavailable. Explicitly accepted (spec Out-of-Scope / req 5). *Mitigation:* docs phase should note authors get no feedback on a typo.
- **R3 — Reliability is behavioral, not gate-verified.** Req 3's "reliably grades" is a first-class quality bar but full behavioral verification stays manual (req 12); deterministic gates only prove the prompt is *assembled* correctly (rubric present, task present, `# Skills` absent), not that the judge *acts* on it. The design leans on G1/G2 + the small N=1 reality to make reliability near-certain today; downstream should not mistake green gates for behavioral proof.
- **R4 — `## Scenario requirements` conversion could drop judge signal.** The blocks contain some unique implementation-level checks, not just task duplication (see conversion topic). A naive "delete the block" conversion risks losing category-(b) checks. *Mitigation:* the conversion rule (pending audit) must preserve unique checks in the retained checks/live-checks prose. Downstream (docs-writer converting the 11 files) must follow the rule, not delete wholesale.
- **R5 — Changeset describes the reversed model.** The existing review-1 changeset documents rubric-by-id. If left unamended, the shipped release note contradicts the final behavior. *Mitigation:* plan phase amends it (see Open Questions).
- **R6 — Stale docs/examples reference the removed model.** `README.md` "Reusable rubrics" section and `examples/skillsmith.config.ts` comments describe `# Rubrics` id-lists. *Mitigation:* docs phase updates them; not a code-phase blocker but must not be forgotten (they are user-facing).
