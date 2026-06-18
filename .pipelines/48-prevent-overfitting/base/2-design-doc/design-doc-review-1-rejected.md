# Design doc review 1 — REJECTED

**Artifact:** `.pipelines/48-prevent-overfitting/base/2-design-doc/design-doc.md` (commit 15c0b13)
**Contract:** `.pipelines/48-prevent-overfitting/base/1-spec/spec.md` (R1–R9, C1–C6, AC1–AC7, D2, D5)
**Verdict:** REJECTED — two blocking specification gaps. Both are exactly the kind the design phase
exists to settle: a code-writer cannot implement without reopening them, and one of them silently
breaks the design's own AC3/AC5 mock strategy if guessed wrong.

The doc is strong overall — the control flow, the corpus-FULL monotonicity argument, the answer-key
structural exclusion, the 5-row fail-open table, the config plumbing, and the `failedOpen` evidence
bit are all sound, and the load-bearing file:line anchors I spot-checked (improver.ts, pipeline.ts,
judge-agent.ts, the config trio, mock.ts, providers/types.ts, context.ts, skill-loader.ts,
enumerate.ts, run-log.ts, the AC4 test, the CLI shim) all match the worktree. The rejection is
narrow: two under-specified contracts on the `invokeImprover` boundary. Fix those and the design is
ready for the plan phase.

---

## BLOCKING

### B1 — The `invokeImprover` ↔ findings rendering contract is never specified, and the mock's revise-detection silently depends on it

