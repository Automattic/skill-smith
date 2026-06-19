# Design research — Stop the self-improvement loop from overfitting skills to eval scenarios (#48)

Status: COMPLETE — design settled across 7 question areas (Q1, Q2, Q3, Q3b, Q4, Q5, Q6+Q7) via
evidence-driven Q&A with design-doc-researcher; every decision file-backed. Ready for a
design-doc-writer to synthesize a standalone `design-doc.md` and for a downstream code-plan.
Input contract: the APPROVED spec at `../1-spec/spec.md` (R1–R9, C1–C6, AC1–AC7, D2, D5).
This record captures architecture, data flow, interfaces/signatures, error handling,
testability hooks, and trade-offs with rejected alternatives.

All file/line references below were verified by the analyst against the worktree at the start of
this phase (not copied blindly from spec-research). The "Settled architecture" section is the
synthesis; the Q&A log holds the full reasoning + grounding behind each decision.

## Verified code surface (analyst read at phase start)

- `src/improvement/improver.ts` — `runImprovement(params): Promise<ImprovementResult>`. Builds
  `buildImprovementContext` (context.ts) at the top, builds `systemPrompt`/`userMessage`, does a
  SINGLE `provider.invoke({ agent, systemPrompt, prompt, cwd: skillsDir, role: "testing" })`,
  writes `iteration-N/improvement.md`, fires `afterImprove` hook, returns
  `{ improvementPath }`. The improver's identity is carried by its system prompt (starts
  "You are the improver agent in the skillsmith self-improvement loop."); it runs `role:"testing"`.
- `src/improvement/context.ts` — `buildImprovementContext({projectRoot, config, iterationReport,
  allScenarios})` returns `{ report: ImproverReport, skillsBlob: string, skillIds: string[] }`.
  `skillsBlob` is the verbatim text of every skill referenced by a FAILING scenario (scoped via
  `collectSkillIds` → `collectFailingScenarios`). `loadSkill(id, skillsRoot)` follows md-links
  inside the skill dir.
- `src/pipeline/pipeline.ts` — outer loop. `runImprovement(...)` is invoked once per failing
  iteration at the `!mergedPass && i < maxIterations && mode==="self-improvement"` guard, passing
  `agent: config.roles.improver.agent`, `improverPrompt: config.roles.improver.prompt`,
  `allScenarios` (the full `EnumeratedScenario[]`), and `outcome.log`.
- `src/pipeline/judge-agent.ts` — precedent for "agent emits one JSON verdict the harness parses":
  `parseJudgeJson(finalText)` strips a single ```-fence then `JSON.parse`; returns `undefined` on
  failure. The judge is skill-blind ("Do not consult any skill documentation"); reads rubric files
  from `paths.rubrics/<id>.md` via `buildJudgeSystemPrompt`. Judge runs `role:"judge"`.
- `src/pipeline/testing-agent.ts` — the snapshot primitive: `snapshotWorkspace(root)` walks a tree
  returning `Map<rel, {mtimeMs,size}>`; `diffSnapshots(before, after)` returns the sorted list of
  CHANGED REL PATHS (new file or mtime/size change). Returns paths only, NOT content.
- `src/config/types.ts` — `RolesInput {test, judge, improver}`, `NormalizedRoles {test, judge,
  improver}`, `SingleRoleInput = string | {agent, prompt?}`, `SelfImprovementConfig
  {maxIterations?, scope?, finalPass?}`.
- `src/config/validate.ts` — `validateRoles` validates the triple; `validateSingleRole(role, path,
  agentIds, errors)` is reusable as-is. `validateSelfImprovement` validates `maxIterations` as
  "integer >= 1".
- `src/config/normalize.ts` — `normalizeSingleRole(role, agents)` is reusable; roles block built
  in `normalizeConfig`. `selfImprovement` carried through only when present.
- `src/config/self-improvement.ts` — `resolveSelfImprovement(config, overrides)` merges CLI
  override > config > defaults, clamps `maxIterations` with `Math.max(1, …)`. `ResolvedSelfImprovement`
  + `SelfImprovementOverrides` are the two structs to extend.
- `src/providers/types.ts` — `Role = "testing" | "judge"` (UNION — do NOT extend). `InvokeParams
  {agent, systemPrompt, prompt, cwd, role}`, `InvokeResult {finalText, toolUseCount, error?,
  usage?}`.
- `src/providers/mock.ts` — `mockProvider.invoke` branches on `role`. Testing branch keys the
  improver off `systemPrompt.includes("improver agent")`; judge branch returns PASS/FAIL JSON.
  Sentinels `GATE="MOCK_GATE"`, `MARKER="SKILLSMITH_LOOP_OK"`. THIS is the testability hook to
  extend with a validator branch.
- `src/__tests__/self-improvement-loop.test.ts` — the existing E2E loop test (fixture
  `loop-project`). MUST stay untouched (AC4). Asserts: converges, marker present, 2 iterations,
  `improvement.md` exists, NO `proposal.md`, NO `skills.diff` (no git).
- `src/__tests__/fixtures/loop-project/` — config has `roles {test, judge, improver}` (NO
  validator), `selfImprovement {maxIterations:3, scope:"failed-scenarios"}`. One skill `wp-foo`,
  one scenario `wp-marker`, one rubric `r1`.

---

## Settled architecture (synthesis — read this first)

The full reasoning + grounding for each decision is in the Q&A log below; this is the consolidated
picture for the design-doc-writer.

### One-paragraph shape
An OPTIONAL read-only `validator` agent is added to the self-improvement loop. After the improver's
first edit (round 0), if `config.roles.validator` is configured, an inner loop INSIDE
`runImprovement` materializes the post-edit WHOLE skills root, hands it + the FULL scenario corpus +
rubric bodies to the validator (running `role:"judge"`, identified by its system prompt — no new
provider `Role`), and parses a machine-readable `{verdict, findings}`. `approve` (or any fail-open)
breaks; `revise`-with-findings re-invokes the improver IN PLACE with the same original context plus
the findings; the validator re-reviews. The cap check sits AFTER each validation and BEFORE the next
improver invoke, so the terminal edit is always reviewed and the counts are N+1/N+1 at the cap. On
cap-without-approval the last edit is KEPT and a WARNING is logged (advisory gate, D2). With no
validator configured the path is byte-identical to today (C4/AC4). Errors/unparseable/malformed
verdicts fail open to approve, flagged in the evidence trail (R8/AC7). The validator never touches
`report.json`, the matrix, or the exit code.

### File inventory
NEW:
- `src/improvement/validator.ts` — `runValidator(params): Promise<ValidatorOutcome>` (build prompt →
  invoke `role:"judge"` → parse → write `validation-round-K.md` → return outcome). Owns the
  provider-error fail-open path (a).
- `src/improvement/validator-verdict.ts` — `classifyValidatorVerdict(finalText: string):
  ValidatorOutcome` (parse + shape + fail-open mapping; the 5-row AC2 table). Owns the
  parse/shape fail-open path (b).
- `src/improvement/read-skills-root.ts` — `readSkillsRoot(skillsRoot: string): string` (whole-root
  content read, follows md-links, skips non-skill dirs; materializes the validator's "after").
- `src/util/parse-agent-json.ts` — `parseAgentJson(finalText: string): object | undefined` (extracted
  from `parseJudgeJson`; shared by judge + validator).
- Fixtures `src/__tests__/fixtures/validator-loop-project/` (AC3) and
  `validator-loop-cap-project/` (AC5).
- Tests `validator-verdict.test.ts` (AC2), `validator-loop.test.ts` (AC3/AC5), new AC1 cases in
  config-validate/self-improvement tests.

MODIFIED:
- `src/improvement/improver.ts` — extract the single improver invoke into a private
  `invokeImprover(...)`; add the inner validate/revise loop gated by `config.roles.validator`; new
  `RunImprovementParams` fields `corpus: EnumeratedScenario[]` and `maxValidationRounds: number`.
  DEFAULT_VALIDATOR_PROMPT constant lives here or in validator.ts.
- `src/pipeline/pipeline.ts` — split the inline enumerate into `const enumerated = …` +
  `allScenarios = filterScenarios(enumerated, …)`; pass `corpus: enumerated` and
  `maxValidationRounds: selfImprovement.maxValidationRounds` into the `runImprovement` call (:193).
- `src/pipeline/judge-agent.ts` — replace private `parseJudgeJson` with an import of `parseAgentJson`
  (behavior-identical; only modification to this file).
- `src/config/types.ts` — `RolesInput`/`NormalizedRoles` `+ validator?`; `SelfImprovementConfig`
  `+ maxValidationRounds?`.
- `src/config/validate.ts` — `validateRoles` `+` optional `roles.validator` check;
  `validateSelfImprovement` `+` `maxValidationRounds` integer-≥1 check.
- `src/config/normalize.ts` — roles block `+` spread-when-present `validator`.
- `src/config/self-improvement.ts` — `ResolvedSelfImprovement`/`SelfImprovementOverrides`/`DEFAULTS`
  `+ maxValidationRounds` (default 2); `resolveSelfImprovement` clamp `Math.max(1, …)`.
- `src/providers/mock.ts` — `invokeValidator` branch in `invokeJudge`; gated add-leak/remove-leak in
  the improver branch (behind `VALIDATOR_LOOP_FIXTURE`, so `loop-project` stays byte-identical).
- `bin/skillsmith.mjs` — `--validation-rounds` flag mirroring `--iterations`.

UNCHANGED (load-bearing): `providers/types.ts` `Role` union (C5); `judge-agent.ts`'s skill-blindness
+ prompt (C1); the existing `self-improvement-loop.test.ts` (AC4); all existing config/fixtures.

### Key interfaces
```
// improvement/validator.ts
interface RunValidatorParams { agent; validatorPrompt?; skillsBlob; corpus: EnumeratedScenario[];
                               config; projectRoot; iterationDirectory; round; log }
