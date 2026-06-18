# Spec research — Stop the self-improvement loop from overfitting skills to eval scenarios (#48)

Status: COMPLETE — requirements clear, testable, with acceptance criteria and out-of-scope.
Ready for a spec-writer to synthesize a standalone spec.md. (5 questions resolved via Q&A with
spec-researcher; every claim file-backed.)

## Decisions log (settled-with-default vs owner-level — for spec-writer + owner)

All have a recommended default the spec can be written against; none are blockers. Two are worth
the owner's explicit sign-off:
- D1 (SETTLED): the `validator` role is OPTIONAL; absent → loop behaves exactly as today.
  Forced by backward-compat (existing configs/tests must stay valid). No owner input needed.
- D2 (OWNER-LEVEL, recommend default): cap-without-approval KEEPS the last edit + warns (advisory
  gate), does NOT revert. Faithful to "edits live in the working tree for human review" + the
  outer-cap precedent + the "floor-raiser, not a guarantee" intent. A harder revert-gate would be
  stronger-than-intent; spec names it a non-goal unless the owner elects it. *Confirm with owner.*
- D3 (SETTLED): round cap = new `selfImprovement.maxValidationRounds`, integer ≥1, default 2,
  same shape/precedence as `maxIterations`.
- D4 (SETTLED): validator sees {post-edit whole skill, scenario corpus, rubrics}; NOT the judge
  reviews; optionally the diff. Edit-capture in-process/ephemeral, whole skills root, no git.
- D5 (SETTLED, recommend default): spec REQUIRES the LLM validator (catches forms a–d); the
  deterministic pre-scan (RULES 1–3) is a recommended-but-OPTIONAL accelerator, left to design.
  (Owner may mandate the pre-scan if a deterministic floor is wanted — not required.)
- D6 (SETTLED): validator runs with `role:"judge"` (read-only), identified by its system prompt;
  no new provider `Role` value. Validator prompt behavior recommend = replace (mirror improver),
  small design call.

## 0. External grounding (state of the art — for honest-limits framing)

Literature on benchmark contamination / memorization detection (arxiv 2406.04244 survey;
researchgate 399521396 on LLM-reasoning limits) gives a precise frame for the intent's
legible-vs-subtle caveat: **detection difficulty inversely correlates with proximity to full
exposure.** Label-level / verbatim exposure (copying a value, naming a scenario, copying
acceptance wording) is straightforward to detect; semantic/abstract contamination (paraphrase,
single-case-answer dressed as general) is "inherently more challenging." This independently
validates RULES 1–3 (verbatim/literal → reliably detectable) vs RULE 4 (semantic → LLM-only and
imperfect). The literature also warns of **judge bias / "confident fabrication aligned with
evaluator priors"** — an LLM critic can hallucinate findings — which is the source of the
false-positive risk the validator must be tuned against (see Q5). Net: the spec's honesty
caveat ("cheap floor-raiser, not a guarantee; catches legible not subtle") is the
correct/defensible position, not under-ambition.

## 1. Problem, grounded in code

When the self-improvement loop edits a skill to fix failing scenarios, the edit must encode
*general* guidance, not memorized answers to the specific evaluation scenarios. Blatant
train/test leakage — naming a scenario, copying acceptance/rubric wording verbatim,
hard-coding an expected value, or writing a single-case answer — should be detected and kept
out of the skill before the edit is accepted.

### Where the loop lives (verified)

- The improver runs in `src/improvement/improver.ts` (`runImprovement`), invoked from
  `src/pipeline/pipeline.ts:193` after the scenario sweep has been graded and verified, when
  the run is not yet passing and there is iteration budget left (`!mergedPass && i < maxIterations
  && mode === "self-improvement"`).
- It runs as the only writer: cwd jailed to the skills root (`config.paths.skills`), role
  `testing` (Read/Write/Edit/Glob/Grep/Bash), edits SKILL.md files in place. No proposal step,
  no executor, no git. Transcript written to `iteration-N/improvement.md`.
- The context it receives is built in `src/improvement/context.ts` (`buildImprovementContext`):
  - `report`: the full iteration report — every scenario that ran, passing AND failing — with
    **each judge's verbatim `review`** (rubrics + acceptance, with notes). Only the per-agent
    `testing` block (durations/tokens) is stripped.
  - `skillsBlob`: the **full verbatim text** of every skill referenced by a failing scenario.
  - So the improver is literally handed: the answer key (verbatim judge reviews tied to
    acceptance/rubric wording) + the full skill text. This is the mechanism that makes leakage
    the expected outcome.

### Why the judge can't fix it (constraint, verified)

- The judge is deliberately skill-blind: `src/pipeline/judge-agent.ts` — it "never sees the
  skill text — only the rubrics, the inline acceptance items, and the files the testing agent
  produced," and the prompt explicitly says "Do not consult any skill documentation." The
  intent's constraint ("the fix must not live in the judge") matches the code.

### Why a held-out gate is off the table (constraint, verified)

- Scenarios come from the consuming project, not the tool. `testing-project` has 11 real
  scenarios (`eval/scenarios/*/scenario.yaml`). Another project would have a different,
  possibly smaller, count. So the mechanism must work for small corpora — no train/holdout
  split assumption.

### Documented invariants the validator touches (README.md — verified, for docs phase)

