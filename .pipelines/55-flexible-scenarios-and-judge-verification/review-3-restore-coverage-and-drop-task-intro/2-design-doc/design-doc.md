# Design Doc: Restore full trunk judging coverage in the JUDGE.md briefs, without task repetition

## Overview

Skillsmith is a scenario-based evaluation harness for coding agents: each scenario runs a **testing agent** against a task and then has a **judge agent** grade the produced work. On this pipeline's branch (issue #55 / PR #56), scenarios use a two-file model — `TESTING-AGENT.md` (the task brief; the only parsed structure is its `# Skills` section) and `JUDGE.md` (the judge's brief, consumed verbatim). At judge time, Skillsmith automatically injects into the judge's system prompt the skill-stripped testing task and the content of every rubric in the project's rubrics directory.

On `origin/trunk`, the bundled `testing-project`'s 11 scenarios defined their judging coverage in the pre-conversion model: a `scenario.yaml` with `acceptance:` bullets (source-level requirements) plus a `rubrics:` reference to `wp-interactivity-api-best-practices`, and an `e2e.spec.mjs` with live behavioral tests. A prior conversion pass to the two-file model dropped real coverage (e.g. `counter/JUDGE.md` lost all four of its trunk acceptance checks) and opened every brief with a narrative restating the task the judge already receives automatically.

This design restores **exactly trunk's judging coverage** — nothing dropped, nothing added — into the 11 `JUDGE.md` briefs, removes all task repetition and all duplication of harness-supplied material, and realigns the one conformance test that encoded the rejected contract. Two questions delegated to this design phase are resolved here: the branch's auto-supply mechanism was verified end-to-end against the requirement and needs **no core change**, and the proposed shared **workspace** for the judge and testing agent is **not adopted** (rationale and a recommended future shape are recorded below). The entire change surface is 11 brief rewrites plus one test rewrite; Skillsmith core, `testing-project/skillsmith.config.ts`, the role prompts, and the rubric file are untouched.

## Approach

### Requirements at a glance

The spec's requirements, abbreviated here so decision traces are readable standalone:

- **R1** — every trunk `acceptance:` bullet appears in the scenario's `JUDGE.md` as an explicit check against the generated code; no bullet omitted for duplicating the task, the rubric, or a live check. Applies to all 11 scenarios.
- **R2** — each brief instructs the judge to check the code against the `wp-interactivity-api-best-practices` rubric, without inlining the rubric's content.
- **R3** — each brief covers what trunk's `e2e.spec.mjs` verified, as behavior checks against the live running site (observable assertions, not harness mechanics).
- **R4** — behaviors trunk covered in both sources appear in both sections, each in that section's mode.
- **R5** — no brief restates the testing task; briefs hold only judging material.
- **R6** — the harness automatically supplies the skill-stripped testing task and the rubric content; the branch mechanism is verified and changed only where it falls short.
- **R7** — the design phase decides whether to give both roles a shared workspace for repeated information; if not adopted, the rationale is recorded and briefs stay on the existing rubric-supply mechanism.
- **R8** — coverage parity with trunk is reviewer-verified; no coverage-mapping artifact or coverage-assertion test is added to the codebase.
- **R9** — the scenario conformance test (`src/__tests__/testing-project-scenarios.test.ts`) is updated so the suite passes with the new briefs, without becoming a coverage checker.
- **R10** — load-bearing claims are verified against current `origin/trunk` and branch code, never inherited from this pipeline's earlier run artifacts. Coverage is always derived from trunk.

Acceptance criteria AC1–AC8 pair with these: AC1–AC4 restate R1–R5 per brief, AC5 restates R6 per invocation, AC6 requires the workspace decision recorded and matched by shipped code, AC7 requires no coverage artifact/test in the repo, AC8 requires all project guardrails green (`npm run typecheck`, `npm run lint`, `npm test`, `npm --prefix testing-project run check:config`, changeset validation).

### The mental model

This revision is a **content change riding an already-verified mechanism**. The judge's system prompt is assembled (in order) from: the `JUDGE.md` body verbatim, the auto-injected skill-stripped testing task, the harness-owned output format and recursion guard, the rubric blob (whose application is gated by the brief naming a rubric), and the project's judge role prompt (an environment manual). Trunk defined each scenario's judging coverage in three sources — `acceptance:` bullets, the rubric reference, and the `e2e.spec.mjs` — and the work is a per-scenario, trunk-faithful transcription of those three sources into a fixed two-section brief template:

- `acceptance:` bullets → `## Code checks` (verbatim checks against the produced source files)
- rubric reference → a fixed one-line rubric instruction closing the code-checks section
- `e2e.spec.mjs` observable assertions → `## Behavior checks` (live checks against the running site)