interface ValidatorFinding { leak_type: "scenario-name"|"scenario-value"|"verbatim-copy"|"single-case";
                             span; why; suggested_fix }
interface ValidatorOutcome { verdict: "approve"|"revise"; findings: ValidatorFinding[];
                             failedOpen: boolean; transcriptPath }
function runValidator(params): Promise<ValidatorOutcome>
// improvement/validator-verdict.ts
function classifyValidatorVerdict(finalText: string): ValidatorOutcome   // 5-row AC2 table
// improvement/read-skills-root.ts
function readSkillsRoot(skillsRoot: string): string
// util/parse-agent-json.ts
function parseAgentJson(finalText: string): object | undefined
```

### Data flow (one outer failing iteration, validator configured)
pipeline (full `enumerated` corpus + `maxValidationRounds`) → `runImprovement` → `invokeImprover`
(round 0, role:"testing", writes `improvement.md`) → loop{ `readSkillsRoot` ("after") →
`runValidator` (role:"judge", corpus+rubrics+skillsBlob, NO judge reviews) → `classifyValidatorVerdict`
→ write `validation-round-K.md` → approve/fail-open break | cap break (+WARNING) | revise →
`invokeImprover`(findings) } → `afterImprove` (once, `improvementPath`=`improvement.md`) → return.
The validator's input is built ONLY from `corpus` + rubric files + `skillsBlob` — `iterationReport`/
`context.report` (which carry verbatim judge reviews) are structurally excluded from
`RunValidatorParams` (R4 answer-key guarantee).

### Error handling (fail-open, R8/AC7)
Two entry points, both set `failedOpen:true`: (a) provider error → `runValidator` short-circuits
before parse; (b) parse/shape failure → `classifyValidatorVerdict` rows 1/2/5. Both break the loop as
approve; the persisted `failedOpen` bit + a distinct log line make a chronically-broken validator
legible (distinguishes "approve (clean)" from "approve (FAILED-OPEN: …)").

### Testability (mock-driven determinism)
Sentinels in the skill text drive the mock with no real model: `LEAK_TOKEN` (validator → revise while
present), `NEVER_APPROVE` (validator → always revise, AC5 cap), `VALIDATOR_LOOP_FIXTURE` (opt-in gate
keeping `loop-project` byte-identical, AC4). Counts pinned by counting `validation-round-*.md` files
(AC3=2, AC5=3, AC4=0). AC2 is a pure-fn string table.

### Rejected alternatives (and why)
- Separate exported `runImproveValidateCycle` helper — obscures the byte-identical no-validator branch
  (Q1).
- Reusing the `snapshotWorkspace`/mtime primitive for capture — it returns paths not content; the
  validator needs content; the diff it enables is non-load-bearing (Q2).
- Threading the FILTERED `allScenarios` as the corpus — unsound breadth test under `--scenarios`;
  monotonicity proves the FULL set is strictly safer for R3a (Q3b).
- A new provider `Role: "validator"` — forces edits to every provider's exhaustive Role map; the
  validator is tool-identical to the judge (read-only) so `role:"judge"` + system-prompt identity is
  correct (C5).
- Revert-on-cap / staging — stronger than intent; D2 keeps + warns (advisory gate).
- A required deterministic pre-scan — DEFERRED to named follow-up; LLM-only v1 satisfies D5's behavior
  given the full corpus (Q5C).
- Extracting a shared rubric reader out of judge-agent.ts in v1 — kept inline in the validator to
  freeze the backward-compat-critical judge file (Q3); only the pure `parseAgentJson` is extracted
  (Q4), because that move is mechanically trivial and behavior-identical.

---

## Q&A log

### Q1 — Validator inner-loop placement & exact control flow (DECIDED)

**Decision: the inner loop lives INSIDE `runImprovement`, with the single improver invoke
extracted into a private helper `invokeImprover(...)`, gated by one
`if (config.roles.validator === undefined)` branch.** No separate exported `runImproveValidateCycle`.
This makes the no-validator byte-identity (C4/AC4) visually obvious — the property AC4 polices
hardest — while keeping the validate/revise loop in the one function that owns the improver.

**Control flow (settled pseudocode):**
```
runImprovement(params):
  // unchanged: build baseCtx, build context (buildImprovementContext), fire beforeImprove ONCE
  validatorRole = config.roles.validator          // undefined => today's path
  result = invokeImprover(ctx, findings=undefined) // ROUND 0 = first improver pass (today's invoke)

  if validatorRole === undefined:
    // ---- BYTE-IDENTICAL no-validator path (C4/AC4) ----
    write improvement.md (== improver.ts:157-162); log (== :164-168)
  else:
    // ---- validator inner loop (R6/R7/R8) ----
    write improvement.md (round-0 improver transcript)
    round = 0                                       // counts REVISE rounds taken
    while true:
      verdict = runValidator({post-edit whole skills root, corpus, rubrics})  // read-only
      write validation-round-{round}.md (the verdict)        // evidence transcript
      if verdict.kind !== "revise": break           // approve OR fail-open => break
      if round >= maxValidationRounds:              // CAP reached WITH pending findings
        log.warn("validation cap reached without approval")  // R7/D2: keep + warn, NO revert
        break
      round++
      result = invokeImprover(ctx, findings=verdict.findings)  // re-edit IN PLACE
      // (no per-revise improver transcript — SUPERSEDED by Q6: improvement.md = round 0 only,
      //  validation-round-K.md is the per-round artifact; see Q6 §3)

  // fire afterImprove ONCE here, after the loop, in BOTH paths (== improver.ts:170-176)
  return { improvementPath }
