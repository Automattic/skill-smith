# Design doc — Stop the self-improvement loop from overfitting skills to eval scenarios (#48)

This is a standalone implementation design. A code-plan-writer and code-writers should be able to
build from this without opening the spec or the design research. Every file/line reference was
verified against the worktree at the start of the design phase. The contract this design satisfies
is the approved spec (R1–R9, C1–C6, AC1–AC7, owner decisions D2 and D5); the requirement IDs are
cited inline so reviewers can trace each design choice to its source.

---

## 1. Problem and approach

Skillsmith runs a self-improvement loop. When a scenario sweep is graded and a skill is still
failing, an **improver** agent (`src/improvement/improver.ts`, `runImprovement`) edits the skill's
`SKILL.md` files in place to make the failing scenarios pass. The improver is the only writer, it is
cwd-jailed to the skills root, and nothing currently scores or gates its edit. The scenario judge is
deliberately *skill-blind* (it never sees skill text). The result is train/test leakage: the
improver memorizes the specific evaluation scenarios into the skill — scenario names, scenario-unique
literal values, verbatim acceptance/rubric wording — instead of writing general guidance.

This design adds an **optional, read-only `validator` agent** to the self-improvement loop. After the
improver edits, the validator reviews the resulting skill for **edit quality** — specifically,
blatant train/test leakage — and returns either `approve` or `revise`-with-findings. On `revise`, the
improver edits again in place to address the findings; the validator re-reviews; this inner loop
repeats until the validator approves or a configurable round cap is reached. **The improver remains
the sole writer.**

**Honest scope (load-bearing framing, C6).** The validator catches only *legible / blatant*
overfitting — naming a scenario, copying a scenario-unique literal value, copying acceptance or rubric
wording verbatim, or an obvious single-case answer. It does **not** catch subtle, paraphrased, or
semantic overfitting. It is a cheap floor-raiser, not a guarantee of generalization. Within the
automated loop the gate is **advisory**; the authoritative merge gate remains **human PR review**.
This honesty caveat is deliberate: detection difficulty rises with abstraction, and an
over-aggressive critic would do active harm (see §6, R3a).

**The validator is optional (C4).** With no `roles.validator` configured, the self-improvement loop
behaves *exactly* as it does today, byte-identical, with zero behavior change. All acceptance criteria
are mock-driven and deterministic — no real model runs in the test suite.

### Key terms

- **Improver** — the existing sole-writer agent (`runImprovement`), cwd-jailed to the skills root,
  edits `SKILL.md` files in place. Runs `role: "testing"`. Identity carried by its system prompt
  (`"You are the improver agent in the skillsmith self-improvement loop."`).
- **Scenario judge** — the existing per-scenario grader (`src/pipeline/judge-agent.ts`). It is
  *skill-blind*: it never sees the skill text, only the rubrics, the inline acceptance items, and the
  files the testing agent produced. Runs `role: "judge"`. **This must not change (C1).**
- **Validator** — the new optional read-only agent this design introduces. Runs `role: "judge"`
  (read-only tool surface), identified by its own system prompt — **not** a new provider `Role`.
- **Corpus** — the set of active scenarios the consuming project supplies (each scenario's
  `name + description + prompt + acceptance`) plus the rubric text(s). It is the enumerated
  `*/scenario.yaml` set; a `_candidates.yaml` is never enumerated and is therefore excluded by
  construction. **This is the FULL enumerated set, before any `--scenarios` filter** (see §4.3).
- **Leakage** — the edit references something that identifies a *specific* scenario (its name, its
  scenario-unique value, or its verbatim wording).
- **Domain** — the API surface that recurs across many scenarios and is what the skill exists to teach
  (e.g. `data-wp-on--click`, `data-wp-text`, `aria-expanded`). Never leakage.

---

## 2. Architecture overview

The inner validate/revise loop lives **INSIDE `runImprovement`** (`src/improvement/improver.ts`), with
the current single improver invoke extracted into a private helper `invokeImprover(...)`. The loop is
gated by exactly one `if (config.roles.validator === undefined)` branch. There is **no** separate
exported `runImproveValidateCycle`. (Rationale and rejected alternative in §10.)

This placement makes the no-validator byte-identity (C4/AC4) visually obvious — the property AC4
polices hardest — while keeping the validate/revise loop inside the one function that owns the
improver.

### 2.1 Control flow (settled)

```
runImprovement(params):
  // UNCHANGED prologue: build baseCtx, build context (buildImprovementContext),
  // fire beforeImprove ONCE.
  validatorRole = config.roles.validator          // undefined => today's path

  result = invokeImprover(ctx, findings=undefined) // ROUND 0 = first improver pass
                                                   //   (== today's single provider.invoke)

  if validatorRole === undefined:
    // ---- BYTE-IDENTICAL no-validator path (C4/AC4) ----
    // invokeImprover already wrote improvement.md and logged; nothing else.
  else:
    // ---- validator inner loop (R6/R7/R8) ----
    round = 0                                       // counts REVISE rounds TAKEN
    while true:
      after    = readSkillsRoot(skillsDir)          // post-edit WHOLE skills root (content)
      verdict  = runValidator({ after, corpus, rubrics, ... })   // read-only, role:"judge"
      // runValidator writes validation-round-{round}.md (the evidence transcript)
      if verdict.verdict !== "revise": break        // approve OR fail-open => break
      if round >= maxValidationRounds:              // CAP reached WITH pending findings
        log.info("WARNING: validation cap reached without approval")  // R7/D2: keep + warn, NO revert
        break
      round++
      result = invokeImprover(ctx, findings=verdict.findings)  // re-edit IN PLACE

  // fire afterImprove ONCE here, after the loop settles, in BOTH paths.
  return { improvementPath }   // improvementPath == iteration-N/improvement.md (round 0)
```

**The cap check sits AFTER each validation and BEFORE the next improver invoke.** This is the
load-bearing structural choice. `while (true)` with the cap check in this position guarantees the
**terminal validation** — the review of the last, un-revised edit — always runs, and its findings feed
the warning. This is exactly AC5's "each edit, including the final un-revised one, is reviewed." A
`while (round < cap)` header would validate N times instead of N+1 and skip the terminal review —
wrong for AC5.

### 2.2 Round-counter semantics and AC traces

- `round` = number of revise rounds TAKEN. Round 0 is always the first improver pass (== today's
  single invoke). `maxValidationRounds = N` means "up to N revise rounds when the validator is active."
- **AC3 (happy path, N=2):** improver#1 writes MARKER+LEAK_TOKEN → validate#1 = `revise` (findings
  name LEAK_TOKEN) → round becomes 1, improver#2 removes LEAK_TOKEN → validate#2 = `approve` → break.
  = **2 improver invokes, 2 validation transcripts**, exactly one revise round, final skill leak-free.
- **AC5 (cap, N=2, never-approve):** improver#1 → validate#1 = `revise` → round 1, improver#2 →
  validate#2 = `revise` → round 2, improver#3 → validate#3 = `revise` → `round(2) >= cap(2)` → WARN +
  break. = **3 improver invokes (N+1), 3 validation transcripts (N+1)**, last edit KEPT (not reverted).

The two E2E criteria (AC3, AC5) share one loop shape and one set of cap semantics — they do not encode
two different loops.

### 2.3 Hooks fire once

`beforeImprove` fires ONCE before round 0; `afterImprove` fires ONCE after the loop settles — in BOTH
paths. They do **not** fire per round. The hook type carries a single `improvementPath`
(`IterationCompleteHookContext` / `ImproveHookContext`); per-round firing would perturb the
no-validator path's observable hook behavior and has no spec basis. `afterImprove`'s `improvementPath`
stays the round-0 `improvement.md`.