Everything the harness already supplies — the task, the rubric text, the base environment instructions — is dropped from the briefs. Everything that is judging coverage is kept. Core is untouched; the conformance test is realigned to guard the new template contract (shape, not coverage).

Coverage is derived **fresh from `origin/trunk` at implementation time** (`git show origin/trunk:testing-project/eval/scenarios/<id>/{scenario.yaml,e2e.spec.mjs}`), never from prior pipeline artifacts (R10). Coverage parity is then verified by the pipeline's reviewers comparing the redone briefs against those trunk sources (R8); nothing in the repo encodes the mapping.

### Trunk coverage shape (design-phase evidence, not a transcription source)

The design phase read all 11 trunk scenarios in full. The survey below grounds the template decision (one shape fits all 11) and orients reviewers; per R10 and conversion rule 1, implementers transcribe from trunk directly, not from this table.

| Scenario | Acceptance bullets | e2e tests | e2e observable assertions (paraphrase) |
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

The per-scenario counts above sum to **63** acceptance bullets. All 63 are check-shaped (none narrative) and none is behavior-only — both properties re-evaluated this revision over the full 63-bullet set, every bullet read from `origin/trunk` (the "Server-rendered HTML includes/seeds …" family is code-mode: it checks the produced server output, corroborable pre-hydration). Common to all 11 e2e specs — and explicitly **not** coverage — are harness mechanics: plugin de/activation, host-post creation, `page.goto` plumbing, teardown, poll timeouts, locator scoping. Three scenarios carry coverage-relevant fixture facts (environment deltas) that must survive as behavior-check setup steps: `independent-counters` and `shared-state` embed the block **twice** in one post; `paginated-list` creates **5 extra posts** (6 total, 3 per page → 2 pages).

### How the acceptance criteria are met

| Criterion | Met by |
|---|---|
| AC1 (all trunk bullets as code checks) | Conversion rule 2 — verbatim transcription, one check per bullet, no omissions/merges |
| AC2 (all e2e behaviors as live checks, none added) | Conversion rules 3 and 5 — one bullet per observable assertion; unperformable or unverified observations (async-fetch's rendered outcome, config-fetch's nonce header) degrade by mandatory in-brief conditional, never by silent omission or addition |
| AC3 (rubric instructed, not inlined) | Fixed rubric sentence naming the bare id; conformance test asserts id present and rubric sentinel absent |
| AC4 (no task restatement) | Conversion rule 6 + the task-free fixed opener; reviewer-verified (deliberately not machine-asserted) |
| AC5 (auto-supplied judge inputs) | Verified branch mechanism, unchanged (Decision 1) |
| AC6 (workspace decision recorded, code matches) | Decision 2 — not adopted, rationale + recommended future shape recorded here; zero core changes shipped |
| AC7 (no coverage artifact/test in repo) | Decision 5 — `liveChecks` anchors deleted; rewritten test asserts only uniform template invariants |
| AC8 (guardrails green) | Test rewrite makes `npm test` pass; no other guardrail touches the changed files; no changeset needed (see Dependencies) |

## Components

### Changed

- **`testing-project/eval/scenarios/<id>/JUDGE.md` × 11** (`async-fetch`, `config-fetch`, `counter`, `derived-double`, `focus-trap-menu`, `fruit-list-each`, `independent-counters`, `minimal-scaffold`, `paginated-list`, `shared-state`, `toggle-visibility`) — rewritten to the template in Decision 3 via the conversion rules in Decision 4.
- **`src/__tests__/testing-project-scenarios.test.ts`** — the scenario conformance test, realigned to the new template contract per Decision 5.

### Untouched but load-bearing

These were all verified this design phase against branch code; the design depends on them staying as they are.