```

**Why `while (true)` with the cap check AFTER validate, BEFORE the next improver invoke:** this is
the load-bearing structural choice. It guarantees the **terminal validation** (the review of the
last, un-revised edit) always runs and its findings feed the warning — exactly AC5's "each edit,
including the final un-revised one, is reviewed." Putting the cap on a `while (round < cap)` header
would validate N times instead of N+1 and skip the terminal review — wrong for AC5.

**Round-counter ↔ AC traces (verified by both analyst and researcher, counts exact):**
- `round` = revise rounds TAKEN; `maxValidationRounds = N` = "up to N revise rounds"; round 0 is
  always the first improver pass (== today's single invoke).
- **AC3** (N=2, happy): improver#1 (MARKER+LEAK) → validate#1=`revise` → round1, improver#2 (removes
  LEAK) → validate#2=`approve` → break. = **2 improver invokes, 2 validation transcripts**, exactly
  one revise round, final skill leak-free. ✓
- **AC5** (N=2, never-approve): improver#1 → validate#1=`revise` → round1, improver#2 →
  validate#2=`revise` → round2, improver#3 → validate#3=`revise` → `round(2) >= cap(2)` → WARN +
  break. = **3 improver invokes (N+1), 3 validation transcripts (N+1)**, last edit KEPT. ✓

**`beforeImprove` / `afterImprove` fire ONCE** (not per round): the hook type carries a single
`improvementPath` (types.ts:221-224, :283-286); per-round firing would perturb the no-validator
path's observable hook behavior and has no spec basis. `beforeImprove` once before round 0;
`afterImprove` once after the loop settles.

**Transcript filenames (analyst decision, refining researcher's minimal proposal):**
- `improvement.md` = the ROUND-0 improver transcript on EVERY path. On the no-validator path this
  is byte-identical to today, so AC4's `existsSync(iteration-1/improvement.md)` assertion
  (self-improvement-loop.test.ts:81-84) holds untouched.
- `validation-round-{K}.md` (K from 0) = each validator verdict (prose + parsed). AC3/AC5 assert a
  validation transcript exists; this is it. R5 explicitly permits persisting the validator's prose
  verdict "like improvement.md."
- **SUPERSEDED by Q6 §3:** an earlier draft of this section proposed `improvement-round-{K}.md` per
  revise round. That is DROPPED — the spec (R5) only requires the validator's prose persisted, and
  the AC counts drive off `validation-round-*.md` alone (Q7.4). So the ONLY new persisted file is
  `validation-round-{K}.md`; `improvement.md` stays round-0-only on every path. See Q6 §3.
- The no-validator path writes ONLY `improvement.md` (no round suffix, no validation files) — the
  byte-identical guarantee.

**Threading (what `runImprovement` needs that it lacks today):**
- `runImprovement` is called at EXACTLY ONE site: pipeline.ts:193. The resolved `selfImprovement`
  struct is in scope there (declared pipeline.ts:84) but is NOT currently passed into the
  `runImprovement({...})` call — verified.
- **Only ONE new `RunImprovementParams` field is needed: `maxValidationRounds: number`** — pulled
  from the resolved struct (see Q5 plumbing). Cherry-pick the single field; do NOT pass the whole
  `ResolvedSelfImprovement` struct (it would couple `runImprovement` to mode/scope/finalPass it has
  no business reading).
- The validator agent + prompt are read off `config.roles.validator` INSIDE `runImprovement` (not
  passed as a param) — this is the single runtime on/off gate, mirroring how pipeline reads
  `config.roles.improver.agent/.prompt`. Corpus is derived from `allScenarios` (already passed);
  rubric text is read from `config.paths.rubrics` the same way the judge does (judge-agent.ts:95-100),
  reachable via `config` + `projectRoot` (both already in `RunImprovementParams`).

**Rejected alternative:** lifting the whole cycle into a separate exported
`runImproveValidateCycle`. Buys nothing here and obscures the byte-identical no-validator path. (A
separate helper would only pay off if the writer wants the cycle unit-testable in isolation, but
the E2E fixture AC3/AC5 already exercises it.)

### Q2 — Edit-capture: materializing post-edit skill state over the whole skills root (DECIDED)

**Decision: load-bearing = a fresh whole-skills-root CONTENT read ("after") materialized after each
improver invoke; the "before" read and the before/after diff are OPTIONAL and SKIPPED in v1.** Use a
direct content read, NOT the snapshot/mtime primitive.

**Load-bearing reader (net-new, ~15 lines):** a new module
`src/improvement/read-skills-root.ts` exporting:
```
/** Read every skill under the skills root (whole-root; follows md-links
 *  per skill via loadSkill; skips dirs without SKILL.md). Materializes the
 *  validator's post-edit "after" state. In-process, ephemeral — writes
 *  nothing, touches no git. */
