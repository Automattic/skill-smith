# Doc plan review — APPROVED

Adversarial, single-shot review of `3-plan/doc-plan.md` (items D1–D6) for the
"skip misconfigured agents across a run" feature. The plan is sound and complete:
it would produce correct, complete, product-facing documentation of the shipped
behavior. Approved.

## Verdict

**APPROVED.** Every reader-facing behavior the feature ships is documented;
nothing is documented-but-not-shipped; the "Where" homes are real and
appropriate; the D5 bug is real and the fix matches the code; scope discipline is
clean; no internal-process vocabulary is planned for any doc body.

## What I verified against the actual code and artifacts

### Completeness — every shipped reader-facing behavior is covered

- **Warn default (D1)** — misconfigured = pre-invoke/credential-based and distinct
  from a grading failure; test agent excluded from execution (no invoke, no
  hooks); surfaced in both the end-of-run summary and `report.json`; the stable
  `misconfigured: ` reason prefix is the distinguisher. The **non-zero exit on a
  partial run** (the central CI-facing anti-regression rule, spec R3.3) is called
  out explicitly, including "not green just because the remaining rows passed."
- **Role-aware handling (D2)** — judge stops up front (non-zero, no graded
  matrix); improver degrades to test-only (surfaced, exit still derives from the
  matrix, so a clean test-only run can legitimately exit zero); all-test-agents-
  misconfigured is still a failure. The exit-code nuance distinguishing the
  improver-degrade (does not force non-zero) from the test-agent exclusion (does)
  is stated, matching spec R4.2 vs R3.3.
- **Public API (D3)** — both named exports documented with prose contracts:
  `runnableTestAgentIds(config, env)` and `agentRunnable(config, agentId, env)`,
  pure/synchronous; the **throw-on-unknown-id** contract (an unknown id throws, is
  not coerced to `false`); the provider→credential mapping; the no-gate providers
  (`claude-code`/`mock`/`codex`) reported runnable from the static view, with the
  `codex` rationale; and the e2e consumer.
- **e2e behavior (D4)** — the new `openai-api-nano` agent, the no-OpenAI-creds
  behavior (haiku-only e2e, no Playwright project / built plugin / workspace for
  the excluded agent, no spurious "e2e failed", non-zero exit with the agent
  surfaced as misconfigured), and `projects` derived from `runnableTestAgentIds`.
- **D5 / D6** — the provider→credential reference touch-up and the (optional)
  extensibility-seam note, both correctly scoped.

### "Where" homes are real and appropriate

Confirmed against the worktree:

- `README.md` exists; the cited section homes are real: `### Usage` (line 29, with
  the "no CLI flags" paragraph at line 46 — the D1/D2 insertion point);
  `## How the Self-Improvement works` (line 88 — the D2 improver cross-ref);
  `### Configuration` (167) / `### CLI flags` (204) / `### Hooks` (212) — the D3
  `### Public API` insertion point lands sensibly before `### Hooks`; `### Hook
  examples` (74, e2e described at line 80) and `### afterAllScenarios — the
  verification gate` (126) — the D4 e2e touch points. Line numbers in the plan are
  approximate ("around", "~") but the section names are exact and the homes are
  correct; no new pages are introduced where an existing home fits.
- `examples/skillsmith.config.ts` exists and is the right home for the D5
  credential-comment audit; the README already points to it (line 202), so D5's
  one-line-pointer approach reuses an existing pointer.
- **No `testing-project/README.md` exists** (confirmed `ls`) — the plan's claim is
  correct, and D4 correctly keeps reference-project docs in the main README rather
  than creating one.

### The D5 bug is real

Confirmed in code: `src/providers/gemini-api.ts:8` gates on
`process.env.GOOGLE_GENERATIVE_AI_API_KEY` (and errors with that name), and the
design's `PROVIDER_CREDENTIAL_ENV` maps `gemini-api → GOOGLE_GENERATIVE_AI_API_KEY`.
The example file's `gemini-flash` comment says "uses GEMINI_API_KEY" — wrong. The
planned fix (change the comment to `GOOGLE_GENERATIVE_AI_API_KEY`) matches reality.
`openai-api`/`anthropic-api` comments in the example are correct (verified against
`openai-api.ts:8` / `anthropic-api.ts:8`).

### Scope discipline

- "fail"/"skip" are **not** documented as available now. No such config key or CLI
  flag exists in the code (grep confirms no policy/`warn`/`misconfigured`
  vocabulary today), so D6's "there is no config key (there is none)" and its
  "drop rather than overstate" guidance are accurate and enforce the
  shipped-behavior-only constraint.
- D3's runnability rule and the raw-vs-normalized config shapes match the code:
  `SkillsmithConfigInput.roles.test.agents` is `string[]` and `agents` is a
  record keyed by id (`src/config/types.ts:57,101`), so `agentRunnable` /
  `runnableTestAgentIds` operating on string ids and `config.agents[agentId]
  .provider` is correct. The throw-on-unknown-id contract matches the code-plan
  (Task 1) and is safe for internal callers because `validate.ts:130-132`
  guarantees `roles.test.agents` references real agents.
- The `{ skipped }` marker → `SKIPPED` verdict path is real (`agent-loop.ts:284`),
  and the existing `testing failed: …` skip (`agent-loop.ts:221`) is the unrelated
  skip D1 says to distinguish from via the prefix — grounded.
- `writeAgentReport(agentDirectory, testing, review)` persists `{ testing, review }`
  (`agent-loop.ts:298-308`), so the excluded agent's row is
  `{ testing: { duration: 0 }, review: { skipped: "misconfigured: <VAR> is not set" } }`,
  exactly as D1/D4 describe.
- Audiences (Who) are correct: end-users and CI users (D1/D2), integrators and
  maintainers (D3), reference-project users (D4), provider-configurers (D5),
  maintainers only (D6). Updates are minimal and targeted — five edits to existing
  homes, no new page, D6 optionally collapsing into a code comment.

### No internal-process vocabulary in planned doc bodies

The Why/Source traces (spec/design/plan/AC references) are confined to the plan
and the plan states explicitly they must not appear in any shipped doc. The
documented terms ("misconfigured", "runnable", "excluded", "degrade") are ordinary
domain words, not phase/spec/design/plan/acceptance-criteria/task tags.

## Conclusion

The doc plan documents only shipped behavior, homes each item correctly, fixes a
real bug, and respects scope. Approved with no changes.
