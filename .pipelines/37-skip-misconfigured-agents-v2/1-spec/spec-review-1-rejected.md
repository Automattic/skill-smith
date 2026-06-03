# Spec review 1 — REJECTED

Reviewer: `spec-reviewer` (adversarial, single-shot). Iteration N=1.
Target: `1-spec/spec.md`. Context: `0-prompt/prompt.md`, `1-spec/spec-research.md`.

Verdict: **Needs changes.** The spec is strong on the core anti-regression logic
(R3.3 exit-code threading, R3.4 all-excluded guard, role-aware judge-stop /
improver-degrade, single policy seam, the chokepoint description). The codebase
facts it asserts were spot-checked against the worktree and all hold. But three
material problems block approval — the largest is that the "Open items" section
was gutted relative to the grounded research, which mis-sets the design phase's
agenda.

---

## Blocking issues

### B1 — Open items gutted: four+ genuine design decisions silently dropped, and the two that remain are not actually open

The research (`spec-research.md`, "Open decisions deferred to the design phase",
lines 438–459) deferred **six** concrete, code-cited HOW decisions. `spec.md`'s
"Open items" (lines 244–260) records only **two** — and those two are
restatements of requirements that are *already decided*, not open questions:

- Spec open item 1 ("driving role-aware behaviors deterministically") is just
  R4.4 restated. R4.4 already *requires* deterministic testability; it is not an
  unresolved choice.
- Spec open item 2 ("statically un-checkable providers stay runnable") is just
  R1.3 restated. R1.3 already *settles* this.

Meanwhile these genuinely-open design decisions from the research vanished with
no home in `spec.md` (not in Requirements, not in Open items, not in Out of
Scope):

1. **The exact mechanism that threads "an agent was excluded" to the single
   exit-code chokepoint** — reuse the existing non-PASS marker/row vs. a new
   top-level "excluded agents" field (research §Exit-code Part A, lines 174–189;
   research open-decisions bullet 1). This is the central HOW behind R3.3/R3.4
   and must be flagged as a design decision, not left implicit.