export function readSkillsRoot(skillsRoot: string): string;
```
Implementation shape: `readdirSync(skillsRoot, { withFileTypes: true })` → keep dir entries that
contain a `SKILL.md` → `loadSkill(entry.name, skillsRoot)` each → concatenate. Returns the same
`=== <rel> ===` section format `loadSkill` already emits (consistent with `skillsBlob`). Caller
passes `resolve(projectRoot, config.paths.skills)` (== improver.ts:117 `skillsDir`).

**Why this captures everything the validator must see:**
- **New/unreferenced dirs:** the id list comes from the LIVE directory listing, not from
  `allScenarios` — so it captures dirs the improver created or edited that no scenario references
  (R5's blind-spot closure). `context.skillsBlob` (context.ts:63-65) is scoped to failing-scenario
  ids via `collectSkillIds` (context.ts:123-137) and is therefore NOT a valid whole-root read.
- **md-linked reference files:** `loadSkill` follows md-links inside each skill dir
  (skill-loader.ts:36-45), so reference files (e.g. `references/directives.md`, where some live
  leakage sits per spec-research §3 Q1) are reviewed.
- **Robustness guard:** `loadSkill` THROWS on a missing `SKILL.md` (skill-loader.ts:15-17), so the
  reader MUST gate each dir on `existsSync(join(skillsRoot, entry.name, "SKILL.md"))` before calling
  it — a non-skill dir (e.g. `_assets/`) is skipped, not a crash. This mirrors
  `mock.ts:applyMarkerToSkills` (mock.ts:120-122), the only existing whole-root `*/SKILL.md` walk.
  Use `isDirectorySafe` (util/fs.ts) for the dir check (the repo's EACCES/ENOENT-tolerant helper).

**Why NOT the snapshot/mtime primitive (`snapshotWorkspace`/`diffSnapshots`, testing-agent.ts:105-170):**
it returns a changed-PATH list keyed on `{mtimeMs,size}`, NOT content. The validator needs content;
the diff it would enable is explicitly "not load-bearing" (R4). So the primitive is complexity we
don't need — compose a direct content reader instead.

**Why skip the "before"/diff in v1:** R4 marks the diff "not load-bearing"; R3/R3a's discriminator
is **breadth across the corpus** ("is this string a fingerprint of exactly one scenario I can
see?"), computed from {post-edit skill, corpus, rubrics} — it needs no before/after delta. The delta
would only sharpen form-(d) single-case-answer detection and let revise feedback say "the line you
added" (R4) — nice-to-have. Skipping it means one read per round (the "after"), no top-of-function
baseline read, simpler control flow. **Named optional enhancement** for a future iteration: a sibling
`readSkillsRootMap(skillsRoot): Map<rel, content>` + a baseline read before round 0 would enable the
diff; left out of v1.

**Module-name note (analyst refinement):** name the module `read-skills-root.ts`, NOT
`skills-snapshot.ts` — "snapshot" collides with the mtime/size primitive we are deliberately NOT
using; the function reads content.

**No git, no `*.diff` — confirmed (C3, R5):** the reader is pure `fs` (`readdirSync` + `loadSkill` →
`readFileSync`), in-process, ephemeral; nothing is written to disk except the validator's PROSE
verdict transcript (`validation-round-K.md`, text like `improvement.md`, NOT a diff). The existing
assertion `!existsSync(iteration-1/skills.diff)` (self-improvement-loop.test.ts:89-92) stays green
untouched (it's on the no-validator AC4 path anyway).

### Q3 — Validator agent wiring: input assembly, system prompt, runValidator interface (DECIDED)

**`runValidator` lives in a new `src/improvement/validator.ts`** (sibling to improver.ts), mirroring
the JUDGE's "build system prompt → build user message → invoke → parse one JSON verdict" shape
(judge-agent.ts:34-88), NOT the improver's writeback shape.

**Signature:**
```
// src/improvement/validator.ts
export interface RunValidatorParams {
  agent: AgentDefinition;            // config.roles.validator.agent
  validatorPrompt?: string;          // config.roles.validator.prompt (REPLACE semantics)
  skillsBlob: string;                // the readSkillsRoot(skillsDir) "after" from Q2 (caller reads)
  allScenarios: EnumeratedScenario[];// corpus source — see corpus-scope decision in Q3b
  config: SkillsmithConfig;          // for paths.rubrics
  projectRoot: string;               // for resolving rubricsRoot
  iterationDirectory: string;        // transcript dir
  round: number;                     // transcript filename suffix
  log: RunLog;
}
export interface ValidatorFinding {
  leak_type: "scenario-name" | "scenario-value" | "verbatim-copy" | "single-case";
  span: string; why: string; suggested_fix: string;
}
export interface ValidatorOutcome {
  verdict: "approve" | "revise";
  findings: ValidatorFinding[];      // empty on approve
  failedOpen: boolean;               // true when error/unparseable/malformed forced approve (R8 evidence)
  transcriptPath: string;
}
export async function runValidator(params: RunValidatorParams): Promise<ValidatorOutcome>;
```
- **`failedOpen`** is the R8 evidence bit — lets the loop/transcript distinguish "validator said
  approve" from "validator failed → treated as approve." The verdict parser (Q4) sets it.
- **`cwd = resolve(projectRoot, config.paths.skills)`** (the skills root, == improver.ts:117). `cwd`
  is a REQUIRED `InvokeParams` field (types.ts:18-24), so something valid must be passed; the skills
  root is the validator's subject and the least-surprising read-only anchor. The mock's judge branch
  never touches `cwd` (mock.ts:96-107), so it's inert in tests; for real providers it's the
  read-only sandbox anchor.
- **Caller reads, passes blob** (`skillsBlob` not `skillsDir`): keeps the per-round read boundary in
  the loop body where the AC3/AC5 counts live. (Self-contained `runValidator(skillsDir)` is viable
  latitude, but caller-reads is cleaner here.)

**Corpus assembly (R4):**
- The corpus = each scenario's `{name, description, prompt, acceptance}` + the rubric BODIES. Source
  is `EnumeratedScenario[]` (`scenario.{name,description,prompt,acceptance,rubrics}`, types.ts:123-131).
  `_candidates.yaml` is excluded by construction (enumerate.ts only opens files named
  `scenario.yaml`, enumerate.ts:36).
- **Error'd scenarios:** INCLUDE non-stub scenarios (unresolved-ref errors still carry a fully-parsed
  prompt/acceptance — legitimate fingerprints), SKIP stubs (parse/shape errors → empty
  prompt/acceptance, contribute nothing). Low-stakes (live testing-project has none; moot for the AC
  suite).
- **Rubric text: union of rubric ids referenced across the corpus, deduped** —
  `new Set(corpus.flatMap(s => s.rubrics))`, each read as `paths.rubrics/<id>.md` with the judge's
  `existsSync ? readFileSync : "TO BE FILLED"` fallback (judge-agent.ts:95-100). Reading ALL `*.md`
  under `paths.rubrics` would over-include rubrics for inactive scenarios — wrong scope.
- **Rubric reader (analyst decision): INLINE the 4-line read in the validator; do NOT factor a shared
  helper out of judge-agent.ts in v1.** Rationale: C1 makes the judge a backward-compat-critical
  surface and AC1 asserts "existing roles-triple tests pass UNCHANGED"; touching judge-agent.ts to
  extract a shared `readRubric` risks that proof for a pure-cleanup gain. Name the extraction
  (`src/scenarios/rubric-loader.ts`, sibling to skill-loader.ts) as OPTIONAL future cleanup. (The
  researcher leaned extract; analyst overrides toward minimal blast radius given C1.)

**The answer-key exclusion (R4) — structural guarantee:** the trap is that `runImprovement` IS handed
`iterationReport`, and `buildImprovementContext` projects it into `context.report` which preserves
every judge's verbatim `review` (context.ts:97-121). **The validator MUST NOT receive
`iterationReport`, `context.report`, or `context.skillsBlob`.** `RunValidatorParams` deliberately
EXCLUDES all of them — the validator literally cannot see the answer key because it isn't passed it.
Its input is built only from `allScenarios` (raw scenarios, no graded results) + rubric files +
`skillsBlob`. Testing-agent produced files live in per-agent workspaces and are never read by the
validator.

**Validator system prompt:**
- **Identity sentinel: `"You are the validator agent in the skillsmith self-improvement loop."`**
  (mirrors improver.ts:124). The mock branches on `systemPrompt.includes("validator agent")`.
  False-match guard (verified): the validator runs `role:"judge"` → takes `invokeJudge` (mock.ts:53),
  never the `role:"testing"` path where `includes("improver agent")` is checked (mock.ts:61) — so no
  collision. Belt-and-suspenders: DEFAULT_VALIDATOR_PROMPT must NOT contain the literal 2-word
  sequence `"improver agent"`. The mock's validator branch goes INSIDE `invokeJudge` (mock.ts:96),
  keyed on the sentinel, checked before the generic judge PASS/FAIL fallthrough.
- **Precedence: REPLACE (mirror the IMPROVER), not append.** Exact guard:
  `validatorPrompt !== undefined && validatorPrompt.length > 0 ? validatorPrompt :
  DEFAULT_VALIDATOR_PROMPT` (identical to improver.ts:118-121). Rationale: the built-in encodes the
  ENTIRE anti-leakage contract (R2/R3/R3a/R9); appending a project prompt would risk a project
  diluting the verdict-format contract. (Judge/test APPEND as "# Role instructions" — the validator
  does NOT follow that pattern.) Footgun (doc note, not code): a project that overrides the prompt
  must keep the JSON schema + the "validator agent" sentinel — same footgun the improver's replace
  already ships.
- **DEFAULT_VALIDATOR_PROMPT section outline** (structure; full prose is the writer's job):
  1. Identity + mandate — EDIT QUALITY (generality/anti-leakage), NOT correctness (R2); correctness
     stays with the scenario judge next sweep.
  2. The four leak types (R2 a–d), named with the enum spelling: `scenario-name`, `scenario-value`,
     `verbatim-copy`, `single-case`.
  3. The bright line (R3) — leakage = identifies a SPECIFIC scenario; domain = API surface recurring
     across scenarios (breadth ≥ 2) MUST pass clean; "specificity-to-one-scenario is the bright
     line"; do NOT anchor on "appears in the rubric."
  4. Two-prong AND + precision bias (R3/R3a) — flag ONLY when BOTH (i) scenario-specific AND (ii)
     not-necessary-to-teach; either fails → APPROVE; uncertain → APPROVE; zero-or-≥2-scenarios MUST
     pass clean; state the harm asymmetry (false-positive waters down guidance; false-negative caught
     at PR review).
  5. What you see — post-edit whole skill, corpus (name/description/prompt/acceptance), rubric texts.
  6. Output format (R9) — the exact verdict JSON, findings required-&-non-empty on revise / empty on
     approve, `span` = actual offending substring, strict JSON, no prose/fences (mirror
     judge-agent.ts:126-127).
  7. Recursion guard — "Do not invoke `skillsmith`…" (copy improver.ts:130-132 / judge-agent.ts:129-131).
- **User message** (data, separate from system prompt): `# Post-edit skill` + skillsBlob;
  `# Active scenario corpus` + per-scenario {name/description/prompt/acceptance}; `# Rubrics` + rubric
  bodies. Instructions in system prompt, data in user message (mirrors judge + improver).