- `snapshotWorkspace`/`diffSnapshots` already exist (`src/pipeline/testing-agent.ts:105,154`):
  an in-process before/after Map<rel,{mtimeMs,size}> diff used to detect what the testing agent
  wrote (snapshot before at :41, diff after at :82). This is the reusable primitive for the
  validator's edit-capture over the skills root — NO git, NO new pattern.
  - PRECISION (confirmed): this primitive returns only the LIST of CHANGED FILE PATHS (keyed on
    `{mtimeMs, size}`), NOT content. So "capture the edit" = (path-level change detection via the
    snapshot primitive — which also catches NEW files and edits OUTSIDE failing-skills, closing
    the Q2.1 blind spot) + (content read of before/after via `loadSkill`/read on those paths).
    Two complementary primitives, both already in-repo. Simpler alternative the spec may prefer:
    read-and-compare CONTENT directly over the skills root and skip mtime/size entirely (the
    validator needs content regardless). Spec wording must NOT say "snapshot primitive alone =
    the edit."
- Docs verdict (confirmed by grepping README/CONTRIBUTING/docs/AGENTS):
  - EXACTLY ONE statement flips true→false: README:116 "There is no separate proposal or review
    step" — the validator IS a review step; it's the ONLY place asserting "no review step", so a
    single-line fix (plus a clause in the improver-flow description for the validate/revise inner
    loop).
  - README:124 "The improver is the only agent that writes, and only inside `paths.skills`" →
    STAYS TRUE, and is a REQUIREMENT to PRESERVE: keep the validator write-less so this holds.
  - README:124 "never commits, pushes, or captures a diff … working tree for human review" →
    STAYS CONSISTENT because the statement is about GIT/persisted artifacts (the testing agent
    ALREADY computes an in-process before/after every scenario and has coexisted with it fine).
    Spec must word edit-capture as in-process / ephemeral / not-git, and must NOT introduce a
    persisted `*.diff` file (that would bump the LETTER of "never captures a diff"). Persist the
    validator's PROSE verdict/feedback (like `improvement.md`), not a diff artifact.
- README:124 "The improver is the only agent that writes, and only inside `paths.skills`." →
  STAYS TRUE (validator is read-only).
- README:116 "There is no separate proposal or review step." → BECOMES FALSE — the validator IS
  a review step. Docs phase must update this.
- README:124 "The harness never commits, pushes, or captures a diff — your edits live in the
  working tree for human review." → about GIT/persisted artifacts. An ephemeral in-process
  snapshot (never written/committed) is arguably consistent; spec should word edit-capture as
  in-process and ephemeral so it doesn't contradict this.
- README:200 "`roles.improver.prompt` replaces the built-in improver instructions entirely" —
  precedent for how a `roles.validator.prompt` would behave (replace vs append). Note:
  test/judge prompts are APPENDED as "# Role instructions"; improver prompt REPLACES. Validator
  prompt behavior is a small spec decision (recommend: mirror improver = replace, since it's
  also a harness-owned-instructions agent — but flag for design).

### How a validator role would attach (verified surface area)

- `roles` is a small, extensible structure: `RolesInput` / `NormalizedRoles` in
  `src/config/types.ts`, normalized in `src/config/normalize.ts`, validated in
  `src/config/validate.ts`. Single-agent roles accept a `string` shorthand or
  `{ agent, prompt }`. A `validator` role would be a natural fourth role alongside
  `test` / `judge` / `improver`.
- The reviewer/writer loop pattern already exists in radical-pipelines
  (spec-reviewer/spec-writer, code-reviewer/code-writer) — precedent for an approve/revise
  loop with the writer staying the only mutator.

### Role plumbing details (verified, relevant to spec'ing the validator role)

- A single-agent role is validated by `validateSingleRole` (`src/config/validate.ts:139`)
  and normalized by `normalizeSingleRole` (`src/config/normalize.ts:54`) — both reusable for a
  new `validator` role. `roles` is required to be an object with `test`/`judge`/`improver`
  today (`validate.ts:94`); adding a fourth role raises the backward-compat question below.
- Provider `Role` is only `"testing" | "judge"` (`src/providers/types.ts:16`). The validator is
  read-only, so it maps naturally to `judge` (read-only tool surface) — BUT unlike the scenario
  judge it MUST see the skill text + the diff. So "read-only like the judge" ≠ "uses the judge's
  skill-blind prompt." Worth flagging to design; for the spec it just means the validator is a
  distinct read-only role, not the scenario judge.
- The improver invoke (`improver.ts:148`) returns `InvokeResult { finalText, toolUseCount,
  error? }`. A validator would invoke the same way and the harness would parse a structured
  verdict from `finalText` (the judge already does this — `parseJudgeJson`,
  `judge-agent.ts:141`). Precedent exists for "agent emits a single JSON verdict the harness
  parses."

### Questions the code surfaced at the start (ALL resolved via Q&A — see Decisions log + §3)

These were the open questions when I first read the code; each was driven to ground in the Q&A.
Kept here as the research trail; the Decisions log at the top and §3 hold the resolutions.
- Q-i (backward compat): validator role REQUIRED or OPTIONAL? → OPTIONAL, forced by
  backward-compat (Q3/Q4; Decisions D1). Absent → behaves exactly as today.
- Q-ii (gate vs annotate / "accepted" mechanics): → approve/revise inner loop, improver edits
  in place, "accepted" = validator approved current on-disk state; advisory-in-loop /
  authoritative-at-PR (Q3; Decisions D2).
- Q-iii (round cap default + cap-without-approval): → `maxValidationRounds` default 2; on cap
  KEEP + warn, do NOT revert (Q3; Decisions D3).
- Q-iv (what the validator sees / answer-key tension): → {post-edit whole skill, corpus,
  rubrics}; NOT judge reviews; in-process/ephemeral/no-git edit-capture (Q2; Decisions D4).