2. **Whether to add a new status/verdict kind (`excluded`/`misconfigured`) or
   reuse the existing `SKIPPED` kind** for surfacing (research lines 215–222;
   open-decisions bullet 2). R3.2 states the *behavior* ("distinguishable from a
   normal failure and an unrelated skip") but the mechanism is an open choice.
3. **How the provider→credential requirement is expressed** (extend the
   `Provider` contract vs. a separate provider→env mapping) **and whether
   `codex` opts into the `OPENAI_API_KEY` check** (research lines 91–97, 450).
4. **Whether to export `UserFacingError` (currently internal-only) or reuse an
   existing precondition/abort path** for the judge stop, R4.1 (research lines
   133–134, 456).
5. The precise **R5 public-API surface/signature** (research open-decisions
   bullet 4).
6. The exact **nano model id string** for `openai-api-nano` (research
   open-decisions bullet 6).

**What must change:** Replace the current two-item list with the research's set
of genuinely-open HOW decisions (items 1–6 above, or a justified subset). Do not
list already-settled requirements as "open." Items 5 and 6 are minor and may be
folded in briefly, but **items 1–4 are load-bearing** (they are the design
choices behind R3.2, R3.3, R3.4, R4.1, and R1.3's codex edge) and must each be
recorded as an open design decision. If the brief's "two open items" framing is
being honored literally, that framing predates the six-way research expansion;
the grounded research is authoritative for what design must settle.

### B2 — `codex` provider silently dropped from R1.3 and from Definitions

The codebase has a `codex` provider (`src/providers/codex.ts`) that reads the
**same** `OPENAI_API_KEY` (`codex.ts:65`) but does **not** pre-check it
(research lines 16–17, 74–76). The research's R1.3 explicitly names codex:
"(`claude-code`, `mock`, and `codex` unless the design opts it into the
`OPENAI_API_KEY` check)".

`spec.md` drops codex entirely:
- Definitions (lines 53–54) name only `claude-code` and `mock` as having "no
  environment-readable credential gate."
- R1.3 (lines 77–81) lists only `claude-code` and `mock`.
- Out of Scope (lines 272–274) again lists only `claude-code`, `mock`.

This leaves codex's status undefined: a reader cannot tell whether codex is
statically misconfigurable, runnable-by-default, or out of scope — even though
it shares `OPENAI_API_KEY` and is a live provider.

**What must change:** Account for `codex` explicitly. Either (a) add it to R1.3's
"not statically misconfigurable" set with the research's qualifier ("unless the
design opts it into the `OPENAI_API_KEY` check"), and reflect the codex-opt-in
choice in the Open items per B1.3; or (b) state deliberately that codex is out
of scope for this feature. Silence is not acceptable for a provider that gates
on the very credential this feature keys off.

### B3 — "Playwright" genericized to "browser-test," weakening the prompt's named acceptance (R6/AC5)

`spec.md` replaces every "Playwright" with "browser-test" (lines 14, 36, 38,
149, 222, 224, 231). The prompt names Playwright directly
(`prompt.md:49,53`: "creates one Playwright project per configured agent",
"Playwright setup"), and the research grounds the e2e change in the concrete
`testing-project/playwright.config.ts` `projects` array and the
`${iterationDir}/tests-report.json` report keyed by `projectName` (research
lines 239–282).

The likely motivation is R7.4 (no internal-process vocabulary), but R7.4 forbids
*internal-process* vocabulary (phase names, specs, design docs, plans,
acceptance-criteria/task ids) in **shipped deliverables**, and explicitly scopes
itself: "This document may use such vocabulary; the constraint applies to the
shipped deliverables." "Playwright" is a real third-party tool present in the
repo, not process vocabulary, and the spec is not a shipped deliverable. So the
genericization is not required — and it costs concreteness:

- R6.1 ("MUST NOT create a browser-test project") no longer points clearly at
  the actual change site, the `projects` array in
  `testing-project/playwright.config.ts`.
- AC5.1 references a "browser-test report" but drops the concrete verifiable
  artifact the research established: `${iterationDir}/tests-report.json` whose
  results carry `projectName: "haiku"` and none for `openai-api-nano`. Acceptance
  criteria are supposed to be "observable and testable"; the current wording is
  testable only after a reader re-derives that "browser-test report" means that
  file.

**What must change:** Use "Playwright" where the prompt and code do, and restore
the concrete acceptance artifact in AC5.1 (the `tests-report.json` /
`projectName` attribution, or at minimum a named, file-level check), so AC5 is
verifiable as written rather than after translation.

---

## Non-blocking observations (fix if convenient; not gating)

- AC5.1 could additionally name the merged `${runDirectory}/report.json` as the
  place the "misconfigured/excluded — not an e2e failure" distinction is
  machine-checkable, mirroring AC2.4. The research supports this (lines 276–282).
- R1.2/R1.3 and the Definitions repeat the provider→env mapping three times
  (Overview line 52–54, Definitions, R1.2). Not wrong, just redundant.

---

## What I verified (and that passed)

- Public barrel `src/index.ts` exports exactly what the spec assumes
  (`defineConfig`, config types, `Provider`/`ProviderId`, `run`, `RunOptions`);
  the new runnability API would indeed need to be a named export here (R5.1). ✓
- `openai-api` gates on `OPENAI_API_KEY` and returns `{ error: "OPENAI_API_KEY
  is not set" }` from `invoke()` — pre-invoke static check is exact (R1.2). ✓
- Exit code is decided at a single chokepoint, `prepareSummary`
  (`summary.ts:66–76`): `allPass = rows.length > 0 && rows.every(isRowPass)`,
  exit `allPass ? 0 : 1`. R3.3's "thread a signal to the single chokepoint" and
  the "merely dropping the row is FORBIDDEN" framing match the code exactly. ✓
- `testing-project/skillsmith.config.ts` declares only `claude-code`
  haiku/opus and `roles.test.agents: ["haiku"]`; no `openai-api-nano` yet — so
  R6.2 (add it) is necessary and correctly stated. ✓
- `playwright.config.ts` maps one project per declared test-agent id
  (`config.roles.test.agents.map((agentId) => ({ name: agentId, ... }))`);
  filtering that array is the e2e-side change R6.1 describes. ✓
- The `mock` provider already carries a deterministic `mock-fail-testing`
  sentinel and improver-marker logic — confirming a deterministic
  misconfiguration provider is feasible, so R4.4 / Open item 1 are achievable. ✓
- R3.4 / AC2.3 (all-excluded stays non-zero) and the Out-of-Scope note that a
  future "skip" must re-establish the all-excluded guard are sound and
  consistent with the emergent guard in `prepareSummary`/`isRowPass`. ✓
- R4.1's hedge ("SHOULD be detected up front when the judge's provider is
  statically checkable") correctly accommodates `testing-project`'s
  `claude-code` judge being un-checkable. ✓
- Role-aware exit-code semantics are correct: improver-degrade does NOT force
  non-zero (R4.2), and the forced-non-zero rule is correctly scoped to excluded
  TEST agents (R3.3). ✓
- No internal-process vocabulary detected in the spec's prescription of the
  shipped deliverables (R7.4 as applied to code is respected). ✓

---

## Summary

Fix B1 (restore the genuine open design decisions; stop listing settled
requirements as open), B2 (account for `codex`), and B3 (use "Playwright" and
restore the concrete AC5 artifact). The core logic is correct and need not
change; these are completeness/concreteness defects that would otherwise force
the design phase to re-derive decisions the research already surfaced.