### 2.4 What the validator never touches (advisory gate, C6/D2)

The validator's verdict flows ONLY into `validation-round-{K}.md` transcripts and `run.log` lines. It
**never** writes a `ScenarioReport` cell, never touches `report.json` (the merged scenario matrix),
never touches the pass/fail matrix, and never changes the exit code. The exit code remains
`allPass ? 0 : 1` derived from the merged scenario matrix, invisible to validator approve/revise. The
scenario that triggered improvement either still fails the next sweep (→ exit 1) or passes (→ exit 0);
the validator caps/warns but does not change exit semantics. This is what "advisory within the loop"
means concretely.

---

## 3. File inventory

### NEW files

| File | Responsibility |
|---|---|
| `src/improvement/validator.ts` | `runValidator(params): Promise<ValidatorOutcome>` — build prompt → invoke `role:"judge"` → parse → write `validation-round-K.md` → return outcome. Owns the **provider-error** fail-open path (entry point a). Holds `DEFAULT_VALIDATOR_PROMPT`. |
| `src/improvement/validator-verdict.ts` | `classifyValidatorVerdict(finalText: string): ValidatorOutcome` — parse + shape-check + fail-open mapping (the 5-row AC2 table). Owns the **parse/shape** fail-open path (entry point b). Pure function. |
| `src/improvement/read-skills-root.ts` | `readSkillsRoot(skillsRoot: string): string` — whole-root content read; follows md-links per skill; skips non-skill dirs. Materializes the validator's post-edit "after" state. |
| `src/util/parse-agent-json.ts` | `parseAgentJson(finalText: string): object \| undefined` — extracted verbatim from `parseJudgeJson`; shared by judge + validator. |
| `src/__tests__/fixtures/validator-loop-project/` | AC3 converge fixture (validator configured, converges in one revise round). |
| `src/__tests__/fixtures/validator-loop-cap-project/` | AC5 cap fixture (validator never approves). |
| `src/__tests__/validator-verdict.test.ts` | AC2 — pure-fn string table over `classifyValidatorVerdict`. |
| `src/__tests__/validator-loop.test.ts` | AC3 + AC5 — E2E loop over the two new fixtures. |
| (new cases) in `config-validate` / `self-improvement` test files | AC1 role-validation + `maxValidationRounds` resolve cases. |

### MODIFIED files

| File | Change |
|---|---|
| `src/improvement/improver.ts` | Extract the single improver invoke into a private `invokeImprover(...)`; add the inner validate/revise loop gated by `config.roles.validator`; add two new `RunImprovementParams` fields `corpus: EnumeratedScenario[]` and `maxValidationRounds: number`. |
| `src/pipeline/pipeline.ts` | Split the inline enumerate (`:85-88`) into `const enumerated = enumerateScenarios(...)` + `const allScenarios = filterScenarios(enumerated, ...)`; pass `corpus: enumerated` and `maxValidationRounds: selfImprovement.maxValidationRounds` into the `runImprovement(...)` call at `:193`. |
| `src/pipeline/judge-agent.ts` | Replace the private `parseJudgeJson` (`:141-153`) with an `import { parseAgentJson }` and delete the local copy. **Behavior-identical; this is the only change to this file.** |
| `src/config/types.ts` | `RolesInput` + `validator?: SingleRoleInput`; `NormalizedRoles` + `validator?: { agent: AgentDefinition; prompt?: string }`; `SelfImprovementConfig` + `maxValidationRounds?: number`. |
| `src/config/validate.ts` | `validateRoles` + optional `roles.validator` check (guarded by `!== undefined`); `validateSelfImprovement` + `maxValidationRounds` integer-≥1 check (guarded by `!== undefined`). |
| `src/config/normalize.ts` | Roles block + spread-when-present `validator` via `normalizeSingleRole`. |
| `src/config/self-improvement.ts` | `ResolvedSelfImprovement` + `maxValidationRounds: number`; `SelfImprovementOverrides` + `maxValidationRounds?: number`; `DEFAULTS` + `maxValidationRounds: 2`; `resolveSelfImprovement` clamp `Math.max(1, …)`. |
| `src/providers/mock.ts` | Add `invokeValidator` branch inside `invokeJudge`; add gated add-leak / remove-leak behavior in the improver branch of `invokeTesting` (behind `VALIDATOR_LOOP_FIXTURE`, so `loop-project` stays byte-identical). |
| `bin/skillsmith.mjs` | Add `--validation-rounds` flag mirroring `--iterations`. |

### UNCHANGED (load-bearing — do not touch)

- `src/providers/types.ts` `Role` union (`"testing" | "judge"`) — **C5: do not extend.**
- `src/pipeline/judge-agent.ts`'s skill-blindness and prompt-building (C1) — only the `parseJudgeJson`
  → `parseAgentJson` import swap is allowed.
- `src/__tests__/self-improvement-loop.test.ts` (AC4) — must stay byte-identical, untouched.
- All existing config files, fixtures, and tests — must stay valid and unchanged (C4/AC4).

---

## 4. Data flow and exact validator inputs

### 4.1 One outer failing iteration, validator configured

```
pipeline.ts
  enumerated   = enumerateScenarios(config.paths, projectRoot)     // FULL corpus
  allScenarios = filterScenarios(enumerated, params.scenarios)     // run subset (improver path)
  → runImprovement({ ..., allScenarios, corpus: enumerated, maxValidationRounds })

runImprovement
  → invokeImprover(ctx, findings=undefined)   // round 0, role:"testing", writes improvement.md
  → loop:
       after   = readSkillsRoot(skillsDir)                         // post-edit WHOLE skills root
       outcome = runValidator({ after (as skillsBlob), corpus, rubrics, ... })
                   // role:"judge"; NO judge reviews, NO iterationReport
                 → classifyValidatorVerdict(finalText)             // (on successful invoke)
                 → write validation-round-{round}.md
       approve / fail-open → break
       cap reached         → log WARNING + break
       revise              → invokeImprover(ctx, findings)         // re-edit in place
  → afterImprove (once)
  → return { improvementPath }   // == improvement.md (round 0)
```

### 4.2 Exactly what the validator sees (R4) and what is structurally excluded

The validator's input is built **ONLY** from three sources:

1. **The post-edit whole skills root** — `readSkillsRoot(skillsDir)` returns the concatenated content
   of every skill under the skills root (whole skill, not just the round's delta). Leakage is a
   property of the resulting skill *state*; the live skill can carry accumulated leakage from prior
   iterations that a delta-only review would wave through. See §5 for the reader.
2. **The FULL enumerated scenario corpus** — each scenario's `{name, description, prompt, acceptance}`,
   threaded as a new `corpus` field **separate from** the improver's filtered `allScenarios` (see §4.3
   for why FULL, and the precision argument).
3. **The rubric bodies** — the union of rubric ids referenced across the corpus, deduped, each read as
   `paths.rubrics/<id>.md`.

The validator does **NOT** see:

- The **judge reviews** (graded pass/notes results). This is the "answer key" exclusion — see §4.4.
- The **`iterationReport`** or `buildImprovementContext`'s `context.report` (which preserve every
  judge's verbatim `review`).
- The **`context.skillsBlob`** (it is scoped to failing-scenario ids only — not a valid whole-root
  read).
- The **testing agents' produced files** (they live in per-agent workspaces and are never read by the
  validator).