### Q3b — Validator corpus = FULL enumerated set (pre-`--scenarios` filter) (DECIDED, spec-constrained)

**Decision: the validator's corpus is the FULL enumerated scenario set
(`enumerateScenarios(config.paths, projectRoot)`, BEFORE the `--scenarios` filter), independent of
which scenarios this run is evaluating.** This is spec-constrained (R3/R3a/C2), NOT latitude — the
breadth discriminator is unsound on a narrowed set.

**The problem:** `allScenarios` threaded to `runImprovement` (pipeline.ts:205) is
`filterScenarios(enumerateScenarios(...), params.scenarios)` (pipeline.ts:85-88) — i.e. the
`--scenarios`-FILTERED set. R3's breadth test ("a literal appearing in EXACTLY ONE active scenario")
is only sound against the whole corpus. On a `--scenarios`-narrowed run (e.g. one scenario), every
literal looks unique-to-one → fabricated FALSE POSITIVES — exactly the harm R3a forbids. The
unfiltered set is NOT retained anywhere today (the `enumerateScenarios(...)` result is an inline arg
to `filterScenarios`, consumed and discarded; verified no in-scope variable holds it at the
runImprovement call site).

**Monotonicity proof the full set is STRICTLY safer (key result):** a literal's breadth count (how
many scenarios contain it) is monotonic in corpus size — adding scenarios can only INCREASE a count,
never decrease it. R3 flags only breadth==1 literals (prong i). A literal that is breadth==1 in the
full set is breadth==1 in any subset containing it, so the full set never INTRODUCES a flag the
filtered set wouldn't. Conversely, a literal that is breadth≥2 in the full set can appear breadth==1
in a filtered subset (the other scenarios were filtered out) → the filtered set FABRICATES false
positives the full set wouldn't. Therefore false-positive count(full) ≤ count(filtered), ALWAYS.
There is no case where the filtered set yields fewer false positives. The full corpus only ever ADDS
breadth evidence, which only ever DEMOTES flags.

**Spec grounding:** Corpus = "the enumerated `*/scenario.yaml` set" (Key terms, spec.md:45-48) — the
project's on-disk set, not a run's subset. C2 (spec.md:198-201): the breadth test "is what makes
small-corpus operation work" — it is only meaningful against the full enumerated set. `--scenarios`
(runner.ts:9/36) is an operator run-subset knob, orthogonal to leakage detection; it must never
change WHETHER something is leakage, only which skills the improver edits this run.

