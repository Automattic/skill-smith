# Design doc review 2 — APPROVED

**Artifact:** `.pipelines/48-prevent-overfitting/base/2-design-doc/design-doc.md` (commit d189931)
**Contract:** `.pipelines/48-prevent-overfitting/base/1-spec/spec.md` (R1–R9, C1–C6, AC1–AC7, D2, D5)
**Prior:** `design-doc-review-1-rejected.md` (blocking B1, B2; nits N1–N3)
**Verdict:** APPROVED — both blocking issues are genuinely resolved, all three nits addressed, the
loop counts re-trace correctly, spec faithfulness holds, and every load-bearing file:line anchor
matches the worktree. Ready for the plan phase.

---

## B1 — RESOLVED. The `invokeImprover` ↔ findings rendering contract is now pinned.

§2.0 (new section, "settled — load-bearing for AC3/AC4/AC5") fully specifies the boundary the prior
review found undefined:

- **Signature pinned:** `async function invokeImprover(findings: ValidatorFinding[] | undefined):
  Promise<{ improvementPath: string }>`, `findings=undefined` on round 0, `verdict.findings` on revise.
- **User-message placement, span verbatim (rule 1):** findings render into the improver's **user
  message** (`prompt`), NOT the system prompt, via `renderFindings(findings)` building a
  `# Validator findings` section that lists each finding as `[<leak_type>] <span> — <why>; fix:
  <suggested_fix>` with the **`span` rendered verbatim** (R9's stated purpose). Round 0
  (`findings === undefined`) emits **no** findings section, so the user message is byte-identical to
  today's (`improver.ts:134-142`).
- **The mock coupling is now explicit and correct.** The doc spells out that the mock improver keys
  revise-vs-round-0 on `params.prompt.includes("LEAK_TOKEN")`, that `params.prompt` is the user
  message (`runImprovement` passes the user message as `prompt`, verified at `improver.ts:152`), and
  that the *only* source of the literal `LEAK_TOKEN` on a revise round is the rendered finding's
  `span`. It enumerates the exact failure mode if a writer rendered findings into the system prompt or
  dropped `span` (AC3 would not converge / AC5's counts would shift). §11.3 (lines 919–922) now agrees
  verbatim with §2.0 rule 1.

AC3/AC5 can no longer silently break on a reasonable implementation choice. Confirmed against the
worktree: `improver.ts:152` passes the user message as `prompt`; round-0 user message is
`improver.ts:134-142`.

## B2 — RESOLVED. `improvement.md` write-ownership is now an explicit round-0-only rule.

§2.0 rule 2 states the rule the prior review required and the §9.3 contradiction is gone:

- **Round-0-only write, stated as a literal guard:** `invokeImprover` writes
  `iteration-N/improvement.md` **only when `findings === undefined`** —
  `if (findings === undefined) writeFileSync(improvementPath, body)`. Revise-round calls re-edit in
  place and log but do **not** write or clobber `improvement.md`.
- **Per-revise transcripts intentionally not persisted** (R5 mandates only the validator's prose);
  the doc says so explicitly so the writer does not add `improvement-round-K.md`.
- **`improvementPath` stable** (derived from `iterationDirectory`, not the round) and returned to the
  hook unchanged on every path (§2.0, §2.3).
- **AC3/AC4/AC5 re-traced against the rule** (lines 132–137): in all three, `improvement.md` is the
  round-0 transcript and there are no `improvement-round-K.md` files. §9.3 (lines 814–817) now
  cross-references "§2.0 rule 2" and is internally consistent. AC4's byte-identity anchor
  (`self-improvement-loop.test.ts:81-84`) is correct; no-validator path runs only the round-0 call →
  exactly one write → byte-identical.

## Nits — all three addressed.

- **N1 (normalize.ts anchor):** §8.1 now cites the correct idiom —
  the `test` role's `prompt` spread at `normalize.ts:33-35` **inside the roles literal**, before its
  closing brace at `:39` — and explicitly warns NOT to mirror the imperative `out.x = …` pattern at
  `:47-50`. Verified against the file: `:33-35` is the `test.prompt` spread inside the roles literal,
  `:39` the closing brace, `:47-50` the `out`-object imperative assignments. Correct.
- **N2 (mock improver helpers):** §11.3 (lines 908–918) now specifies both helpers behaviorally —
  walk immediate `<dir>/SKILL.md` like `applyMarkerToSkills`; `applyMarkerAndLeakToSkills` appends
  MARKER + LEAK_TOKEN (round 0); `removeLeakTokenFromSkills` strips the LEAK_TOKEN line (revise);
  idempotent skip-if-present; both return the edited count.
- **N3 (`description` in corpus):** §4.2 (lines 294–295) now flags that `Scenario.description`
  (`types.ts:128`) is currently used only as the judge's user-message tail (`judge-agent.ts:173`) and
  that surfacing it to the validator is a new, intentional use, not a copy-paste. Anchor verified.

---

## Fresh adversarial pass

- **Loop-count soundness re-traced.** `while(true)` with the cap check AFTER each validate / BEFORE
  the next improver invoke: AC3 (N=2, converges) → 2 improver invokes + 2 validation transcripts
  (`validation-round-0.md` revise, `validation-round-1.md` approve), one revise round, leak-free final
  skill. AC5 (N=2, never-approve) → 3 improver invokes (N+1) + 3 validation transcripts (N+1,
  `validation-round-0..2.md`), terminal validation runs, last edit kept, WARNING logged. Both correct;
  they share one loop shape.
- **Spec faithfulness.** Goal (optional read-only validator, improver sole writer) honored; C1 (judge
  stays skill-blind — only the entanglement-free `parseJudgeJson`→`parseAgentJson` import swap touches
  the judge); C2 (breadth test on the FULL corpus, no holdout — the monotonicity proof
  `false-positive(full) ≤ false-positive(filtered)` is valid); D2 (advisory keep+warn, validator never
  writes a `ScenarioReport`/`report.json`/exit code, no revert); D5 (LLM required, pre-scan deferred
  within the spec's explicit grant, no AC made unsatisfiable). All faithful.
- **Consistency / standalone-ness.** B1 and B2 are now consistent across §2.0/§2.1/§4.1/§9.3/§11.3.
  All interfaces, the 5-row AC2 fail-open table (exhaustive partition; both entry points set
  `failedOpen:true`; row-4 leniency consistent with R3a), the config plumbing, and the mock strategy
  are pinned; a code-plan-writer can build without reopening the spec.
- **Anchors.** Every load-bearing file:line spot-checked matches the worktree: improver.ts
  (117/118-121/124/134-142/148-168/152/170-176); normalize.ts (33-35/39/47-50); judge-agent.ts
  (95-100/126-131/141-153/173); mock.ts (61/96/111-129/119-122); skill-loader.ts (15-17/36-45);
  context.ts (61-65/97-121/108); pipeline.ts (85-88/193/205/206); self-improvement.ts
  (3-8/10-15/17-25/42-46); validate.ts (94/100/139-175/177-204/188-194/182); run-log.ts (29-55);
  self-improvement-loop.test.ts (34/36-37/46/81-84/89-92).

### One cosmetic note (NON-BLOCKING — not grounds for rejection, no re-review needed)

§11.5's AC3 parenthetical labels the two transcripts "round-1 revise + round-2 approve," but the
`{round}`-from-0 suffix pinned in §9.3 ("K from 0") and §6.1 (`round: number; // transcript filename
suffix`) produces `validation-round-0.md` (revise) and `validation-round-1.md` (approve). The labels
are 1-indexed prose; the actual filenames are 0-indexed. This breaks no binding assertion: the
count-by-regex (`/^validation-round-\d+\.md$/` == 2) and the `existsSync(iteration-1/
validation-round-1.md)` check (the approve transcript) are both correct under the specified 0-indexed
scheme. A writer following §9.3/§6.1 produces the right files and both assertions pass. Worth tidying
the parenthetical for readability, but it is a label slip, not a contract gap.

Approved. Ready for the plan phase.