Optionally the validator MAY see the before/after diff — a recommended enhancement that sharpens
single-case-answer detection and lets revise feedback reference "the line you added." It is **not
load-bearing and is skipped in v1** (see §5.2). Showing the validator the corpus is not a new leak:
the leak #48 cares about is `corpus → persisted skill` (ships to users), not `corpus → ephemeral
reviewer` (discarded after the decision). **The validator's transcript MUST NOT be written into the
skill.**

### 4.3 Corpus is the FULL enumerated set (R3/R3a/C2 — spec-constrained, not latitude)

The validator's corpus is the **FULL enumerated scenario set** (`enumerateScenarios(config.paths,
projectRoot)`, BEFORE the `--scenarios` filter), independent of which scenarios this run is evaluating.

**The problem.** Today, `allScenarios` threaded into `runImprovement` is
`filterScenarios(enumerateScenarios(...), params.scenarios)` — the `--scenarios`-FILTERED set
(`pipeline.ts:85-88`). R3's breadth test ("a literal appearing in EXACTLY ONE active scenario") is only
sound against the whole corpus. On a `--scenarios`-narrowed run (e.g. one scenario), every literal
looks unique-to-one → fabricated FALSE POSITIVES — exactly the harm R3a forbids. The unfiltered set is
not retained anywhere today (the `enumerateScenarios(...)` result is an inline arg to `filterScenarios`,
consumed and discarded).

**Monotonicity proof the full set is strictly safer (the key result).** A literal's breadth count (how
many scenarios contain it) is monotonic in corpus size — adding scenarios can only INCREASE a count,
never decrease it. R3 flags only breadth==1 literals (prong i). A literal that is breadth==1 in the
full set is breadth==1 in any subset containing it, so the full set never INTRODUCES a flag the
filtered set wouldn't. Conversely, a literal that is breadth≥2 in the full set can appear breadth==1 in
a filtered subset (the other scenarios were filtered out) → the filtered set FABRICATES false positives
the full set wouldn't. Therefore `false-positive-count(full) ≤ false-positive-count(filtered)`, always.
There is no case where the filtered set yields fewer false positives. The full corpus only ever ADDS
breadth evidence, which only ever DEMOTES flags. This is the precision/monotonicity argument for FULL
over filtered.

**Spec grounding.** Corpus = "the enumerated `*/scenario.yaml` set" (the project's on-disk set, not a
run's subset). C2: the breadth test "is what makes small-corpus operation work" — only meaningful
against the full enumerated set. `--scenarios` is an operator run-subset knob, orthogonal to leakage
detection; it must never change WHETHER something is leakage, only which skills the improver edits this
run.

**Threading (chosen — option i).** At `pipeline.ts:85-88`, extract the inline call into a named const:

```ts
const enumerated = enumerateScenarios(config.paths, projectRoot);   // FULL corpus
const allScenarios = filterScenarios(enumerated, params.scenarios); // run subset (improver path)
```

Thread `enumerated` into the `runImprovement(...)` call at `:193` as the new `corpus` field;
`runImprovement` forwards it to `runValidator`. The improver's failing-scenario context keeps using the
filtered `allScenarios` (correct — it edits the run's failing skills). So `RunValidatorParams`'s corpus
source is the FULL set, distinct from the improver's `allScenarios`.

**Corpus assembly details.**
- Source type is `EnumeratedScenario[]` (`scenario.{name,description,prompt,acceptance,rubrics}`).
  `_candidates.yaml` is excluded by construction — `enumerateScenarios` only opens files named
  `scenario.yaml` (`enumerate.ts:36`).
- **Error'd scenarios:** INCLUDE non-stub scenarios (an unresolved-ref error still carries a
  fully-parsed prompt/acceptance — legitimate fingerprints); SKIP stubs (parse/shape errors produce
  empty prompt/acceptance via `stubScenario`, contributing nothing). Low-stakes (the live
  testing-project has none; moot for the AC suite).
- **Rubric text:** union of rubric ids referenced across the corpus, deduped —
  `new Set(corpus.flatMap(s => s.rubrics))` — each read as `paths.rubrics/<id>.md` with the judge's
  `existsSync ? readFileSync : "TO BE FILLED"` fallback (`judge-agent.ts:95-100`). Do NOT read all
  `*.md` under `paths.rubrics` — that would over-include rubrics for inactive scenarios.
- **Rubric reader: INLINE the ~4-line read in the validator. Do NOT factor a shared helper out of
  `judge-agent.ts` in v1.** Rationale: C1 makes the judge a backward-compat-critical surface and AC1
  asserts "existing roles-triple tests pass UNCHANGED"; touching `judge-agent.ts` to extract a shared
  `readRubric` risks that proof for a pure-cleanup gain. Name the extraction
  (`src/scenarios/rubric-loader.ts`, sibling to `skill-loader.ts`) as OPTIONAL future cleanup.

### 4.4 The answer-key exclusion (R4) — structural guarantee

The trap: `runImprovement` IS handed `iterationReport`, and `buildImprovementContext` projects it into
`context.report`, which preserves every judge's verbatim `review` (`context.ts:97-121`). **The
validator MUST NOT receive `iterationReport`, `context.report`, or `context.skillsBlob`.**
`RunValidatorParams` deliberately EXCLUDES all of them — the validator literally cannot see the answer
key because it is not passed it. Its input is built only from `corpus` (raw scenarios, no graded
results) + rubric files + the post-edit `skillsBlob`. This is a structural guarantee, not a prompt
instruction: the data is not in scope, so it cannot leak in.

---

## 5. Post-edit capture: `readSkillsRoot`

### 5.1 The load-bearing reader (net-new, ~15 lines)

```ts
// src/improvement/read-skills-root.ts
/** Read every skill under the skills root (whole-root; follows md-links
 *  per skill via loadSkill; skips dirs without SKILL.md). Materializes the
 *  validator's post-edit "after" state. In-process, ephemeral — writes
 *  nothing, touches no git. */