- `src/pipeline/judge-agent.ts` — judge system-prompt assembly (`buildJudgeSystemPrompt`), the rubric selection lead-in, and the user-message builder (inlined produced files).
- `src/scenarios/enumerate.ts` — reads `JUDGE.md` opaquely (no parsing) and implements the `# Skills` strip; errors scenarios missing a `# Skills` section.
- `src/scenarios/rubric-loader.ts` — loads every top-level `*.md` under `paths.rubrics`, each wrapped with a `# Rubric: <id>` header.
- `testing-project/skillsmith.config.ts` — frozen (spec out-of-scope): `paths.rubrics: './eval/rubrics'`, judge tools `[Read, Bash]` + Playwright MCP (`npx @playwright/mcp@latest`, no `--caps` flag), role prompt wiring.
- `testing-project/eval/prompts/judge.md` (`roles.judge.prompt`) — the judge environment manual: env vars (`$SKILLSMITH_PROJECT_ROOT`, `$SKILLSMITH_WP_PORT`, `$SKILLSMITH_PLUGIN_SLUG`), the WP-CLI bridge (`eval/utils/judge-wp.mjs`), post-create recipe, rendered-post URL shape. Frozen; the briefs delegate all base environment mechanics to it.
- `testing-project/eval/prompts/testing-agent.md` (`roles.test.prompt`) — test-side shared scaffold instructions. Frozen.
- `testing-project/eval/rubrics/wp-interactivity-api-best-practices.md` — the sole rubric; auto-loaded.
- `testing-project/eval/scenarios/<id>/TESTING-AGENT.md` × 11 — out of scope; all match their trunk `scenario.yaml` prompts verbatim today.
- wp-env hooks (`wp-env-judge.ts`) — activate the plugin and warm the environment before the judge runs; the reason briefs must not say "Activate the plugin".
- `src/__tests__/testing-project-e2e-removal.test.ts` — scans every file under `testing-project/` and fails on e2e vocabulary; constrains the new briefs' wording (see Interfaces).

## Interfaces and Data Flow

### Judge system prompt assembly (branch mechanism, verified end-to-end)

`buildJudgeSystemPrompt` (`src/pipeline/judge-agent.ts:201–234`) joins with `\n\n`, in order:

1. **`scenario.judgeBrief` verbatim** — the `JUDGE.md` body. First section; nothing is framed above it, so the brief's first line is the de-facto opener of the judge's system prompt.
2. **`# Testing task`** — the `TESTING-AGENT.md` body with the `# Skills` section stripped (first heading titled exactly `Skills`, case-insensitive, any depth 1–6, through the next same-or-shallower heading; sub-headings and prose removed, so no skill name leaks). Always present.
3. **`# Output format`** (strict JSON `{ "pass": <bool>, "notes": "<string>" }`) and **`# Recursion guard`** — harness-owned.
4. **`# Grading rubrics`** — present only when rubrics exist: a fixed selection lead-in plus every rubric wrapped `# Rubric: <id>`. The lead-in, verbatim:

   > The rubrics below are shared, reusable grading criteria. Apply ONLY the
   > rubric(s) this scenario's brief refers to; the others are provided for
   > reference and must not affect the verdict.

5. **`# Role instructions`** — `roles.judge.prompt` (the judge environment manual), when set.

The judge's user message contains only the inlined produced files; its working directory is a full recursive copy of the testing agent's workspace. The task never rides the user message.

### Couplings the briefs must honor

`JUDGE.md` remains an opaque markdown contract — core parses nothing from it, so headings are convention, enforced only by the conformance test. The brief-side couplings are:

1. **Rubric activation key** — the lead-in makes rubric application conditional on the brief *naming* the rubric. A brief that omits the name still gets the rubric text, but flagged reference-only. Each brief therefore names the bare id `` `wp-interactivity-api-best-practices` ``, matching the `# Rubric: <id>` blob header exactly (R2 is the activation key, not decoration).
2. **No positional task references** — the injected `# Testing task` lands *after* the brief; briefs must never say "the task above/below", only neutral phrasing ("the produced work", "the block").
3. **Banned literal strings** — `src/__tests__/testing-project-e2e-removal.test.ts:115` fails on any `testing-project/` file containing `e2e.spec.mjs`, `@playwright/test`, `playwright.config`, lowercase `playwright test`, or `verify-e2e`. Behavior-check bullets never cite their e2e origin; they just state the live check.
4. **Conformance-test template invariants** — the rewritten test's uniform assertions (Decision 5).

### Testing-agent side (context for the workspace decision)

The testing agent's system prompt (`src/pipeline/testing-agent.ts:35–107`) is: skill blob from `paths.skills`, workspace constraint, pre-existing workspace files inlined, recursion guard, and `roles.test.prompt`. Its user message is `TESTING-AGENT.md` verbatim (including `# Skills`). **No rubric channel exists for the testing agent** — rubrics are judge-only, on trunk and on the branch. This asymmetry is deliberate and preserved (see Decision 2).

### Data flow of this revision's changes

No interface changes anywhere. The 11 brief bodies change (content flowing into prompt section 1); the conformance test changes what it asserts about those bodies. Nothing else in the data flow moves.

## Key Decisions

### Decision 1: No core change — the branch mechanism already satisfies auto-supply

