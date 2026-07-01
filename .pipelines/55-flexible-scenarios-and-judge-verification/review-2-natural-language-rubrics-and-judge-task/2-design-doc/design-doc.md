# Design Doc: Leaner judge briefs — natural-language rubrics and an auto-supplied task

## Overview

Skillsmith is a scenario-based evaluation harness for coding agents. For each scenario a **testing agent** implements something from a `TESTING-AGENT.md` brief, a **judge** verifies the result against a live environment from a `JUDGE.md` brief and returns a `{ pass, notes }` verdict, and a self-improvement loop rewrites the project's *skills* until scenarios pass.

An earlier increment on this branch (review-1) made the judge's rubric grading reusable by teaching Skillsmith to parse a `# Rubrics` id-list out of `JUDGE.md`, validate each id against a rubric file at enumeration time, and inject the matched rubric(s) into the judge prompt. In practice that reintroduced two frictions the two-file model was meant to avoid: a **required, id-matched structured section** inside `JUDGE.md`, and **`JUDGE.md` files that repeat the task** (a `## Scenario requirements` block duplicating `TESTING-AGENT.md`).

This revision makes a scenario's `JUDGE.md` leaner to author and free of duplication, in two moves. (1) **Rubrics referenced in natural language:** `JUDGE.md` becomes fully opaque prose — Skillsmith parses nothing structured out of it — and an author names the rubric to grade against in plain language. (2) **The judge is told the task automatically:** Skillsmith supplies the testing agent's task to the judge on every run (minus the brief's `# Skills` section), so `JUDGE.md` no longer restates it. The judge itself is unchanged: it stays the live behavioral judge returning `{ pass, notes }`, and reporting and the self-improvement loop are untouched. The work spans Skillsmith core (remove the review-1 `# Rubrics` machinery; deliver rubrics by loading all of them from the configured path; auto-supply the skill-agnostic task) and the bundled `testing-project` (convert all 11 scenario `JUDGE.md` files to the new shape). This is **not** a revert to `origin/trunk`'s read-only structured `{ rubrics, acceptance }` grader — the branch's live `{ pass, notes }` judge stays.

## Approach

The feature is realized as **three cohesive, mostly-independent changes at the enumeration/judge boundary**. Nothing outside that boundary changes: the provider invocation, the `{ pass, notes }` verdict contract, `classifyVerdict`, the report, console/progress output, and the self-improvement loop are all untouched. The two "inject" changes both land in `judge-agent.ts`'s prompt assembly, which already has everything it needs in scope (`runJudgeAgent` already receives the full `scenario`, `config`, and `projectRoot`), so **no new call-site plumbing** is required.

**Change 1 — Make `JUDGE.md` fully opaque (removal).** Delete the review-1 `# Rubrics` parser, its enumeration-time id validation, the `Scenario.rubrics` field, the per-scenario rubric resolver in the judge (`resolveRubricBlob`), and the id-matched injection path. After this, enumeration reads `JUDGE.md` verbatim into `scenario.judgeBrief` and parses nothing out of it. Enumeration still parses the *testing* brief's `# Skills` section — but only for skill *loading*, which is unchanged.

**Change 2 — Deliver rubric content by "load-all-from-path".** When `config.paths.rubrics` is set, the judge loads *every* top-level `*.md` rubric under it (sorted, deduped), concatenates them, and injects the result into the judge system prompt under a single `# Grading rubrics` heading. The `JUDGE.md` prose names which rubric(s) apply, and the judge selects. Two guardrails make the prose→rubric mapping reliable (see Key Decisions). When `paths.rubrics` is unset or the directory is empty, **no** rubric section is emitted and **no** error is raised.

**Change 3 — Auto-supply the skill-agnostic task.** On every judge run, strip the `# Skills` section from `scenario.testingBrief` and inject the remainder into the judge system prompt (a dedicated task section placed right after the `judgeBrief`), so `JUDGE.md` need not restate the task and the judge never learns which skill(s) were used.

**`testing-project` conversion.** All 11 scenario `JUDGE.md` files are rewritten to the new shape: drop the `# Rubrics` id-list, reference the rubric in prose, drop the task-duplicating and rubric-covered bullets, and re-home the scenario-specific mechanism checks under a non-`## Scenario requirements` heading (see the conversion rule in Key Decisions). The rubric file content is unchanged and the project keeps `paths.rubrics: './eval/rubrics'`.

The implementer's mental model: *enumeration produces opaque briefs; the judge, at invocation time, assembles its system prompt from the verbatim `judgeBrief` + the auto-supplied (skill-stripped) task + all rubrics loaded from the configured path (guardrail-wrapped) + the existing output-format/recursion-guard/role sections; the user message stays purely the produced files.*

## Components

Paths below are on the branch (`worktree-55-...`) unless marked `origin/trunk`. Line numbers reflect the current branch state and are indicative anchors, not contracts.

### Modified — `src/scenarios/enumerate.ts`

Enumeration loses all rubric machinery and gains a section-strip helper.

- **Remove** `RUBRICS_HEADING_RE` (`:15`) and `parseRubricsSection` (`:122-128`).
- **Remove** the rubric parse+validate block in `scenarioFromBriefs` (`:311-325`) and stop writing `Scenario.rubrics` (the `rubrics` field in the scenario literal at `:330` and in `stubScenario` at `:359`).
- **Remove** the `rubricsRoot` plumbing: computed in `enumerateScenarios` (`:204-207`), passed into `scenarioFromBriefs` (`:235`), and the `rubricsRoot` parameter (`:288`). After removal, `enumerateScenarios` no longer computes or threads a rubrics root.
- **Update** the JSDoc on `EnumeratedScenario` (`:149-172`), `enumerateScenarios` (`:174-197`), `scenarioFromBriefs` (`:266-282`), and `stubScenario` (`:341-350`) to drop all mentions of `# Rubrics`/`rubrics`.
- **Keep** `parseListSection` (`:39-69`), `HEADING_RE` (`:11`), `SKILLS_HEADING_RE` (`:13`), and `parseSkillsSection` (`:93-99`) — the `# Skills` section is still parsed for skill loading.
- **Add** a new exported **section-strip** helper (working name `stripSkillsSection( testingBrief: string ): string`). Responsibility: return the testing brief with its `# Skills` section removed. It reuses `parseListSection`'s boundary logic — locate the first heading whose text matches `SKILLS_HEADING_RE` at any depth, and remove from that heading line through the line before the next heading of same-or-shallower depth (or EOF). Line endings are normalized (`\r\n?` → `\n`) before matching, mirroring `parseListSection`. When the brief has no `# Skills` heading, it returns the brief unchanged. Because `parseListSection` only returns list-item *ids* (not the section span), this is a genuinely new helper; it is co-located here with the heading regexes it depends on. A more general `stripSection( brief, isHeading )` factoring is acceptable if the plan prefers it, but only one call site (`# Skills`) exists today.

### Modified — `src/pipeline/judge-agent.ts`

The judge gains rubric load-all and task injection, and loses the per-scenario rubric resolver.

- **Remove** `resolveRubricBlob` (`:122-138`) and its sole call in `runJudgeAgent` (`:65`).
- **Change** the `loadRubric` import (`:10`) — see rubric-loader below (repurposed, not removed).
- **Add** rubric load-all: at `runJudgeAgent`, when `config.paths.rubrics` is set, load all rubrics from `resolve( projectRoot, config.paths.rubrics )` into a single concatenated, guardrail-wrapped blob; `undefined` when the path is unset or the directory yields no rubric files.
- **Add** task injection: compute `stripSkillsSection( scenario.testingBrief )` and pass the result into the system-prompt builder.
- **Modify** `buildJudgeSystemPrompt`. Today (`:189-215`) it assembles `[ judgeBrief, outputInstruction, rubricBlob?, rolePrompt? ]`. After the change it assembles `[ judgeBrief, taskSection, outputInstruction, gradingRubrics?, rolePrompt? ]`, where:
  - `taskSection` is the skill-stripped task under a dedicated heading (working name `# Testing task` or `# Task under evaluation`), placed **immediately after `judgeBrief`** so the judge reads its checks in the context of what was asked. This section is always present (auto-supply is unconditional, req 6); it is passed in as a string param, keeping the builder pure.
  - `gradingRubrics` keeps the existing `# Grading rubrics` heading name (`:208`) but its body is guardrail-wrapped (G1 + G2 lead-in, see Key Decisions). Omitted entirely when the rubric blob is `undefined`/empty (mirrors today's behavior at `:207`).
  - The builder stays a **pure string builder** (no filesystem access): `runJudgeAgent` does the filesystem work (rubric load) and the strip, then passes strings in — mirroring today's `rubricBlob` param pattern, so the builder stays unit-testable.
- **Update** the JSDoc on `runJudgeAgent` (`:37-49`) and `buildJudgeSystemPrompt` (`:171-188`) to describe the auto-supplied task and the load-all rubric section.
- **Unchanged:** `buildUserMessage` (`:293-312`) — the user message stays purely the inlined produced files; its `_scenario` param stays deliberately unused. `parseJudgeJson`, `judgeCapabilities`, the provider invocation, and the `{ pass, notes }` return contract are untouched.

### Modified — `src/scenarios/rubric-loader.ts` (`loadRubric`)

**Repurposed, not deleted.** `loadRubric( id, rubricsRoot )` (`:18-58`) loads `<rubricsRoot>/<id>.md` plus every in-tree md-linked companion file (BFS, dedup by visited set, external/absolute/anchor/mailto links skipped, `#fragments` stripped), emitting each as `=== <rel-path> ===\n<text>`. Its **only** prior production caller was `resolveRubricBlob`; once that is removed, `loadRubric` would be orphaned. Instead it becomes the per-file primitive of the load-all: a new `loadAllRubrics( rubricsRoot )` enumerates top-level `*.md` files, sorts them by filename ascending, calls `loadRubric( <basename-without-.md>, rubricsRoot )` per file (so md-link expansion is retained for free), and dedupes by resolved path. Placement of `loadAllRubrics` (in `rubric-loader.ts` as a sibling of `loadRubric`, vs. inline in `judge-agent.ts`) is a plan-phase nicety; the research recommends `rubric-loader.ts` to keep `judge-agent.ts` lean. `loadRubric`'s existing throw-on-missing-entry behavior (`:20-24`) is largely mooted because load-all only ever passes ids that came from a directory listing, but per-file reads should still be guarded (see Failure Modes).

### Modified — `src/config/types.ts`

- **Remove** the `Scenario.rubrics?` field and its JSDoc (`:197-202`), and drop the `rubrics` reference in the `EnumeratedScenario`/scenario doc prose that mentions parsing `# Rubrics`.
- **Keep** `Paths.rubrics?` (`:146-155`) exactly as-is — optional, no default, no start-up existence gate.

### Modified — `testing-project` scenario briefs

- The **11** scenario `JUDGE.md` files under `testing-project/eval/scenarios/*/` are rewritten per the conversion rule (see Key Decisions). Directories: `async-fetch`, `config-fetch`, `counter`, `derived-double`, `focus-trap-menu`, `fruit-list-each`, `independent-counters`, `minimal-scaffold`, `paginated-list`, `shared-state`, `toggle-visibility`.
- `testing-project/eval/rubrics/wp-interactivity-api-best-practices.md` (the single rubric file, H1 `# WordPress Interactivity API Best Practices`) is **unchanged** (req 10).
- `testing-project/skillsmith.config.ts` keeps `paths.rubrics: './eval/rubrics'` (`:76`) — the project stays opted-in to rubrics.

### Untouched-but-relevant (verified, no signature or behavior change)

- **`src/pipeline/agent-loop.ts`** — the `runJudgeAgent` call site (`:273-283`) already passes `scenario`, `config`, and `projectRoot`. No signature change, no new argument.
- **`src/reports/verdict.ts`** — `classifyVerdict` already handles `{ pass, notes }`; its legacy `{ rubrics, acceptance }` branch is untouched.
- **`src/pipeline/testing-agent.ts`** — the testing agent loads the skills it *uses* from the skills directory into its own system prompt via `loadSkill` (`:42-45`), **not** from the brief's `# Skills` list. The brief's `# Skills` list is only a reference list Skillsmith parses to know which skills to load. Therefore stripping `# Skills` from the copy handed to the judge changes nothing about what the testing agent did — it only hides skill identity from the judge (exactly req 7).
- **Config defaults / path checks** — `DEFAULT_PATHS` has no `rubrics` entry and `checkPaths` gates only `['skills','scenarios']`; no change is needed for req 4 (this branch already differs from `origin/trunk`, which makes `rubrics` required, defaulted, and existence-gated — that shape is deliberately **not** re-adopted).

## Interfaces and Data Flow

### Data flow after the change

1. **Enumeration.** `JUDGE.md` is read verbatim into `scenario.judgeBrief`; nothing is parsed out of it (req 1). `TESTING-AGENT.md` is read verbatim into `scenario.testingBrief`; its `# Skills` list is still parsed via `parseSkillsSection` for skill *loading* only. `Scenario.rubrics` no longer exists.
2. **Judge invocation.** `runJudgeAgent` has `scenario` (incl. `judgeBrief`, `testingBrief`), `config`, and `projectRoot` in scope (unchanged signature). It computes two derived strings:
   - **Rubric content:** `loadAllRubrics( resolve( projectRoot, config.paths.rubrics ) )` → sorted, concatenated, deduped, guardrail-wrapped blob; `undefined` when `config.paths.rubrics` is unset or the directory has no rubric files.
   - **Task content:** `stripSkillsSection( scenario.testingBrief )` → the task minus its `# Skills` section.
3. **System-prompt assembly.** `buildJudgeSystemPrompt` builds sections in order: `[ judgeBrief, taskSection, outputInstruction (+recursion guard), gradingRubrics?, rolePrompt? ]`.
4. **User message.** `buildUserMessage` is unchanged — only the produced files, inlined as `=== <rel> ===\n<body>` blocks (with the `=== (no files written) ===` fallback). The task goes in the *system prompt*, not here.
5. **Provider invoke → verdict.** Unchanged: the judge emits a single JSON object, `parseJudgeJson` parses it, and `{ pass, notes }` flows through `classifyVerdict` into the report and self-improvement context exactly as before.

### Interface sketches (illustrative, not final)

New enumeration export:

```ts
// src/scenarios/enumerate.ts
export function stripSkillsSection( testingBrief: string ): string;
// Returns testingBrief with its `# Skills` section (heading through the line
// before the next same-or-shallower heading, or EOF) removed; unchanged when absent.
```

New rubric-loader export (placement is a plan nicety):

```ts
// src/scenarios/rubric-loader.ts
export function loadAllRubrics( rubricsRoot: string ): string | undefined;
// Enumerate top-level *.md under rubricsRoot, sort ascending, loadRubric() each,
// dedupe by resolved path, wrap each under a `# Rubric: <id>` header (G1);
// undefined when no rubric files. The G2 lead-in may be added by the caller
// or here — a plan nicety, so long as it precedes the rubric bodies.
```

`buildJudgeSystemPrompt` gains a task-string parameter:

```ts
// src/pipeline/judge-agent.ts
export function buildJudgeSystemPrompt(
	scenario: Scenario,
	config: SkillsmithConfig,
	task: string,            // stripSkillsSection( scenario.testingBrief ), always present
	rubricBlob?: string      // load-all blob, undefined => no `# Grading rubrics` section
): string;
```

### Assembled judge system prompt (illustrative shape)

```
<verbatim JUDGE.md judgeBrief>

# Testing task
<TESTING-AGENT.md content with its `# Skills` section removed>

# Output format
Return a single JSON object with exactly these two keys:
  { "pass": <bool>, "notes": "<string>" }
...
# Recursion guard
...

# Grading rubrics
The rubrics below are shared, reusable grading criteria. Apply ONLY the
rubric(s) this scenario's brief refers to; the others are provided for
reference and must not affect the verdict.        <-- G2 selection instruction

# Rubric: wp-interactivity-api-best-practices       <-- G1 self-identifying header
=== wp-interactivity-api-best-practices.md ===
# WordPress Interactivity API Best Practices
...rubric body...

# Role instructions
<config.roles.judge.prompt, when set>
```

When `paths.rubrics` is unset or empty, the entire `# Grading rubrics` block (including G2) is omitted and no error is raised.

### `testing-project` `JUDGE.md` shape after conversion (author-facing)

Opaque prose the judge reads verbatim; Skillsmith parses nothing from it:

```
<intro prose: "…Decide whether it satisfies the task it was given, using both
the produced source files and the live, running site.">

Also grade the produced code against the WordPress Interactivity API best-practices rubric.

## Environment
<plain-language setup, unchanged>

## What to check          <-- present ONLY when a scenario has category-(b) residue
- <scenario-specific mechanism check re-homed from `## Scenario requirements`>

## Live checks
<plain-language live-behavior steps, unchanged>
```

## Key Decisions

### Decision: `JUDGE.md` is fully opaque — remove the review-1 `# Rubrics` machinery

- **Choice:** Delete `parseRubricsSection`/`RUBRICS_HEADING_RE`, the enumeration-time id validation, `Scenario.rubrics`, `resolveRubricBlob`, and the id-matched `# Grading rubrics` path. Enumeration reads `JUDGE.md` verbatim and parses nothing from it. `JUDGE.md` has no required or reserved section names.
- **Alternatives:** Keep the parser but make it optional; support the `# Rubrics` id-list *alongside* the new prose model.
- **Trade-offs:** Removing the parser is the whole point of the revision (no required structured section, fewer authoring restrictions); supporting both models is explicitly out of scope (no backward compatibility with the id-section) and would perpetuate the friction. The accepted cost is that a mistyped rubric reference in prose is no longer detected at enumeration.
- **Traces to:** Requirements 1, 5; Acceptance criteria 1, 4, 8.

### Decision: Rubric delivery = load-all-from-path (Mechanism A) + two guardrails

- **Choice:** When `config.paths.rubrics` is set, load **all** top-level `*.md` rubrics under it (sorted ascending by filename, deduped by resolved path, md-linked companions expanded via the repurposed `loadRubric`), concatenate them into one `# Grading rubrics` section, and let the `JUDGE.md` prose select which apply. Add two guardrails: **G1** — inject each rubric under a self-identifying `# Rubric: <id>` header (the id being the filename without `.md`, the string an author references), with the file's own H1 traveling verbatim inside the body as a human name; **G2** — prepend a one-line selection instruction telling the judge to apply **only** the rubric(s) the brief names and treat the rest as reference-only. When the path is unset or the directory has no rubric files, emit no section and no error.
- **Alternatives:** Mechanism B — Skillsmith itself selects which rubric(s) to inject per scenario, either by re-introducing a parsed selector in `JUDGE.md` (re-adds the id-matching friction req 1 removes) or by fuzzy-matching prose to rubric filenames in code (brittle NL-matching with its own failure modes).
- **Trade-offs:** Prompt budget is not the deciding axis — one rubric ≈ 1.1k tokens (the sole file today is ~1,090 tokens with no md-links to expand); growth is linear (~9-11k tokens even at 8-10 rubrics), modest against a judge that already receives the produced files and a full environment prompt. Reliability is the deciding axis. At today's **N=1** (one rubric, per req 10), Mechanism A is trivially reliable — nothing to confuse the single rubric with. As N grows, A's sharpest risk is **over-application** (a "here are the rubrics, grade against them" prompt reading as *all mandatory*), covered by G2; cross-contamination and wrong-rubric selection are covered by G1's unambiguous per-rubric labeling. B avoids over-application but reintroduces either structure or brittle matching, fighting the "fully-opaque `JUDGE.md`, fewer restrictions" intent for little gain at current scale. A scales by dropping files into the path with zero authoring ceremony; if over-application ever bites at large N, a future revision can add scoping — pre-committing to B now is premature.
- **Traces to:** Requirements 3, 4; Acceptance criteria 2, 3.

### Decision: Determinism — the load-all is sorted

- **Choice:** `readdirSync` is unordered, so `loadAllRubrics` sorts the enumerated `*.md` filenames ascending before loading, matching the existing id-sort convention in `enumerate.ts` and keeping the assembled prompt stable.
- **Alternatives:** Rely on filesystem order (non-deterministic across platforms).
- **Trade-offs:** A single `.sort()` makes `buildJudgeSystemPrompt`'s output deterministic and therefore unit-testable, at negligible cost.
- **Traces to:** Requirement 3 (reliability); Requirement 12 / Acceptance criterion 9 (deterministic gates).

### Decision: Auto-supply the task via the judge system prompt, minus `# Skills`

- **Choice:** On every judge run, strip the `# Skills` *section* (heading + its list/prose through the next same-or-shallower heading) from `scenario.testingBrief` via `stripSkillsSection`, and inject the remainder as a dedicated task section in the judge **system prompt**, placed immediately after the `judgeBrief`. Auto-supply is unconditional (not a config toggle). Strip the whole section, not just the list items, so no skill identity leaks via surrounding prose; when a brief has no `# Skills` heading, pass it through unchanged.
- **Alternatives:** (1) Place the task in the judge **user message** after a `--` separator — `origin/trunk`'s pattern (`origin/trunk:src/pipeline/judge-agent.ts:181` appends `scenario.description`); note trunk supplied only a short `description` field that carried no skills, so it never needed stripping, and that field is gone on this branch (the full task is `scenario.testingBrief`). (2) Strip only the `# Skills` list items rather than the whole section.
- **Trade-offs:** The task is grading *context/instructions*, not the *artifact*. Placing it in the system prompt preserves the branch's clean "what the judge reads (user message) == what it verifies (produced files)" invariant and keeps `buildUserMessage` a pure file-inliner with no `scenario` dependency. Both placements are functionally valid; system-prompt placement is the cleaner fit for this branch's structure. Stripping the whole section (not just list items) is required because prose around the list could still name the skill.
- **Traces to:** Requirements 6, 7; Acceptance criteria 5, 6.

### Decision: Keep the live `{ pass, notes }` judge, reporting, and loop unchanged

- **Choice:** Do not touch the provider invocation, the `{ pass, notes }` verdict shape, `classifyVerdict`, the report contents, console/progress output, or the self-improvement loop. This is explicitly **not** a revert to `origin/trunk`'s read-only structured `{ rubrics, acceptance }` grader.
- **Alternatives:** Re-adopt trunk's structured grader verdict.
- **Trade-offs:** The three changes are orthogonal to the verdict pipeline; keeping it fixed minimizes blast radius and keeps the changes independently testable. Reverting to trunk's grader is out of scope and would undo the branch's live behavioral judge.
- **Traces to:** Requirement 8; Acceptance criterion 7.

### Decision: `testing-project` conversion rule — preserve unique judge checks, do NOT wholesale-delete `## Scenario requirements`

- **Choice:** For each of the 11 `JUDGE.md` files: (1) drop the `# Rubrics` id-list and add a plain-prose rubric reference instead (e.g. "Also grade the produced code against the WordPress Interactivity API best-practices rubric"); (2) drop category-(a) bullets (task duplication, now auto-supplied via the task) and category-(c) bullets (already covered by the auto-loaded rubric); (3) **preserve** category-(b) bullets — the scenario-specific mechanism checks not in the task and not in the rubric — re-homed under a checks heading that is **not** named `## Scenario requirements` (working name `## What to check`), added **only when there is (b) residue**; (4) keep `## Environment` and `## Live checks` as-is; reword any intro that referenced "the requirements below" to "the task it was given". Downstream must **not** interpret AC8 as "delete everything but Environment/Live checks."
- **Alternatives:** Wholesale-delete the `## Scenario requirements` block entirely (satisfies AC8's letter but violates its intent).
- **Trade-offs:** A per-scenario audit of all 11 (`TESTING-AGENT.md` task vs. `JUDGE.md` block vs. the rubric) found category-(b) content in **9 of 11** scenarios — real judge signal that a blanket delete would lose. The rubric's own preamble states its criteria "apply to every Interactivity API scenario and should not be duplicated in scenario-level acceptance lists," so category-(c) bullets are redundant by design and safe (indeed intended) to drop. Re-homing (b) under a renamed heading satisfies AC8's literal "no `## Scenario requirements` block, no `# Rubrics` id-list" while honoring its intent ("keep the specific things to check"). All 11 reference exactly `wp-interactivity-api-best-practices`, one each. This is a `testing-project`-only content change (no version bump).
  - **(b) residue by scenario** (what must survive): highest — `focus-trap-menu` (single boolean drives drawer + aria-expanded; Tab/Shift+Tab trap via directives not addEventListener; Escape close; instance-scoped focus return; real server-rendered anchors), `paginated-list` (`data-wp-router-region`; `withSyncEvent`; generator + `import('@wordpress/interactivity-router')` + `navigate`; server `$_GET['pg']` slice; `clientNavigation` nuance; SDP-gotcha on Prev/Next omission), `config-fetch` (`wp_interactivity_config()` not state/context; `getConfig()` read; `X-WP-Nonce` from config; exact server APIs), `derived-double` (derived getter vs stored mutable field; action mutates only counter; directive references the getter), `minimal-scaffold` (`console.log` inside a store init callback, not top-level/handler/watch; `data-wp-init="callbacks.<name>"`), `fruit-list-each` (`data-wp-each` + `<template>` not PHP foreach; in-place `.push()` not reassign); moderate — `independent-counters` (local context via `getContext()`, not global), `shared-state` (global `state.*`, not context — the mirror), `toggle-visibility` (single boolean drives both aria-expanded and hidden/negation); minimal/none — `counter` (reduces cleanly to task + rubric, no `## What to check`), `async-fetch` (one weak URL-literal check the auto-task already carries).
- **Traces to:** Requirement 9; Acceptance criterion 8.

#### Worked conversion examples

Faithful to existing wording — only (a)/(c) bullets and the `# Rubrics` list are dropped, (b) checks re-homed, one prose rubric sentence added, `## Environment`/`## Live checks` kept.

**Example 1 — `minimal-scaffold` (HIGH-(b): init-callback + `data-wp-init` survive). AFTER:**

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

Dropped: the `# Rubrics` list; the (a)/(c) bullet "Hello from iAPI emitted by render.php server-side" (its outcome is in the auto-task; the surviving live-check confirms the text renders). *Discretion point (not load-bearing):* if the server-vs-client emission emphasis is wanted, keep it as a `## What to check` bullet.

**Example 2 — `counter` (CLEAN: ~zero (b); the minimal floor). AFTER:**

```
You are grading a WordPress interactive counter block that an agent produced. Decide whether it satisfies the task it was given, using both the produced source files and the live, running site.

Also grade the produced code against the WordPress Interactivity API best-practices rubric.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, insert them on a published post, then open that post in the browser to run the live checks below.

## Live checks

Open the published post. Confirm the rendered counter shows 5. Click the "Increment" button; the number must become 6. Click "Decrement" twice; the number must become 4.
```

All four original `## Scenario requirements` bullets were (a) (named increment/decrement actions; initial 5) or (c) (`data-wp-on--click`; `data-wp-text` reactivity — both generic rubric criteria), so the block is dropped entirely and **no** `## What to check` is added. This is the clean floor: intro + rubric-reference + `## Environment` + `## Live checks`. The other 9 follow the `minimal-scaffold` pattern (re-home their (b) set); `counter` (and near-`async-fetch`) is the only near-empty case.

## Dependencies

- **No new external dependencies.** Load-all uses `node:fs` (`readdirSync`, `existsSync`, `readFileSync`, `statSync` — all already imported, incl. by `rubric-loader.ts`) and `node:path` (`resolve`, `join`, `relative`). The strip helper reuses in-repo regexes and the `parseListSection` boundary logic in `enumerate.ts`.
- **Internal dependencies:** `judge-agent.ts` → `rubric-loader.ts` (the repurposed `loadRubric`/new `loadAllRubrics`) and → `enumerate.ts` (the new `stripSkillsSection` export). `judge-agent.ts` **loses** its dependency on `Scenario.rubrics`.
- **No change** to providers, the config schema (beyond removing `Scenario.rubrics`), or the WordPress `testing-project` runtime. `Paths.rubrics?` stays optional with no default and no start-up existence gate. This is a rearrangement of existing primitives, keeping the dependency surface flat — matching the pre-1.0, minimal-footprint posture.
- **Consult `origin/trunk`, not only this branch** (owner directive): trunk still carries the original rubric-loading machinery and rubric content this change builds on, and it supplies reusable precedents — the skill-agnostic judge clause ("Do not consult any skill documentation.", `origin/trunk:src/pipeline/judge-agent.ts:119`), the task-in-user-message placement pattern (`:181`), and the per-rubric header pattern `# Rubric: <id>` (`:105`). Trunk's **required, defaulted, existence-gated** `paths.rubrics` shape is deliberately **not** re-adopted; the branch's optional/un-gated shape is correct per the spec.

## Failure Modes and Observability

Every failure path degrades gracefully to "run with less context, no error," matching the spec's optionality and fewer-restrictions intent.

- **Rubrics path unset or empty:** `loadAllRubrics` returns `undefined` (or the caller treats an empty result as such) → no `# Grading rubrics` section, run completes, **no error**. Same code path as today's `undefined` rubric blob. (Req 4, AC3.)
- **`JUDGE.md` names a rubric with no file:** the reference is ordinary prose; the named file is simply absent from the loaded set. No enumeration error, scenario still runs. The judge grades against whatever *is* loaded; if the named rubric is absent, its criteria are silently unavailable — an **accepted trade** (spec Out-of-Scope; Skillsmith performs no detection). This silent miss is the main "surprise" surface; the docs phase should tell authors a mistyped rubric name is not reported. (Req 5, AC4.)
- **A rubric file is unreadable, or a linked companion is missing:** `loadRubric` already skips non-existent/non-file queue entries. Because load-all enumerates existing files, `loadRubric`'s throw-on-missing-entry is largely mooted, but the plan should wrap per-file reads so one unreadable rubric degrades to *skipping that file* (logged at `log.info`) rather than aborting the whole judge run.
- **`TESTING-AGENT.md` has no `# Skills` section:** `stripSkillsSection` is a no-op; the whole brief is supplied as the task. No error.
- **Verdict / reporting / loop:** unchanged. `{ pass, notes }` flows through `classifyVerdict` and into the report and the self-improvement context (verbatim notes + failing scenarios' skill files) exactly as before. No new downstream failure surface. (Req 8, AC7.)
- **Over-application of unnamed rubrics (future, N>1):** mitigated by guardrail G2 (selection instruction) and G1 (self-identifying headers). Not present today (N=1). Residual risk logged below.

**Observability.** Reuse the existing `log.info` scope in `runJudgeAgent` (`judge:<scenario>@<agent>`). No new log *contract* is introduced (observability output is not a spec requirement to change). Optional, plan-phase additions for debuggability: log the count of rubrics loaded and that the task was supplied — kept minimal.

## Risks and Open Questions

### Risks

- **R1 — Over-application at large N (reliability, req 3).** With load-all, a future project with many rubrics could see the judge apply criteria from rubrics a scenario never named, biasing the verdict. *Mitigation:* G2 (selection instruction) + G1 (self-identifying headers). Not present today (N=1). If it ever bites, a future revision can add scoping. G2's behavioral effectiveness is verified manually/owner-run.
- **R2 — Silent mistyped-rubric reference (accepted).** A `JUDGE.md` naming a nonexistent rubric produces no error and that rubric's criteria are silently unavailable. Explicitly accepted (spec Out-of-Scope / req 5). *Mitigation:* docs phase notes authors get no feedback on a typo.
- **R3 — Reliability is behavioral, not gate-verified.** Req 3's "reliably grades" is a first-class quality bar, but full behavioral verification stays manual (req 12). Deterministic gates prove only that the prompt is *assembled* correctly (rubric present, task present, `# Skills` absent), not that the judge *acts* on it. The design leans on G1/G2 + the N=1 reality to make reliability near-certain today; downstream must not mistake green gates for behavioral proof.
- **R4 — `## Scenario requirements` conversion could drop judge signal.** The blocks are not pure task restatements — category-(b) unique mechanism checks exist in 9/11 scenarios. A naive "delete the block" conversion loses that signal. *Mitigation:* downstream must follow the conversion rule (preserve (b) under a renamed heading), not delete wholesale.
- **R5 — The existing changeset describes the reversed model.** `.changeset/flexible-scenarios-judge-verification.md` (review-1) documents the rubric-by-id model this revision reverses; left unamended, the shipped release note would contradict the final behavior. *Mitigation:* resolved in Open Questions (recommend amend).
- **R6 — Stale docs/examples reference the removed model.** `README.md`'s "Reusable rubrics" section (and `:26`, `:308`, `:310`, `:340-342`) and `examples/skillsmith.config.ts` (`:187-197`) describe the `# Rubrics` id-list and `# Grading rubrics` id-injection being replaced. User-facing; the docs phase must update them (not a code-phase blocker, but must not be forgotten).

### Open Questions (non-blocking — for the plan/writer phases)

- **Changeset: amend vs. add (req 11).** The existing `.changeset/flexible-scenarios-judge-verification.md` (review-1) documents the rubric-by-id model this revision reverses. Options: (a) amend it to describe the final natural-language model, or (b) add a second `minor` changeset. Both satisfy "a `minor` changeset is recorded, pre-1.0." **Recommendation:** amend the existing changeset so the PR ships one coherent release note (natural-language rubric reference + auto-supplied skill-agnostic task), rather than a note describing rubric-by-id followed by a note reversing it. Deferred to the code-plan/docs phases; not a design blocker.
- **Exact heading strings (cosmetic).** Working names used here: task section `# Testing task` (or `# Task under evaluation`); rubric section keeps `# Grading rubrics`; per-rubric header `# Rubric: <id>`; the re-homed testing-project checks heading `## What to check`; the G2 lead-in line. Final wording is a plan/writer nicety; the *structure* and *placement* are the load-bearing decisions.
- **Deterministic test list to specify in the plan (req 12 / AC9).** Unit/integration tests should cover: (1) the `# Rubrics` parser is fully removed — no code parses it (AC1, AC8); (2) `stripSkillsSection` — strips the section, no-op when absent, handles `# Skills` as the last section and `\r\n` endings (AC6); (3) `loadAllRubrics` — sorted, concatenated, deduped, `undefined`/empty on unset/empty path (AC3); (4) `buildJudgeSystemPrompt` — includes the task (minus `# Skills`), includes `# Grading rubrics` with G1/G2 when rubrics are present, omits it when none, and still emits the output-format/recursion-guard/role sections (AC1, AC5, AC6); (5) enumeration does not error on a prose rubric reference with no file (AC4); (6) verdict/report wiring unchanged (`classifyVerdict` `{ pass, notes }`) (AC7). Full behavioral reliability (does the judge *act* on the named rubric) stays manual/owner-run. Pipeline agents run at most one scenario × one agent as a sanity check; the self-improvement loop is not exercised by the pipeline.