export function readSkillsRoot(skillsRoot: string): string;
```

**Implementation shape.** `readdirSync(skillsRoot, { withFileTypes: true })` → keep dir entries that
contain a `SKILL.md` → `loadSkill(entry.name, skillsRoot)` each → concatenate with `\n\n`. Returns the
same `=== <rel> ===` section format `loadSkill` already emits (consistent with the improver's
`skillsBlob`). The caller passes `resolve(projectRoot, config.paths.skills)` (== `improver.ts:117`'s
`skillsDir`).

**Robustness guard (load-bearing — `loadSkill` throws on a missing `SKILL.md`,
`skill-loader.ts:15-17`).** The reader MUST gate each dir on the presence of a `SKILL.md` BEFORE
calling `loadSkill`, so a non-skill dir (e.g. `_assets/`) is skipped, not a crash. Use `isDirectorySafe`
(`util/fs.ts`, the repo's EACCES/ENOENT-tolerant helper) for the dir check, and check
`existsSync(join(skillsRoot, entry.name, "SKILL.md"))` before invoking. This mirrors
`mock.ts:applyMarkerToSkills` (`mock.ts:119-122`), the only existing whole-root `*/SKILL.md` walk.

**Why this captures everything the validator must see:**
- **New/unreferenced dirs:** the id list comes from the LIVE directory listing, not from
  `allScenarios` — so it captures dirs the improver created or edited that no scenario references (R5's
  blind-spot closure). `context.skillsBlob` is scoped to failing-scenario ids via `collectSkillIds`
  and is therefore NOT a valid whole-root read.
- **md-linked reference files:** `loadSkill` follows md-links inside each skill dir
  (`skill-loader.ts:36-45`), so reference files (e.g. `references/directives.md`, where some live
  leakage sits) are reviewed.

**No git, no `*.diff` (C3, R5).** The reader is pure `fs` (`readdirSync` + `loadSkill` →
`readFileSync`), in-process, ephemeral; nothing is written except the validator's PROSE verdict
transcript (`validation-round-K.md`, text like `improvement.md`, NOT a diff). The existing assertion
`!existsSync(iteration-1/skills.diff)` (`self-improvement-loop.test.ts:89-92`) stays green untouched.

### 5.2 Why skip the "before"/diff in v1

R4 marks the diff "not load-bearing." R3/R3a's discriminator is **breadth across the corpus** ("is this
string a fingerprint of exactly one scenario I can see?"), computed from {post-edit skill, corpus,
rubrics} — it needs no before/after delta. The delta would only sharpen form-(d) single-case-answer
detection and let revise feedback say "the line you added" — nice-to-have. Skipping it means one read
per round (the "after"), no top-of-function baseline read, simpler control flow. **Named optional
enhancement** for a future iteration: a sibling `readSkillsRootMap(skillsRoot): Map<rel, content>` plus
a baseline read before round 0 would enable the diff; left out of v1.

**Module-name note:** name the module `read-skills-root.ts`, NOT `skills-snapshot.ts` — "snapshot"
collides with the mtime/size primitive (`snapshotWorkspace`/`diffSnapshots`, `testing-agent.ts`) we are
deliberately NOT using; the function reads content. See §10 for why the snapshot primitive is rejected.

---

## 6. The validator agent: `runValidator` and the system prompt

`runValidator` lives in a new `src/improvement/validator.ts` (sibling to `improver.ts`), mirroring the
JUDGE's "build system prompt → build user message → invoke → parse one JSON verdict" shape
(`judge-agent.ts:34-88`), NOT the improver's writeback shape.

### 6.1 Interfaces

```ts
// src/improvement/validator.ts
export interface RunValidatorParams {
  agent: AgentDefinition;             // config.roles.validator.agent
  validatorPrompt?: string;           // config.roles.validator.prompt (REPLACE semantics)
  skillsBlob: string;                 // the readSkillsRoot(skillsDir) "after" (caller reads, passes blob)
  corpus: EnumeratedScenario[];       // the FULL enumerated set (§4.3)
  config: SkillsmithConfig;           // for paths.rubrics
  projectRoot: string;                // for resolving rubricsRoot
  iterationDirectory: string;         // transcript dir
  round: number;                      // transcript filename suffix
  log: RunLog;
}

export interface ValidatorFinding {
  leak_type: "scenario-name" | "scenario-value" | "verbatim-copy" | "single-case";
  span: string;          // the actual offending substring
  why: string;           // 1 line
  suggested_fix: string; // how to generalize
}

export interface ValidatorOutcome {
  verdict: "approve" | "revise";
  findings: ValidatorFinding[];   // empty on approve
  failedOpen: boolean;            // true when error/unparseable/malformed forced approve (R8 evidence)
  transcriptPath: string;
}

export async function runValidator(params: RunValidatorParams): Promise<ValidatorOutcome>;
```

- **The corpus field is named `corpus`** (the FULL set), distinct from the improver's `allScenarios`.
- **`failedOpen`** is the R8 evidence bit — lets the loop/transcript distinguish "validator said
  approve" from "validator failed → treated as approve." Set by either fail-open entry point (§7).
- **`cwd = resolve(projectRoot, config.paths.skills)`** (the skills root, == `improver.ts:117`). `cwd`
  is a REQUIRED `InvokeParams` field, so something valid must be passed; the skills root is the
  validator's subject and the least-surprising read-only anchor. The mock's judge branch never touches
  `cwd`, so it is inert in tests; for real providers it is the read-only sandbox anchor.
- **Caller reads, passes blob** (`skillsBlob` not `skillsDir`): keeps the per-round read boundary in
  the loop body where the AC3/AC5 counts live.

### 6.2 `runValidator` body shape

```ts
const provider = getProvider(agent.provider);
const result = await provider.invoke({
  agent, systemPrompt, prompt: userMessage,
  cwd: skillsDir, role: "judge",
});

let outcome: ValidatorOutcome;
if (result.error !== undefined) {
  outcome = { verdict: "approve", findings: [], failedOpen: true, transcriptPath };  // (a) §7
  log.info("validator dispatch failed → treated as approve");
} else {
  outcome = classifyValidatorVerdict(result.finalText);    // (b) §7, rows 1–5; set transcriptPath after
}
// write validation-round-{round}.md (failedOpen-prominent header + findings/raw)
return outcome;
```

### 6.3 Validator identity and prompt precedence

- **Identity sentinel:** the system prompt opens with `"You are the validator agent in the skillsmith
  self-improvement loop."` (mirrors `improver.ts:124`). The mock branches on
  `systemPrompt.includes("validator agent")`. **False-match guard (verified):** the validator runs
  `role:"judge"` → takes the mock's `invokeJudge` path, never the `role:"testing"` path where
  `includes("improver agent")` is checked — so no collision. Belt-and-suspenders:
  `DEFAULT_VALIDATOR_PROMPT` must NOT contain the literal two-word sequence `"improver agent"`.
- **Prompt precedence: REPLACE (mirror the IMPROVER), not append.** Exact guard:
  `validatorPrompt !== undefined && validatorPrompt.length > 0 ? validatorPrompt :
  DEFAULT_VALIDATOR_PROMPT` (identical to `improver.ts:118-121`). Rationale: the built-in encodes the
  ENTIRE anti-leakage contract (R2/R3/R3a/R9); appending a project prompt would risk a project diluting
  the verdict-format contract. (The judge/test roles APPEND a `# Role instructions` block — the
  validator does NOT follow that pattern.) Documented footgun (not enforced in code): a project that
  overrides the prompt must keep the JSON schema and the `"validator agent"` sentinel — the same
  footgun the improver's replace already ships.

### 6.4 `DEFAULT_VALIDATOR_PROMPT` — required section outline

Full prose is the code-writer's job; the structure and the load-bearing rules are fixed here:

1. **Identity + mandate (R2).** EDIT QUALITY (generality / anti-leakage), NOT scenario correctness.
   Correctness stays with the scenario judge on the next sweep.
2. **The four leak types (R2 a–d),** named with the exact enum spelling so findings are typed and
   assertable: `scenario-name`, `scenario-value`, `verbatim-copy`, `single-case`. Specifically:
   (a) a scenario name or directory name in the skill (a scenario's directory name and its
   `scenario.name` can differ — e.g. dir `counter` → name `counter-block`; both forms count);
   (b) a scenario-unique literal value (quoted string, number, identifier, URL) hard-coded into the
   skill; (c) verbatim acceptance or rubric wording copied into the skill prose; (d) a single-case
   answer — guidance shaped "for THIS task do X" rather than "in general do X."
3. **The bright line (R3).** Leakage = the edit references something that identifies a SPECIFIC scenario
   (its name, its unique value, or its verbatim wording). Domain = the API surface that recurs across
   scenarios (breadth ≥ 2) and is what the skill exists to teach — MUST pass clean. "Specificity to one
   scenario is the bright line." Do NOT anchor on "appears in the rubric" — the rubric and skill SHOULD
   share vocabulary; anchoring there would flag the subject matter. Leakage is not "the skill uses a
   concrete value" (an illustrative example legitimately needs *some* concrete value); leakage is "the
   skill uses THE SCENARIO'S value." The rule: use a value that ISN'T one of the eval scenarios' values.