- **Choice:** Ship zero changes to `src/pipeline/judge-agent.ts` and its collaborators. The mechanism was verified end-to-end this design phase: a live assembly experiment over the real `counter` files (running `stripSkillsSection` + `loadAllRubrics` + `buildJudgeSystemPrompt`) confirmed the judge's system prompt contains the trunk task paragraph with the `# Skills` block gone plus the full rubric content, in the documented order; the unit suite covers every link in the chain (auto-supply with skills removed, rubric loading from `paths.rubrics`, section omission when empty, task placement, judge cwd).
- **Alternatives:** Change core to close a gap — no gap was found for the task-and-rubrics half of the requirement. The only unimplemented clause ("plus workspace content, if adopted") is resolved by Decision 2 and is inert.
- **Trade-offs:** None material; changing a verified working mechanism would violate the spec's "changed only where it falls short" clause.
- **Traces to:** R6, AC5.

### Decision 2: R7 workspace — not adopted; the existing channels already are the workspace

- **Choice:** No new workspace mechanism. The revision stays on the existing shared channels: `paths.rubrics` (judge-only, auto-injected), `roles.judge.prompt` (judge-side shared environment manual), `roles.test.prompt` (test-side shared instructions), `paths.skills` (skill content). The redone briefs simply **stop duplicating** what those channels carry.
- **Alternatives:**
  1. *New optional `paths.workspace` directory, contents prompt-injected into both roles* (mirror of rubric loading). Feasible and non-breaking — but it would ship an empty mechanism (see trade-offs).
  2. *Shared directory materialized on disk into each role's working directory.* Strictly worse: pre-seeded testing-workspace files are prompt-inlined anyway; shared files would pollute the artifact of record and the judge workspace copy; and the repo already tried disk-materialized shared instructions (PR #5's `AGENTS.md`) and migrated them out to the role-prompt channel.
- **Rationale:**
  1. **The repeated-information inventory shows no homeless content.** Across the current 11 briefs, roughly 55 scenario-common prose lines repeat (a line count of duplicated text in the *branch* briefs — unrelated to the 63 trunk acceptance bullets in the coverage survey); about 44 of them already have shared homes (rubric content, environment manual, scaffold instructions, skill content). The irreducible per-brief residue is the one-line rubric instruction — which *cannot* move to a shared channel, because under the rubric lead-in it is the per-scenario activation key — plus 3 genuinely scenario-specific environment deltas, which are not shared material by definition.
  2. **Nothing present needs a both-roles channel.** The environment manual is judge-only material, scaffold instructions are test-only, and rubrics must remain judge-only: handing them to the agent under test would change what the eval measures relative to trunk (rubrics were judge-only there too) and would break the lead-in's per-scenario selection semantics.
  3. **The duplication was actively harmful.** All 11 current briefs instruct "Activate the plugin" while the judge hook already activates it and the manual says so — the briefs drifted into contradicting the shared source they duplicated. The fix is in the briefs (stop restating shared material), not in core.
  4. **Spec discipline.** Out of scope: unconditional core changes; core changes only if the R6 mechanism falls short (it does not — Decision 1) or workspaces are adopted. Adopting a mechanism with no content to carry would be change for its own sake.
- **Trade-offs:** The honest gap is that no single channel hands the same content to both roles from one place — accepted because no present content needs that capability.
- **Recommended future shape (recorded per AC6, not built):** if a future project accumulates content that genuinely must reach both roles from one place, the recommended mechanism is option 1 — a new optional `paths.workspace` key beside `rubrics?:` in `src/config/types.ts`, contents prompt-injected into both roles' system prompts via a loader mirroring `loadAllRubrics`, with rubrics kept as a separate judge-only channel (preserving selection semantics and test-agent non-contamination). Non-breaking; new optional config field = `minor` per the CONTRIBUTING bump table. To be filed as its own issue if the need materializes.
- **Consequences:** This revision ships **zero Skillsmith core changes**; `testing-project/skillsmith.config.ts` and both role prompts stay byte-identical. The redone briefs carry no base environment prose and no activation instruction — only checks, the rubric sentence, and the 3 scenario-specific environment deltas. Briefs may *reference* manual affordances ("create posts via the WP-CLI bridge") but never restate them.
- **Traces to:** R7, AC6; R6's workspace clause; spec Out of Scope ("unconditional core changes", frozen config/role prompts).

### Decision 3: The JUDGE.md template — one fixed shape for all 11 briefs

