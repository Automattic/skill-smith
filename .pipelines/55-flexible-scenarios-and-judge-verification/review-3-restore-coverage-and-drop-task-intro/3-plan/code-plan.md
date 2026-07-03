# Code Plan: Restore full trunk judging coverage in the JUDGE.md briefs, without task repetition

## Overview

This revision rewrites the 11 `testing-project/eval/scenarios/<id>/JUDGE.md` briefs to a fixed two-section template that carries exactly the judging coverage each scenario defined on `origin/trunk` (its `scenario.yaml` `acceptance:` bullets as code checks, its `e2e.spec.mjs` observable assertions as live behavior checks, plus the rubric instruction), with no task repetition and no duplication of harness-supplied material — and realigns the one conformance test (`src/__tests__/testing-project-scenarios.test.ts`) that encoded the rejected contract. The change surface is exactly those 12 files: **zero Skillsmith core changes** (the auto-supply mechanism was verified in the design phase and needs none; the R7 workspace was evaluated and not adopted), no config changes, no role-prompt changes, and **no changeset** (the diff — `testing-project/**` briefs plus `src/__tests__/**` — matches nothing in `.changeset/config.json`'s `changedFilePatterns`, whose `!src/__tests__/**` negation excludes the test).

**Ordering.** The suite must be green after every task's commit, but the current conformance test asserts the *old* brief shape (`## Environment` / `## Live checks` headings, `$SKILLSMITH_PLUGIN_SLUG`, a prose rubric reference, per-scenario `liveChecks` fragments) while the final test asserts the *new* template shape across all 11 briefs. Neither contract can hold while briefs are half-converted, so the plan is a three-stage sandwich:

1. **Task 1** trims the conformance test to a transitional set of invariants that are true of both the old and the new brief shapes (and deletes the `liveChecks` coverage anchors, which spec R8/AC7 reject).
2. **Tasks 2–12** rewrite one brief per task (counter first — the design doc provides its complete target content as the worked example — then the rest alphabetically). Each rewritten brief satisfies the transitional test and the banned-strings test, so every commit is green.
3. **Task 13** rewrites the conformance test to the final template contract of design Decision 5, which all 11 briefs now satisfy.

The transitional state in Task 1 is purely a sequencing device; the test's **end state** (after Task 13) matches design Decision 5 exactly. Documentation is out of scope here (phase 5 plans it separately); the known README example-brief divergence is deliberately left to the docs phase per design Decision 6.

## Guardrail scopes

All code-phase gates are fixed commands with no `{scope}` placeholders; there are no scope values to fill.

| Gate             | Scope                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| typecheck        | None — fixed command `npm run typecheck`                               |
| lint             | None — fixed command `npm run lint`                                    |
| tests            | None — fixed command `npm test`                                        |
| config-smoke     | None — fixed command `npm --prefix testing-project run check:config`   |
| changeset-format | None — fixed command `npx tsx scripts/validate-changesets.ts`          |

## Spec coverage

| Spec item | Where it is addressed |
|---|---|
| R1 / AC1 (trunk acceptance bullets as code checks) | Tasks 2–12 (`## Code checks` transcription); Flow 1 |
| R2 / AC3 (rubric instructed, not inlined) | Tasks 2–12 (fixed rubric sentence, bare id); Task 13 (mechanical guard); Flow 3 |
| R3 / AC2 (trunk e2e coverage as behavior checks) | Tasks 2–12 (`## Behavior checks`); Flow 2 |
| R4 (overlaps in both modes) | Tasks 2–12 (no dedup rule); Flows 1–2 |
| R5 / AC4 (no task repetition) | Tasks 2–12 (fixed task-free opener, prohibitions); Flow 4 |
| R6 / AC5 (auto-supplied judge inputs) | No task — design Decision 1 verified the branch mechanism end-to-end and ships zero core changes. Enforced observably by the diff-surface acceptance in Task 13 and Flow 5 |
| R7 / AC6 (workspace decision) | No task — design Decision 2: not adopted, rationale recorded in the approved design doc. Code side verified by the diff-surface acceptance in Task 13 and Flow 6 |
| R8 / AC7 (coverage parity reviewer-verified, not code-encoded) | Task 1 (deletes `liveChecks` anchors), Task 13 (test stays structural), shared conventions (no new tests in Tasks 2–12); Flow 7 |
| R9 / AC8 (conformance test follows the new contract; guardrails green) | Tasks 1 and 13; every task's acceptance runs the guardrails; Flow 8 |
| R10 (verify against trunk, not prior artifacts) | Baked into every brief task's procedure (step 1 reads trunk fresh; discrepancy with this plan is a blocker) |

## E2E test plan

**This revision ships no automated end-to-end tests and no e2e-type tasks.** That is deliberate and spec-mandated: the project's e2e harness was removed on this branch (guarded by `src/__tests__/testing-project-e2e-removal.test.ts`), trunk's e2e specs are precisely the material being transcribed *into* the judge briefs, and spec R8 names the pipeline's reviewers — not code — as the control for coverage parity. The flows below are therefore **manual verification flows for the code-reviewer** (and any human re-driver). "Revision diff" below means `git diff --name-only <parent-of-Task-1's-commit>..HEAD -- . ':(exclude).pipelines'`. Both scoping choices are deliberate: it baselines at Task 1's parent commit, not at trunk (the branch carries earlier issue-55 work, so comparisons of *this revision's* surface must not sweep that in), and it excludes `.pipelines/**` by pathspec (pipeline process artifacts — review verdicts, plan revisions — are git-tracked and legitimately commit into the range during a normal rejection cycle; they are process records, not part of this revision's code surface, and must never affect a diff-surface expectation below).

### Flow 1: Per-scenario code-check parity with trunk acceptance bullets

- **Steps:** For each of the 11 scenario ids, run `git show origin/trunk:testing-project/eval/scenarios/<id>/scenario.yaml` and extract the `acceptance:` list. Open the branch's `testing-project/eval/scenarios/<id>/JUDGE.md` and compare its `## Code checks` bullets 1:1, in order.
- **Expected:** Every trunk bullet appears verbatim as one check (bullet counts: async-fetch 5, config-fetch 8, counter 4, derived-double 5, focus-trap-menu 9, fruit-list-each 6, independent-counters 5, minimal-scaffold 3, paginated-list 7, shared-state 6, toggle-visibility 5 — 63 total). The only permitted deviations: YAML quoting unescaped (config-fetch bullets 1–2, paginated-list bullets 6–7 including `\"` → `"`, minimal-scaffold bullet 2, toggle-visibility bullet 5) and derived-double bullet 1 dropping the phrase "from the Interactivity API skill". No bullet added, dropped, or merged.
- **Traces to:** Acceptance criterion 1 (R1, R10).

### Flow 2: Per-scenario behavior-check parity with trunk e2e specs

- **Steps:** For each scenario, run `git show origin/trunk:testing-project/eval/scenarios/<id>/e2e.spec.mjs`, list its observable assertions (ignoring harness mechanics: plugin de/activation, host-post creation, `page.goto` plumbing, teardown, poll timeouts, locator scoping), and compare against the brief's `## Behavior checks` bullets.
- **Expected:** Every trunk observable assertion is covered by a bullet; no bullet asserts a behavior trunk did not cover. The three environment-delta setup steps are present (`independent-counters` and `shared-state`: block embedded twice in one post; `paginated-list`: 5 extra published posts). Exactly two briefs carry an explicit conditional-fallback bullet (async-fetch: rendered-joke outcome; config-fetch: `X-WP-Nonce` header), each naming its covering code check — never silently absent, never phrased as optional.
- **Traces to:** Acceptance criterion 2 (R3, R4).

### Flow 3: Rubric instruction present, rubric content not inlined

- **Steps:** Run `grep -L 'wp-interactivity-api-best-practices' testing-project/eval/scenarios/*/JUDGE.md` and `grep -l 'viewScriptModule' testing-project/eval/scenarios/*/JUDGE.md`.
- **Expected:** Both commands output nothing (every brief names the bare rubric id; none contains the rubric sentinel sentence). The Task 13 conformance test asserts the same mechanically.
- **Traces to:** Acceptance criterion 3 (R2).

### Flow 4: No task restatement

- **Steps:** Read each of the 11 briefs end to end.
- **Expected:** Each opens with the fixed decision-rule sentence pair (no "You are grading …", no narrative naming what the testing agent was asked to build); task facts appear only as expected values inside checks; no positional references to the injected task ("the task above/below"); no base-environment or plugin-activation prose.
- **Traces to:** Acceptance criterion 4 (R5).

### Flow 5: Auto-supply mechanism untouched and verified

- **Steps:** Run `npm test` (the existing judge-agent/enumerate/rubric-loader unit tests cover skill-stripped task injection, rubric auto-loading, section ordering and omission). Run the revision diff: `git diff --name-only <parent-of-Task-1's-commit>..HEAD -- . ':(exclude).pipelines'`.
- **Expected:** Suite green; the revision diff lists exactly 12 files — the 11 `JUDGE.md` briefs and `src/__tests__/testing-project-scenarios.test.ts`. No change under `src/pipeline/`, `src/scenarios/`, `src/config/`. (Commits under `.pipelines/**` — e.g. a code-review rejection record — may exist in the range; the pathspec excludes them and they do not fail this flow.)
- **Traces to:** Acceptance criterion 5 (R6, design Decision 1).

### Flow 6: Workspace decision recorded and matched by shipped code

- **Steps:** Confirm the approved design doc (`.pipelines/55-flexible-scenarios-and-judge-verification/review-3-restore-coverage-and-drop-task-intro/2-design-doc/design-doc.md`, Decision 2) records the not-adopted rationale and recommended future shape. Re-use Flow 5's diff.
- **Expected:** Rationale recorded; `testing-project/skillsmith.config.ts`, `testing-project/eval/prompts/judge.md`, and `testing-project/eval/prompts/testing-agent.md` are byte-identical across the revision diff.
- **Traces to:** Acceptance criterion 6 (R7, design Decision 2).

### Flow 7: No coverage-mapping artifact or coverage-assertion test

- **Steps:** Run `grep -rn liveChecks src/` and inspect `ANCHORS` in `src/__tests__/testing-project-scenarios.test.ts`; scan the revision diff for any new file.
- **Expected:** No `liveChecks` anywhere; `ANCHORS` holds only per-scenario `prompt` fragments (guarding out-of-scope `TESTING-AGENT.md` task text, not judging coverage); no new files added by the revision.
- **Traces to:** Acceptance criterion 7 (R8).

### Flow 8: All guardrails green

- **Steps:** Run `npm run typecheck`, `npm run lint`, `npm test`, `npm --prefix testing-project run check:config`, `npx tsx scripts/validate-changesets.ts`.
- **Expected:** All five pass, with the rewritten conformance test running against the new briefs and no changeset added for this revision.
- **Traces to:** Acceptance criterion 8 (R9).

## Shared brief conventions (binding for Tasks 2–12)

Every brief task instantiates this exact template and follows these rules. They are restated here from design Decisions 3 and 4 so each task is executable without reading the design doc.

### The template

Each `JUDGE.md` is replaced in full with:

```markdown
Judge the produced work against the checks below, using both the produced source files and the live, running site. Pass only if every check, including the rubric check, is satisfied.

## Code checks

Verify in the produced source files:

- <trunk acceptance bullet 1, verbatim>
- <…one markdown bullet per trunk bullet, in trunk order…>

As a further code check, verify the produced code against the `wp-interactivity-api-best-practices` rubric.

## Behavior checks

Verify on the live, running site:

- <setup step — only the 3 scenarios with environment deltas>
- <one action → expected-observation bullet per trunk e2e observable assertion>
```

Fixed strings (byte-exact, each on a single line — the conformance test in Task 13 asserts a case-insensitive substring of the opener, so do not hard-wrap inside it):

- Opener (the file's first paragraph): `Judge the produced work against the checks below, using both the produced source files and the live, running site. Pass only if every check, including the rubric check, is satisfied.`
- Code-checks lead-in: `Verify in the produced source files:`
- Rubric sentence (closes the `## Code checks` section): ``As a further code check, verify the produced code against the `wp-interactivity-api-best-practices` rubric.``
- Behavior-checks lead-in: `Verify on the live, running site:`
- Headings: exactly `## Code checks` and `## Behavior checks`, in that order, and no other headings.

### Conversion procedure (per scenario)

1. **Read trunk fresh (R10).** Run `git show origin/trunk:testing-project/eval/scenarios/<id>/scenario.yaml` and `git show origin/trunk:testing-project/eval/scenarios/<id>/e2e.spec.mjs`. Transcribe from what you read, not from this plan's summaries. If trunk disagrees with any fact this plan states for your scenario (bullet count, quoting, observable list), **stop and report a blocker** — the plan is wrong, not trunk.
2. **Code checks:** transcribe every `acceptance:` bullet verbatim, in trunk order, one markdown bullet each, preserving wording and expected values. Unescape YAML quoting where the scalar is quoted (drop the surrounding quotes; convert `\"` to `"`); make no other edit except the single permitted edit class noted in the derived-double task.
3. **Behavior checks:** one bullet per observable assertion of each trunk e2e test, phrased as what the judge does on the live site and what it must observe. Include assertion-bearing techniques trunk's assertions depend on (window sentinel, accessibility-tree absence, focus position, the browser's network-request log, console messages). Exclude harness mechanics (plugin de/activation, host-post creation, navigation plumbing, teardown, poll timeouts, locator scoping). Open the section with the setup bullet only in the three environment-delta scenarios.
4. **Overlaps (R4):** a behavior trunk covered in both sources appears in both sections, each in its own mode — never dedup across sections.
5. **Mandatory conditionals:** only async-fetch and config-fetch carry a conditional-fallback bullet; their normative wording is given in those tasks. No other brief gets one, and neither bullet may be dropped or made optional.

### Prohibitions (every brief)

- No task restatement: no "You are grading …" or any narrative naming what the testing agent was asked to build; task facts (initial values, labels, list contents) appear only as expected values inside checks.
- No positional references to the injected task ("the task above/below") — use "the produced work" / "the block".
- No base-environment prose and no activation instruction: no "Activate the plugin", no URLs, no env vars of any kind (in particular not `$SKILLSMITH_PLUGIN_SLUG`, and never the dead `$SKILLSMITH_JUDGE_URL` / `$SKILLSMITH_POST_ID`). The judge role prompt owns environment mechanics; briefs may reference its affordances by name (e.g. "via the WP-CLI bridge") but never restate them.
- No inlined rubric content (in particular not the sentinel sentence about `viewScriptModule`), and no `# Rubrics`, `## Environment`, `## Live checks`, or `## Scenario requirements` headings.
- No pre-statement of the output shape (no `{ "pass"` …).
- None of the banned literal strings from `src/__tests__/testing-project-e2e-removal.test.ts`: `e2e.spec.mjs`, `@playwright/test`, `playwright.config`, lowercase `playwright test`, `verify-e2e`.

### Testing rule for brief tasks (R8)

Tasks 2–12 are content tasks. Per spec R8/AC7 the code-writer must **not** add any new test, assertion, or artifact about brief content or coverage — the RED-phase habit of writing a unit test per acceptance criterion is explicitly overridden here. Mechanical guarding lives only in the transitional (Task 1) and final (Task 13) conformance test; each brief task's acceptance is verified by inspection against this plan and by running the five guardrails.

### Shared acceptance for Tasks 2–12

Each brief task must satisfy, in addition to its scenario-specific acceptance:

- The file consists of exactly: the fixed opener, `## Code checks` with its lead-in, the transcribed bullets, the fixed rubric sentence, `## Behavior checks` with its lead-in, and the behavior bullets (setup bullet first where applicable). Nothing else.
- Every prohibition above holds for the full file.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm --prefix testing-project run check:config`, and `npx tsx scripts/validate-changesets.ts` all pass; no file other than the task's `JUDGE.md` is changed and no changeset is added.

## Tasks

### Task 1: Trim the conformance test to transition-safe invariants

- **Goal:** Make `src/__tests__/testing-project-scenarios.test.ts` green for both the old and the new brief shapes, and remove the coverage-anchor data that R8/AC7 reject, so Tasks 2–12 can land one brief per commit.
- **Type:** tdd
- **Files to change:** `src/__tests__/testing-project-scenarios.test.ts`
- **Changes:**
  - In `ANCHORS`, delete every `liveChecks` array and narrow the record type to `Record<string, { prompt: string }>`. Keep all 11 `prompt` fragments and the `keys(ANCHORS) == SCENARIO_IDS` test unchanged.
  - Leave untouched in behavior: the two-file/no-legacy-files test, the enumeration test (`skills == ['wp-interactivity-api']`), the `TESTING-AGENT.md` test (Skills heading, prompt anchor, no scaffold duplication), and the `_candidates.yaml` test.
  - In the JUDGE.md content test, **delete** these assertions (old-contract relics): the `## Environment` heading requirement, the `## Live checks` heading requirement, the `$SKILLSMITH_PLUGIN_SLUG` requirement, the `RUBRIC_PROSE_REFERENCE` requirement (delete the now-unused constant too), the per-scenario `liveChecks` fragment loop, and the `## Scenario requirements` heading ban.
  - **Keep** these assertions (true of both shapes): no `# Rubrics` heading; the brief does not contain `RUBRIC_SENTINEL` (keep that constant); no `/\{\s*["']?pass["']?/` output-shape pre-statement; neither `$SKILLSMITH_JUDGE_URL` nor `$SKILLSMITH_POST_ID` appears.
  - Update the test title and the file's header comment only as far as needed to stop describing deleted assertions (the full new-contract description is written in Task 13). Match the file's existing formatting style (tabs, WordPress-style spacing).
- **Depends on:** none
- **Traces to:** Spec R8, R9; Acceptance criteria 7, 8; design Decision 5.
- **Acceptance:**
  - `npm test` passes against the current (not-yet-rewritten) briefs.
  - The string `liveChecks` no longer appears anywhere in `src/`; `ANCHORS` entries carry only `prompt`.
  - The suite no longer asserts `## Environment`, `## Live checks`, `$SKILLSMITH_PLUGIN_SLUG`, the prose rubric reference, or the `## Scenario requirements` ban for any `JUDGE.md`.
  - The suite still fails a brief that adds a `# Rubrics` heading, inlines the rubric sentinel, pre-states the `{ "pass" …}` shape, or names a dead env var (spot-verifiable by inspection of the retained assertions).
  - `npm run typecheck` and `npm run lint` pass (no unused constants or dead types remain).

### Task 2: Rewrite counter/JUDGE.md to the template (worked example)

- **Goal:** Restore trunk's full judging coverage for `counter` in the new template; this task's output is the byte-exact model for the other ten briefs.
- **Type:** tdd
- **Files to change:** `testing-project/eval/scenarios/counter/JUDGE.md`
- **Changes:** Follow the shared conventions. Trunk facts to verify at implementation time: 4 acceptance bullets, no YAML quoting, 2 e2e tests with 3 observable assertions (initial value 5; increment → 6; decrement twice → 4). The complete target file is:

  ```markdown
  Judge the produced work against the checks below, using both the produced source files and the live, running site. Pass only if every check, including the rubric check, is satisfied.

  ## Code checks

  Verify in the produced source files:

  - Has increment and decrement actions that modify the counter state
  - Uses data-wp-on--click on both increment and decrement buttons
  - Uses data-wp-text or equivalent to display the counter value reactively
  - Server-rendered HTML includes the initial counter value (5)

  As a further code check, verify the produced code against the `wp-interactivity-api-best-practices` rubric.

  ## Behavior checks

  Verify on the live, running site:

  - The block initially displays the counter value 5.
  - Clicking the increment button updates the displayed value to 6.
  - Clicking the decrement button twice from there updates the displayed value to 4.
  ```

- **Depends on:** Task 1
- **Traces to:** Spec R1–R5, R10; Acceptance criteria 1–4; design Decision 3 (worked example), Decision 4.
- **Acceptance:** (plus shared acceptance)
  - The file content is exactly the target above.
  - The R4 overlap is visible: the initial value 5 appears both as a code check (server-rendered HTML) and as a behavior check (live display).

### Task 3: Rewrite async-fetch/JUDGE.md to the template

- **Goal:** Restore trunk's full judging coverage for `async-fetch`, including the mandatory explicit conditional for the live-unobservable rendered-joke outcome.
- **Type:** tdd
- **Files to change:** `testing-project/eval/scenarios/async-fetch/JUDGE.md`
- **Changes:** Follow the shared conventions. Trunk facts to verify: 5 acceptance bullets, no YAML quoting; 2 e2e tests whose observable assertions are: clicking "Fetch joke" renders the (mocked) joke text and issues exactly one request to the stub URL; the joke text is absent before any click and present after. The stub URL `https://jsonplaceholder.example/joke` does not resolve in the judge environment and the response cannot be mocked (the judge's Playwright MCP runs without `--caps=network`), so per design Decision 4 rule 5 the rendered outcome degrades by explicit in-brief conditional. `## Behavior checks` carries exactly these three bullets (normative wording for the third; keep the first two in this action → observation shape):

  - `Before any click, the paragraph beneath the "Fetch joke" button is empty — no joke text is shown.`
  - ``Clicking the "Fetch joke" button triggers exactly one request, to exactly `https://jsonplaceholder.example/joke` (check the browser's network-request log).``
  - ``The fetched joke itself cannot be observed rendering live — `jsonplaceholder.example` does not resolve and the response cannot be mocked in this environment — so for the joke-display outcome fall back to the code checks above covering the display wiring (the reactive binding of the `joke` value and the write into state/context after the fetch resolves), rather than failing the block for the missing live render.``

- **Depends on:** Task 1
- **Traces to:** Spec R1–R5, R10; Acceptance criteria 1–4 (AC2's explicit-degradation clause); design Decision 4 rules 2, 3, 5.
- **Acceptance:** (plus shared acceptance)
  - `## Code checks` carries trunk's 5 bullets verbatim, in order (generator/`yield` requirement, exact stub URL, reactive display binding, server-seeded empty value, `data-wp-on--click` wiring).
  - `## Behavior checks` carries exactly the three bullets above; the conditional bullet is present, unconditional in presence, and names the covering code checks.
  - No behavior bullet claims the joke text renders live without the fallback.

### Task 4: Rewrite config-fetch/JUDGE.md to the template

- **Goal:** Restore trunk's full judging coverage for `config-fetch`, including the mandatory nonce-header live bullet with its explicit conditional fallback.
- **Type:** tdd
- **Files to change:** `testing-project/eval/scenarios/config-fetch/JUDGE.md`
- **Changes:** Follow the shared conventions. Trunk facts to verify: 8 acceptance bullets — bullets 1 and 2 are YAML double-quoted scalars; drop the surrounding quotes when transcribing. 1 e2e test whose observable assertions are: clicking the "Load post" button issues a request to `/wp-json/wp/v2/posts/1`; that request carries a non-empty `X-WP-Nonce` header (not the string `undefined`); the post title renders in the block. In the judge environment the endpoint is real, so the sequence stays live; per the design's wp-env-content risk, the expected title must not be hard-coded — the brief reads it via the WP-CLI bridge first — and the post's existence must be verified once against the real warm env (the verification step below; the design forbids silently depending on post ID 1 existing). Whether the judge's network-request tooling exposes request headers is unverified, so the nonce bullet carries the mandatory conditional (design Decision 4 rule 5). `## Behavior checks` carries exactly these four bullets (normative wording for the last; keep the others in this shape):

  - `Setup: using the WP-CLI bridge, look up the post with ID 1 and note its title — that is the text the block must render.`
  - ``Clicking the "Load post" button triggers a request to `/wp-json/wp/v2/posts/1` (check the browser's network-request log).``
  - `After the click, the block displays that post's title.`
  - ``The click-triggered request to `/wp-json/wp/v2/posts/1` carries a non-empty `X-WP-Nonce` header (check the request in the browser's network-request log); if the available tooling does not expose request headers, fall back to the code check above that `view.js` sets the `X-WP-Nonce` header from the config-supplied nonce.``

  **One-time warm-env verification (required — fully discharges the design's wp-env-content risk, first-listed mitigation).** The setup bullet assumes a post with ID 1 exists in the judge environment; the design doc flags that as unverified model knowledge and forbids depending on it silently. Before finalizing the brief, verify it once against the real warm judge env: boot the environment the way the judge hooks do (`bootJudgeEnv` in `testing-project/eval/utils/wp-env-judge.ts`, or equivalently `npm --prefix testing-project run env:start` for a fresh default-content wp-env), then look up post ID 1 through the WP-CLI bridge (`node testing-project/eval/utils/judge-wp.mjs post get 1 --field=post_title`, or the `wpCli` helper in `testing-project/eval/utils/wp-cli.mjs`). Record the outcome — the command and the returned title — in this task's commit message. If the lookup finds **no** post with ID 1, **stop and report a blocker** instead of shipping the brief: post IDs cannot be created on demand (`wp post create` auto-assigns IDs), so retargeting the live sequence would be a design-level change, and the setup bullet as written would misgrade the block on an environment defect. Because the judge env is recreated fresh from the same wp-env recipe on every run, this single verification is what makes the setup bullet deterministic for all future runs — no absence wording is needed in the brief itself.

- **Depends on:** Task 1
- **Traces to:** Spec R1–R5, R10; Acceptance criteria 1–4 (AC2's explicit-degradation clause); design Decision 4 rules 2, 3, 5; design risk "wp-env default content assumption".
- **Acceptance:** (plus shared acceptance)
  - `## Code checks` carries trunk's 8 bullets verbatim in order, with bullets 1–2 unquoted from YAML and no other wording change.
  - `## Behavior checks` carries exactly the four bullets above; the nonce bullet is present, unconditional in presence, and names its fallback code check.
  - No behavior bullet hard-codes an expected post title (no "Hello world!").
  - The one-time warm-env verification was performed: post ID 1's existence (and its current title) was confirmed against a running warm wp-env via the WP-CLI bridge, and the command plus returned title are recorded in this task's commit message. (A missing post is a blocker per Changes, not a wording change.)

### Task 5: Rewrite derived-double/JUDGE.md to the template

- **Goal:** Restore trunk's full judging coverage for `derived-double`, applying the single permitted edit class (skill-attribution removal).
- **Type:** tdd
- **Files to change:** `testing-project/eval/scenarios/derived-double/JUDGE.md`
- **Changes:** Follow the shared conventions. Trunk facts to verify: 5 acceptance bullets, no YAML quoting. **The one permitted edit:** in bullet 1, remove the phrase "from the Interactivity API skill" — the parenthetical becomes `(this is the static-derived-state pattern)` — keeping the check and its grading allowance otherwise verbatim (the judge is skill-agnostic by design; no other bullet in any scenario gets this treatment). 2 e2e tests whose observable assertions are: the two reactive values initially read 1 and 2; after each "Increment" click the pair reads 2/4, then 3/6, then (after two more clicks) 5/10 — the second value staying exactly double the counter after every click. Express as four bullets: initial 1 and 2; first click → 2 and 4; second click → 3 and 6; two further clicks → 5 and 10, the displayed pair remaining counter-and-exact-double after every click.
- **Depends on:** Task 1
- **Traces to:** Spec R1–R5, R10; Acceptance criteria 1–4; design Decision 4 rule 2 (edit class), rule 3.
- **Acceptance:** (plus shared acceptance)
  - `## Code checks` carries trunk's 5 bullets in order; bullet 1 differs from trunk only by the removed phrase "from the Interactivity API skill"; bullets 2–5 are verbatim.
  - `## Behavior checks` covers exactly: initial 1/2, then 2/4, 3/6, and 5/10 across the click sequence, with the double invariant stated.
  - The brief never names any skill.

### Task 6: Rewrite focus-trap-menu/JUDGE.md to the template

- **Goal:** Restore trunk's full judging coverage for `focus-trap-menu` (the largest scenario: 9 code checks, 4 live sequences).
- **Type:** tdd
- **Files to change:** `testing-project/eval/scenarios/focus-trap-menu/JUDGE.md`
- **Changes:** Follow the shared conventions. Trunk facts to verify: 9 acceptance bullets, no YAML quoting; 4 e2e tests whose observable assertions are: (1) initially the "Menu" button has `aria-expanded="false"` and the drawer is hidden; (2) clicking "Menu" flips `aria-expanded` to `"true"` and makes the "Home", "About", and "Contact" links visible; (3) with the drawer open, pressing Escape closes it (`aria-expanded="false"`, drawer hidden) and returns keyboard focus to the "Menu" button; (4) with the drawer open, pressing Tab with focus on "Contact" wraps focus to "Home", and Shift+Tab from "Home" wraps focus to "Contact". Focus-return and the Tab/Shift+Tab wrap are assertion-bearing and must appear as observations (design rule 3). Express as five bullets (initial state; open; Escape-close with focus return; Tab wrap; Shift+Tab wrap).
- **Depends on:** Task 1
- **Traces to:** Spec R1–R5, R10; Acceptance criteria 1–4; design Decision 4 rule 3 (assertion-bearing techniques).
- **Acceptance:** (plus shared acceptance)
  - `## Code checks` carries trunk's 9 bullets verbatim, in order.
  - `## Behavior checks` covers exactly the four trunk test sequences, including focus returning to the "Menu" button after Escape and both wrap directions.
  - No bullet mentions fixture mechanics (host post, activation, locator scoping).

### Task 7: Rewrite fruit-list-each/JUDGE.md to the template

- **Goal:** Restore trunk's full judging coverage for `fruit-list-each`.
- **Type:** tdd
- **Files to change:** `testing-project/eval/scenarios/fruit-list-each/JUDGE.md`
- **Changes:** Follow the shared conventions. Trunk facts to verify: 6 acceptance bullets, no YAML quoting; 3 e2e tests whose observable assertions are: the list initially shows exactly 3 items in order Apple, Banana, Cherry (server-rendered); clicking "Add Mango" yields 4 items with "Mango" as the 4th; clicking it twice yields 5 items with "Mango" as both the 4th and 5th. Express as three bullets mirroring those tests.
- **Depends on:** Task 1
- **Traces to:** Spec R1–R5, R10; Acceptance criteria 1–4; design Decision 4 rules 2–3.
- **Acceptance:** (plus shared acceptance)
  - `## Code checks` carries trunk's 6 bullets verbatim, in order.
  - `## Behavior checks` covers exactly: 3 initial items in Apple/Banana/Cherry order; 4 items with "Mango" 4th after one click; 5 items with "Mango" 4th and 5th after a second click.

### Task 8: Rewrite independent-counters/JUDGE.md to the template

- **Goal:** Restore trunk's full judging coverage for `independent-counters`, including its embed-twice environment delta.
- **Type:** tdd
- **Files to change:** `testing-project/eval/scenarios/independent-counters/JUDGE.md`
- **Changes:** Follow the shared conventions. Trunk facts to verify: 5 acceptance bullets, no YAML quoting; the trunk fixture embeds the block **twice** in one post (coverage-relevant delta → setup bullet); 2 e2e tests whose observable assertions are: both instances initially display 0; clicking the first instance's "Increment" twice leaves the displays at 2 and 0; then clicking the second instance's once leaves them at 2 and 1. `## Behavior checks` opens with a setup bullet in the shape `Setup: insert two instances of the block into one published post.`, followed by three observation bullets (both at 0; first ×2 → 2 / 0; then second ×1 → 2 / 1).
- **Depends on:** Task 1
- **Traces to:** Spec R1–R5, R10; Acceptance criteria 1–4; design Decision 3 (env-delta setup steps), Decision 4 rule 3.
- **Acceptance:** (plus shared acceptance)
  - `## Code checks` carries trunk's 5 bullets verbatim, in order.
  - `## Behavior checks` opens with the two-instance setup bullet and covers exactly the 0/0 → 2/0 → 2/1 sequence, asserting the untouched instance stays unchanged at each step.

### Task 9: Rewrite minimal-scaffold/JUDGE.md to the template

- **Goal:** Restore trunk's full judging coverage for `minimal-scaffold`.
- **Type:** tdd
- **Files to change:** `testing-project/eval/scenarios/minimal-scaffold/JUDGE.md`
- **Changes:** Follow the shared conventions. Trunk facts to verify: 3 acceptance bullets — bullet 2 is a YAML single-quoted scalar; drop the surrounding quotes when transcribing (inner double quotes stay). 2 e2e tests whose observable assertions are: the page shows the text "Hello from iAPI"; an "iapi-ready" message appears in the browser console once the block hydrates (hydration is asynchronous — the observation may need a moment); the block wrapper carries a non-empty `data-wp-interactive` attribute. Express as three bullets (console messages are judge-observable via the browser console-message log).
- **Depends on:** Task 1
- **Traces to:** Spec R1–R5, R10; Acceptance criteria 1–4; design Decision 4 rules 2–3.
- **Acceptance:** (plus shared acceptance)
  - `## Code checks` carries trunk's 3 bullets in order, bullet 2 unquoted from YAML with no other wording change.
  - `## Behavior checks` covers exactly: "Hello from iAPI" displayed; "iapi-ready" logged to the console after hydration; a non-empty `data-wp-interactive` attribute on the wrapper.
  - No bullet adds a "logged only once" live assertion (trunk's e2e did not assert once-ness live; the init-callback placement is code-check material).

### Task 10: Rewrite paginated-list/JUDGE.md to the template

- **Goal:** Restore trunk's full judging coverage for `paginated-list`, including its 5-extra-posts environment delta and the assertion-bearing no-reload sentinel and accessibility-tree checks.
- **Type:** tdd
- **Files to change:** `testing-project/eval/scenarios/paginated-list/JUDGE.md`
- **Changes:** Follow the shared conventions. Trunk facts to verify: 7 acceptance bullets — bullets 6 and 7 are YAML double-quoted scalars; drop the surrounding quotes and convert `\"` to `"` when transcribing. The trunk fixture creates **5 extra published posts** (6 total with the host post; 3 per page → 2 pages) — coverage-relevant delta → setup bullet. 2 e2e tests whose observable assertions are: (1) the list region (the `data-wp-router-region` wrapper) is present and shows the 3 newest posts (newest test posts present, oldest absent), and no "Previous" link is present in the page's accessibility tree within the block; (2) after planting a marker on `window`, clicking the block's "Next" link swaps the list in place to page 2 (the oldest post appears, the newest disappears), the URL updates to include `?pg=2`, and the `window` marker survives — proving no full page reload. Express as: one setup bullet in the shape `Setup: using the WP-CLI bridge, create 5 additional published posts so the site has at least two pages of 3 posts.`, then four observation bullets (page-1 contents in the router-region wrapper; "Previous" absent from the accessibility tree; plant the `window` marker via script evaluation; click "Next" → in-place swap to page 2 + URL contains `?pg=2` + marker survives).
- **Depends on:** Task 1
- **Traces to:** Spec R1–R5, R10; Acceptance criteria 1–4; design Decision 3 (env-delta setup steps), Decision 4 rule 3 (assertion-bearing techniques).
- **Acceptance:** (plus shared acceptance)
  - `## Code checks` carries trunk's 7 bullets in order; bullets 6–7 unquoted from YAML (with `\"` unescaped to `"`) and no other wording change.
  - `## Behavior checks` opens with the 5-extra-posts setup bullet and covers exactly: page-1 newest-3 contents, "Previous" absent from the accessibility tree, and the Next-click sequence proving in-place swap via the surviving `window` marker plus the `?pg=2` URL.
  - The R4 overlap is visible (router region and accessibility-tree absence appear as code checks and live observations, each in its own mode).

### Task 11: Rewrite shared-state/JUDGE.md to the template

- **Goal:** Restore trunk's full judging coverage for `shared-state`, including its embed-twice environment delta.
- **Type:** tdd
- **Files to change:** `testing-project/eval/scenarios/shared-state/JUDGE.md`
- **Changes:** Follow the shared conventions. Trunk facts to verify: 6 acceptance bullets, no YAML quoting; the trunk fixture embeds the block **twice** in one post (setup bullet, same shape as Task 8); 2 e2e tests whose observable assertions are: both instances initially display 0; clicking the first instance's "Increment" updates both displays to 1, clicking the second's updates both to 2, and clicking the first's again updates both to 3 — every click updates both displays in lockstep, whichever button is clicked. Express as the setup bullet plus two observation bullets (both at 0; the three-click lockstep sequence).
- **Depends on:** Task 1
- **Traces to:** Spec R1–R5, R10; Acceptance criteria 1–4; design Decision 3 (env-delta setup steps), Decision 4 rule 3.
- **Acceptance:** (plus shared acceptance)
  - `## Code checks` carries trunk's 6 bullets verbatim, in order.
  - `## Behavior checks` opens with the two-instance setup bullet and covers exactly the 0/0 start and the 1 → 2 → 3 lockstep sequence alternating which instance's button is clicked.

### Task 12: Rewrite toggle-visibility/JUDGE.md to the template

- **Goal:** Restore trunk's full judging coverage for `toggle-visibility`.
- **Type:** tdd
- **Files to change:** `testing-project/eval/scenarios/toggle-visibility/JUDGE.md`
- **Changes:** Follow the shared conventions. Trunk facts to verify: 5 acceptance bullets — bullet 5 is a YAML single-quoted scalar (it contains a colon); drop the surrounding quotes when transcribing (inner double quotes stay). This scenario is *not* in the design doc's illustrative unescaping list, but design Decision 4 rule 2's general rule ("unescape YAML-quoted scalars") governs; the list was illustrative. 2 e2e tests whose observable assertions are: initially the paragraph is hidden and the button has `aria-expanded="false"`; clicking the button reveals the paragraph and flips `aria-expanded` to `"true"`; clicking it again hides the paragraph and flips `aria-expanded` back to `"false"`. Express as three bullets.
- **Depends on:** Task 1
- **Traces to:** Spec R1–R5, R10; Acceptance criteria 1–4; design Decision 4 rules 2–3.
- **Acceptance:** (plus shared acceptance)
  - `## Code checks` carries trunk's 5 bullets in order, bullet 5 unquoted from YAML with no other wording change (inner `aria-expanded="false"` quotes preserved).
  - `## Behavior checks` covers exactly: hidden + `"false"` initially; visible + `"true"` after one click; hidden + `"false"` after a second click.

### Task 13: Finalize the conformance test to the template contract

- **Goal:** Lock the new brief template mechanically, exactly per design Decision 5, now that all 11 briefs comply.
- **Type:** tdd
- **Files to change:** `src/__tests__/testing-project-scenarios.test.ts`
- **Changes:**
  - Rewrite the JUDGE.md content test so that, for every one of the 11 briefs, it asserts exactly these seven uniform, scenario-independent invariants:
    1. has a `## Code checks` heading and a `## Behavior checks` heading (regexes of the form `/^#+\s+Code checks$/im` and `/^#+\s+Behavior checks$/im`);
    2. contains the literal rubric id `wp-interactivity-api-best-practices` (the R2 activation-key guard);
    3. does NOT contain `RUBRIC_SENTINEL` (no rubric inlining);
    4. does NOT match `/\{\s*["']?pass["']?/` (harness owns the output format);
    5. does NOT contain `$SKILLSMITH_JUDGE_URL` or `$SKILLSMITH_POST_ID`;
    6. matches the decision-rule opener fragment `/pass only if every check/i` — the chosen short stable fragment of the fixed opener (a contiguous substring of "Pass only if every check, including the rubric check, is satisfied.");
    7. does NOT match `/^#+\s+Rubrics$/im` (brief opaqueness holds).
  - No per-scenario data may inform these assertions; the only per-scenario data in the file remains `ANCHORS`' `prompt` fragments guarding the out-of-scope `TESTING-AGENT.md` task text.
  - Rewrite the file's header comment and the test's title to describe the new contract: the two-file model, the fixed task-free decision-rule opener, `## Code checks` closing with the bare-id rubric sentence, `## Behavior checks` for live checks, the auto-supply division of labor (skill-stripped task and rubrics injected by the harness; environment mechanics owned by the judge role prompt), and — explicitly — that coverage parity with trunk is reviewer-verified, not asserted here (R8).
  - Change nothing else: the two-file test, enumeration test, anchors-cover-set test, `TESTING-AGENT.md` test, and `_candidates.yaml` test stay as Task 1 left them.
- **Depends on:** Tasks 2–12 (all)
- **Traces to:** Spec R2, R8, R9; Acceptance criteria 3, 7, 8; design Decision 5.
- **Acceptance:**
  - `npm test` passes against the 11 rewritten briefs.
  - The JUDGE.md content test asserts exactly the seven invariants above — no more, no fewer; temporarily breaking any one of them in any brief (e.g. renaming a heading, deleting the rubric id, inlining the sentinel sentence, adding `{ "pass"`, or rewording the opener fragment) makes `npm test` fail.
  - No assertion in the file encodes per-scenario judging coverage; `liveChecks` does not appear; `ANCHORS` still carries exactly the 11 `prompt` fragments.
  - The revision diff (`git diff --name-only <parent-of-Task-1's-commit>..HEAD -- . ':(exclude).pipelines'`) lists exactly 12 files: the 11 `JUDGE.md` briefs and this test file — zero core changes, zero config changes, no changeset (AC5/AC6/AC7's code-side consequence). The `:(exclude).pipelines` pathspec is part of the criterion: pipeline artifacts (review records, plan revisions) legitimately commit into the range mid-phase and must not fail this check.
  - `npm run typecheck`, `npm run lint`, `npm --prefix testing-project run check:config`, and `npx tsx scripts/validate-changesets.ts` all pass.