## 2. Proposed direction (from intent, to be pinned down)

Add a read-only **validator** agent that reviews the improver's edit for generality /
anti-leakage and returns `approve` or `revise`-with-changes, looping until approval or a
small round cap; the improver stays the only writer. The validator judges *edit quality*
(general? leaked?), not *correctness* (does the scenario pass?) — correctness stays with the
scenario judge on the next sweep. Honest scope: catches only legible/blatant overfitting, not
subtle overfitting; a cheap floor-raiser, not a guarantee.

## 3. Open questions (Q&A log)

### Q1 — Concrete detectable leakage signals (ANSWERED)

**Smoking gun — the live skill is already overfit.** Cross-referencing the active skill tree
against the 11 scenarios shows scenario-specific literals memorized into "general" guidance:
- `'joke' => ''` / `joke` → async-fetch only (SKILL.md:21,183,199)
- `(no post loaded yet)` → config-fetch only, verbatim acceptance wording (SKILL.md:21)
- `Apple`/`Banana`/`Cherry`/`Mango`/`Add Mango` → fruit-list-each only (SKILL.md:212,221,228; also references/server-rendering.md)
- `iapi-ready`/`Hello from iAPI` → minimal-scaffold only (SKILL.md:242,247)
- `'pg'`/`?pg=<n>` → paginated-list only (SKILL.md:254; also references/directives.md, client-navigation.md)
- `X-WP-Nonce` → config-fetch only (SKILL.md:207)

This is #48's failure mode, observable in the repo today. It gives the design/code phases a
ready-made **positive fixture**: a known-overfit skill the validator MUST flag. (Confirmed by
reading SKILL.md directly — it ships a `toggle` example with `aria-expanded`/`isOpen` mirroring
the toggle-visibility scenario, so the example-vs-memorization line is genuinely subtle.)

**Leakage taxonomy for this corpus (4 tiers):**
- (a) Scenario names / dir names (`toggle-visibility`, `counter-block`, `paginated-list`, …) in the edit → blatant. NOTE: dir name ≠ `scenario.name` (dir `counter` → name `counter-block`); both forms matter.
- (b) Scenario-unique literal values — the fingerprints above plus things like counter seed `5`, anchors `#home`/`#about`/`#contact`, `rest_url('wp/v2/posts/1')`, "3 most recent posts". The prompt's incidental particulars, not the API.
- (c) Verbatim acceptance/rubric sentence fragments copied into skill prose (e.g. `(no post loaded yet)`; rubric phrasings like "no flash of unbound content").
- (d) Single-case answers — guidance shaped "for THIS task do X" rather than "in general do X". Not pinnable to a string.

**The sharp domain-vs-leakage discriminator (key result): BREADTH OF APPEARANCE, and it's
measurable.**
- DOMAIN (must teach, NOT leakage): a token that recurs across MANY scenarios and/or appears
  in the rubric is the API's own surface — `data-wp-on--click` (10/11 scenarios + skill),
  `data-wp-text` (6/11 + skill + rubric), `wp_interactivity_state` (5/11 + skill + rubric),
  `data-wp-bind`, etc. Flagging these makes the validator useless.
- LEAKAGE (fingerprint): a token in EXACTLY 1 scenario with zero rubric presence.
- This breadth signal is **exactly why the small-corpus constraint still works**: you don't
  split train/holdout, you ask "is this string a fingerprint of one of the scenarios I can
  see?" The validator's corpus = the 11 active `*/scenario.yaml` + the rubric files.
  (`_candidates.yaml` is NOT enumerated — `src/scenarios/enumerate.ts:30` — exclude it.)

