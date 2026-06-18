# Spec — Stop the self-improvement loop from overfitting skills to eval scenarios (#48)

## Overview

Skillsmith runs a self-improvement loop: when a scenario sweep is graded and a skill is
still failing, an **improver** agent edits the skill's `SKILL.md` files in place to make the
failing scenarios pass. The improver is the only writer; it is handed the full iteration
report (including each judge's verbatim review, which is tied to the scenarios' acceptance and
rubric wording) plus the full text of every skill referenced by a failing scenario. Nothing
currently scores or gates the edit, and the scenario judge is deliberately skill-blind.

The result is a train/test leakage problem: the improver memorizes the specific evaluation
scenarios into the skill instead of writing general guidance. This is observable in the repo
today — the live skill has scenario-specific literals baked into ostensibly "general" prose
(e.g. `Apple`/`Banana`/`Cherry`/`Mango` from the fruit-list scenario, the verbatim acceptance
fragment `(no post loaded yet)`, `iapi-ready`, the pagination param `pg`).

**This spec adds an optional, read-only `validator` agent to the self-improvement loop.** After
the improver edits, the validator reviews the resulting skill for **edit quality** —
specifically, blatant train/test leakage — and returns either `approve` or
`revise`-with-findings. On `revise`, the improver edits again in place to address the findings;
the validator re-reviews; this inner loop repeats until the validator approves or a configurable
round cap is reached. The improver remains the sole writer.

**Honest scope (load-bearing framing).** The validator catches only *legible / blatant*
overfitting — naming a scenario, copying a scenario-unique literal value, copying acceptance or
rubric wording verbatim, or an obvious single-case answer. It does **not** catch subtle,
paraphrased, or semantic overfitting. It is a cheap floor-raiser, not a guarantee of
generalization. Within the automated loop the gate is **advisory**; the authoritative merge gate
remains **human PR review**. This honesty caveat is deliberate and correct — detection difficulty
rises with abstraction, and an over-aggressive critic would do active harm (see R3a).

The validator is **optional**: with no `roles.validator` configured, the self-improvement loop
behaves exactly as it does today, with zero behavior change. All acceptance criteria are
mock-driven and deterministic — no real model runs in the test suite.

### Key terms

- **Improver** — the existing sole-writer agent (`src/improvement/improver.ts`,
  `runImprovement`), cwd-jailed to the skills root, edits `SKILL.md` files in place.
- **Scenario judge** — the existing per-scenario grader. It is *skill-blind*: it never sees the
  skill text, only the rubrics, the inline acceptance items, and the files the testing agent
  produced. This must not change.