- **Choice:** Every brief follows this exact structure (spec-vocabulary headings; convention enforced only by the conformance test, since core parses nothing from `JUDGE.md`):

  ```markdown
  Judge the produced work against the checks below, using both the produced
  source files and the live, running site. Pass only if every check,
  including the rubric check, is satisfied.

  ## Code checks

  Verify in the produced source files:

  - <trunk acceptance bullet 1>
  - <trunk acceptance bullet 2>
  - …

  As a further code check, verify the produced code against the
  `wp-interactivity-api-best-practices` rubric.

  ## Behavior checks

  Verify on the live, running site:

  - <optional setup step(s) — only the 3 scenarios with environment deltas>
  - <live behavior check derived from e2e observable assertion 1>
  - …
  ```

  Element decisions:
  - **Opening line (decision rule).** One fixed, task-free sentence pair, identical across all 11 briefs. It restores trunk's all-must-pass verdict strictness: on trunk, `classifyVerdict` (`src/reports/verdict.ts`) folded the per-item verdict mechanically — a pair passed only when every rubric and acceptance item passed, and the e2e suite was a separate hard gate. On the branch, nothing states a decision rule anywhere (`# Output format` is shape-only; the judge manual is environment mechanics only), and with the config and role prompts frozen this revision, **the per-brief template is the only permitted home for a decision rule**. The wording folds the rubric into the rule explicitly ("including the rubric check") because trunk's fold covered rubric items too — `classifyVerdict` failed the pair on **any** rubric-item failure, not just acceptance items — and a bare "every check" could defensibly be read as the bulleted checks only, making the restored rule strictly weaker than trunk's and the R2 rubric check advisory in practice. The opener is judging material, not task narrative — it never names what was built — and replaces the current briefs' "Decide whether it satisfies the task it was given…" line.
  - **`## Code checks`** carries every trunk `acceptance:` bullet, one check per bullet, and closes with the fixed rubric sentence naming the bare id in backticks. The rubric sentence lives in this section because the rubric is a code-mode check (applied to the generated code), and is itself phrased as a check ("As a further code check, verify …") so it sits unambiguously inside the opener's all-must-pass fold; the bare id matches the `# Rubric: <id>` blob header, making the lead-in's "brief-named" selection unambiguous.
  - **`## Behavior checks`** carries trunk's e2e observable assertions as action → expected-observation bullets against the live site. Scenario-specific setup steps open the section where trunk's fixtures demanded them (insert the block twice — `independent-counters`, `shared-state`; create 5 extra posts — `paginated-list`): these are coverage-relevant environment deltas, not harness mechanics.
  - **No `## Environment` section and no base environment prose.** The judge manual owns activation, URLs, env vars, and the WP-CLI bridge; restating it caused the activate-drift bug (Decision 2).
  - **Heading depth H2**, consistent with current brief convention; the brief's internal headings sit under the assembled prompt's injected H1 sections, and core is indifferent.

  Worked example — the complete target `counter/JUDGE.md`:

  ```markdown
  Judge the produced work against the checks below, using both the produced
  source files and the live, running site. Pass only if every check,
  including the rubric check, is satisfied.

  ## Code checks

  Verify in the produced source files:

  - Has increment and decrement actions that modify the counter state
  - Uses data-wp-on--click on both increment and decrement buttons
  - Uses data-wp-text or equivalent to display the counter value reactively
  - Server-rendered HTML includes the initial counter value (5)

  As a further code check, verify the produced code against the
  `wp-interactivity-api-best-practices` rubric.

  ## Behavior checks

  Verify on the live, running site:

  - The block initially displays the counter value 5.
  - Clicking the increment button updates the displayed value to 6.
  - Clicking the decrement button twice from there updates the displayed value to 4.
  ```

  The four code checks are trunk's four bullets verbatim; the R4 overlap is visible (initial value 5 appears in both sections, each in its mode).
- **Alternatives:** Keep the review-2 heading vocabulary (`## What to check` / `## Live checks` / `## Environment`). Rejected: the spec's own vocabulary is code/behavior checks; the `## Environment` section exists only to duplicate the frozen manual (the drift-bug source); and the design-phase shape survey shows one template fits all 11 scenarios with no scenario-specific structure — every scenario reduces to 3–9 code-check bullets, 1–4 live behavior sequences, the rubric sentence, an optional env-delta setup step (3 scenarios), and a mandatory live-fallback conditional (2 scenarios, see Decision 4 rule 5).
- **Trade-offs:** With the narrative opener gone (R5), the judge's system prompt opens directly with judging material; the only generic judge framing is `# Role instructions` at the end. Verified as a deliberate design call, not an auto-supply failure. The new decision-rule opener is verdict semantics, not judging coverage — flagged so reviewers don't misread it as coverage inflation (R8 review compares checks, not the decision rule).
- **Traces to:** R1–R5, AC1–AC4; R2's activation-key finding (Decision 1 consequence).

### Decision 4: Per-scenario conversion rules (trunk-faithful transcription)

