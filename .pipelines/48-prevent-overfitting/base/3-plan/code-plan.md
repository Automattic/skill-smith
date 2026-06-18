# Code plan — Stop the self-improvement loop from overfitting skills to eval scenarios (#48)

This plan decomposes the approved design doc (`.../base/2-design-doc/design-doc.md`) into an
ordered set of discrete, independently-implementable tasks. Each task is implemented by a fresh
code-writer with TDD on the shared pipeline branch `worktree-48-prevent-overfitting`. Tasks are
ordered so dependencies come first; later tasks build on the symbols earlier tasks export. The
design doc is the source of truth for every signature, section (§), and rule cited below — a
code-writer should not need to reopen the spec, but every task lists the spec ACs / requirements it
traces to.

**Settled decisions a code-writer must NOT reopen** (carried from spec + design): D2 advisory gate
(keep-and-warn on cap, no revert); D5 (LLM validator required, deterministic pre-scan DEFERRED — v1
is LLM-validator-only, §8.4); full-corpus input (§4.3); fail-open (§7); backward-compat
byte-identity (C4/AC4 — `self-improvement-loop.test.ts` and `loop-project/` stay UNTOUCHED); validator
reuses `role:"judge"` (C5 — do NOT extend the `Role` union in `providers/types.ts:16`).

**Guardrails every task's commit must keep green** (project `check`): typecheck, lint (biome),
tests (`node --test`), config-smoke, changeset-format. Most tasks are net-additive and keep all
existing tests passing; the byte-identity tasks (T1, T8, T11) are where regressions would surface.
A single changeset covers the whole feature — see **T14**.

**Conventions used below.** "Files" lists exact paths. Line numbers are as verified at design time;
treat them as anchors, re-confirm before editing. "Traces to" cites spec ACs (AC1–AC7), spec
requirements (R1–R9), spec constraints (C1–C6), and design sections (§).

---

## Task graph (dependency order)

```
T1  parseAgentJson extraction (shared JSON helper)         → no deps
T2  config types (RolesInput/NormalizedRoles/SelfImprovementConfig)  → no deps
T3  config validate (roles.validator + maxValidationRounds) → T2
T4  config normalize (validator spread-when-present)        → T2
T5  resolveSelfImprovement (maxValidationRounds clamp/default) → T2
T6  AC1 config tests (roles.validator + resolve case)       → T3, T4, T5
T7  classifyValidatorVerdict + AC2 test                     → T1
T8  readSkillsRoot reader                                   → no deps
T9  runValidator agent (+ DEFAULT_VALIDATOR_PROMPT)         → T1, T7, T8, T2
T10 improver.ts: invokeImprover extraction + inner loop     → T5, T8, T9, T2
T11 pipeline.ts: enumerated corpus threading                → T2, T10, T5
T12 mock.ts: validator branch + gated improver leak behavior → (independent of T9/T10 internals; needs sentinels)
T13 fixtures + AC3/AC5/AC6 E2E loop tests                   → T10, T11, T12
T14 CLI flag (--validation-rounds) + changeset              → T5
```

T1–T9 are leaf/near-leaf and may be implemented in any order consistent with their `Depends on`.
T10 and T11 are the integration spine; T12 and T13 are the E2E proof; T14 is the surface + release
bookkeeping. T12 can be written before or after T10/T11 (it only depends on the agreed sentinels and
prompt identity strings), but its E2E payoff is only realized once T10/T11/T13 land — keep T13 after
all three.

---

## T1 — Extract `parseAgentJson` (shared fenced/bare-JSON helper)

**Goal.** Lift the judge's private `parseJudgeJson` into a shared, judge-agnostic pure function the
validator can reuse, with the judge importing it (byte-identical behavior).

**Files.**
- NEW `src/util/parse-agent-json.ts`
- MODIFY `src/pipeline/judge-agent.ts` (replace local `parseJudgeJson`, add import)
- NEW `src/__tests__/parse-agent-json.test.ts` (small unit, optional-but-recommended)

**Changes.**
- Create `parseAgentJson(finalText: string): object | undefined` by lifting the body of
  `parseJudgeJson` (`judge-agent.ts:141-153`) **verbatim**: trim; strip ONE leading/trailing
  fence via `/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/`; `JSON.parse`; return `undefined` on throw or
  on a `null`/non-object result. It MUST stay judge-agnostic — it does NOT validate the judge's
  `{rubrics, acceptance}` shape (§7.1).