- **Validator** — the new optional read-only agent this spec introduces.
- **Corpus** — the set of active scenarios the consuming project supplies (each
  scenario's name + description + prompt + acceptance) plus the rubric text(s). It is the
  enumerated `*/scenario.yaml` set; a `_candidates.yaml` is never enumerated and is therefore
  excluded by construction.
- **Leakage** — the edit references something that identifies a *specific* scenario (its name,
  its scenario-unique value, or its verbatim wording).
- **Domain** — the API surface that recurs across many scenarios and is what the skill exists to
  teach (e.g. `data-wp-on--click`, `data-wp-text`, `aria-expanded`). Never leakage.

## Requirements

### Functional

**R1 — Optional validator in the self-improvement loop.**
Add an OPTIONAL `validator` agent to the self-improvement loop: a read-only reviewer of the
improver's edit that returns `approve` or `revise`-with-findings, looping until approval or a
round cap. The improver stays the ONLY writer. The validator needs no write capability.

**R2 — Mandate is edit quality, not correctness.**
The validator judges EDIT QUALITY (generality / anti-leakage), NOT scenario correctness. It
detects blatant train/test leakage in these four forms:
- (a) a scenario name or directory name in the skill (note: a scenario's directory name and its
  `scenario.name` can differ — e.g. dir `counter` → name `counter-block` — both forms count);
- (b) a scenario-unique literal value (quoted string, number, identifier, URL) hard-coded into
  the skill;
- (c) verbatim acceptance or rubric wording copied into the skill prose;
- (d) a single-case answer — guidance structurally shaped "for THIS task do X" rather than "in
  general do X".

Correctness ("does the scenario pass?") stays with the scenario judge on the next sweep. The
validator does not assess correctness.

**R3 — Leakage-vs-domain discriminator + false-positive guard (two-prong AND).**
The bright line is **specificity to a single scenario**. Flag content ONLY when BOTH prongs hold:
- (i) **Scenario-specific** — the content fingerprints exactly one scenario: its name/dir-name,
  a literal appearing in exactly one active scenario and absent from the rubric / shared domain
  surface, or a verbatim span from one scenario's acceptance or a rubric bullet; AND
- (ii) **Not necessary to teach** — a generic substitute value or example would convey the same
  principle equally well.

If EITHER prong fails → APPROVE. The API surface that recurs across scenarios (breadth ≥ 2) or
appears in zero scenarios MUST pass clean — never flag what the skill exists to teach
(e.g. `aria-expanded`, `data-wp-bind`, `isOpen`). The crisp meta-rule:

> Leakage = the edit references something that identifies a SPECIFIC scenario (its name, its
> unique value, or its verbatim wording). Domain = the edit references the API surface that
> recurs across scenarios and is what the skill exists to teach. Specificity-to-one-scenario is
> the bright line.

Do NOT anchor on "appears in the rubric" — the rubric and skill SHOULD share vocabulary;
anchoring there would flag the subject matter. Anchor on scenario-corpus uniqueness +
specificity. Leakage is not "the skill uses a concrete value" — an illustrative example
legitimately needs *some* concrete value. Leakage is "the skill uses THE SCENARIO'S value"; the
rule is "use a value that ISN'T one of the eval scenarios' values."

**R3a — Precision bias: favor false-negatives over false-positives (explicit requirement).**
When uncertain whether content is leakage or legitimate teaching, the validator APPROVES.
Rationale: a false POSITIVE actively harms — it blocks a legitimate fix, burns revise rounds,
and pressures the improver to WATER DOWN good guidance to appease the gate (the worst outcome).
A false NEGATIVE merely slips a blatant leak to the working tree, where human PR review (the
authoritative gate) still catches it. The operational, testable form of this bias: a value
appearing in zero scenarios, or in ≥ 2 scenarios (domain vocabulary), MUST pass clean.

**R4 — What the validator sees.**
The validator sees:
- the post-edit skill (whole skill, not just the round's delta — leakage is a property of the
  resulting skill *state*; the live skill can carry accumulated leakage from prior iterations
  that a delta-only review would wave through);
- the active scenario corpus (each scenario's name + description + prompt + acceptance);
- the rubric text(s).

It does NOT see the judge reviews (graded pass/notes results) or the testing agents' produced
files. Optionally it may see the before/after diff (a recommended enhancement that sharpens
single-case-answer detection and lets revise feedback reference "the line you added"; not
load-bearing). Showing the validator the corpus is not a new leak: the leak #48 cares about is
corpus → persisted skill (ships to users), not corpus → ephemeral reviewer (discarded after the
decision). The validator's transcript MUST NOT be written into the skill.

**R5 — Edit-capture is in-process / ephemeral / NOT git.**
Capture the "before" via the existing pre-edit skill read (the same `loadSkill` /
`skillsBlob`-style read the loop already performs before invoking the improver) and the "after"
via a re-read, covering the WHOLE skills root (walk `paths.skills`), not just the failing-skill
subset — because the improver's write scope is the whole skills root and it can edit unreferenced
skills or create new files. The capture is in-process and ephemeral. There MUST be no persisted
`*.diff` artifact and no dependency on git. The validator's PROSE verdict / feedback MAY be
persisted as an evidence transcript (analogous to the improver's `improvement.md`).

**R6 — Approve/revise mechanics (no staging, no revert-between-rounds).**
On `revise`, the improver re-edits IN PLACE per the validator's findings, given the same original
iteration report and skill context the first round had, plus the validator's findings. The
validator then re-reviews the new on-disk state. "Accepted" = the validator approved the CURRENT
on-disk state. There is no staging and no revert between rounds; leaked text persists on disk only
until the improver itself edits it out. This mirrors how a human iterates on a file toward review
comments.

**R7 — Round cap config + cap-without-approval behavior (advisory gate).**
Add a new config field `selfImprovement.maxValidationRounds`: an integer ≥ 1, clamped, with
precedence CLI override > config > default, default **2** (the improver's first pass plus up to 2
revise rounds). It has the same shape and precedence as the existing `maxIterations`. Do NOT
overload `0` as "disabled" — keep the clamp ≥ 1; the validator's on/off is governed solely by the
presence/absence of `roles.validator` (R1, C4). The cap means "how many revise rounds when the
validator IS active."

**On reaching the cap WITHOUT validator approval: KEEP the last edit on disk AND record a
prominent warning** in the evidence trail / run summary. Do NOT revert. This is an explicit
decision (see *Decisions / Assumptions* below): the inner loop mirrors the existing outer-loop
behavior (give up after N rounds, keep the artifact, report), and reverting would contradict the
documented "edits live in the working tree for human review" contract. The gate is therefore
advisory within the loop; the warning makes any residual leakage legible at the human PR
boundary.

**R8 — Fail-open.**
A validator provider error or an unparseable / malformed verdict → treat as APPROVE, log, and
exit the inner loop. Concrete rules:
- provider error → log, treat as approve, exit inner loop;
- verdict won't parse → log "validator verdict unparseable", treat as approve, exit (do NOT spend
  a revise round on garbage);
- `verdict == "revise"` but findings empty/absent → malformed → fail-open to approve;
- ONLY a parseable `verdict == "revise"` with non-empty findings triggers a revise round.

The evidence trail MUST distinguish "validator said approve" from "validator failed → treated as
approve," so a chronically-broken validator is visible to a human reviewer even though both exit
identically. Rationale: a broken validator must never become a ceiling-lowerer — it must leave the
system no worse than the pre-validator baseline.

**R9 — Verdict format.**
The validator emits a machine-readable verdict:

```json
{
  "verdict": "approve" | "revise",
  "findings": [
    {
      "leak_type": "scenario-name" | "scenario-value" | "verbatim-copy" | "single-case",
      "span": "<the actual offending substring>",
      "why": "<1 line>",
      "suggested_fix": "<how to generalize>"
    }
  ]
}
```

`findings` is REQUIRED and non-empty when `verdict == "revise"`; absent/empty on `approve`.
`leak_type` is enumerated to the four forms in R2 (a–d) so the reason is typed for the improver
and assertable in tests. `span` is the actual offending substring so the improver can locate it
and a test can assert the finding names it. Parse the verdict via a fenced/bare-JSON-tolerant
helper plus a validator-specific shape check (`verdict ∈ {approve, revise}`, findings-when-revise).

### Non-functional / constraints

**C1 — Judge stays skill-blind.** The scenario judge must remain skill-blind; the leakage fix
lives in the new validator, not the judge.

**C2 — No held-out gate.** No held-out-scenario / train-test-split mechanism. Scenarios are
supplied by the consuming project and the set can be small, so the mechanism must work for small
corpora. (The breadth test — "is this string a fingerprint of exactly one scenario I can see?" —
is what makes small-corpus operation work without a holdout split.)

**C3 — No git dependency.** The validator must NOT depend on git. Git was deliberately designed
out of the improver; reintroducing it would reverse a decoupling the repo already made.

**C4 — Backward compatible (forced).** With no `roles.validator` configured, the loop behaves
EXACTLY as today — zero behavior change. Existing configs, fixtures, and tests stay valid and
unchanged. The presence/absence of `roles.validator` is the runtime on/off gate.

**C5 — Validator is read-only; improver is sole writer; no new provider `Role`.** The validator
runs with the existing read-only judge tool surface (`role: "judge"`), identified by its own
system prompt — Role is a tool-permission tier, not an identity. Do NOT add a new provider `Role`
value. The improver remains the only writer.

**C6 — Honest scope.** Catches legible/blatant leakage, not subtle/paraphrased/semantic
overfitting. Advisory within the loop; authoritative at human PR review.

## Out of Scope

- **Subtle / semantic / paraphrased overfitting** — reworded acceptance items, single-case
  answers carrying no copied token beyond what an LLM can catch imperfectly. Detection difficulty
  rises with abstraction; the intent scopes this out.
- **A hard guarantee of generalization or zero-leakage-on-disk.** The validator is a
  floor-raiser, not a proof; human PR review is the merge gate.
- **Reverting the improver's edits** — no revert-on-cap, no staging, no rollback. (See Decisions
  D2: a harder revert-gate is a non-goal unless the owner explicitly elects it.)
- **Moving any leakage check into the scenario judge** — the judge stays skill-blind.
- **A held-out / train-test split mechanism.**
- **Catching leakage smuggled OUTSIDE the skills root** — the improver is cwd-jailed to the
  skills root, so this is out of scope by construction.
- **A required deterministic pre-scan.** The LLM validator is required (see Decisions D5); a
  deterministic pre-scan (exact scenario-name / scenario-unique-literal / verbatim-n-gram
  matching) is a recommended-but-OPTIONAL accelerator left to the design phase, not a requirement.

## Decisions / Assumptions

Two decisions are owner-level and stated here explicitly so they are visible to the owner and
reviewer rather than buried in requirements.

**D2 — Cap-without-approval is an ADVISORY gate (keep + warn), not a revert-gate.**
On reaching `maxValidationRounds` without the validator approving, the loop KEEPS the last edit on
disk and emits a prominent warning; it does NOT revert (R7). This is faithful to the intent's
"cheap floor-raiser, not a guarantee," to the existing outer-cap precedent (keep the artifact,
report failure, no revert), and to the documented contract that edits live in the working tree for
human review. **Honest caveat:** this DOES let leakage reach the working tree on cap; that is
acceptable because human PR review is the authoritative merge gate and the warning makes the
leakage legible. A harder guarantee (revert-on-cap, staging) is **stronger than intent** and is an
explicit **non-goal** unless the owner later elects it.

**D5 — The LLM validator is REQUIRED; a deterministic pre-scan is OPTIONAL.**
The spec requires the LLM validator agent, because it can in principle catch all four leakage
forms a–d (given the corpus), whereas a deterministic scan can never catch form (d), the
single-case answer. A deterministic pre-scan over forms a–c (scenario-name match, scenario-unique
literal match, verbatim n-gram/span match) is a recommended-but-OPTIONAL accelerator left to the
design phase; the spec requires the *behavior* (reliably catch forms a–c, attempt d), not the
pre-scan mechanism. The owner MAY mandate the pre-scan if a deterministic floor is wanted, but it
is not required.

**Other settled assumptions (carried forward, no owner action needed):**
- The validator role is OPTIONAL; absent → loop behaves exactly as today (forced by
  backward-compat, C4).
- `selfImprovement.maxValidationRounds` is an integer ≥ 1, clamped, default 2, same shape as
  `maxIterations` (R7).
- The validator runs read-only with `role: "judge"`, identified by its system prompt — no new
  provider `Role` value (C5).
- Edit-capture is in-process / ephemeral / no-git, over the whole skills root (R5).
- The validator sees {post-edit whole skill, corpus, rubrics}, NOT the judge reviews (R4).

## Acceptance Criteria

All criteria are mock-driven and deterministic — no real model runs in the test suite. (A
real-model smoke check against the live overfit skill and its de-fingerprinted twin is a design
reference, not part of this suite.)

**AC1 — Config validation.** A config with `roles.validator` (string shorthand or `{agent,
prompt}`) validates; `roles.validator` pointing at an unknown agent is rejected; a non-string
`validator.prompt` is rejected; a config WITHOUT `validator` still validates, AND the existing
roles-triple validation tests pass UNCHANGED.

**AC2 — Verdict parse/shape (pure-function table).** A well-formed `approve` parses; a well-formed
`revise`-with-findings parses; fenced JSON parses; `revise` with empty/absent findings →
malformed → fail-open approve; an invalid `verdict` value → invalid; non-JSON → undefined →
fail-open approve.

**AC3 — Convergence E2E.** With a validator-loop fixture (default `maxValidationRounds = 2`): the
mock improver's first pass writes a passing MARKER plus a LEAK_TOKEN → the mock validator returns
`revise` (findings name LEAK_TOKEN) → the improver removes LEAK_TOKEN → the validator returns
`approve` → the loop converges. Traced against the same R6/R7 loop as AC5, this happy path yields
**2 improver invocations** (first pass + 1 revise round) and **2 validation transcripts** (the
round-1 `revise` and the round-2 `approve`). Assert (a) the validator ran (a validation transcript
exists), (b) exactly one revise round occurred, (c) the final on-disk skill is leak-free (does not
include LEAK_TOKEN). These counts share the loop shape and cap semantics AC5 pins, so the two E2E
criteria encode one loop.

**AC4 — Backward-compat E2E.** The EXISTING self-improvement-loop test (no validator role) stays
UNTOUCHED and passing — the no-validator path is byte-identical to today. This is the strongest
backward-compat proof.

**AC5 — Cap behavior (validator-never-approves variant).** With a mock validator that never
approves and `maxValidationRounds = N` (the loop in R6/R7: validate every on-disk edit, including
the last; the terminal validation is what detects the cap and breaks): the inner loop terminates
at the cap (no hang — exactly **N+1 improver invocations** and **N+1 validation transcripts**).
For the default N=2 that is 3 improver invocations (the first pass plus 2 revise rounds) and 3
validation transcripts (each edit, including the final un-revised one, is reviewed — its findings
feed the warning). The LAST edit is KEPT on disk (not reverted), a stable WARNING log line is
recorded (e.g. "validation cap reached without approval"), and the run still proceeds to an exit
code. This pins the SAME loop shape as AC3's happy path; the two E2E criteria do not encode two
different loops.

**AC6 — False-positive guard.** A general, non-leaked edit (generic example values — the
de-fingerprinted skill) is APPROVED, and domain vocabulary (breadth ≥ 2, e.g.
`data-wp-on--click`) is never flagged. Pinned by a leakage-scan unit test (if a pre-scan is
specced in design) and/or the must-approve negative fixture. Honest scope of the deterministic
portion: with a *mock* validator, the must-approve fixture verifies the loop accepts an `approve`
verdict (converges without a revise round) — it does NOT exercise a model's breadth-rule judgment.
The breadth-rule judgment itself (a real model declining to flag domain vocabulary) is covered by
the design-reference real-model check, not this suite. If design elects the optional pre-scan, its
`leakage-scan.test.ts` unit pins the breadth rule deterministically; absent that, AC6's
unconditional, deterministic claim is the loop-approves-on-approve behavior.

**AC7 — Fail-open behavior.** A validator provider error or an unparseable verdict does NOT block
the improver or stall the loop — it exits the inner loop as approve, with the evidence trail
distinguishing "approved" from "failed → treated-as-approve."