**Threading (option i — recommended, chosen):** at pipeline.ts:85-88, extract the inline call into a
named const:
```
const enumerated = enumerateScenarios(config.paths, projectRoot);   // FULL corpus
const allScenarios = filterScenarios(enumerated, params.scenarios); // run subset (improver path)
```
Thread `enumerated` into the `runImprovement` call (pipeline.ts:193) as a new field (e.g. `corpus`);
`runImprovement` passes it to `runValidator`. The improver's failing-scenario context keeps using the
filtered `allScenarios` (correct — it edits the run's failing skills). So `RunValidatorParams`'s
corpus field is named `corpus` (the full set), distinct from the improver's `allScenarios`.

**Rejected:** (ii) re-enumerate inside `runValidator` — wasteful re-walk on every validator invoke
(up to N+1 per iteration) and hides the decision inside the validator instead of at the threading
boundary. (iii) use the filtered set — violates R3a under the common `--scenarios` workflow;
rejected.

**Net new threading:** one named-const split at pipeline.ts:85-88; one new `corpus:
EnumeratedScenario[]` field on `RunImprovementParams` set at the :193 call; `runImprovement` forwards
it to `runValidator`. (This is SEPARATE from the `maxValidationRounds` field from Q1 — two new
`RunImprovementParams` fields total: `corpus` and `maxValidationRounds`.)

### Q4 — Verdict parse/shape + fail-open mapping (DECIDED)

**(1) JSON-extraction helper: EXTRACT (Option A).** Lift `parseJudgeJson`'s body
(judge-agent.ts:141-153) into `src/util/parse-agent-json.ts` as
`parseAgentJson(finalText: string): object | undefined`; judge-agent.ts imports it and deletes its
private copy; the validator imports it too.
- The lift is purely mechanical and byte-identical: `parseJudgeJson` is entirely judge-agnostic
  (takes a string, strips ONE leading/trailing ```-fence via
  `/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/`, `JSON.parse`, returns `undefined` on throw or non-object).
  It does NOT validate the judge's `{rubrics, acceptance}` shape — that lives downstream in
  `classifyVerdict` (reports/verdict.ts). Zero judge-concept coupling.
- **Why this does NOT threaten C1/AC1** (and why this is a different call than the rubric reader,
  which I kept inline): C1 is judge SKILL-BLINDNESS (enforced by the judge's prompt + what it's
  shown, judge-agent.ts:111 — untouched by a parse-helper move). AC1's "unchanged" tests are the
  CONFIG-validation roles-triple tests (config-validate.test.ts / self-improvement.test.ts) — they
  exercise the config layer, NOT judge-agent.ts's parse path, and cannot observe where `parseJudgeJson`
  lives. The judge's behavior for any input is identical (same body, now via import). The rubric
  reader stayed inline because extracting it restructured the judge's prompt-BUILDING flow; this is a
  self-contained pure function with no such entanglement, so DRY wins.
- (Latitude acknowledged: a validator-private copy — Option B, judge frozen — is also correct, ~10
  duplicated stable lines. Analyst chose A because the move is mechanically trivial and
  behavior-preserving, and the shared helper improves both call sites.)

**(2) The testable classify unit: `classifyValidatorVerdict(finalText: string): ValidatorOutcome`** —
takes the raw STRING and owns BOTH extraction (`parseAgentJson`) and shape-check, so AC2's
string-level rows (non-JSON, fenced JSON) are coverable in one pure-function table. Lives in a new
`src/improvement/validator-verdict.ts` (separate pure module, mirrors the verdict.ts/verdict.test.ts
split); pinned by new `validator-verdict.test.ts` (AC2). NOTE this differs from `classifyVerdict`
(reports/verdict.ts), which takes an already-PARSED object — the judge's parse and classify are split
across two files; for the validator they are FOLDED so AC2 can feed strings.

**Complete decision table (THIS IS AC2 — verified complete against R8 + AC2):**

| # | Input | Result | failedOpen |
|---|---|---|---|
| 1 | `parseAgentJson` → `undefined` (non-JSON / unparseable) | `{verdict:"approve", findings:[]}` | **true** |
| 2 | parsed, `verdict ∉ {"approve","revise"}` (missing/typo/wrong type) | `{verdict:"approve", findings:[]}` | **true** |
| 3 | `verdict:"approve"` (findings absent or empty) | `{verdict:"approve", findings:[]}` | false |
| 4 | `verdict:"revise"` + non-empty well-shaped findings | `{verdict:"revise", findings:[...]}` | false |
| 5 | `verdict:"revise"` + empty/absent findings (malformed) | `{verdict:"approve", findings:[]}` | **true** |

- Completeness argument: parses or not (1 vs 2-5); if parses, verdict in-enum or not (2 vs 3-5); if
  in-enum, approve (3) or revise (4-5); revise has non-empty findings (4) or not (5). No gap.
- Maps to R8: row 1 = "won't parse → approve"; row 5 = "revise but findings empty/absent → malformed
  → fail-open"; row 4 = "ONLY parseable revise with non-empty findings triggers a revise round" (the
  sole non-approve outcome). Maps to AC2's six cases (approve/revise/fenced parse; empty-findings,
  invalid-verdict, non-JSON → fail-open). Fenced JSON is handled inside `parseAgentJson` and is
  orthogonal to the row (a fenced approve → row 3, fenced revise → row 4).
- **Row-4 finding-shape strictness: LENIENT (analyst decision, per R3a spirit).** Row 4 requires
  `verdict:"revise"` AND `findings` is a non-empty array (optionally: first finding has a string
  `span`). Do NOT fail-open merely because one finding lacks `suggested_fix` — over-strictness wastes
  the revise signal and burns rounds. AC2's malformed case is specifically EMPTY/ABSENT findings
  (row 5), not a missing sub-field.
- **findings normalization:** on every approve outcome (rows 1,2,3,5) emit canonical `findings:[]`
  even if raw JSON carried stray findings on an approve — keeps the loop's `verdict.kind !==
  "revise"` break (Q1) clean.

**(3) Two fail-open entry points, BOTH set `failedOpen:true`** (mirrors the judge's two degradation
paths, judge-agent.ts:69-75 and :77-84):
- **(a) Provider error → handled in `runValidator`, BEFORE parsing.** After `provider.invoke`, if
  `result.error !== undefined`: do NOT call `classifyValidatorVerdict` (finalText is meaningless) —
  short-circuit to `{verdict:"approve", findings:[], failedOpen:true}`, log "validator dispatch
  failed → treated as approve," write transcript. (R8: "provider error → log, treat as approve, exit
  inner loop.")
- **(b) Parse/shape failure → handled in `classifyValidatorVerdict`** (rows 1/2/5), only on a
  successful invoke (`result.error === undefined`).

`runValidator` tail:
```
const result = await provider.invoke({ ..., role: "judge" });
let outcome: ValidatorOutcome;
if (result.error !== undefined) {
  outcome = { verdict: "approve", findings: [], failedOpen: true };   // (a)
  log.info("validator dispatch failed → treated as approve");
} else {
  outcome = classifyValidatorVerdict(result.finalText);              // (b) rows 1-5
}
writeValidationTranscript(iterationDirectory, round, result, outcome); // persists verdict + failedOpen
return outcome;
```

**Why both set `failedOpen:true` (R8 last paragraph / AC7):** approve and fail-open-approve BOTH
break the loop identically, so without the flag a chronically-broken validator looks like a string of
clean approvals. The persisted `failedOpen` bit is what makes "approved 5× in a row because it kept
erroring" legible to a human reviewer. Transcript should render it prominently:
`VALIDATOR: approve (clean)` vs `VALIDATOR: approve (FAILED-OPEN: <reason>)` where reason is
"provider error: <err>" (path a) or "verdict unparseable" / "revise without findings" / "invalid
verdict value" (path b). See Q6 for the evidence-trail details.

### Q5 — Config plumbing (roles.validator + maxValidationRounds + CLI) and D5 pre-scan (DECIDED)

**(A) `roles.validator` wiring (AC1) — additive, backward-compatible, all confirmed:**
- **types.ts:** `RolesInput` (50-54) `+ validator?: SingleRoleInput`; `NormalizedRoles` (69-73)
  `+ validator?: { agent: AgentDefinition; prompt?: string }`. The `?` is load-bearing — it makes
  "config WITHOUT validator validates" hold at the type level. Role UNION (providers/types.ts:16)
  UNCHANGED (C5).
- **validate.ts:** in `validateRoles` (after :100): `if (roles.validator !== undefined)
  validateSingleRole(roles.validator, "roles.validator", agentIds, errors);` — reuses
  `validateSingleRole` (139-175) as-is. The `!== undefined` guard means validator-absent → line
  skipped → zero new errors → existing triple-only configs validate exactly as before (same
  optional-by-guard idiom `validateSelfImprovement` already uses at :182). Leave the top-level
  "roles must be object with test/judge/improver" message (validate.ts:94) AS-IS — it lists the
  REQUIRED roles; validator is optional (latitude, either fine).
- **normalize.ts:** in the roles block (after :38): `...(input.roles.validator !== undefined ?
  { validator: normalizeSingleRole(input.roles.validator, agents) } : {})` — the EXACT
  spread-when-present idiom already used for `selfImprovement`/`hooks` (:47-50). Absent → no
  `validator` key on `NormalizedRoles` → `config.roles.validator === undefined` is the Q1 runtime
  gate.
- **AC1 tests** (new, mirroring the improver cases at self-improvement.test.ts:171-186): (a)
  string-shorthand validator validates; (a') ADD an object-form `{agent, prompt}` valid case (the
  spec lists both forms, AC1); (b) unknown-agent rejected — `validateSingleRole` already emits
  `roles.validator references unknown agent "<id>"` (validate.ts:156-158/169-170); (c)
  non-string-prompt rejected — emits `roles.validator.prompt must be a string` (validate.ts:172-174);
  (d) config WITHOUT validator still validates AND existing triple tests UNCHANGED. New tests just
  assert `errors.some(e => e.includes("roles.validator"))`.

**(B) `maxValidationRounds` (R7) — mirrors `maxIterations` exactly:**
- **types.ts:** `SelfImprovementConfig` (81-85) `+ maxValidationRounds?: number`.
- **self-improvement.ts:** `ResolvedSelfImprovement` (3-8) `+ maxValidationRounds: number`;
  `SelfImprovementOverrides` (10-15) `+ maxValidationRounds?: number`; `DEFAULTS` (17-25)
  `+ maxValidationRounds: 2` (extend the `Pick<...>` key union at :18-19);
  `resolveSelfImprovement` return `+ maxValidationRounds: Math.max(1, overrides.maxValidationRounds
  ?? cfg.maxValidationRounds ?? DEFAULTS.maxValidationRounds)`. **Clamp `Math.max(1, …)`** — a
  configured `0` clamps to `1` (one revise round), it does NOT disable the validator; on/off is
  governed solely by `roles.validator` presence (R7/C4).
- **validate.ts:** `validateSelfImprovement` (177-204) `+` a `maxValidationRounds` integer-≥1 block
  mirroring maxIterations (188-194), `!== undefined`-guarded.
- **CLI override chain — REAL end-to-end (traced):** `bin/skillsmith.mjs` (`parseArgs`, builds
  `overrides`) → `run({overrides})` (runner.ts:29/37, `RunOptions.overrides`) → `runPipeline`
  (pipeline.ts:51) → `resolveSelfImprovement(config, params.overrides)` (pipeline.ts:84).
  `params.overrides` originates ONLY from the CLI shim and the programmatic `run({overrides})` API.
  `maxIterations` plugs in via the `--iterations` flag (bin: option decl + parse/validate/assign,
  the `Number.parseInt` + `< 1` guard block).
- **Decision: ADD a `--validation-rounds` CLI flag** (parity — R7 says "same shape and precedence as
  maxIterations," and maxIterations HAS a CLI flag). Concretely in `bin/skillsmith.mjs`: add
  `"validation-rounds": { type: "string" }` to the `parseArgs` options; add a parse/validate/assign
  block mirroring `--iterations` (`Number.parseInt`, `< 1` → error+exit, else
  `overrides.maxValidationRounds = n`); update the usage string. Honest note: `bin/skillsmith.mjs`
  is a thin untested parseArgs shim; the tested link is the `resolveSelfImprovement` precedence
  (`??`-chain), pinned by a new case in self-improvement.test.ts's existing default/config/override
  triple (:84-105). So the flag is an obvious mirror of `--iterations`; correctness rides on the
  tested resolve chain.

**(C) D5 — DEFER the deterministic pre-scan; v1 = LLM validator only (DECIDED).**
- The spec EXPLICITLY permits this: D5 makes the LLM validator REQUIRED and the pre-scan "a
  recommended-but-OPTIONAL accelerator left to the design phase"; Out-of-scope lists "A required
  deterministic pre-scan" as NOT a requirement. Deferring is squarely within the spec's grant.
- **No AC becomes unsatisfiable.** AC1/AC2/AC3/AC5/AC7 don't touch the pre-scan. AC6 is written to
  degrade gracefully (spec.md:317-319): with a mock validator, AC6 verifies "the loop accepts an
  approve verdict (converges without a revise round)" — it does NOT exercise a model's breadth-rule
  judgment either way. The pre-scan's ABSENCE only forgoes one optional `leakage-scan.test.ts` unit
  pinning the breadth rule deterministically; it weakens no other AC.
- **LLM-only satisfies D5's *behavior* requirement for forms a–c.** Given the FULL corpus (Q3b) +
  rubrics + post-edit whole skill, the LLM can in principle catch a (scenario name in skill), b
  (literal unique to one corpus scenario), and c (verbatim acceptance/rubric span) — it is shown both
  sides to compare. D5 requires the behavior, not the mechanism.
- **Honest caveat to state in the design:** without the pre-scan, a–c detection reliability rides on
  the model (same as form d) — consistent with C6/intent ("legible floor-raiser, not a guarantee").
  The pre-scan would have raised the deterministic floor on a–c + added explainability; deferring
  trades that for a tighter v1 blast radius. The pre-scan also carries its OWN false-positive risk
  (a deterministic matcher wired as a "strong prior" can nudge the LLM toward false positives — the
  R3a harm); building it correctly (surfaced-evidence-only, NEVER auto-rejecting on string match) is
  more surface than the loop itself.
- **v1 ships:** the LLM validator (DEFAULT_VALIDATOR_PROMPT encoding the breadth rule + two-prong AND
  + precision bias), the loop, the config, parse/verdict helpers, the mock wiring, and AC1-5/7 + the
  must-approve fixture for AC6's loop-approves-on-approve. The design doc NAMES the deterministic
  pre-scan (RULES 1-3 over a–c, surfaced-evidence-only never-gating, with its `leakage-scan.test.ts`)
  as explicit, scoped follow-up.

### Q6 — Evidence trail (DECIDED)

**1. Cap warning (R7/AC5): `log.info("validation cap reached without approval")`.** `RunLog` is
INFO-ONLY (surface: `header`/`section`/`info`/`hook`/`gap`, run-log.ts:29-55 — NO `warn` level). The
warning is a stable literal via `log.info`; for legibility use the literal
`"WARNING: validation cap reached without approval"` and have AC5 grep that token. **Where it lands:**
`runImprovement` receives the iteration's `RunLog` (`outcome.log`, passed at pipeline.ts:206); every
`log.info` accumulates in that RunLog and is dumped to **`${iterationDirectory}/run.log`** via
`log.dump` (run-log.ts:57-62), called after the improver in `fireAfterIteration` (pipeline.ts:445,
which runs after the `runImprovement` call at :193). So AC5 reads
`iteration-1/run.log` and asserts `.includes("validation cap reached without approval")`. (RunLog
dumps to the file regardless of `mirrorStderr`, so the test can suppress console and still grep the
file — mirrors self-improvement-loop.test.ts:36-37.)

**2. The validator NEVER touches `report.json` / the pass-fail matrix / the exit code (C6 advisory).**
`report.json` is exclusively the scenario judge's matrix (built by `aggregateIterationReport` /
`writeRunReport` from per-scenario reports, iteration-report.ts; the per-scenario reports are
aggregated from the judge verdicts + verification hook, scenario-report.ts:46-69 — the validator
writes none of these). Exit code = `allPass ? 0 : 1` from the merged scenario matrix (summary.ts:76),
invisible to validator approve/revise. **Advisory = the validator's verdict flows ONLY into
`validation-round-K.md` + log lines, never into a `ScenarioReport` cell.** AC5's "run still proceeds
to an exit code" is the normal exit path: the scenario that triggered improvement either still fails
next sweep (→ exit 1) or passes (→ 0); the validator caps/warns but does not change exit semantics.
AC5 should assert the run RETURNS a number (no hang), NOT a specific value (don't couple AC5 to
scenario design) — unless the cap fixture's scenario is deliberately designed to stay failing (then 1
is assertable).

**3. Transcript artifacts — no collisions, write mirrors improvement.md, hook contract unchanged:**
- New file: `validation-round-{K}.md` (K from 0) per validator verdict.
  `writeFileSync(join(iterationDirectory, \`validation-round-${round}.md\`), body)` — same pattern as
  improver.ts:157-162. Body leads with the `failedOpen`-prominent header (Q4):
  `VALIDATOR round K: approve|revise (clean | FAILED-OPEN: <reason>)` then findings/raw.
- **Simplification (analyst, adopting researcher's refinement): DROP `improvement-round-K.md`.** The
  spec (R5) only requires the validator's PROSE verdict be persisted; per-revise improver transcripts
  are not required and the AC counts drive off `validation-round-*.md` alone (Q7.4). So the ONLY new
  persisted files are `validation-round-{K}.md`. `improvement.md` stays the ROUND-0 improver
  transcript on every path (revising Q1's transcript-naming decision: there is no
  `improvement-round-K.md`). This keeps the new-artifact surface minimal and AC4's byte-identical
  no-validator path trivially clean.
- No collision with existing iteration-dir names (`improvement.md`, `report.json`, `summary.txt`,
  `run.log`, per-scenario subdirs). `afterImprove`'s `improvementPath` stays the round-0
  `improvement.md` → `ImproveHookContext` (types.ts:221-224) UNCHANGED; the validation transcripts are
  separate files the hook never references.

### Q7 — Testability: mock + fixtures + AC test shapes (DECIDED)

**1. Mock validator branch (mock.ts).** Inside `invokeJudge` (mock.ts:96), add — BEFORE the generic
judge PASS/FAIL fallthrough — a branch keyed on `params.systemPrompt.includes("validator agent")`
(safe: validator runs `role:"judge"` → never the `role:"testing"` improver-branch). The verdict is
keyed off the post-edit skill, which the validator SEES via the user prompt's skillsBlob (Q3) — so
the mock checks `params.prompt.includes("LEAK_TOKEN")`:
```
function invokeValidator(params): InvokeResult {
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
(row 4) / `approve` (row 3). **Cap control = a `NEVER_APPROVE` sentinel in the skill text** (surfaced
in the skillsBlob) — cleanest because the mock has access only to `InvokeParams`, not config
(consistent with how MOCK_GATE/MARKER already work, mock.ts:19-20).

**2. Mock improver revise behavior (mock.ts), gated to keep AC4 byte-identical.** Inside the existing
`invokeTesting` improver branch (`systemPrompt.includes("improver agent")`, mock.ts:61), gate the new
behavior on an opt-in marker `VALIDATOR_LOOP_FIXTURE` (present only in the validator-loop fixtures'
skill/report) so the existing `loop-project` keeps hitting the UNCHANGED `applyMarkerToSkills` path:
```
if (systemPrompt.includes("improver agent")) {
  if (prompt.includes("VALIDATOR_LOOP_FIXTURE")) {
    const isReviseRound = prompt.includes("LEAK_TOKEN");   // findings name it; absent on round 0
    if (isReviseRound) return removeLeakTokenFromSkills(cwd);   // revise: strip LEAK_TOKEN
    return applyMarkerAndLeakToSkills(cwd);                     // round 0: add MARKER + LEAK_TOKEN
  }
  return applyMarkerToSkills(cwd);   // UNCHANGED no-validator path (AC4)
}
```
- **Revise-vs-round-0 detection = `prompt.includes("LEAK_TOKEN")`**: on revise, the validator's
  findings (appended to the improver's user prompt by `invokeImprover`, Q1) name LEAK_TOKEN; on round
  0 there are no findings and the failing skill does not yet contain LEAK_TOKEN (the improver is about
  to ADD it). **Fixture constraint (analyst note):** no scenario prompt/acceptance or rubric in the
  validator-loop fixtures may contain the literal `LEAK_TOKEN` — otherwise it would appear in the
  round-0 improver prompt (via the report/corpus) and falsely trip the revise branch. Keep the token
  out of the corpus text.
- The `VALIDATOR_LOOP_FIXTURE` opt-in marker is the AC4 guarantee: `loop-project`'s improver prompt
  lacks it → unchanged `applyMarkerToSkills` → `self-improvement-loop.test.ts` byte-identical, no
  `validation-round-*.md` written.

**3. Fixtures: TWO of them** (each a self-contained mirror of `loop-project/`, each with a
PRISTINE_SKILL reset like self-improvement-loop.test.ts:34/46):
- `fixtures/validator-loop-project/` (AC3 converge): config adds `roles.validator: "checker"` + a
  `checker` mock agent + `selfImprovement.maxValidationRounds: 2`; pristine `skills/wp-foo/SKILL.md`
  carries `MOCK_GATE` + `VALIDATOR_LOOP_FIXTURE` but NOT MARKER/LEAK_TOKEN (improver adds those).
- `fixtures/validator-loop-cap-project/` (AC5 never-approve): same, plus `NEVER_APPROVE` in the
  pristine skill so the mock validator never approves.
- Two fixtures over one-parameterized: lower shared-state risk, mirrors `loop-project`'s
  self-contained shape, each test owns its pristine reset. (One-fixture-with-in-test-mutation is
  viable latitude but more fragile.)

**4. AC assertions + the file-count approach:** count `validation-round-*.md` by filename regex
(`/^validation-round-\d+\.md$/`) in `iteration-1/` — this pins BOTH the validation-transcript count
AND the improver-invoke count (equal by the validate-after-every-edit loop structure, Q1):
- **AC3** (converge, N=2): exactly **2** `validation-round-*.md` (round-1 revise + round-2 approve);
  `existsSync(iteration-1/validation-round-1.md)` ("validator ran"); exactly one revise round (= 2
  transcripts, or read round-1=revise/round-2=approve); final skill `!includes("LEAK_TOKEN")`; exit 0.
- **AC4** (backward-compat): `self-improvement-loop.test.ts` UNTOUCHED; running `loop-project` writes
  ZERO `validation-round-*.md` (validator never runs), `improvement.md` byte-identical, existing
  asserts hold. Strongest proof = the test file is not edited.
- **AC5** (cap, N=2, never-approve): exactly **3** `validation-round-*.md` (each edit incl. the final
  un-revised one reviewed); `iteration-1/run.log` includes the WARNING literal; last edit KEPT (assert
  the skill reflects the last improver edit, not a revert); run RETURNS a number (no hang).
- **AC2** (`validator-verdict.test.ts`): pure-fn string table over `classifyValidatorVerdict` (Q4
  5-row table) — no mock/fixture needed.
- **AC1** (config-validate / self-improvement.test.ts): the role-validation cases from Q5(A).
- **AC6**: the must-approve loop-approves-on-approve behavior — the `validator-loop-project` fixture
  with the validator returning `approve` (no LEAK present) converges with zero revise rounds (the
  deterministic portion); the real breadth-rule judgment is the design-reference real-model check, not
  this suite (pre-scan deferred, Q5C).