- In `judge-agent.ts`: delete the local `parseJudgeJson` (`:141-153`), add
  `import { parseAgentJson } from "../util/parse-agent-json";`, and change the one call site
  (`:77`, `parseJudgeJson(result.finalText)`) to `parseAgentJson(result.finalText)`. No other change
  to `judge-agent.ts` (§3 "MODIFIED files" — "Behavior-identical; this is the only change to this
  file"; C1 judge skill-blindness untouched).

**Depends on.** —

**Traces to.** §7.1, §3, §10 (extract-`parseAgentJson` decision), C1 (judge unchanged).

**Acceptance.**
- Typecheck + lint clean; all existing tests still pass (judge behavior unchanged).
- If the unit test is added: `parseAgentJson` returns a parsed object for bare JSON and for
  one-fence-wrapped JSON; returns `undefined` for non-JSON, for a JSON array/`null`/scalar (non-object),
  and for malformed JSON.
- `judge-agent.ts` no longer defines `parseJudgeJson`; `grep -n parseJudgeJson src/` returns nothing.

---

## T2 — Config types: `roles.validator` + `maxValidationRounds`

**Goal.** Add the optional type surface so "config WITHOUT validator validates" holds at the type
level and downstream code can read `config.roles.validator` and `selfImprovement.maxValidationRounds`.

**Files.**
- MODIFY `src/config/types.ts`

**Changes.**
- `RolesInput` (`:50-54`): add `validator?: SingleRoleInput;`.
- `NormalizedRoles` (`:69-73`): add `validator?: { agent: AgentDefinition; prompt?: string };`. The
  `?` is load-bearing (makes the no-validator config valid at the type level, C4).
- `SelfImprovementConfig` (`:81-85`): add `maxValidationRounds?: number;`.
- Do **NOT** touch the `Role` union in `src/providers/types.ts:16` (C5 — explicitly UNCHANGED, §3).

**Depends on.** —

**Traces to.** AC1, R1, R7, C4, C5, §8.1, §8.2, §3.

**Acceptance.**
- Typecheck clean. A config object literal without `roles.validator` and without
  `selfImprovement.maxValidationRounds` still typechecks (no required fields added).
- `NormalizedRoles.validator` and `SelfImprovementConfig.maxValidationRounds` are both optional.

---

## T3 — Config validation: `roles.validator` + `maxValidationRounds`

**Goal.** Validate the new optional fields without changing any behavior when they are absent.

**Files.**
- MODIFY `src/config/validate.ts`

**Changes.**
- In `validateRoles` (after the improver check at `:100`), add a `!== undefined`-guarded line:
  `if (roles.validator !== undefined) validateSingleRole(roles.validator, "roles.validator", agentIds, errors);`
  Reuse `validateSingleRole` (`:139-175`) as-is — it already emits
  `roles.validator references unknown agent "<id>"` and `roles.validator.prompt must be a string`
  for the new path label. Leave the top-level required-roles message (`:94`,
  "roles must be an object with `test`, `judge`, `improver`") UNCHANGED — validator is optional, not
  required (§8.1).
- In `validateSelfImprovement` (`:177-204`), add a `!== undefined`-guarded `maxValidationRounds`
  block mirroring the `maxIterations` block (`:188-194`):
  `if (block.maxValidationRounds !== undefined) { if (!Number.isInteger(block.maxValidationRounds) || (block.maxValidationRounds as number) < 1) errors.push("selfImprovement.maxValidationRounds must be an integer >= 1"); }` (§8.2).

**Depends on.** T2 (types).

**Traces to.** AC1, R7, C4, §8.1, §8.2.

**Acceptance.**
- Typecheck + lint clean; all existing config tests still pass UNCHANGED (the guards mean
  validator-absent / maxValidationRounds-absent configs take zero new error branches).
- (Pinned by T6) a config with `roles.validator` pointing at an unknown agent yields a
  `roles.validator references unknown agent` error; a non-string `validator.prompt` yields
  `roles.validator.prompt must be a string`; `maxValidationRounds: 0.5` yields
  `selfImprovement.maxValidationRounds must be an integer >= 1`.

---

## T4 — Config normalize: validator spread-when-present

**Goal.** Normalize `roles.validator` into object form when present; produce no `validator` key when
absent (so `config.roles.validator === undefined` is the runtime on/off gate, §2).

**Files.**
- MODIFY `src/config/normalize.ts`

**Changes.**
- INSIDE the `roles` object literal (`:28-39`), before its closing brace (`:39`), add the
  EXACT spread-when-present idiom already used for the `test` role's prompt (`:33-35`):
  `...(input.roles.validator !== undefined ? { validator: normalizeSingleRole(input.roles.validator, agents) } : {})`.
  Reuse the existing `normalizeSingleRole` (`:54-66`). Do NOT use the imperative
  `if (input.x !== undefined) out.x = …` pattern (`:47-50`) — the design specifies the in-literal
  spread (§8.1). Absent → no `validator` key on `NormalizedRoles`.

**Depends on.** T2 (types).

**Traces to.** AC1, R1, C4, §8.1, §2 (runtime gate).

**Acceptance.**
- Typecheck + lint clean; all existing tests still pass.
- A normalized config with `roles.validator: "checker"` (string) yields
  `config.roles.validator.agent.id === "checker"`; the object form `{ agent, prompt }` carries the
  prompt; a config without `validator` yields `config.roles.validator === undefined`.

---

## T5 — `resolveSelfImprovement`: `maxValidationRounds` (clamp, default 2)

**Goal.** Resolve `maxValidationRounds` with precedence CLI override > config > default(2), clamped
to ≥ 1 — identical shape to `maxIterations`.

**Files.**
- MODIFY `src/config/self-improvement.ts`

**Changes.**
- `ResolvedSelfImprovement` (`:3-8`): add `maxValidationRounds: number;`.
- `SelfImprovementOverrides` (`:10-15`): add `maxValidationRounds?: number;`.
- `DEFAULTS` (`:17-25`): extend the `Pick<...>` key union (`:18-19`) with `"maxValidationRounds"` and
  add `maxValidationRounds: 2`.
- In `resolveSelfImprovement`'s return (`:44-49`): add
  `maxValidationRounds: Math.max(1, overrides.maxValidationRounds ?? cfg.maxValidationRounds ?? DEFAULTS.maxValidationRounds)`.
- **Clamp `Math.max(1, …)`** — a configured `0` clamps to `1` (one revise round); it does NOT
  disable the validator. Do NOT overload `0` as "disabled" — the validator's on/off is governed
  SOLELY by `roles.validator` presence (R7, §8.2).

**Depends on.** T2 (types).

**Traces to.** AC1, R7, §8.2.

**Acceptance.**
- Typecheck + lint clean; all existing `self-improvement.test.ts` cases still pass.
- (Pinned by T6) default resolves to `2`; a config `maxValidationRounds: 4` resolves to `4`; an
  override `{ maxValidationRounds: 5 }` wins over config; a configured/overridden `0` clamps to `1`.

---

## T6 — AC1 config tests (validator validation + maxValidationRounds resolve)

**Goal.** Pin AC1 with new cases mirroring the existing improver/maxIterations cases, asserting the
no-validator path is unchanged.

**Files.**
- MODIFY `src/__tests__/config-validate.test.ts` (roles.validator cases)
- MODIFY `src/__tests__/self-improvement.test.ts` (maxValidationRounds resolve + validate cases)

**Changes.** Add cases mirroring the existing improver/maxIterations cases (§8.1 AC1 list, §8.2):
- `config-validate.test.ts`:
  (a) a string-shorthand `roles.validator: "<agent>"` referencing a known agent VALIDATES (no error
  mentioning `roles.validator`);
  (a') the object form `roles.validator: { agent: "<agent>", prompt: "..." }` validates;
  (b) `roles.validator: "nope"` (unknown agent) → `errors.some(e => e.includes("roles.validator"))`
  and matches `/roles\.validator references unknown agent "nope"/`;
  (c) `roles.validator: { agent: "<known>", prompt: 123 }` → matches
  `/roles\.validator\.prompt must be a string/`;
  (d) a config WITHOUT `validator` still validates (zero `roles.validator` errors). Do NOT edit the
  existing roles-triple cases — they must pass UNCHANGED (AC1).
- `self-improvement.test.ts`:
  - resolve: default → `maxValidationRounds === 2`; config `maxValidationRounds: 4` → `4`; override
    `{ maxValidationRounds: 5 }` over config `4` → `5`; configured `0` clamps to `1`.
  - validate: `maxValidationRounds: 0.5` → `errors.some(e => e.includes("maxValidationRounds"))`;
    `maxValidationRounds: 0` (integer) → still an error (`< 1`).

**Depends on.** T3, T4, T5.

**Traces to.** AC1, R7, §8.1, §8.2.

**Acceptance.**
- New cases pass; the pre-existing roles-triple and maxIterations cases pass UNCHANGED (re-run the
  full file). `node --test src/__tests__/config-validate.test.ts` and
  `node --test src/__tests__/self-improvement.test.ts` green.

---

## T7 — `classifyValidatorVerdict` + AC2 pure-function table

**Goal.** Implement the pure verdict parse/shape/fail-open classifier (the 5-row AC2 table) and pin
it with a string-input unit test.

**Files.**
- NEW `src/improvement/validator-verdict.ts`
- NEW `src/__tests__/validator-verdict.test.ts`

**Changes.**
- Export the `ValidatorFinding` and `ValidatorOutcome` interfaces here (so `validator-verdict.ts` is
  the home of the verdict types; `validator.ts` re-imports them in T9). Shapes per §6.1:
  - `ValidatorFinding { leak_type: "scenario-name" | "scenario-value" | "verbatim-copy" | "single-case"; span: string; why: string; suggested_fix: string }`
  - `ValidatorOutcome { verdict: "approve" | "revise"; findings: ValidatorFinding[]; failedOpen: boolean; transcriptPath: string }`
    — but `classifyValidatorVerdict` returns the outcome WITHOUT `transcriptPath` set by the caller;
    model `classifyValidatorVerdict(finalText: string): Omit<ValidatorOutcome, "transcriptPath">` (or
    return a partial that T9 fills `transcriptPath` on). Keep the function pure — no fs, no path.
- `classifyValidatorVerdict(finalText)` owns BOTH extraction (`parseAgentJson` from T1) and the
  shape-check, folding parse+classify so AC2's string-level rows are one table (§7.2). Implement the
  exact 5-row decision table (§7.3):
  | # | Input | Result | failedOpen |
  |---|---|---|---|
  | 1 | `parseAgentJson` → `undefined` (non-JSON) | `{verdict:"approve", findings:[]}` | true |
  | 2 | parsed, `verdict ∉ {"approve","revise"}` | `{verdict:"approve", findings:[]}` | true |
  | 3 | `verdict:"approve"` (findings absent/empty) | `{verdict:"approve", findings:[]}` | false |
  | 4 | `verdict:"revise"` + non-empty findings array | `{verdict:"revise", findings:[...]}` | false |
  | 5 | `verdict:"revise"` + empty/absent findings | `{verdict:"approve", findings:[]}` | true |
  - **Row-4 strictness is LENIENT (§7.3):** require `verdict:"revise"` AND `findings` is a non-empty
    array (optionally assert `findings[0].span` is a string). Do NOT fail-open merely because a finding
    lacks `suggested_fix`. Pass through the findings array as-is (cast to `ValidatorFinding[]`).
  - **findings normalization:** every approve outcome (rows 1,2,3,5) emits canonical `findings: []`
    even if raw JSON carried stray findings on an approve (keeps the loop's `verdict !== "revise"`
    break clean, §7.3).

**Depends on.** T1 (`parseAgentJson`).

**Traces to.** AC2, AC7 (row 1 = parse-failure fail-open), R8, R9, §7.2, §7.3.

**Acceptance.**
- `validator-verdict.test.ts` covers all 5 rows over raw STRINGS:
  - well-formed `approve` string → `{verdict:"approve", findings:[], failedOpen:false}` (row 3);
  - well-formed `revise`-with-findings string → `verdict:"revise"`, `findings.length >= 1`,
    `failedOpen:false` (row 4);
  - **fenced** JSON (one ```json fence) for both approve and revise parses (orthogonal to row);
  - `revise` with empty `findings: []` and `revise` with absent findings → row 5 → `approve`,
    `failedOpen:true`;
  - `verdict:"approved"` (typo) / missing verdict / wrong type → row 2 → `approve`, `failedOpen:true`;
  - non-JSON (`"not json"`) → row 1 → `approve`, `failedOpen:true`.
- `node --test src/__tests__/validator-verdict.test.ts` green; typecheck + lint clean.

---

## T8 — `readSkillsRoot` whole-root content reader

**Goal.** Materialize the validator's post-edit "after" state: a whole-skills-root content read that
follows md-links per skill and skips non-skill dirs, with no git and no persisted artifact.

**Files.**
- NEW `src/improvement/read-skills-root.ts`
- NEW `src/__tests__/read-skills-root.test.ts` (small unit, recommended)

**Changes.**
- Export `readSkillsRoot(skillsRoot: string): string` (§5.1). Implementation shape:
  `readdirSync(skillsRoot, { withFileTypes: true })` → for each entry, gate on
  `isDirectorySafe(join(skillsRoot, entry.name))` (`util/fs.ts`) AND
  `existsSync(join(skillsRoot, entry.name, "SKILL.md"))` BEFORE calling `loadSkill` (the robustness
  guard — `loadSkill` throws on a missing `SKILL.md`, `skill-loader.ts:15-17`, so a non-skill dir like
  `_assets/` must be skipped not crash) → `loadSkill(entry.name, skillsRoot)` each → concatenate with
  `"\n\n"`. Returns the same `=== <rel> ===` section format `loadSkill` emits (§5.1).
- **No git, no `*.diff`** (C3/R5): pure `fs`, in-process, writes nothing. Name the module
  `read-skills-root.ts`, NOT `skills-snapshot.ts` (§5.2 module-name note — "snapshot" collides with
  the mtime/size primitive we are deliberately not using).
- Skip the "before"/diff entirely in v1 (§5.2) — only the "after" read exists.

**Depends on.** — (uses existing `loadSkill`, `isDirectorySafe`).

**Traces to.** R4, R5, C3, §5.1, §5.2.

**Acceptance.**
- Typecheck + lint clean.
- Unit test (recommended): given a temp skills root with two skill dirs (each a `SKILL.md`) and one
  non-skill dir (e.g. `_assets/` with no `SKILL.md`), `readSkillsRoot` returns content containing
  both skills' text and does NOT throw on the non-skill dir; a skill with an md-linked reference file
  has the linked file's content included (md-link following via `loadSkill`). The function writes no
  files (assert the dir is unchanged) and references no git.

---

## T9 — `runValidator` agent + `DEFAULT_VALIDATOR_PROMPT`

**Goal.** The validator agent: build the system prompt (anti-leakage contract) + user message
(post-edit skill + corpus + rubrics), invoke `role:"judge"`, classify the verdict, own the
provider-error fail-open, and write the `validation-round-{round}.md` transcript.

**Files.**
- NEW `src/improvement/validator.ts`

**Changes.**
- Define `RunValidatorParams` (§6.1):
  `{ agent: AgentDefinition; validatorPrompt?: string; skillsBlob: string; corpus: EnumeratedScenario[]; config: SkillsmithConfig; projectRoot: string; iterationDirectory: string; round: number; log: RunLog }`.
  Re-export / import `ValidatorFinding`, `ValidatorOutcome` from `validator-verdict.ts` (T7).
- `export async function runValidator(params): Promise<ValidatorOutcome>` with the body shape of
  §6.2:
  - `cwd = resolve(projectRoot, config.paths.skills)` (the skills root, == `improver.ts:117`) — a
    REQUIRED `InvokeParams` field; inert for the mock judge branch, the read-only anchor for real
    providers (§6.1).
  - `provider.invoke({ agent, systemPrompt, prompt: userMessage, cwd, role: "judge" })`.
  - **Provider-error fail-open (entry point a, §7.4):** if `result.error !== undefined`, do NOT call
    `classifyValidatorVerdict` — short-circuit to `{ verdict:"approve", findings:[], failedOpen:true }`,
    `log.info("validator dispatch failed → treated as approve")`.
  - else `classifyValidatorVerdict(result.finalText)` (T7) — parse/shape fail-open (entry point b).
  - Compute `transcriptPath = join(iterationDirectory, \`validation-round-${round}.md\`)` and
    `writeFileSync` the body (§9.3): lead with the `failedOpen`-prominent header
    `VALIDATOR round K: approve|revise (clean | FAILED-OPEN: <reason>)` then findings/raw. Reason
    strings per §7.4: `"provider error: <err>"` (path a); for path b distinguish
    `"verdict unparseable"` / `"revise without findings"` / `"invalid verdict value"` as available
    (a single generic "FAILED-OPEN" reason is acceptable if the precise sub-reason is not threaded —
    the load-bearing requirement is the `failedOpen` bit + a distinguishable header, §7.4/AC7).
  - Set `transcriptPath` on the returned outcome; return it.
- **System prompt** = `DEFAULT_VALIDATOR_PROMPT` unless `validatorPrompt` overrides
  (REPLACE semantics, mirror improver `:118-121`): `validatorPrompt !== undefined &&
  validatorPrompt.length > 0 ? validatorPrompt : DEFAULT_VALIDATOR_PROMPT` (§6.3). Open with the
  identity sentinel **`"You are the validator agent in the skillsmith self-improvement loop."`**
  (§6.3). `DEFAULT_VALIDATOR_PROMPT` MUST NOT contain the literal two-word sequence `"improver agent"`
  (false-match guard, §6.3).
- `DEFAULT_VALIDATOR_PROMPT` sections (§6.4) — full prose is the code-writer's; the required structure
  and load-bearing rules are fixed: (1) identity + mandate = EDIT QUALITY not correctness (R2);
  (2) the four leak types named with the EXACT enum spelling `scenario-name`/`scenario-value`/
  `verbatim-copy`/`single-case` (R2 a–d, incl. dir-name≠scenario.name note); (3) the bright line =
  specificity-to-one-scenario, domain (breadth ≥ 2) MUST pass clean, do NOT anchor on "appears in the
  rubric" (R3); (4) two-prong AND + precision bias, EITHER prong fails → APPROVE, uncertain → APPROVE,
  value in 0 or ≥2 scenarios MUST pass clean, state the harm asymmetry (R3/R3a); (5) what you see =
  post-edit whole skill + corpus (name/description/prompt/acceptance) + rubric texts; (6) output format
  = the exact R9 verdict JSON, strict JSON no prose no fences; (7) recursion guard (copy
  `improver.ts:130-132` / `judge-agent.ts:129-131`).
- **User message** (data, separate from system prompt, §6.4): `# Post-edit skill` + `skillsBlob`;
  `# Active scenario corpus` + per-scenario `{name, description, prompt, acceptance}` from `corpus`;
  `# Rubrics` + rubric bodies. **Rubric assembly (§4.3):** dedupe rubric ids across the corpus
  (`new Set(corpus.flatMap(s => s.scenario.rubrics))`), read each as `paths.rubrics/<id>.md` with the
  judge's `existsSync ? readFileSync : "TO BE FILLED"` fallback (`judge-agent.ts:95-100`). Do NOT read
  all `*.md` under `paths.rubrics`. **INLINE the ~4-line rubric read in the validator — do NOT factor
  a shared helper out of `judge-agent.ts`** (§4.3 — protects the AC1/C1 judge proof).
- **Corpus assembly (§4.3):** source is `EnumeratedScenario[]`. INCLUDE error'd-but-non-stub scenarios
  (an unresolved-ref error still carries a parsed prompt/acceptance); SKIP stubs (empty
  prompt/acceptance from `stubScenario`). `_candidates.yaml` is excluded by construction upstream.
- **Structurally EXCLUDE the answer key (§4.4):** `RunValidatorParams` deliberately has NO
  `iterationReport`, NO `context.report`, NO `context.skillsBlob`, NO judge reviews. Do NOT add them.
- **Identity collision is safe (§6.3):** validator runs `role:"judge"` → the mock takes `invokeJudge`,
  never the `role:"testing"` improver branch — no `"improver agent"` collision.

**Depends on.** T1 (`parseAgentJson` via T7), T7 (`classifyValidatorVerdict` + types), T8
(`readSkillsRoot` — actually called by the loop in T10, but `runValidator` consumes its `skillsBlob`
output, so the type contract aligns here), T2 (`NormalizedRoles.validator` / config types).

**Traces to.** R1, R2, R3, R3a, R4, R8, R9, C1, C5, §4.2, §4.3, §4.4, §6, §7.4, §9.3.

**Acceptance.**
- Typecheck + lint clean. `runValidator` is exercised E2E by T13 (no standalone unit required, but a
  thin unit asserting the provider-error path sets `failedOpen:true` and writes a transcript is welcome
  for AC7).
- Reviewable invariants: `RunValidatorParams` has no `iterationReport`/`report`/judge-review field;
  the system prompt opens with the `"validator agent"` sentinel and contains no `"improver agent"`
  substring; rubric read is inline (no new export from `judge-agent.ts`); the only write is
  `validation-round-{round}.md`.

---

## T10 — `improver.ts`: extract `invokeImprover` + add the inner validate/revise loop

**Goal.** Extract the single improver invoke into a private `invokeImprover(findings)` and add the
validator inner loop INSIDE `runImprovement`, gated by exactly one
`if (config.roles.validator === undefined)` branch — keeping the no-validator path byte-identical.

**Files.**
- MODIFY `src/improvement/improver.ts`

**Changes.**
- Add two new `RunImprovementParams` fields (§3): `corpus: EnumeratedScenario[]` and
  `maxValidationRounds: number`. (`pipeline.ts` supplies them in T11.)
- **Extract `invokeImprover` (§2.0).** Move the current single improver invoke
  (`:148-168`: `getProvider().invoke({role:"testing"})` + the `improvement.md` write + the two
  `log.info`s) into a private `async function invokeImprover(findings: ValidatorFinding[] | undefined): Promise<{ improvementPath: string }>`
  closing over the baseCtx-derived locals (`agent`, the system-prompt base, `skillsDir`,
  `iterationDirectory`, `log`, `instructions`, `context`). Two load-bearing rules:
  1. **Findings → USER message, `span` verbatim (§2.0 rule 1):** on a revise round
     (`findings !== undefined`) append a `# Validator findings` section to the **user message**
     (`prompt`), NOT the system prompt, built by a new `renderFindings(findings)` helper listing each
     finding as `[<leak_type>] <span> — <why>; fix: <suggested_fix>` with the **`span` verbatim**. On
     round 0 (`findings === undefined`) emit NO findings section, so the user message is byte-identical
     to today's (`:134-142`). (This is what makes the mock's `prompt.includes("LEAK_TOKEN")`
     revise-detection work — §2.0 rule 1, §11.3.)
  2. **`improvement.md` written ONLY on round 0 (§2.0 rule 2):** guard the write literally
     `if (findings === undefined) writeFileSync(improvementPath, body)`. Revise-round calls re-edit in
     place and log but do NOT write/clobber `improvement.md`. `improvementPath` is computed once from
     `iterationDirectory` and returned on every call. Do NOT create `improvement-round-K.md` files
     (§2.0 rule 2, §9.3).
- **Control flow (§2.1):** keep the UNCHANGED prologue (build `baseCtx`, `buildImprovementContext`,
  fire `beforeImprove` ONCE). Then:
  - `result = invokeImprover(undefined)` (round 0 = today's single invoke; writes `improvement.md`).
  - `if (config.roles.validator === undefined)` → the byte-identical no-validator path (round 0 already
    did everything; nothing else runs).
  - `else` the inner loop (R6/R7/R8):
    ```
    let round = 0;                      // counts REVISE rounds TAKEN
    while (true) {
      const after = readSkillsRoot(skillsDir);                 // T8
      const outcome = await runValidator({ skillsBlob: after, corpus, config,
        projectRoot, agent: config.roles.validator.agent,
        validatorPrompt: config.roles.validator.prompt,
        iterationDirectory, round, log });                     // T9; writes validation-round-{round}.md
      if (outcome.verdict !== "revise") break;                 // approve OR fail-open → break
      if (round >= maxValidationRounds) {                      // CAP reached WITH pending findings
        log.info("WARNING: validation cap reached without approval");  // R7/D2 keep+warn, NO revert
        break;
      }
      round++;
      result = await invokeImprover(outcome.findings);         // re-edit in place; findings→USER msg
    }
    ```
    **The cap check sits AFTER each validation and BEFORE the next improver invoke** — `while(true)`
    with the cap check in this position guarantees the terminal validation always runs (AC5's N+1/N+1).
    A `while (round < cap)` header is WRONG (§2.1, §10).
  - Fire `afterImprove` ONCE after the loop settles, in BOTH paths, with the round-0 `improvementPath`
    (§2.3 — hooks do NOT fire per round).
  - `return { improvementPath }` (round-0 `improvement.md`).
- **The warning literal** is the exact token `"WARNING: validation cap reached without approval"` via
  `log.info` (RunLog has no `warn` level — `run-log.ts:29-55`; §9.1). AC5 greps this literal.
- Do NOT let the validator touch `report.json`, the matrix, or the exit code (§2.4, §9.2 — advisory).

**Depends on.** T5 (`maxValidationRounds` threaded by pipeline), T8 (`readSkillsRoot`),
T9 (`runValidator`, `ValidatorFinding`), T2 (`config.roles.validator`).

**Traces to.** R1, R5, R6, R7, R8, C3, C4, D2, AC3, AC4, AC5, AC7, §2.0, §2.1, §2.2, §2.3, §2.4, §9.1.

**Acceptance.**
- Typecheck + lint clean. The no-validator path is structurally byte-identical: round 0 runs the same
  invoke + the same single `improvement.md` write + the same two `log.info`s, and the
  `if (config.roles.validator === undefined)` branch does nothing else. `self-improvement-loop.test.ts`
  (AC4) MUST stay UNTOUCHED and green (run it).
- The cap-check sits after validate / before the next invoke (reviewable from the `while(true)`
  structure). `renderFindings` renders `span` verbatim into the user message. `improvement.md` is
  written under the `findings === undefined` guard only.
- E2E behavior pinned by T13 (AC3/AC5).

---

## T11 — `pipeline.ts`: thread the FULL enumerated corpus + `maxValidationRounds`

**Goal.** Split the inline enumerate so the FULL (unfiltered) corpus is retained, and pass it plus
`maxValidationRounds` into the `runImprovement` call.

**Files.**
- MODIFY `src/pipeline/pipeline.ts`

**Changes.**
- At `:85-88`, split the inline call (§4.3 option i):
  ```ts
  const enumerated = enumerateScenarios(config.paths, projectRoot);   // FULL corpus
  const allScenarios = filterScenarios(enumerated, params.scenarios);  // run subset (improver path)
  ```
- In the `runImprovement({...})` call (`:193-207`), add `corpus: enumerated` and
  `maxValidationRounds: selfImprovement.maxValidationRounds`. Keep `allScenarios` as-is (the improver's
  failing-scenario context still uses the FILTERED set — correct, it edits this run's failing skills,
  §4.3). The corpus source is the FULL set, distinct from `allScenarios`.
- Do NOT re-enumerate inside `runValidator` (§4.3 / §10 rejected alternative — wasteful, hides the
  decision).

**Depends on.** T2 (types), T5 (`selfImprovement.maxValidationRounds` on `ResolvedSelfImprovement`),
T10 (`RunImprovementParams.corpus` / `.maxValidationRounds` fields exist).

**Traces to.** R3, R3a, C2, AC3, AC5, §4.1, §4.3.

**Acceptance.**
- Typecheck + lint clean; all existing pipeline/E2E tests still pass (the split is behavior-preserving
  for the no-validator path — `allScenarios` is computed identically).
- `enumerated` (the FULL set, pre-filter) is what flows into `corpus`; `allScenarios` (filtered) still
  drives the improver's failing-scenario context and the run roster.

---

## T12 — `mock.ts`: validator branch + gated improver add-leak/remove-leak

**Goal.** Make the mock provider drive the validator loop deterministically — a validator branch that
returns `revise`/`approve` off sentinels, and gated improver behavior that adds then removes the leak
— WITHOUT changing the existing `loop-project` path (AC4 byte-identity).

**Files.**
- MODIFY `src/providers/mock.ts`

**Changes.**
- **Validator branch (§11.2).** Inside `invokeJudge` (`:96`), BEFORE the generic judge PASS/FAIL
  fallthrough (`:99`), add a branch keyed on `params.systemPrompt.includes("validator agent")` (safe:
  validator runs `role:"judge"` → never the improver `role:"testing"` branch). Implement
  `invokeValidator(params)` per §11.2:
  ```ts
  const neverApprove = params.prompt.includes("NEVER_APPROVE");   // AC5 cap control
  const leaked = params.prompt.includes("LEAK_TOKEN");
  if (neverApprove || leaked) {
    return { finalText: JSON.stringify({ verdict: "revise", findings: [
      { leak_type: "scenario-value", span: "LEAK_TOKEN",
        why: "scenario-unique token copied into the skill",
        suggested_fix: "use a generic example value" } ] }), toolUseCount: 0 };
  }
  return { finalText: JSON.stringify({ verdict: "approve", findings: [] }), toolUseCount: 0 };
  ```
  The verdict JSON is the exact R9 shape, so `classifyValidatorVerdict` maps it to a real `revise`
  (row 4) / `approve` (row 3). The validator SEES the post-edit skill via the user prompt's
  `skillsBlob`, so the mock keys off `params.prompt` (not `systemPrompt`).
- **Gated improver behavior (§11.3).** Inside the existing improver branch
  (`systemPrompt.includes("improver agent")`, `:61`), gate new behavior on the `VALIDATOR_LOOP_FIXTURE`
  opt-in:
  ```ts
  if (params.systemPrompt.includes("improver agent")) {
    if (params.prompt.includes("VALIDATOR_LOOP_FIXTURE")) {
      const isReviseRound = params.prompt.includes("LEAK_TOKEN");   // findings name it; absent on round 0
      const edited = isReviseRound
        ? removeLeakTokenFromSkills(params.cwd)        // revise: strip LEAK_TOKEN, keep MARKER
        : applyMarkerAndLeakToSkills(params.cwd);      // round 0: add MARKER + LEAK_TOKEN
      return { finalText: `improver edited ${edited} skill(s)`, toolUseCount: edited };
    }
    const edited = applyMarkerToSkills(params.cwd);    // UNCHANGED no-validator path (AC4)
    return { finalText: `improver applied marker to ${edited} skill(s)`, toolUseCount: edited };
  }
  ```
- **Helpers (mirror `applyMarkerToSkills` `:111-129`, §11.3):** both walk the immediate
  `<dir>/SKILL.md` entries under `cwd` with the same `readdirSync(..., {withFileTypes:true})` +
  `existsSync(SKILL.md)` guard and return the count edited.
  - `applyMarkerAndLeakToSkills(cwd)` (round 0): for each gated SKILL.md, append BOTH the `MARKER` line
    (so the gated judge flips `GATE_FAIL`→`GATE_PASS`) AND a `LEAK_TOKEN` line; idempotent "skip if
    already present" shape.
  - `removeLeakTokenFromSkills(cwd)` (revise): for each SKILL.md containing the `LEAK_TOKEN` line,
    rewrite without that line, leaving `MARKER` intact (so the scenario still passes; the skill becomes
    leak-free → validate#2 approves → AC3 converges).
- The `VALIDATOR_LOOP_FIXTURE` opt-in is the AC4 guarantee: `loop-project`'s improver prompt lacks it →
  unchanged `applyMarkerToSkills` → `self-improvement-loop.test.ts` byte-identical, zero
  `validation-round-*.md` written (§11.3).

**Depends on.** Agreement on the sentinels and on the prompt identity strings (`"validator agent"`,
`"improver agent"`) and the user-message rendering of findings — all fixed by T9/T10's design. Can be
implemented in parallel with T9/T10 against those fixed strings; its payoff is realized in T13.

**Traces to.** AC3, AC4, AC5, AC6, R6, §11.2, §11.3.

**Acceptance.**
- Typecheck + lint clean; `self-improvement-loop.test.ts` (the existing `loop-project` test) stays
  green and UNTOUCHED (the new improver behavior is behind `VALIDATOR_LOOP_FIXTURE`, which
  `loop-project` does not carry).
- The validator branch returns valid R9-shaped JSON; the improver helpers mirror
  `applyMarkerToSkills`'s walk/guard/return-count shape.

---

## T13 — Fixtures + AC3/AC5/AC6 E2E loop tests

**Goal.** Two self-contained fixtures and the E2E test(s) that exercise the whole inner loop end to
end: convergence (AC3), cap behavior (AC5), and the false-positive/approve-on-approve guard's
deterministic portion (AC6).

**Files.**
- NEW `src/__tests__/fixtures/validator-loop-project/` (config + `checker` agent + skill + scenario +
  rubric)
- NEW `src/__tests__/fixtures/validator-loop-cap-project/` (same, plus `NEVER_APPROVE` in the skill)
- NEW `src/__tests__/validator-loop.test.ts` (AC3 + AC5 + AC6 deterministic portion)

**Changes.**
- **Fixtures (§11.4)** — each a self-contained mirror of `loop-project/` (config.ts + `skills/<id>/SKILL.md`
  + `eval/scenarios/<dir>/scenario.yaml` + `eval/rubrics/<id>.md`), each with a `PRISTINE_SKILL` the
  test resets (like `self-improvement-loop.test.ts:34/46`):
  - `validator-loop-project/`: config adds `roles.validator: "checker"`, a `checker` mock agent
    (`{ provider: "mock", model: "mock" }`), and `selfImprovement.maxValidationRounds: 2`. The pristine
    `skills/<id>/SKILL.md` carries `MOCK_GATE` + `VALIDATOR_LOOP_FIXTURE` but NOT `MARKER`/`LEAK_TOKEN`
    (the improver adds those). Mirror the loop-project config shape (`mode: "self-improvement"`,
    `paths.base: "./.skillsmith"`, `maxIterations` ≥ 2 so the improver runs).
  - `validator-loop-cap-project/`: same, plus `NEVER_APPROVE` in the pristine skill so the mock
    validator never approves.
  - **Fixture constraint (§11.3):** NO scenario prompt/acceptance or rubric text in either fixture may
    contain the literal `LEAK_TOKEN` (else it appears in the round-0 improver prompt via report/corpus
    and falsely trips the revise branch). Keep the token out of corpus text. (The skill text is where
    the leak lives; the corpus must be clean of it.)
- **AC3 — convergence (§11.5):** run `validator-loop-project` (default `maxValidationRounds = 2`). The
  mock improver's round-0 writes MARKER + LEAK_TOKEN → validate#1 = `revise` (finding names
  LEAK_TOKEN) → improver#2 removes LEAK_TOKEN → validate#2 = `approve` → converge. Assert in
  `iteration-1/`: exactly **2** `validation-round-*.md` files (regex `/^validation-round-\d+\.md$/`);
  `existsSync(validation-round-1.md)` ("the validator ran"); exactly one revise round (= 2 transcripts,
  or read round-1 = revise / round-2 = approve); the final on-disk skill `!includes("LEAK_TOKEN")`;
  exit code `0`. Reset the skill to PRISTINE in a `finally` block; suppress `console.log` (mirror
  `self-improvement-loop.test.ts:36-37/43-47`).
- **AC5 — cap (§11.5):** run `validator-loop-cap-project` with the never-approve validator and
  `maxValidationRounds = N` (default 2). Assert exactly **3** (N+1) `validation-round-*.md` files (each
  edit incl. the final un-revised one is reviewed — its findings feed the warning);
  `iteration-1/run.log` `.includes("validation cap reached without approval")` (read the dumped file;
  RunLog dumps regardless of `mirrorStderr`, §9.1); the LAST edit is KEPT (assert the skill reflects
  the last improver edit, e.g. still carries MARKER — NOT reverted); the run RETURNS a number (no
  hang). Do NOT assert a specific exit value unless the cap fixture's scenario is deliberately designed
  to stay failing (§9.2) — assert it returns a number.
- **AC6 — false-positive/approve guard, deterministic portion (§11.5):** the `validator-loop-project`
  approve case IS the AC6 deterministic portion — with no LEAK present the validator returns `approve`
  and the loop converges with ZERO revise rounds. The real breadth-rule judgment (a model declining to
  flag breadth-≥2 domain vocab) is the design-reference real-model check, NOT this suite (pre-scan
  deferred, §8.4). Assert: a variant where the skill has no leak (or after convergence) yields an
  approve with zero revise rounds (exactly 1 `validation-round-*.md` if the very first edit is clean,
  or rely on the AC3 round-2 approve as the approve-acceptance evidence). Keep AC6 tied to "loop
  accepts an approve verdict," not to a model's breadth judgment.

**Depends on.** T10 (inner loop), T11 (corpus threading), T12 (mock branches + helpers).

**Traces to.** AC3, AC5, AC6, R6, R7, D2, §9.1, §9.2, §11.4, §11.5.

**Acceptance.**
- `node --test src/__tests__/validator-loop.test.ts` green: AC3 converges (2 transcripts, leak-free,
  exit 0); AC5 caps (3 transcripts, WARNING literal in `run.log`, last edit kept, returns a number);
  AC6 deterministic approve-on-approve holds. Each test resets its fixture skill to pristine in
  `finally` and leaves the working tree clean.
- The full suite (`node --test`) passes, including `self-improvement-loop.test.ts` UNCHANGED (AC4).

---

## T14 — CLI `--validation-rounds` flag + changeset

**Goal.** Add the CLI flag mirroring `--iterations` (precedence CLI > config > default), and record
the release changeset for the whole feature.

**Files.**
- MODIFY `bin/skillsmith.mjs`
- NEW `.changeset/<name>.md`

**Changes.**
- In `bin/skillsmith.mjs` (§8.3): add `"validation-rounds": { type: "string" }` to the `parseArgs`
  `options` (`:24-30`); add a parse/validate/assign block mirroring `--iterations` (`:53-60`):
  `Number.parseInt(values["validation-rounds"], 10)`; `!Number.isFinite(n) || n < 1` →
  `console.error("--validation-rounds must be an integer >= 1")` + `process.exit(1)`; else
  `overrides.maxValidationRounds = n`. Update the usage string (`:35`) to include
  `[--validation-rounds N]`. The flag's value flows CLI → `run({overrides})` →
  `resolveSelfImprovement(config, params.overrides)` — the tested link is the resolve precedence
  (pinned in T6); `bin/skillsmith.mjs` is the thin untested shim (§8.3).
- **Changeset (single, covers the whole feature):** add `.changeset/<short-name>.md` with front-matter
  `"@automattic/skillsmith": minor` and a non-empty body. **Bump type = minor** per
  `CONTRIBUTING.md` table — this is "Additive new CLI flag with sensible default" + "New optional
  `selfImprovement` field" (`maxValidationRounds`) + a new optional `roles.validator` config field, all
  additive with backward-compatible defaults (no `BREAKING:` prefix; not pre-1.0 breaking). One-line
  summary ~120 chars, e.g. "Add an optional read-only validator agent to the self-improvement loop that
  flags blatant train/test leakage (`roles.validator`, `selfImprovement.maxValidationRounds`,
  `--validation-rounds`)." No conventional-commit prefix.

**Depends on.** T5 (`SelfImprovementOverrides.maxValidationRounds` exists so the override is typed).

**Traces to.** R7, AC1, §8.3; project changeset guardrail.

**Acceptance.**
- `node bin/skillsmith.mjs --validation-rounds 0` errors with `--validation-rounds must be an integer
  >= 1` and a non-zero exit; `--validation-rounds 3` sets `overrides.maxValidationRounds = 3` (smoke
  via reading the shim, or a programmatic `run({ overrides })` assertion via the resolve chain already
  pinned in T6). The usage string lists the new flag.
- The changeset validates (`validate-changesets.test.ts` green; `check`'s changeset-format step
  passes): front-matter key `@automattic/skillsmith`, value `minor`, non-empty body, no
  conventional-commit prefix.

---

## Coverage matrix — every spec requirement, constraint, and AC is owned

| Spec item | Owning task(s) |
|---|---|
| **R1** optional validator in loop, improver sole writer | T2, T4, T9, T10 |
| **R2** mandate = edit quality, 4 leak types | T9 (`DEFAULT_VALIDATOR_PROMPT` §6.4), T7 (enum) |
| **R3** leakage-vs-domain two-prong AND | T9 (prompt §6.4), T11 (full corpus) |
| **R3a** precision bias, 0/≥2 scenarios pass clean | T9 (prompt §6.4), T11 (full corpus monotonicity) |
| **R4** what the validator sees (no judge reviews) | T8, T9 (§4.2/§4.4 exclusion) |
| **R5** edit-capture in-process/ephemeral/no-git, whole root | T8, T10 |
| **R6** approve/revise mechanics, in-place, no revert | T10 (inner loop), T12 (mock revise) |
| **R7** `maxValidationRounds` config + cap keep+warn | T2, T3, T5, T10 (warn), T14 (CLI) |
| **R8** fail-open (provider error / unparseable / malformed) | T7 (rows 1/2/5), T9 (provider-error path) |
| **R9** verdict JSON format | T7 (parse/shape), T9 (prompt), T12 (mock emits R9 shape) |
| **C1** judge stays skill-blind | T1 (judge unchanged except import), T9 (rubric read inline) |
| **C2** no held-out gate, small-corpus breadth | T11 (full corpus) |
| **C3** no git dependency | T8 (pure fs) |
| **C4** backward compatible (forced) | T3/T4/T5 (`!== undefined` guards), T10 (round-0-only path), T12 (`VALIDATOR_LOOP_FIXTURE` gate), AC4 untouched |
| **C5** validator read-only, `role:"judge"`, no new `Role` | T2/T9 (no `Role` union edit) |
| **C6** honest scope, advisory | T9 (prompt), T10 (§2.4 advisory) |
| **AC1** config validation | T3, T4, T5, T6 |
| **AC2** verdict parse/shape table | T7 |
| **AC3** convergence E2E | T10, T11, T12, T13 |
| **AC4** backward-compat E2E (untouched) | T1, T10, T12 (gate) — `self-improvement-loop.test.ts` stays untouched |
| **AC5** cap behavior | T10, T11, T12, T13 |
| **AC6** false-positive guard (deterministic portion) | T12, T13 |
| **AC7** fail-open behavior | T7 (row 1), T9 (provider-error + `failedOpen` transcript), T13 (optional mock-error path) |

**Guardrails:** typecheck/lint/tests green on every task; config-smoke unaffected (additive optional
fields); changeset recorded in T14 (minor).

**Deferred per D5/§8.4 (NOT in this plan, by design):** the deterministic pre-scan
(`leakage-scan.ts` / `leakage-scan.test.ts`, RULES 1–3 over forms a–c, surfaced-evidence-only,
never-gating). v1 is LLM-validator-only. Also deferred (named optional cleanups, NOT tasks):
`src/scenarios/rubric-loader.ts` extraction (§4.3) and the `readSkillsRootMap` + baseline-read diff
(§5.2).