4. **Two-prong AND + precision bias (R3/R3a).** Flag content ONLY when BOTH prongs hold: (i)
   **scenario-specific** — the content fingerprints exactly one scenario (its name/dir-name; a literal
   appearing in exactly one active scenario and absent from the rubric / shared domain surface; or a
   verbatim span from one scenario's acceptance or a rubric bullet); AND (ii) **not necessary to teach**
   — a generic substitute value or example would convey the same principle equally well. If EITHER prong
   fails → APPROVE. When uncertain → APPROVE. A value appearing in ZERO scenarios, or in ≥ 2 scenarios
   (domain vocabulary), MUST pass clean. State the harm asymmetry: a false POSITIVE actively harms (it
   blocks a legitimate fix, burns revise rounds, and pressures the improver to water down good guidance
   — the worst outcome); a false NEGATIVE merely slips a blatant leak to the working tree where human PR
   review still catches it.
5. **What you see.** The post-edit whole skill; the active scenario corpus
   (name/description/prompt/acceptance per scenario); the rubric texts.
6. **Output format (R9).** The exact verdict JSON (§6.5). `findings` is REQUIRED and non-empty when
   `verdict == "revise"`, absent/empty on `approve`. `span` = the actual offending substring. Strict
   JSON, no prose, no fences (mirror `judge-agent.ts:126-127`).
7. **Recursion guard.** "Do not invoke `skillsmith` or any wrapper that would re-enter the harness."
   (copy `improver.ts:130-132` / `judge-agent.ts:129-131`).

**User message (data, separate from the system prompt):** `# Post-edit skill` + skillsBlob;
`# Active scenario corpus` + per-scenario {name/description/prompt/acceptance}; `# Rubrics` + rubric
bodies. Instructions in system prompt, data in user message (mirrors judge + improver).

### 6.5 Verdict format (R9)

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

`findings` is REQUIRED and non-empty when `verdict == "revise"`; absent/empty on `approve`. `leak_type`
is enumerated to the four R2 forms so the reason is typed for the improver and assertable in tests.
`span` is the actual offending substring so the improver can locate it and a test can assert the
finding names it.

---

## 7. Verdict parse/shape and fail-open (R8/AC7)

### 7.1 `parseAgentJson` — the extracted JSON helper

Lift `parseJudgeJson`'s body (`judge-agent.ts:141-153`) verbatim into `src/util/parse-agent-json.ts`:

```ts
// src/util/parse-agent-json.ts
export function parseAgentJson(finalText: string): object | undefined;
```

It trims, strips ONE leading/trailing ```-fence via `/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/`,
`JSON.parse`s, and returns `undefined` on throw or on a non-object result. It is entirely judge-agnostic
— it does NOT validate the judge's `{rubrics, acceptance}` shape (that lives downstream in
`classifyVerdict`, `reports/verdict.ts`). `judge-agent.ts` imports it and deletes its private copy; the
validator imports it too.

**Why this does not threaten C1/AC1.** C1 is judge SKILL-BLINDNESS (enforced by the judge's prompt and
what it is shown — untouched by a parse-helper move). AC1's "unchanged" tests are the CONFIG-validation
roles-triple tests, which exercise the config layer and cannot observe where `parseJudgeJson` lives. The
judge's behavior for any input is identical (same body, now via import). This is a different call than
the rubric reader (§4.3), which stayed inline because extracting it would restructure the judge's
prompt-building flow; `parseAgentJson` is a self-contained pure function with no such entanglement, so
DRY wins.

### 7.2 `classifyValidatorVerdict` — the pure classify unit

```ts
// src/improvement/validator-verdict.ts
export function classifyValidatorVerdict(finalText: string): ValidatorOutcome;
```

It takes the raw STRING and owns BOTH extraction (`parseAgentJson`) and the shape-check, so AC2's
string-level rows (non-JSON, fenced JSON) are coverable in one pure-function table. Lives in its own
module (mirroring the `verdict.ts` / `verdict.test.ts` split); pinned by `validator-verdict.test.ts`
(AC2). NOTE this differs from `classifyVerdict` (`reports/verdict.ts`), which takes an already-PARSED
object — the judge's parse and classify are split across two files; for the validator they are FOLDED so
AC2 can feed strings.

### 7.3 The complete 5-row decision table (THIS IS AC2)

| # | Input | Result | failedOpen |
|---|---|---|---|
| 1 | `parseAgentJson` → `undefined` (non-JSON / unparseable) | `{verdict:"approve", findings:[]}` | **true** |
| 2 | parsed, `verdict ∉ {"approve","revise"}` (missing / typo / wrong type) | `{verdict:"approve", findings:[]}` | **true** |
| 3 | `verdict:"approve"` (findings absent or empty) | `{verdict:"approve", findings:[]}` | false |
| 4 | `verdict:"revise"` + non-empty well-shaped findings | `{verdict:"revise", findings:[...]}` | false |
| 5 | `verdict:"revise"` + empty / absent findings (malformed) | `{verdict:"approve", findings:[]}` | **true** |

**Completeness argument:** parses or not (1 vs 2–5); if parses, verdict in-enum or not (2 vs 3–5); if
in-enum, approve (3) or revise (4–5); revise has non-empty findings (4) or not (5). No gap.

**Maps to R8:** row 1 = "won't parse → approve"; row 5 = "revise but findings empty/absent → malformed
→ fail-open"; row 4 = "ONLY a parseable revise with non-empty findings triggers a revise round" (the
sole non-approve outcome). Fenced JSON is handled inside `parseAgentJson` and is orthogonal to the row
(a fenced approve → row 3, a fenced revise → row 4).

**Row-4 finding-shape strictness: LENIENT (per R3a spirit).** Row 4 requires `verdict:"revise"` AND
`findings` is a non-empty array (optionally: the first finding has a string `span`). Do NOT fail-open
merely because one finding lacks `suggested_fix` — over-strictness wastes the revise signal and burns
rounds. AC2's malformed case is specifically EMPTY/ABSENT findings (row 5), not a missing sub-field.

**findings normalization:** on every approve outcome (rows 1, 2, 3, 5) emit a canonical `findings: []`
even if raw JSON carried stray findings on an approve — keeps the loop's `verdict !== "revise"` break
(§2.1) clean.

### 7.4 Two fail-open entry points, both set `failedOpen: true`

Mirrors the judge's two degradation paths (`judge-agent.ts:69-75` and `:77-84`):

- **(a) Provider error → handled in `runValidator`, BEFORE parsing.** After `provider.invoke`, if
  `result.error !== undefined`: do NOT call `classifyValidatorVerdict` (finalText is meaningless) —
  short-circuit to `{verdict:"approve", findings:[], failedOpen:true}`, log "validator dispatch failed
  → treated as approve," write the transcript. (R8: "provider error → log, treat as approve, exit inner
  loop.")
- **(b) Parse/shape failure → handled in `classifyValidatorVerdict`** (rows 1/2/5), only on a successful
  invoke (`result.error === undefined`).

Both break the loop as approve. **Why both set `failedOpen: true` (R8 last paragraph / AC7):** approve
and fail-open-approve BOTH break the loop identically, so without the flag a chronically-broken
validator looks like a string of clean approvals. The persisted `failedOpen` bit is what makes
"approved 5× in a row because it kept erroring" legible to a human reviewer. The transcript renders it
prominently: `VALIDATOR: approve (clean)` vs `VALIDATOR: approve (FAILED-OPEN: <reason>)` where reason
is `"provider error: <err>"` (path a) or `"verdict unparseable"` / `"revise without findings"` /
`"invalid verdict value"` (path b). The evidence trail must distinguish "validator said approve" from
"validator failed → treated as approve" so a chronically-broken validator never becomes a
ceiling-lowerer — it leaves the system no worse than the pre-validator baseline.

---

## 8. Config plumbing

### 8.1 `roles.validator` (AC1) — additive, backward-compatible

- **`types.ts`:** `RolesInput` (`:50-54`) `+ validator?: SingleRoleInput`; `NormalizedRoles` (`:69-73`)
  `+ validator?: { agent: AgentDefinition; prompt?: string }`. The `?` is load-bearing — it makes
  "config WITHOUT validator validates" hold at the type level. The `Role` union
  (`providers/types.ts:16`) is UNCHANGED (C5).
- **`validate.ts`:** in `validateRoles` (after `:100`):
  `if (roles.validator !== undefined) validateSingleRole(roles.validator, "roles.validator", agentIds,
  errors);` — reuses `validateSingleRole` (`:139-175`) as-is. The `!== undefined` guard means
  validator-absent → line skipped → zero new errors → existing triple-only configs validate exactly as
  before (the same optional-by-guard idiom `validateSelfImprovement` uses at `:182`). Leave the
  top-level "roles must be an object with `test`, `judge`, `improver`" message (`validate.ts:94`) as-is
  — it lists the REQUIRED roles; validator is optional.
- **`normalize.ts`:** in the roles block (after `:38`):
  `...(input.roles.validator !== undefined ? { validator: normalizeSingleRole(input.roles.validator,
  agents) } : {})` — the EXACT spread-when-present idiom already used for `selfImprovement`/`hooks`
  (`:47-50`). Absent → no `validator` key on `NormalizedRoles` → `config.roles.validator === undefined`
  is the §2 runtime gate.
- **AC1 tests** (new, mirroring the improver cases): (a) string-shorthand validator validates; (a')
  object-form `{agent, prompt}` valid case (the spec lists both forms); (b) unknown-agent rejected —
  `validateSingleRole` already emits `roles.validator references unknown agent "<id>"`; (c)
  non-string-prompt rejected — emits `roles.validator.prompt must be a string`; (d) config WITHOUT
  validator still validates AND the existing roles-triple tests pass UNCHANGED. New tests assert
  `errors.some(e => e.includes("roles.validator"))`.

### 8.2 `maxValidationRounds` (R7) — mirrors `maxIterations` exactly

- **`types.ts`:** `SelfImprovementConfig` (`:81-85`) `+ maxValidationRounds?: number`.
- **`self-improvement.ts`:** `ResolvedSelfImprovement` (`:3-8`) `+ maxValidationRounds: number`;
  `SelfImprovementOverrides` (`:10-15`) `+ maxValidationRounds?: number`; `DEFAULTS` (`:17-25`)
  `+ maxValidationRounds: 2` (extend the `Pick<...>` key union at `:18-19`); `resolveSelfImprovement`
  return `+ maxValidationRounds: Math.max(1, overrides.maxValidationRounds ?? cfg.maxValidationRounds ??
  DEFAULTS.maxValidationRounds)`.
- **Clamp `Math.max(1, …)`** — a configured `0` clamps to `1` (one revise round); it does NOT disable
  the validator. **Do NOT overload `0` as "disabled."** The validator's on/off is governed SOLELY by the
  presence/absence of `roles.validator` (R7/C4). The cap means "how many revise rounds when the
  validator IS active." Default is **2** (the improver's first pass plus up to 2 revise rounds).
- **`validate.ts`:** `validateSelfImprovement` (`:177-204`) `+` a `maxValidationRounds` integer-≥1 block
  mirroring the `maxIterations` block (`:188-194`), `!== undefined`-guarded:
  `"selfImprovement.maxValidationRounds must be an integer >= 1"`.

### 8.3 CLI `--validation-rounds`

R7 requires the same shape and precedence as `maxIterations`, and `maxIterations` HAS a CLI flag, so add
`--validation-rounds`. **Precedence: CLI override > config > default.**

- **CLI override chain (traced end-to-end):** `bin/skillsmith.mjs` (`parseArgs`, builds `overrides`) →
  `run({overrides})` (`runner.ts`, `RunOptions.overrides`) → `runPipeline` (`pipeline.ts:51`) →
  `resolveSelfImprovement(config, params.overrides)` (`pipeline.ts:84`). `params.overrides` originates
  ONLY from the CLI shim and the programmatic `run({overrides})` API.
- **In `bin/skillsmith.mjs`:** add `"validation-rounds": { type: "string" }` to the `parseArgs` options;
  add a parse/validate/assign block mirroring `--iterations` (`Number.parseInt`, `< 1` → error + exit,
  else `overrides.maxValidationRounds = n`); update the usage string.
- **Honest note:** `bin/skillsmith.mjs` is a thin, untested `parseArgs` shim; the tested link is the
  `resolveSelfImprovement` precedence (`??`-chain), pinned by a new case in `self-improvement.test.ts`'s
  existing default/config/override triple. The flag is an obvious mirror of `--iterations`; correctness
  rides on the tested resolve chain.

### 8.4 D5 — the deterministic pre-scan is DEFERRED; v1 is LLM-validator-only

The spec EXPLICITLY permits this: D5 makes the LLM validator REQUIRED and the pre-scan "a
recommended-but-OPTIONAL accelerator left to the design phase"; Out-of-scope lists "A required
deterministic pre-scan" as NOT a requirement. **Deferring is squarely within the spec's grant.**

- **No AC becomes unsatisfiable.** AC1/AC2/AC3/AC5/AC7 don't touch the pre-scan. AC6 is written to
  degrade gracefully: with a mock validator, AC6 verifies "the loop accepts an approve verdict
  (converges without a revise round)" — it does NOT exercise a model's breadth-rule judgment either
  way. The pre-scan's absence only forgoes one optional `leakage-scan.test.ts` unit pinning the breadth
  rule deterministically; it weakens no other AC.
- **LLM-only satisfies D5's *behavior* requirement for forms a–c.** Given the FULL corpus (§4.3) +
  rubrics + post-edit whole skill, the LLM can in principle catch (a) a scenario name in the skill, (b)
  a literal unique to one corpus scenario, and (c) a verbatim acceptance/rubric span — it is shown both
  sides to compare. D5 requires the behavior, not the mechanism. Form (d), the single-case answer, can
  ONLY be caught by the LLM (a deterministic scan can never catch it) — which is why the LLM validator
  is required.
- **Honest caveat to carry into the docs:** without the pre-scan, a–c detection reliability rides on
  the model (same as form d) — consistent with C6/intent ("legible floor-raiser, not a guarantee"). The
  pre-scan would have raised the deterministic floor on a–c and added explainability; deferring trades
  that for a tighter v1 blast radius. The pre-scan also carries its OWN false-positive risk: a
  deterministic matcher wired as a "strong prior" can nudge the LLM toward false positives (the R3a
  harm); building it correctly (surfaced-evidence-only, NEVER auto-rejecting on a string match) is more
  surface than the loop itself.
- **The design NAMES the pre-scan as scoped follow-up:** RULES 1–3 over forms a–c (scenario-name match,
  scenario-unique-literal match, verbatim n-gram/span match), surfaced-evidence-only and never-gating,
  with its own `leakage-scan.test.ts` pinning the breadth rule deterministically.

---

## 9. Evidence trail and error handling

### 9.1 The cap warning (R7/AC5)

`RunLog` is INFO-ONLY — its surface is `header` / `section` / `info` / `hook` / `gap` (`run-log.ts:29-55`),
there is **no `warn` level**. Emit the warning as a stable literal via `log.info` using the token
`"WARNING: validation cap reached without approval"`, and have AC5 grep that literal.

**Where it lands.** `runImprovement` receives the iteration's `RunLog` (`outcome.log`, passed at
`pipeline.ts:206`). Every `log.info` accumulates in that RunLog and is dumped to
`${iterationDirectory}/run.log` via `log.dump`, called after the improver inside `fireAfterIteration`
(`pipeline.ts:445`, which runs at `:210`, AFTER the `runImprovement` call at `:193`). So AC5 reads
`iteration-1/run.log` and asserts `.includes("validation cap reached without approval")`. (RunLog dumps
to the file regardless of `mirrorStderr`, so the test can suppress console and still grep the file —
mirrors `self-improvement-loop.test.ts:36-37`.)

### 9.2 The validator NEVER touches `report.json` / the matrix / the exit code (C6/D2 advisory)

`report.json` is exclusively the scenario judge's matrix (built by `aggregateIterationReport` /
`writeRunReport` from per-scenario reports; the per-scenario reports are aggregated from the judge
verdicts + the verification hook — the validator writes none of these). The exit code is
`allPass ? 0 : 1` from the merged scenario matrix, invisible to validator approve/revise. **Advisory =
the validator's verdict flows ONLY into `validation-round-K.md` + log lines, never into a
`ScenarioReport` cell.** AC5's "run still proceeds to an exit code" is the normal exit path: the scenario
that triggered improvement either still fails the next sweep (→ exit 1) or passes (→ 0); the validator
caps/warns but does not change exit semantics. AC5 should assert the run RETURNS a number (no hang), NOT
a specific value (don't couple AC5 to scenario design) — unless the cap fixture's scenario is
deliberately designed to stay failing, in which case `1` is assertable.

### 9.3 Transcript artifacts — `validation-round-{K}.md` is the only new persisted file

- **New file per validator verdict:** `validation-round-{K}.md` (K from 0).
  `writeFileSync(join(iterationDirectory, \`validation-round-${round}.md\`), body)` — same pattern as
  `improver.ts:157-162`. The body leads with the `failedOpen`-prominent header (§7.4):
  `VALIDATOR round K: approve|revise (clean | FAILED-OPEN: <reason>)`, then findings/raw.
- **`improvement.md` stays the ROUND-0 improver transcript on every path.** There is **no**
  `improvement-round-K.md`. The spec (R5) only requires the validator's PROSE verdict be persisted;
  per-revise improver transcripts are not required, and the AC counts drive off `validation-round-*.md`
  alone. This keeps the new-artifact surface minimal and AC4's byte-identical no-validator path
  trivially clean. On the no-validator path, `improvement.md` is byte-identical to today, so AC4's
  `existsSync(iteration-1/improvement.md)` assertion (`self-improvement-loop.test.ts:81-84`) holds
  untouched, and ZERO `validation-round-*.md` files are written.
- **No collisions** with existing iteration-dir names (`improvement.md`, `report.json`, `summary.txt`,
  `run.log`, per-scenario subdirs). `afterImprove`'s `improvementPath` stays the round-0
  `improvement.md` → `ImproveHookContext` UNCHANGED; the validation transcripts are separate files the
  hook never references.

---

## 10. Key technical decisions and rejected alternatives

| Decision | Rationale | Rejected alternative (and why) |
|---|---|---|
| Inner loop INSIDE `runImprovement`, gated by `if (config.roles.validator === undefined)`, with `invokeImprover(...)` extracted | Makes the no-validator byte-identity (C4/AC4) visually obvious — the property AC4 polices hardest — and keeps the loop in the one function that owns the improver. | A separate exported `runImproveValidateCycle` — buys nothing here and obscures the byte-identical no-validator branch. (Would only pay off if the cycle needed isolated unit-testing, but AC3/AC5 already exercise it E2E.) |
| `while (true)` with the cap check AFTER validate / BEFORE the next improver invoke | Guarantees the terminal validation (review of the last un-revised edit) always runs and feeds the warning — exactly AC5's N+1/N+1 counts. | `while (round < cap)` header — validates N times not N+1, skips the terminal review. Wrong for AC5. |
| Corpus = the **FULL** enumerated set, threaded as a new `corpus` field separate from `allScenarios` | **Monotonicity/precision:** breadth count is monotonic in corpus size; `false-positive-count(full) ≤ count(filtered)` always. The filtered set FABRICATES false positives under `--scenarios` — exactly the R3a harm. Spec-constrained by R3/R3a/C2, not latitude. | Threading the FILTERED `allScenarios` as the corpus — unsound breadth test under `--scenarios`, fabricates false positives. Re-enumerating inside `runValidator` — wasteful re-walk (up to N+1 per iteration) and hides the decision inside the validator. |
| `readSkillsRoot` = direct whole-root CONTENT read | The validator needs content; captures new/unreferenced dirs (id list from the live listing) and md-linked reference files; pure `fs`, no git (C3/R5). | Reusing `snapshotWorkspace`/`diffSnapshots` (the mtime/size primitive) — it returns changed PATHS not content; the diff it enables is non-load-bearing (R4). |
| Skip the "before"/diff in v1 | R3/R3a's discriminator is breadth across the corpus, computed from {post-edit skill, corpus, rubrics} — no delta needed. One read per round, simpler control flow. | Eager before+diff — only sharpens form-(d) detection and "the line you added" feedback (nice-to-have). Named optional enhancement (`readSkillsRootMap` + baseline read). |
| Validator runs `role: "judge"`, identified by its system prompt | The validator is tool-identical to the judge (read-only); Role is a tool-permission tier, not an identity (C5). | A new provider `Role: "validator"` — forces edits to every provider's exhaustive Role map for zero tool-surface gain. |
| Cap-without-approval = KEEP last edit + WARN (advisory gate, D2) | Faithful to "cheap floor-raiser, not a guarantee"; mirrors the existing outer-cap precedent (keep artifact, report, no revert) and the documented "edits live in the working tree for human review" contract. **Honest caveat:** this DOES let leakage reach the working tree on cap — acceptable because human PR review is the authoritative gate and the warning makes it legible. | Revert-on-cap / staging / rollback — stronger than intent; an explicit non-goal unless the owner later elects it. |
| Prompt precedence: REPLACE (mirror the improver), not append | The built-in encodes the ENTIRE anti-leakage contract (R2/R3/R3a/R9); appending a project prompt risks diluting the verdict-format contract. | Append a `# Role instructions` block (the judge/test pattern) — risks a project diluting the verdict schema. |
| `DEFERRED` deterministic pre-scan; v1 LLM-validator-only (D5) | Spec explicitly permits it; LLM-only satisfies D5's *behavior* for a–c given the full corpus, and is the only way to catch (d). Tighter v1 blast radius; pre-scan carries its own R3a false-positive risk. | A required pre-scan in v1 — not required by D5; named as scoped follow-up (RULES 1–3, surfaced-evidence-only, never-gating, `leakage-scan.test.ts`). |
| Extract `parseAgentJson` (shared) | Mechanically trivial, byte-identical, judge-agnostic; improves both call sites; does not touch the judge's skill-blindness or the AC1 config tests. | Keep a validator-private copy (judge frozen) — correct but duplicates ~10 stable lines; DRY wins here because the move is entanglement-free. |
| Keep the rubric reader INLINE in the validator | C1 makes the judge backward-compat-critical and AC1 asserts its config tests pass UNCHANGED; extracting a shared `readRubric` would restructure the judge's prompt-building flow. | Extract `src/scenarios/rubric-loader.ts` in v1 — risks the AC1 proof for a pure-cleanup gain. Named as OPTIONAL future cleanup. |

---

## 11. Testability hooks (mock-driven determinism)

All acceptance criteria are mock-driven — no real model runs in the test suite. (A real-model smoke
check against the live overfit skill and its de-fingerprinted twin is a design reference, not part of
this suite.)

### 11.1 Mock sentinels

Sentinels in the skill text drive the mock with no real model. They are checked off `InvokeParams`
(the mock has access only to params, not config — consistent with how `MOCK_GATE` / `MARKER` work):

- **`LEAK_TOKEN`** — present in the post-edit skill (surfaced in the skillsBlob in the validator's user
  prompt) → the mock validator returns `revise` (a finding naming `LEAK_TOKEN`); absent → `approve`.
- **`NEVER_APPROVE`** — present in the skill text → the mock validator ALWAYS returns `revise`
  (drives AC5's cap).
- **`VALIDATOR_LOOP_FIXTURE`** — an OPT-IN marker present ONLY in the validator-loop fixtures'
  skill/report. It gates the new mock-improver add-leak/remove-leak behavior, so the existing
  `loop-project` keeps hitting the UNCHANGED `applyMarkerToSkills` path (the AC4 byte-identity
  guarantee).

### 11.2 Mock validator branch (`mock.ts`)

Inside `invokeJudge` (`mock.ts:96`), BEFORE the generic judge PASS/FAIL fallthrough, add a branch keyed
on `params.systemPrompt.includes("validator agent")` (safe: the validator runs `role:"judge"` → never
the `role:"testing"` improver branch). The verdict keys off the post-edit skill, which the validator
SEES via the user prompt's skillsBlob — so the mock checks `params.prompt.includes(...)`:

```ts
function invokeValidator(params: InvokeParams): InvokeResult {
  const neverApprove = params.prompt.includes("NEVER_APPROVE");   // AC5 cap control
  const leaked = params.prompt.includes("LEAK_TOKEN");
  if (neverApprove || leaked) {
    return { finalText: JSON.stringify({ verdict: "revise", findings: [
      { leak_type: "scenario-value", span: "LEAK_TOKEN",
        why: "scenario-unique token copied into the skill",
        suggested_fix: "use a generic example value" } ] }), toolUseCount: 0 };
  }
  return { finalText: JSON.stringify({ verdict: "approve", findings: [] }), toolUseCount: 0 };
}
```

The verdict JSON is exactly the R9 shape, so `classifyValidatorVerdict` parses it to a real `revise`
(row 4) / `approve` (row 3).

### 11.3 Mock improver revise behavior (`mock.ts`), gated to keep AC4 byte-identical

Inside the existing `invokeTesting` improver branch (`systemPrompt.includes("improver agent")`,
`mock.ts:61`), gate the new behavior on the `VALIDATOR_LOOP_FIXTURE` opt-in marker:

```ts
if (systemPrompt.includes("improver agent")) {
  if (prompt.includes("VALIDATOR_LOOP_FIXTURE")) {
    const isReviseRound = prompt.includes("LEAK_TOKEN");   // findings name it; absent on round 0
    if (isReviseRound) return removeLeakTokenFromSkills(cwd);   // revise: strip LEAK_TOKEN
    return applyMarkerAndLeakToSkills(cwd);                     // round 0: add MARKER + LEAK_TOKEN
  }
  return applyMarkerToSkills(cwd);   // UNCHANGED no-validator path (AC4)
}
```

- **Revise-vs-round-0 detection = `prompt.includes("LEAK_TOKEN")`:** on a revise round the validator's
  findings (appended to the improver's user prompt by `invokeImprover`) name `LEAK_TOKEN`; on round 0
  there are no findings and the failing skill does not yet contain `LEAK_TOKEN` (the improver is about to
  ADD it).
- **Fixture constraint:** no scenario prompt/acceptance or rubric in the validator-loop fixtures may
  contain the literal `LEAK_TOKEN` — otherwise it would appear in the round-0 improver prompt (via the
  report/corpus) and falsely trip the revise branch. Keep the token out of the corpus text.
- **The `VALIDATOR_LOOP_FIXTURE` opt-in is the AC4 guarantee:** `loop-project`'s improver prompt lacks it
  → unchanged `applyMarkerToSkills` → `self-improvement-loop.test.ts` byte-identical, no
  `validation-round-*.md` written.

### 11.4 Fixtures — TWO of them

Each is a self-contained mirror of `loop-project/`, each with a `PRISTINE_SKILL` reset (like
`self-improvement-loop.test.ts:34/46`):

- **`fixtures/validator-loop-project/`** (AC3 converge): config adds `roles.validator: "checker"` + a
  `checker` mock agent + `selfImprovement.maxValidationRounds: 2`; the pristine `skills/wp-foo/SKILL.md`
  carries `MOCK_GATE` + `VALIDATOR_LOOP_FIXTURE` but NOT `MARKER`/`LEAK_TOKEN` (the improver adds those).
- **`fixtures/validator-loop-cap-project/`** (AC5 never-approve): the same, plus `NEVER_APPROVE` in the
  pristine skill so the mock validator never approves.

Two fixtures over one parameterized fixture: lower shared-state risk, mirrors `loop-project`'s
self-contained shape, each test owns its pristine reset.

### 11.5 AC assertions and the file-count approach

Count `validation-round-*.md` by filename regex (`/^validation-round-\d+\.md$/`) in `iteration-1/`. By
the validate-after-every-edit loop structure (§2), this pins BOTH the validation-transcript count AND
the improver-invoke count (they are equal).

- **AC1** (`config-validate` / `self-improvement.test.ts`): the role-validation cases from §8.1 +
  the `maxValidationRounds` resolve case.
- **AC2** (`validator-verdict.test.ts`): the pure-fn 5-row string table over `classifyValidatorVerdict`
  (§7.3) — no mock/fixture needed.
- **AC3** (converge, N=2): exactly **2** `validation-round-*.md` (round-1 revise + round-2 approve);
  `existsSync(iteration-1/validation-round-1.md)` ("the validator ran"); exactly one revise round
  (= 2 transcripts, or read round-1=revise / round-2=approve); final skill `!includes("LEAK_TOKEN")`;
  exit 0.
- **AC4** (backward-compat): `self-improvement-loop.test.ts` UNTOUCHED; running `loop-project` writes
  ZERO `validation-round-*.md` (the validator never runs), `improvement.md` byte-identical, existing
  asserts hold. The strongest proof is that the test file is not edited.
- **AC5** (cap, N=2, never-approve): exactly **3** `validation-round-*.md` (each edit incl. the final
  un-revised one reviewed); `iteration-1/run.log` includes the WARNING literal; the last edit is KEPT
  (assert the skill reflects the last improver edit, not a revert); the run RETURNS a number (no hang).
- **AC6** (false-positive guard): the must-approve loop-approves-on-approve behavior — the
  `validator-loop-project` fixture with the validator returning `approve` (no LEAK present) converges
  with ZERO revise rounds (the deterministic portion). The real breadth-rule judgment (a real model
  declining to flag domain vocabulary with breadth ≥ 2, e.g. `data-wp-on--click`) is the
  design-reference real-model check, NOT this suite (pre-scan deferred, §8.4). If design later elects
  the optional pre-scan, its `leakage-scan.test.ts` pins the breadth rule deterministically.
- **AC7** (fail-open): a validator provider error or an unparseable verdict does NOT block the improver
  or stall the loop — it exits the inner loop as approve, with the evidence trail distinguishing
  "approved" from "failed → treated-as-approve" (the `failedOpen` bit, §7.4). Coverable as a
  `classifyValidatorVerdict` row (parse failure → row 1, `failedOpen:true`) and/or a mock provider-error
  path.
```