- **Choice:** Derivation happens in the code phase, directly from trunk, under these rules:
  1. **Sources of truth:** `origin/trunk:testing-project/eval/scenarios/<id>/scenario.yaml` (`acceptance:`) and `<id>/e2e.spec.mjs`, read fresh at implementation time. Never derived from prior pipeline artifacts — including the survey table in this document.
  2. **Code checks:** transcribe every acceptance bullet, preserving wording and expected values; unescape YAML-quoted scalars (`config-fetch`, `paginated-list`, `minimal-scaffold`). Exactly one permitted edit class: remove skill attributions — `derived-double` bullet 1 drops "from the Interactivity API skill" (the judge is skill-agnostic by design; the `# Skills` strip exists precisely to keep skill identity from the judge) while keeping the check and its grading allowance ("Seeding the doubled value alongside the counter … is acceptable"). No bullets added, none dropped, none merged.
  3. **Behavior checks:** one bullet per observable assertion of each trunk e2e test, expressed as what the judge does on the live site and what it must observe. Include assertion-bearing techniques where trunk's assertion depends on them (`paginated-list`: no-full-reload proven via a window sentinel surviving the click, "Previous" absent from the accessibility tree; `focus-trap-menu`: focus-return and Tab/Shift+Tab wrap). Exclude harness mechanics (activation, host-post creation, navigation plumbing, teardown, poll timeouts) — hook- and manual-owned.
  4. **Overlaps:** a behavior in both trunk sources appears in both sections, each in its mode — no dedup.
  5. **Unperformable or unverified live assertions:** where the judge environment cannot reproduce a trunk observation — or its observability by the judge's tooling is unverified at design time — the behavior check is still **mandatory**: the brief carries the bullet stating the closest achievable observable plus an explicit conditional fallback, written into the bullet itself, naming the code check(s) that cover the same behavior. Silent omission and implementer discretion ("may include") are not permitted; degradation is always explicit in the brief text, so any two implementers produce the same brief. The judge-capability check (judge = Read + Bash + Playwright MCP core tools, **no request mocking** — `browser_route` requires the absent `--caps=network` flag; WP-CLI bridge available) found 9 of 11 scenarios fully performable live with verified tooling. Exactly two scenarios carry a conditional under this rule — async-fetch for an unperformable observation, config-fetch for an unverified one:
     - **async-fetch:** its stub URL `https://jsonplaceholder.example/joke` (.example TLD) never resolves and cannot be mocked. Live coverage becomes: text absent pre-click; on click, exactly one request attempt to exactly the stub URL (via the browser's network-request log); the rendered-joke outcome is unobservable live → explicit fallback to the display-wiring code checks (independently covered by trunk's acceptance bullets).
     - **config-fetch:** keeps its full live sequence (real endpoint in the judge env; click → the real post title renders; request URL observable) **and must carry the nonce observation as a live bullet**. Trunk observably asserted that the click-triggered request bore a non-empty `X-WP-Nonce` header (`capturedNonce` truthy and not `'undefined'`), and this is genuinely additional live coverage: a successful title render does not prove the nonce was sent, since a GET to `/wp/v2/posts/1` on a public post succeeds without one. Because header observability via `browser_network_requests` is unverified (see Risks), the bullet follows the same pattern as async-fetch — observe that the click-triggered request to `/wp-json/wp/v2/posts/1` carries a non-empty `X-WP-Nonce` header, with an explicit conditional fallback to the nonce-wiring code check (trunk acceptance bullet 4, this behavior's R4 overlap partner) when the tooling does not expose request headers. The bullet is never optional and never silently absent.
  6. **No task restatement:** no "You are grading…" or narrative lead-in; refer to "the produced work" / "the block"; task facts (5, 0, Apple/Banana/Cherry, button labels) appear only as expected values inside checks; never reference the injected task positionally.
  7. **Banned literal strings:** per the e2e-removal test, briefs must not contain `e2e.spec.mjs`, `@playwright/test`, `playwright.config`, lowercase `playwright test`, or `verify-e2e`.
- **Alternatives:** Paraphrase-and-condense transcription (rejected: R1 forbids omission or merging, and verbatim wording is what reviewers diff against trunk); machine-checked coverage mapping (rejected by R8 — reviewers are the named control).
- **Trade-offs:** Rule 2's single edit class introduces a judgment point (what counts as a skill attribution); it is bounded to the one known instance and reviewers verify parity. Rule 5 accepts a conservative live degradation for async-fetch, and defers config-fetch's header-observability question to a conditional inside the mandated bullet, rather than inventing coverage trunk did not have or letting a trunk-asserted observation drop out at implementer discretion.
- **Traces to:** R1 (rule 2), R3 (rules 3, 5), R4 (rule 4), R5 (rule 6), R10 (rule 1), AC1, AC2, AC4; rule 7 traces to the existing CI constraint.

### Decision 5: The conformance test becomes a template-contract test, never a coverage checker

- **Choice:** Rewrite `src/__tests__/testing-project-scenarios.test.ts` in place, keeping its structure (node:test, hardcoded 11-id `SCENARIO_IDS`, real `enumerateScenarios` run):
  - **Keep unchanged:** T1 (two-file model per scenario; no legacy `scenario.yaml`/`e2e.spec.mjs`), T2 (all 11 enumerate cleanly, `skills == ['wp-interactivity-api']`), T4 (TESTING-AGENT.md: `# Skills` heading present, per-scenario task-fragment anchor present, no scaffold-instruction duplication), T6 (`_candidates.yaml` legacy-free).
  - **`ANCHORS` loses its `liveChecks` arrays entirely** — they are a per-scenario coverage floor "derived from the deleted e2e.spec.mjs", exactly what R8/AC7 reject. `ANCHORS` keeps only the per-scenario `prompt` fragments, which guard the out-of-scope TESTING-AGENT.md task text — task preservation, not judging coverage. T3 survives as `keys(ANCHORS) == SCENARIO_IDS`.
  - **T5 rewritten** to assert, for every brief, only uniform scenario-independent invariants:
    1. has a `## Code checks` heading and a `## Behavior checks` heading;
    2. contains the literal rubric id `wp-interactivity-api-best-practices` (R2 activation-key guard, replacing the prose-title check);
    3. does NOT contain the rubric sentinel sentence (no inlining — AC3);
    4. does NOT pre-state the `{ "pass"` output shape (harness owns `# Output format`);
    5. does NOT reference the dead env vars `$SKILLSMITH_JUDGE_URL` / `$SKILLSMITH_POST_ID`;
    6. contains a short stable fragment of the fixed decision-rule opener (e.g. `pass only if every check`, case-insensitive — fragment, not full sentence, per the file's own short-fragment style; still a substring of the Decision 3 opener after its rubric-fold wording, and any fragment chosen in the code phase must remain consistent with that final wording);
    7. no `# Rubrics` heading (brief opaqueness holds).
  - **Dropped assertions:** the `## Scenario requirements` ban (rejected-contract relic), the `Environment` heading requirement, the `Live checks` heading requirement, the `$SKILLSMITH_PLUGIN_SLUG` requirement, and all `liveChecks` fragments. The T5 header comment is rewritten to describe the new contract (template shape + auto-supply division of labor).
  - **R5 is not mechanically asserted.** "No task restatement" is a semantic property; encoding it (e.g. banning "You are grading") would be brittle content policing. It is reviewer-verified, like coverage parity.
- **Alternatives:** Delete the JUDGE.md contract test entirely and keep only file-shape tests. Rejected: the suite would no longer fail loudly if a future brief broke the two-section format, dropped the rubric activation key, inlined the rubric, or restated the output shape — all mechanism contracts worth guarding, none coverage.
- **Trade-offs:** Retained assertion 6 couples the test to the opener's wording via a short fragment; the exact fragment is chosen in the code phase together with the final opener wording. The one retained per-scenario datum (`prompt` anchors) is defensible under AC7's wording because it guards task text of files this revision explicitly does not touch, not judging coverage.
- **Traces to:** R8, R9, AC7, AC8.

### Decision 6: Change surface is exactly 11 briefs + 1 test

- **Choice:** Nothing else changes. No core, no config, no role prompts, no rubric, no TESTING-AGENT.md, no docs, no changeset.
- **Alternatives:** Fold in the known README divergence (its example brief models rubric-naming-by-title and the old "Decide whether…" opening, both superseded by Decision 3). Rejected: the spec scopes this revision to briefs + test; README edits also trip the changeset gate. It is handed to the docs phase instead (see Risks and Open Questions).
- **Trade-offs:** The repo temporarily carries a README example that lags the template; nothing breaks mechanically (the example is illustrative prose).
- **Traces to:** spec Out of Scope (all six items), R8 (no new artifacts), AC7, AC8.

## Dependencies

- **No new dependencies, no core changes, no config changes.**
- **No changeset for this revision:** the changeset gate fires only on `changedFilePatterns` = `["src/**","bin/**","package.json","examples/**","README.md","!src/__tests__/**"]`; the diff (testing-project briefs + `src/__tests__/**`) matches nothing — the test path is explicitly negated, and CONTRIBUTING exempts tests and the `testing-project/` fixture outright.
- **External-tool dependencies of the checks themselves** (run-time, not build-time): Playwright MCP core tools — navigate/click/type/press_key/snapshot/wait_for, `browser_console_messages`, `browser_evaluate`, `browser_network_requests` (verified available without `--caps`; request mocking verified *unavailable*, and whether it exposes request headers is *unverified* — together these drive Decision 4 rule 5's two conditionals) — and the judge manual's WP-CLI bridge (`eval/utils/judge-wp.mjs`) for the `paginated-list` post-creation setup step.
- **Internal load-bearing (frozen) modules:** listed under Components → Untouched but load-bearing.
- **Guardrail commands (AC8), all verified to exist:** `npm run typecheck` (`tsc --noEmit`), `npm run lint` (`biome lint .` — js/ts only, no markdown lint), `npm test` (`node --import tsx --test src/__tests__/*.test.ts`), `npm --prefix testing-project run check:config` (imports the frozen config; unaffected), changeset validation (satisfied vacuously, above).

## Failure Modes and Observability

- **Brief regression — format:** the rewritten conformance test fails `npm test` (headings, rubric id, rubric-inlining sentinel, output-shape pre-statement, dead env vars, decision-rule fragment).
- **Brief regression — coverage:** deliberately **not** machine-detected (R8). Coverage parity is reviewer-verified against trunk at review time; the pipeline's reviewers are the named control.
- **Banned vocabulary:** `testing-project-e2e-removal.test.ts` fails `npm test` if a brief mentions e2e artifacts.
- **Judge-side failure at run time:** unchanged from the branch mechanism — verdicts land in `{ pass, notes }`; a brief-induced misgrade surfaces as implausible notes (e.g. claiming the rubric or the task was missing), the same observability the harness has today. The fixed all-must-pass decision rule makes borderline verdicts legible: the notes must account for every check.
- **Environment-assumption failures:** if the config-fetch target post is absent or MCP capabilities drift, the affected behavior check fails live in judge notes; both are logged risks with mitigations below (WP-CLI bridge recipe; conservative fallback wording).
- **Duplication-drift class:** the activate-drift bug is fixed as a side effect of Decision 2, but the same class returns if future briefs restate manual content. The conformance test is the only mechanical guard the codebase carries, and per R8 it stays structural — reviewer discipline remains the real control.

## Risks and Open Questions

Handed to the plan/code/docs phases:

- **Playwright MCP capability drift.** The capability check used the microsoft/playwright-mcp README @ main (npm latest 0.0.77), and the config runs `@playwright/mcp@latest` unpinned. Load-bearing conclusions: no request mocking without `--caps=network` (drives the async-fetch fallback); `browser_network_requests` / `browser_console_messages` / `browser_evaluate` / `browser_press_key` available in core; whether `browser_network_requests` exposes request headers is unverified (drives the config-fetch conditional). If mocking ever becomes available, the async-fetch fallback is merely conservative, not wrong; likewise the config-fetch bullet is correct whether or not headers turn out to be observable — the conditional makes it deterministic without settling that question here.
- **wp-env default content assumption (config-fetch).** "Fresh wp-env ships post ID 1 (Hello world!)" is model knowledge, unverified. The behavior check must not silently depend on it: the code phase verifies once against the real warm env, or words the check to tolerate confirming/creating the target post via the WP-CLI bridge.
- **Exact wording of the two fallback conditionals** (async-fetch's rendered-outcome fallback; config-fetch's nonce-header fallback) is drafted in the code phase within Decision 4 rule 5. Both bullets themselves are mandatory — only their wording is code-phase work; reviewers verify the wording preserves trunk's assertion intent without coverage drift. If the code phase verifies that the judge's tooling does expose request headers, the config-fetch conditional simply never fires at run time; the brief text is the same either way.
- **Decision-rule fragment for the conformance test** (Decision 5, assertion 6): the exact short fragment is chosen in the code phase together with the final opener wording; it must stay short and stable per the test file's style.
- **The decision-rule opener is new relative to the current briefs.** It restores trunk's mechanical all-must-pass fold at the prompt level. This is verdict semantics, not judging coverage — recorded so reviewers don't misread it as coverage inflation.
- **README example-brief divergence (docs phase).** README:149–160 models rubric naming by human title plus a "Decide whether the produced block satisfies the task…" opening, both superseded by Decision 3. Nothing breaks mechanically; the docs phase should update the example. README.md is in the changeset gate's patterns (a `none` changeset satisfies the gate for prose-only edits).
- **Future workspace need.** If content ever genuinely must reach both roles from one place, the recorded recommended shape is Decision 2's option 1 (`paths.workspace`, prompt-injected, rubrics kept as a separate judge-only channel) — a future issue, not this revision.