**Hard edge case (irreducible):** an illustrative example legitimately needs SOME concrete
value. Leakage isn't "the skill uses a concrete value" — it's "the skill uses THE SCENARIO'S
value." A `data-wp-each` example could teach with `['One','Two','Three']`; `Apple/Banana/
Cherry/Mango` mirrors fruit-list-each. Recommended rule: deterministic literal match = strong
prior / surfaced evidence; the LLM makes the approve/revise call. Don't auto-reject on string
match alone — rule is "use a value that ISN'T one of the eval scenarios' values."

**Deterministic vs LLM-judgment split:**
- Deterministic (cheap, high-precision, explainable): (a) scenario/dir name match; (b)
  scenario-unique literal match (needs tokenization + the "exactly-one-scenario, not-in-rubric"
  set); (c) verbatim sentence-fragment copy via n-gram / LCS over ~6+ word windows. Could run
  as a pre-filter handing the LLM a list of suspicious spans.
- Irreducibly LLM: (d) single-case-answer detection (generality is semantic); the
  example-vs-memorization edge; PARAPHRASED leakage (reworded acceptance, no n-gram match) —
  which the intent explicitly scopes OUT.

**Three precise, defensible detection rules (refined — priority order):**
- RULE 1 (scenario identity): edit contains a scenario `name`/dir-name → blatant, zero false
  positives, deterministic/exact. A general skill never needs to name an eval scenario.
- RULE 2 (scenario-unique literal): edit contains a literal (quoted string, number,
  identifier, URL) occurring in EXACTLY ONE active scenario's prompt/description/acceptance and
  NOT in the skill's own domain surface independently. Precise version of "hard-coded expected
  value." Self-calibrating: a value shared by ≥2 scenarios is plausibly domain; unique-to-one
  is plausibly its answer. Honest boundary: high-precision for strings/URLs/distinctive
  identifiers, LOW-precision for bare small integers (`1`/`0`/`5`) — there, flag don't reject;
  hand to the LLM.
- RULE 3 (verbatim span copy): a contiguous N+-word span (N≈6–8) of the edit's ADDED text is a
  verbatim substring of some scenario's acceptance/prompt or a rubric bullet. Precise version
  of "copying acceptance/rubric wording." N≥6 clears unavoidable domain phrases
  ("server-rendered HTML").

**The crisp meta-rule to put in the spec (verbatim-worthy):** *"Leakage = the edit references
something that identifies a SPECIFIC scenario (its name, its unique value, or its verbatim
wording); domain = the edit references the API surface that recurs across scenarios and is what
the skill exists to teach. Specificity-to-one-scenario is the bright line."* Do NOT anchor on
"appears in the rubric" — the rubric and skill SHOULD share vocabulary; anchoring there would
flag the subject matter. Anchor on scenario-corpus uniqueness + specificity.

**RULE 4 (single-case answer) is irreducibly LLM:** guidance structurally shaped as an answer
to one scenario without copying any token (e.g. "When the user wants a counter starting at 5
with increment and decrement, seed context.counter=5 and add two actions" — leaks
counter-block's whole shape; `5` is weak, the rest is domain words in a scenario-shaped
arrangement). No scanner catches it.

**Design decision surfaced (D5):** whether the spec MANDATES a deterministic pre-scan feeding
the LLM validator, or leaves it pure-LLM. Researcher recommendation: spec REQUIRES the LLM
validator; the deterministic pre-scan (RULES 1–3) is a recommended-but-OPTIONAL accelerator —
because the LLM alone (given the corpus) can in principle catch forms 1–4, whereas the pre-scan
alone can NEVER catch form 4. Spec should require the *behavior* (catch forms a–c blatant
leakage reliably, attempt d) and leave the pre-scan-vs-pure-LLM mechanism to design.

### Q2 — What the validator sees + how it gets the edit (ANSWERED)

**Edit-capture mechanism:**
- REJECT git (Option C). Git was deliberately designed OUT of the improver: a former
  `src/improvement/git.ts` + pipeline precondition were REMOVED in a later refactor; improver.ts:34
  instructs "Do not commit, push, or run git"; and `self-improvement-loop.test.ts:90` asserts
  "no skills.diff — the improver does not depend on git." Reintroducing git would reverse a
  deliberate decoupling. **Hard constraint: the validator must NOT depend on git.**
- Option A (in-process before/after snapshot) is FEASIBLE and natural. A pre-edit read point
  already exists: `buildImprovementContext` runs at improver.ts:102, BEFORE `provider.invoke`
  at improver.ts:149, producing `context.skillsBlob` (full verbatim skill text via `loadSkill`,
  which follows md-links). Re-running `loadSkill` after invoke gives the "after." All inside
  `runImprovement`, between invoke and return — no loop restructuring. Cost: one extra cheap
  sync read of a few markdown files.
- **Caveat that drives a real requirement:** `skillsBlob` is SCOPED to failing-scenario skills
  (`collectSkillIds`, context.ts:61), but the improver's cwd is the SKILLS ROOT (improver.ts:117,
  153) and it can edit ANY skill or CREATE new files. So a before-snapshot reusing `skillsBlob`
  has two blind spots: edits to a skill not referenced by a failing scenario, and brand-new
  files. Moot in testing-project (one skill) but real for multi-skill projects. **The snapshot
  should cover the WHOLE skills root (walk `paths.skills`), matching the improver's write scope.**

**Diff-only vs whole-skill review (a genuine spec decision):**
- Leakage is a property of the RESULTING SKILL STATE, not only the round's delta. The live
  skill is ALREADY overfit from past iterations — a diff-only validator reviewing iteration N's
  delta would wave through pre-existing leakage as long as THIS round's change is clean. A
  whole-skill validator catches accumulated leakage.
- The intent's wording ("the resulting edit should encode general guidance"; "kept out of the
  skill before the edit is accepted") points at OUTCOME (skill state), not the delta.
- **Recommendation: spec requires the validator sees the POST-EDIT SKILL (whole) + the corpus;
  passing the before/after diff is a recommended enhancement (sharpens single-case-answer
  detection and lets revise feedback say "the line you added"), not load-bearing.** Skills are
  small so whole-skill review is cheap.

**Showing the validator the corpus is NOT a violation / not a new leak.**
- "Skill-blind" is strictly the SCENARIO JUDGE's property (enforced only in judge-agent.ts:111);
  there is no repo-wide "no component sees both skill and scenarios" rule. The improver ALREADY
  sees both the full skill AND the corpus-derived answer key. The validator is downstream — no
  new information exposure.
- The asymmetry is intended: the judge is skill-blind so it grades the ARTIFACT not the skill's
  claims; the validator's JOB is the opposite (compare skill-against-corpus to detect copying),
  so it MUST see both. No conflict.
- The leak #48 cares about is corpus→SKILL (persisted, ships to users), NOT
  corpus→ephemeral-reviewer (discarded after the decision). The validator's transcript must NOT
  be written into the skill (same as improver's `improvement.md` is a discarded evidence trail).

**Minimal sufficient input set:**
- MUST HAVE: (1) post-edit skill text (whole skill); (2) the active scenario corpus — each
  scenario's name + description + prompt + acceptance (`Scenario` shape, types.ts:123, already
  enumerated); (3) the rubric text(s) (read as judge-agent.ts:96 does).
- NICE TO HAVE: the before/after diff.
- SHOULD NOT HAVE: the JUDGE REVIEWS (pass/notes) — correctness axis (orthogonal to leakage),
  the most concentrated form of the answer key, and feeding them tempts the validator toward
  "did the edit make the scenario pass" (the correctness-coupling to avoid). Also NOT the
  testing agents' produced files. Clean cut: validator sees what the improver could have COPIED
  FROM (scenarios+rubrics) but NOT the GRADED RESULTS.

### Q3 — Approve/revise contract, "accepted" mechanics, round cap (ANSWERED)

**On REVISE (mechanics):** improver edits again ON TOP per the validator's feedback; the
validator re-reviews the NEW on-disk state; "accepted" = validator approved the CURRENT on-disk
state. NO staging, NO revert-between-rounds — the improver is the sole writer and writes in
place; leaked text persists on disk only until the improver itself edits it out. Mirrors how a
human iterates on a file toward review comments. Validator needs NO write capability (read-only,
reuses judge `[Read]` surface). Each revise round feeds the improver: {validator's specific
change-requests (leaked spans + what to generalize) + the SAME original iteration report +
skillsBlob the first round had}.

**On CAP-WITHOUT-APPROVAL: KEEP the last edit + record a PROMINENT warning (option i+iii); do
NOT revert.** Grounding:
- The OUTER loop ALREADY does "give up after N rounds, keep the artifact, report failure" — at
  `i >= maxIterations` un-passed (pipeline.ts:188 `i < maxIterations` guard) the loop stops, the
  last edit stays, exit code is 1 (summary.ts:76 `allPass ? 0 : 1`). NO revert on outer-cap. The
  inner validator loop should mirror this, not invent a revert mechanic with zero precedent.
- There is NO revert/restore/rollback anywhere in prod code. The PRISTINE_SKILL writeback
  (self-improvement-loop.test.ts:34/46) is TEST cleanup, not harness behavior.
- Faithful to the documented contract: "edits live in the working tree for human review"
  (README:124/23). Reverting on cap would contradict the docs and surprise the user (failing
  scenario unchanged AND partial progress vanished).
- Resolves the tension: option (ii) revert can STALL progress (a legitimately-hard fix the
  validator keeps nitpicking gets thrown away) — worse than option (i)'s "leakage persists but
  is flagged + caught at PR review." The intent reads "kept out of the skill before accepted AS
  CLEAN/merged": the gate is ADVISORY within the automated loop, AUTHORITATIVE at the human PR
  boundary. Intent itself: "cheap floor-raiser, not a guarantee" — argues against a hard
  revert-gate.
- **Honest caveat to state in the spec:** option (i) DOES let leakage reach the working tree on
  cap; acceptable because human PR review is the real merge gate and the warning makes it
  legible. A HARDER guarantee (revert-on-cap) would be a deliberate stronger-than-intent choice
  — the spec should name it as an explicit non-goal unless the owner asks for it. **(Flag D2 to
  team-lead: confirm advisory-gate-with-warning is the intended strength, not a hard
  revert-gate.)**

**Loop shape:** INNER loop inside `runImprovement` (or a helper it calls, e.g.
`runImproveValidateCycle`), wrapping the existing single `improver.invoke`. OUTER loop
(pipeline.ts:188-208) UNCHANGED — still calls `runImprovement` once per failing iteration.
Pseudocode:
```
improver.invoke(original context)          // existing call, round 0
loop:
  after = re-read skills root              // snapshotWorkspace-style
  verdict = validator.invoke({post-edit skill, corpus})   // read-only
  if verdict == approve OR round >= cap: break
  improver.invoke(original context + validator feedback)  // re-edit in place
  round++