`invokeImprover(...)` is the central new helper (File inventory: "Extract the single improver invoke
into a private `invokeImprover(...)`"). The control flow calls it two ways —
`invokeImprover(ctx, findings=undefined)` (round 0) and `invokeImprover(ctx, findings=verdict.findings)`
(revise rounds, §2.1 line 98 / §4.1 line 205) — but the doc **never defines its signature, the type
of `findings`, or how `findings` is rendered into the improver's prompt.** The only place rendering
is mentioned is one clause buried in the testability section (§11.3, line 828): "the validator's
findings (appended to the improver's user prompt by `invokeImprover`) name `LEAK_TOKEN`." That is an
assertion in a test rationale, not a design contract.

Why this is load-bearing in two independent ways:

1. **Real behavior (R6).** R6 requires the improver re-edit "given the same original iteration report
   and skill context the first round had, **plus the validator's findings**." The whole revise
   mechanic depends on findings reaching the improver. The doc specifies the validator's *output*
   shape precisely (`ValidatorFinding {leak_type, span, why, suggested_fix}`, §6.1/§6.5) but never
   how that output is *consumed* by the improver — which sections of the prompt it lands in, whether
   it goes into the system prompt or the user message, and which fields are rendered.

2. **The mock test strategy (AC3/AC5) silently depends on the unstated answer.** The mock improver
   keys revise-vs-round-0 detection on `prompt.includes("LEAK_TOKEN")` (§11.3, line 819), where
   `prompt` is `InvokeParams.prompt` — i.e. the **user message** (verified: `runImprovement` passes
   the user message as `prompt`, improver.ts:150-155; the mock improver branch reads
   `params.prompt`/the user `prompt`, mock.ts). The only source of the literal `LEAK_TOKEN` on a
   revise round is the rendered finding's `span` (the stale `context.skillsBlob` is the *pre-edit*
   skill and does not contain it — and the §11.3 fixture constraint forbids it in the corpus/report).
   So the mock converges **only if** findings are rendered into the **user message** **with the
   `span` value verbatim.** If a code-writer instead renders findings into the **system prompt**
   (a defensible default — instructions live in the system prompt for the judge and improver today),
   or renders only `why`/`suggested_fix` and not `span`, then `params.prompt.includes("LEAK_TOKEN")`
   is false on every round, the mock improver never strips the leak, the validator never approves,
   and AC3 fails to converge / AC5's counts shift. The design's own happy path breaks on a reasonable
   implementation choice it left open.

**Required fix.** State the `invokeImprover` contract explicitly:
- its signature (e.g. `invokeImprover(ctx, findings: ValidatorFinding[] | undefined)`),
- that on a revise round the findings are rendered into the **user message** (so the mock's
  `params.prompt.includes(...)` sees them), in a named section (e.g. `# Validator findings`),
- and that the rendering includes the `span` verbatim (so both the real improver can locate the
  offending substring — R9's stated purpose for `span` — and the mock's detection fires).
- Confirm round 0 renders no findings section (so `prompt.includes("LEAK_TOKEN")` is false on round 0
  given the fixture constraint).

### B2 — `improvement.md` write-ownership across rounds is internally contradictory

The control flow describes `invokeImprover` as the thing that "writes improvement.md" — stated for
round 0 (§2.1 line 80/85, §4.1 line 196) as a property of the call itself. `invokeImprover` is then
also called on every revise round (§2.1 line 98). But §9.3 (lines 735, 739-741) asserts the opposite:
"**`improvement.md` stays the ROUND-0 improver transcript on every path**. There is **no**
`improvement-round-K.md`," and AC4 depends on `improvement.md` being byte-identical to today.

These cannot both hold without a stated rule. If `invokeImprover` writes `improvement.md` on every
call (as the round-0 description implies), then each revise-round call **overwrites** `improvement.md`
with that round's transcript — so it is the round-(K) transcript, not the round-0 transcript,
contradicting §9.3. If instead `invokeImprover` writes `improvement.md` only on round 0, that is
consistent with §9.3 but is never stated, and it silently discards the per-revise improver
transcripts (acceptable under R5, which only requires the *validator's* prose be persisted — but it
must be said).

This is not merely cosmetic: AC4's byte-identity proof and the §9.3 "no collisions / hook
`improvementPath` unchanged" argument both rest on `improvement.md` being the round-0 transcript. The
write-ownership boundary (does `invokeImprover` write the transcript, or does the caller, and on
which rounds) must be pinned so the code-writer doesn't pick the overwriting reading.

**Required fix.** State unambiguously which component writes `improvement.md` and on which round(s).
The cleanest reading consistent with §9.3 and AC4: `invokeImprover` writes `improvement.md` **only on
round 0** (or the round-0 call writes it and revise-round calls do not), revise-round improver
transcripts are intentionally not persisted (R5 only mandates the validator's prose), and
`improvementPath` returned to the hook is always the round-0 path. Make the round-0-only write
explicit in the §2.1 pseudocode and/or the `invokeImprover` contract from B1.

---

## NON-BLOCKING (fix while in here; not grounds for rejection on their own)

- **N1 — `normalize.ts` anchor cites the wrong idiom.** §8.1 places the validator spread "in the
  roles block (after `:38`)" and cites "the EXACT spread-when-present idiom already used for
  `selfImprovement`/`hooks` (`:47-50`)." But `:47-50` is the imperative `if (input.x !== undefined)
  out.x = …` pattern at the **`out`** object level, not a spread, and not in the roles literal. The
  spread-when-present idiom the validator should mirror is the **`test` role's** at normalize.ts:33-35
  (`...(input.roles.test.prompt !== undefined ? {prompt: …} : {})`), placed **inside** the
  `roles` object literal (before its closing brace at :39), not as a statement "after :38." The
  intent is clear and a writer with the `:33-35` example will get it right, but the cited anchor
  points at the wrong pattern. Re-cite `:33-35` and say "inside the roles literal."

- **N2 — Mock improver helpers are named but not specified.** `applyMarkerAndLeakToSkills(cwd)` and
  `removeLeakTokenFromSkills(cwd)` (§11.3) are sketched only by name. This is test scaffolding and the
  behavior is inferable (round 0: append MARKER + LEAK_TOKEN to each gated SKILL.md, mirroring
  `applyMarkerToSkills`, mock.ts:111-129; revise: strip the LEAK_TOKEN line), so it is not blocking —
  but a one-line behavioral note each would remove the last bit of guesswork and de-risk B1's
  detection coupling (the round-0 helper is what *introduces* the literal the mock later keys on).

- **N3 — `description` in the corpus payload.** §4.2/§6.4 surface `{name, description, prompt,
  acceptance}` per scenario to the validator. `Scenario.description` exists (types.ts:128) and is
  populated, so this is fine; just flag that `description` is currently only used as the judge's
  user-message tail (judge-agent.ts:173) — surfacing it to the validator is a new, intentional use,
  which is correct (more breadth evidence) and worth a half-sentence so the writer doesn't treat it as
  a copy-paste error.

---

## What I verified as sound (so the re-review can move fast)

- **Anchors:** improver.ts (runImprovement single-invoke, `role:"testing"`, identity sentinel
  "improver agent" at :124, improvement.md write :157-162, afterImprove :170-176); judge-agent.ts
  (parseJudgeJson :141-153 byte-for-byte matches the proposed `parseAgentJson`; rubric read
  :95-100; strict-JSON/recursion-guard :126-131); pipeline.ts (inline enumerate+filter :85-88, the
  single `runImprovement` call :193-208 with `allScenarios` :205, `fireAfterIteration` :210 →
  log.dump :445); mock.ts (improver branch keys on "improver agent" :61, judge branch :96,
  `applyMarkerToSkills` :111-129); providers/types.ts (`Role = "testing" | "judge"` :16, unchanged
  per C5); config trio (RolesInput :50-54, NormalizedRoles :69-73, SingleRoleInput :61,
  SelfImprovementConfig :81-85; validateRoles :87-101, validateSingleRole :139-175 with the exact
  error strings, validateSelfImprovement :177-204; resolveSelfImprovement clamp :42-46, DEFAULTS
  :17-25); context.ts (skillsBlob scoped to failing ids :61-65; verbatim judge `review` preserved
  :108 — the answer-key trap is real, and the exclusion is correctly structural); skill-loader.ts
  (md-link follow :36-45; throws on missing SKILL.md :15-17 — the §5.1 robustness guard is
  warranted); enumerate.ts (opens only `scenario.yaml` :36 — `_candidates.yaml` excluded by
  construction; `EnumeratedScenario.scenario.{name,description,prompt,acceptance,rubrics}` present);
  run-log.ts (no `warn` level :29-55 — the `log.info("WARNING: …")` literal approach is correct);
  self-improvement-loop.test.ts (AC4 asserts at :81-92 — improvement.md exists, no skills.diff;
  byte-identity argument holds); bin/skillsmith.mjs (`--iterations` parse/validate/assign :53-60 is
  the right mirror for `--validation-rounds`); util/fs.ts `isDirectorySafe` exists.
- **Control-flow soundness:** the `while(true)` + cap-check-after-validate / before-next-invoke
  yields AC3's 2/2 and AC5's N+1/N+1 — re-traced, correct; the terminal validation always runs.
- **Fail-open table (AC2):** 5 rows, partition is exhaustive (parses?/in-enum?/approve-or-revise?/
  findings-nonempty?); both entry points set `failedOpen:true`; row-4 leniency is consistent with R3a.
- **Corpus = FULL set:** the monotonicity argument (false-positive-count(full) ≤ count(filtered)) is
  valid and the threading (named-const split at :85-88, new `corpus` field forwarded to the validator,
  improver keeps filtered `allScenarios`) is correct and respects C2 (small-corpus / no holdout).
- **Answer-key exclusion (R4):** structurally guaranteed by omitting `iterationReport`/`context.report`/
  `context.skillsBlob` from `RunValidatorParams` — not a prompt instruction. Sound.
- **Advisory gate (C6/D2):** validator never writes a `ScenarioReport`/`report.json`/exit code;
  cap-without-approval keeps + warns, no revert. Faithful to the spec; both hard constraints (C1
  judge skill-blindness untouched except the entanglement-free `parseAgentJson` move; C2 no holdout)
  respected. D5 deferral of the pre-scan is within the spec's explicit grant and weakens no AC.
- **Cap-warning placement (§9.1):** `runImprovement` (pipeline.ts:193) runs before
  `fireAfterIteration` (:210 → log.dump :445), so the `log.info` WARNING lands in
  `iteration-1/run.log`. Verified.

Resolve B1 and B2 (and ideally N1–N3) and the design is ready to proceed.