```
Validator rounds leave their own evidence trail (e.g. `iteration-N/validation-round-K.md`),
consistent with the "full evidence trail" promise; that transcript is discarded-not-persisted
(per Q2).

**Round cap config:** new `selfImprovement.maxValidationRounds`, SAME shape as `maxIterations`:
integer >= 1, clamped `Math.max(1, …)`, precedence CLI override > config > default (mirror
`resolveSelfImprovement`, self-improvement.ts:37-49; add to `ResolvedSelfImprovement` +
`SelfImprovementOverrides`), validated as "integer >= 1" (mirror validate.ts:188-194). Suggested
default 2 (improver's first pass + up to 2 revise rounds). DO NOT overload `=0` as "disabled" —
keep clamp `>= 1`; use validator-role PRESENCE/ABSENCE as the on/off (see Q4/D1). Cap means "how
many revise rounds when the validator IS active."

**Backward compat is essentially forced (pre-answers D1):** existing configs (testing-project,
all fixtures, self-improvement.test.ts's roles triple) have `roles = {test, judge, improver}`
with NO validator. The chosen shape MUST leave those valid and behavior-identical → the
validator role MUST be OPTIONAL; absent → loop runs exactly as today (zero behavior change).

### Q4 — Verdict format + role/provider/mock wiring (ANSWERED)

**FAIL-OPEN (firm).** Unparseable or errored validator verdict → treat as APPROVE, log, exit the
inner loop. Grounding: (1) the improver is already fail-open — provider error → log + return
normally, "Errors are logged; the loop keeps moving" (improver.ts:68,159-168); (2) the judge
degrades-not-crashes on unparseable JSON (`{error:"unparseable", raw}`, judge-agent.ts:77-84) —
the harness NEVER lets a sub-agent's malformed output abort the run; (3) the intent's
"floor-raiser, not a guarantee" demands the validator never become a CEILING-LOWERER — a broken
validator must leave the system no worse than the pre-validator baseline. Concrete rules:
- provider error → log, treat as approve, exit inner loop.
- verdict won't parse → log "validator verdict unparseable", treat as approve, exit (do NOT
  spend a revise round on garbage — a model that can't emit valid JSON won't emit useful
  findings).
- `verdict=="revise"` but findings empty/absent → malformed → fail-open to approve.
- ONLY a parseable `verdict=="revise"` with non-empty findings triggers a revise round.
- **Log nuance (spec sentence):** distinguish "validator said approve" from "validator
  failed → treated as approve" in the evidence trail, so a chronically-broken validator is
  visible to a human reviewer even though both exit identically.

**Verdict schema (mirror the judge's JSON contract):**
```
{ "verdict": "approve" | "revise",
  "findings": [ { "leak_type": "scenario-name|scenario-value|verbatim-copy|single-case",
                  "span": "<offending text>", "why": "<1 line>",
                  "suggested_fix": "<how to generalize>" } ] }
```
- findings REQUIRED & non-empty when `revise`; absent/empty on `approve`.
- `leak_type` enumerated to the four forms (Q1 a–d) — typed reason for the improver + testable
  (fixtures can assert the RIGHT category).
- `span` = the actual offending substring → improver can locate it; a deterministic test can
  assert the finding names `Apple`/`(no post loaded yet)`/etc.

**Parse helper:** EXTRACT `parseJudgeJson`'s fenced/bare-tolerant core (judge-agent.ts:141-153)
into a shared util (e.g. `util/parse-agent-json.ts`), reuse for both judge and validator, and
layer a validator-specific shape check on top (confirm `verdict` ∈ {approve,revise} + findings-
when-revise). Low-risk refactor that improves the judge path too.

**Role decision (HIGH-LEVERAGE): REUSE `role:"judge"`, do NOT add a new `"validator"` Role.**
`Role` drives the tool surface via EXHAUSTIVE `Record<Role,…>` maps in MULTIPLE providers
(claude-code.ts:10, codex.ts:16, fs-tools.ts:283 used by vercel-runner, mock.ts:50) plus the
union (types.ts:16). A new Role value forces edits to ALL of them. The validator is READ-ONLY —
tool-identical to the judge (`[Read]`). Run it with `role:"judge"` → correct read-only sandbox
across EVERY provider for FREE. Role is a tool-permission TIER, not an identity; the validator's
identity is carried by its SYSTEM PROMPT (exactly as the improver runs `role:"testing"` but is
identified by prompt, improver.ts:124/154).

**Exact wiring surface (small, additive, backward-compatible — NO registry/provider/Role-union
changes):**
- types.ts: `RolesInput` (line 50-54) `+ validator?: SingleRoleInput`; `NormalizedRoles` (69-73)
  `+ validator?: { agent; prompt? }`. Role union UNCHANGED.
- validate.ts: `validateRoles` (87-101) `+ if (roles.validator !== undefined)
  validateSingleRole(roles.validator, "roles.validator", agentIds, errors);` — reuses
  validateSingleRole as-is.
- normalize.ts: `normalizeConfig` roles block (28-39) `+ ...(input.roles.validator !== undefined
  ? { validator: normalizeSingleRole(input.roles.validator, agents) } : {})` — reuses
  normalizeSingleRole, carry-through only when present (mirrors hooks/selfImprovement at 47-50).
- mock.ts: KEY TESTABILITY HOOK — add `if (params.systemPrompt.includes("validator agent"))
  return invokeValidator(params);` (pattern from the improver branch at mock.ts:61) returning a
  deterministic `{verdict, findings}`. Mock can key approve/revise off a skill sentinel (analog
  of MOCK_GATE/MARKER at mock.ts:19-20) to drive improve→revise→improve→approve with no real
  model.
- Inner-loop logic (in `runImprovement`/helper): read `config.roles.validator?.agent` ONLY when
  defined; undefined → skip the validator entirely. THIS is the runtime optionality gate
  (analog of pipeline.ts:201 reading `config.roles.improver.agent`).
- Tests: existing triple-building fixtures (config-validate.test.ts, self-improvement.test.ts:30/
  49-53) must remain valid UNCHANGED (proves backward-compat). NEW tests mirror the improver
  ones (config-validate.test.ts:93-105, self-improvement.test.ts:171-186): config WITH validator
  (valid), validator → unknown agent (rejected), non-string validator.prompt (rejected).
- Config examples (docs, not load-bearing): README:178-184, examples/skillsmith.config.ts:84-101,
  testing-project/skillsmith.config.ts:31-37 currently omit validator (fine — optional); docs
  phase may add an example with `roles.validator` + `selfImprovement.maxValidationRounds`.

### Q5 — False-positive bound + verifiable acceptance criteria (ANSWERED)

**False-positive guard (two-prong AND):** flag content ONLY when BOTH hold — (i) SCENARIO-
SPECIFIC: fingerprints a single scenario (name, breadth==1 literal, or verbatim span from one
scenario's acceptance/a rubric bullet); AND (ii) NOT-NECESSARY-TO-TEACH: a generic substitute
value/example would teach the same principle equally well. If EITHER prong fails → APPROVE.
Worked:
- generic list values (`One/Two/Three`, `foo/bar`) in a data-wp-each example → prong (i) fails →
  APPROVE; `Apple/Banana/Cherry/Mango` → both prongs hold → FLAG.
- "explains aria-expanded toggling" → prong (i) FAILS (aria-expanded recurs across
  toggle-visibility + focus-trap-menu + rubric; breadth>1 = domain) → APPROVE. **This is the
  critical false-positive to avoid — the skill MUST teach aria-expanded.**
- a `toggle` example using `isOpen` → prong (i) FAILS (`isOpen` is the skill's own idiom,
  SKILL.md:57,69; generic boolean name) → APPROVE.

**Precision bias (MUST be stated explicitly in the spec): favor FALSE-NEGATIVES over
FALSE-POSITIVES.** A false POSITIVE actively harms — blocks a legit fix, burns revise rounds,
and pressures the improver to WATER DOWN good guidance to appease the gate (the worst outcome).
A false NEGATIVE just slips a blatant leak to the working tree where human PR review (the
authoritative gate) still catches it. Spec language to use: *"The validator MUST NOT flag
general guidance or examples that use non-scenario values. When uncertain, it approves. A value
appearing in zero scenarios, or in ≥2 scenarios (domain vocabulary), MUST pass clean."* The
"0-or-≥2-scenarios = not a fingerprint" breadth test is the operational, testable form of the
bias.

**Concrete fixture PAIR:** POSITIVE (must-flag) = the live overfit SKILL.md as-is (Apple/Banana/
Cherry, iapi-ready, `(no post loaded yet)`, pg — verified Q1). NEGATIVE (must-approve) = the
de-fingerprinted version (Apple/Banana/Cherry → One/Two/Three; `(no post loaded yet)` →
`(loading…)`; iapi-ready → ready) — same pedagogy, scenario tokens swapped for generic. NOTE:
the live-skill pair is for a REAL-MODEL smoke/design reference, NOT the deterministic suite; the
unit/e2e suite uses mock + sentinels (below).

**Verifiable acceptance criteria — all mock-driven, no real model in the suite:**
- `validator-verdict.test.ts` (new, mirrors `verdict.test.ts` pure-fn table): valid approve/
  revise parse; fenced JSON parse; `revise` with no findings → malformed→approve; invalid
  `verdict` value → invalid; non-JSON → undefined → fail-open. Smallest, highest-value unit; no
  mock needed.
- `leakage-scan.test.ts` (new, CONDITIONAL on pre-scan being specced): `Apple` with Apple∈1
  scenario → flagged; `data-wp-on--click` ∈10 scenarios → flags NOTHING (false-positive guard,
  prong i); generic `One/Two/Three` → nothing. This unit pins the breadth rule.
- `fixtures/validator-loop-project/` (new, mirrors `loop-project/`): config adds
  `roles.validator: "checker"` + `selfImprovement.maxValidationRounds: 2`; a THIRD sentinel
  LEAK_TOKEN (orthogonal to the existing MOCK_GATE + MARKER).
- `validator-loop.test.ts` (new, mirrors `self-improvement-loop.test.ts`): mock improver's first
  pass writes MARKER (passes judge) + LEAK_TOKEN; on revise re-invocation it removes LEAK_TOKEN;
  mock validator returns `revise` while LEAK_TOKEN present, else `approve`. Asserts: (a) validator
  ran (validation transcript exists — analog of the `improvement.md` exists-assert at :81-85);
  (b) ≥1 revise occurred; (c) final skill leak-free (`!includes("LEAK_TOKEN")` — inverted
  MARKER assert at :51-53); (d) backward-compat: the EXISTING `self-improvement-loop.test.ts`
  (no validator) stays UNTOUCHED and passing = strongest backward-compat proof.
- CAP test (variant where validator NEVER approves): asserts inner loop terminates at
  `maxValidationRounds` (doesn't hang; exactly N validation transcripts / N+1 improver
  invocations), LAST edit KEPT on disk (not reverted), a stable WARNING log line recorded
  ("validation cap reached without approval"), and the run still PROCEEDS (exit code, no hang).
- `mock.ts` (edit): the `"validator agent"` systemPrompt branch + LEAK_TOKEN logic.
- `config-validate.test.ts` + `self-improvement.test.ts` (edit): add validator-role validation
  cases; existing triple-only cases stay green = backward-compat proof.

## 4. Requirements (FINAL)

Functional:
- R1. Add an OPTIONAL `validator` agent to the self-improvement loop: a read-only reviewer of
  the improver's edit that returns `approve` or `revise`-with-findings, looping until approval
  or a round cap. The improver stays the ONLY writer.
- R2. The validator's mandate is EDIT QUALITY (generality / anti-leakage), NOT scenario
  correctness. It detects blatant train/test leakage: (a) a scenario name/dir-name in the skill,
  (b) a scenario-unique literal value, (c) verbatim acceptance/rubric wording copied into the
  skill, (d) single-case answers shaped to one scenario. Correctness stays with the scenario
  judge on the next sweep.
- R3. Leakage-vs-domain discriminator + FALSE-POSITIVE GUARD (two-prong AND): flag ONLY when
  content is BOTH (i) scenario-SPECIFIC (fingerprints one scenario — a name, a literal appearing
  in exactly one active scenario and absent from the rubric/shared domain surface, or a verbatim
  span from one scenario's acceptance/a rubric bullet) AND (ii) NOT-NECESSARY-TO-TEACH (a generic
  substitute would convey the principle equally). If EITHER prong fails → APPROVE. The API
  surface that recurs across scenarios (breadth ≥2) or appears in zero scenarios MUST pass clean
  — never flag what the skill exists to teach (e.g. `aria-expanded`, `data-wp-bind`, `isOpen`).
- R3a. PRECISION BIAS (explicit requirement): favor false-negatives over false-positives. When
  uncertain whether content is leakage or legitimate teaching, the validator APPROVES. Rationale:
  a false positive degrades the skill (blocks a fix, burns rounds, pressures the improver to
  water down good guidance); a false negative is caught by human PR review.
- R4. The validator sees: the post-edit skill (whole), the active scenario corpus (name +
  description + prompt + acceptance), and the rubric text(s). It does NOT see the judge reviews
  (graded results) or the testing agents' produced files. Optionally the before/after diff.
- R5. Edit-capture is IN-PROCESS / EPHEMERAL / NOT git: capture before via the existing
  pre-edit skill read (skillsBlob / loadSkill) and after via a re-read, over the WHOLE skills
  root (not just failing-skill subset). No persisted `*.diff` artifact; the validator's PROSE
  verdict/feedback may be persisted as an evidence transcript (like `improvement.md`).
- R6. Approve/revise mechanics: on revise, the improver re-edits IN PLACE per the validator's
  findings (+ the same original report/skillsBlob context); the validator re-reviews the new
  on-disk state; "accepted" = validator approved current on-disk state. No staging, no
  revert-between-rounds.
- R7. Round cap: new `selfImprovement.maxValidationRounds` (integer ≥ 1, clamped, precedence CLI
  > config > default, default 2). On cap-without-approval: KEEP the last edit on disk + record a
  prominent warning in the evidence trail / run summary; do NOT revert. (Mirrors outer-cap
  behavior.)
- R8. FAIL-OPEN: validator provider error or unparseable/malformed verdict → treat as approve,
  log, exit the inner loop; only a parseable `revise` with non-empty findings triggers a revise
  round. The log distinguishes "approved" from "failed→treated-as-approve."
- R9. Verdict format: machine-readable `{ verdict: "approve"|"revise", findings: [{ leak_type,
  span, why, suggested_fix }] }`; findings required & non-empty on revise. Parse via a
  fenced/bare-tolerant helper + a validator-shape check.

Non-functional / constraints:
- C1. The scenario judge stays skill-blind; the fix lives in the new validator, not the judge.
- C2. No held-out-scenario gate; the mechanism works for small, project-supplied corpora.
- C3. The validator must NOT depend on git (a deliberate decoupling the repo already made).
- C4. Backward compatible: with no `roles.validator` configured, the loop behaves EXACTLY as
  today (zero behavior change). Existing configs/fixtures/tests stay valid unchanged.
- C5. The validator is read-only (reuses `role:"judge"` tool surface); the improver remains the
  sole writer. No new provider `Role` value.
- C6. Honest scope: catches legible/blatant leakage, not subtle/paraphrased/semantic
  overfitting; advisory within the loop, authoritative at human PR review.

## 5. Acceptance criteria (FINAL)

- AC1. Config validation (`config-validate.test.ts` / `self-improvement.test.ts`): a config with
  `roles.validator` (string or `{agent,prompt}`) validates; `roles.validator` → unknown agent is
  rejected; non-string `validator.prompt` is rejected; a config WITHOUT validator still validates
  AND the existing roles-triple tests pass UNCHANGED.
- AC2. Verdict parse/shape (`validator-verdict.test.ts`, mirrors `verdict.test.ts`): well-formed
  `approve` and `revise`-with-findings parse; fenced JSON parses; `revise` with empty/absent
  findings → malformed → fail-open approve; invalid `verdict` value → invalid; non-JSON →
  undefined → fail-open approve.
- AC3. Convergence E2E (`validator-loop.test.ts` + `fixtures/validator-loop-project/`, mirrors
  `self-improvement-loop.test.ts`): improver's first pass writes MARKER + LEAK_TOKEN → validator
  returns revise (findings name LEAK_TOKEN) → improver removes LEAK_TOKEN → validator approves →
  loop converges; assert (a) validator ran (validation transcript exists), (b) ≥1 revise
  occurred, (c) final on-disk skill is leak-free (`!includes("LEAK_TOKEN")`).
- AC4. Backward-compat E2E: the EXISTING `self-improvement-loop.test.ts` (no validator role)
  stays UNTOUCHED and passing — the no-validator path is byte-identical to today.
- AC5. Cap behavior (validator-never-approves variant): inner loop terminates at
  `maxValidationRounds` (no hang — exactly N validation transcripts / N+1 improver invocations),
  the LAST edit is KEPT on disk (not reverted), a stable WARNING log line is recorded, and the
  run still proceeds to an exit code.
- AC6. False-positive guard: a GENERAL, non-leaked edit (generic example values — the
  de-fingerprinted skill) is APPROVED; domain vocabulary (breadth ≥2, e.g. `data-wp-on--click`)
  is never flagged. Pinned by `leakage-scan.test.ts` (if pre-scan specced) and/or the
  must-approve negative fixture.
- AC7 (fail-open behavior, from R8): a validator provider error or unparseable verdict does NOT
  block the improver or stall the loop — it exits the inner loop as approve, with the
  evidence trail distinguishing "approved" from "failed→treated-as-approve."

## 6. Out of scope (FINAL)

- Subtle / semantic / paraphrased overfitting — reworded acceptance items, single-case answers
  with no copied token beyond what an LLM can catch imperfectly. (Detection difficulty rises
  with abstraction; intent scopes this out.)
- A hard guarantee of generalization or zero-leakage-on-disk. The validator is a floor-raiser,
  not a proof; human PR review is the merge gate.
- Reverting the improver's edits (no revert-on-cap, no staging) — unless the owner elects the
  stronger revert-gate (D2, flagged).
- Moving any leakage check into the scenario judge (judge stays skill-blind).
- A held-out / train-test split mechanism.
- Catching leakage the improver smuggles OUTSIDE the skills root (improver is cwd-jailed to
  skills; out of scope by construction).
