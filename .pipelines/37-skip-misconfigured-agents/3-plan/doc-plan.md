# Doc plan: Skip misconfigured agents across all phases of a run

Tracking issue: https://github.com/Automattic/skillsmith/issues/37
Spec: `1-spec/spec.md` (approved, commit `7bdc87e`)
Design: `2-design-doc/design-doc.md` (approved, commit `ef9a791`)
Code plan: `3-plan/code-plan.md` (approved, commit `2bdb0c2`)

## Overview

This plan enumerates the documentation work that must land alongside the code
change so no user-facing or contributor-facing surface is left describing the
old "misconfigured agent re-fails every iteration" behavior. It plans **what**
to document, **where**, and **for whom** — not the final wording, which the
phase-5 doc-writer fills in by reading the shipped code.

### The behavior the docs must catch up to

A *misconfigured* agent (agent-local config/credential defect that fails
identically every attempt — missing/invalid credential, unknown provider,
model-not-found) is now **identified once and ignored everywhere for the rest
of the run**, with role-specific consequences:

- a misconfigured **tester** is skipped (pre-flight: truly absent; runtime:
  one sentinel cell), excluded from pass/fail math and from re-selection, and
  announced once with its reason — never one failure row per (scenario,
  iteration);
- a misconfigured **judge** fails the run fast with a clear message naming the
  judge and reason;
- a misconfigured **improver** degrades to test-only (valid matrix, no edits,
  no redundant iterations);
- an empty surviving-tester set (per-scenario or whole-run) yields an explicit
  new **INCONCLUSIVE** outcome (non-pass, never a silent pass), with a distinct
  exit code;
- hooks read the misconfigured set as passive data on the run context (keyed by
  agent id, pre-flight entries from `beforeAll`, runtime entries by `afterAll`);
- an unknown `provider` id no longer aborts the whole run at config-load — it is
  now a per-agent skip;
- **a run with no misconfigured agents is unchanged in every observable way**
  (R9/AC14) — docs must not imply the new states appear on a clean run.

### Documentation surfaces found in the repo sweep

A full end-to-end sweep (markdown at every level, the GitHub-Pages landing
page, inline narrative comments, configuration examples, contributor docs)
found these surfaces that reference behavior this feature changes. Every one is
covered by a task below.

1. **`README.md`** (repo root) — the canonical user/contributor doc. References
   the affected behavior in: the run **Lifecycle** sections (Skill Tester
   lifecycle steps 2–6 and the Self-Improvement lifecycle, incl. re-selection
   by `selfImprovement.scope` and the final-pass), the **per-iteration /
   per-agent `report.json` shape**, the **Configuration** block and prose
   (providers, `roles.judge`/`roles.improver`, agents-by-id), the **Hooks**
   table and the `beforeTestAgent` / `beforeAll` / `afterAll` narrative, and
   the implicit **verdict / `RUN RESULT` / exit-code** semantics. This is the
   primary surface.
2. **`examples/skillsmith.config.ts`** — the annotated reference config. Its
   inline comments document, per provider, which credential each agent uses
   (one comment per env-var provider, plus ambient `claude-code`/`codex` auth)
   and the `beforeTestAgent`/`beforeAll` hook examples — exactly the credential
   and hook surfaces the feature touches. Note: the Gemini credential comment is
   currently **stale** (it names a credential the harness does not read); D6
   corrects it from the shipped code.
3. **`docs/index.html`** (GitHub-Pages landing page, linked from README line 3).
   Illustrative only: shows a sample `RUN RESULT: PASS` line and a sample
   pass/fail matrix, and mentions judge/improver/hooks/verdict at a marketing
   altitude. It does not enumerate verdict states or describe credential
   handling, so it does not strictly go stale — but it must be checked for any
   claim the feature contradicts.
4. **Inline narrative doc-comments on `src/config/types.ts`** — the JSDoc on
   `RunContext` and the `Hooks` interface is the in-code contract documentation
   hooks authors read. The new passive misconfigured field is added here by the
   code phase (code task 3); this plan tracks only that the field's *documenting
   comment* reads coherently against the rest of the interface's narrative, so a
   hooks author understands the live/progressive contract.

No surface was found that implies a code task absent from `code-plan.md`, and
the spec is explicit about which behaviors must be surfaced (R7 hooks data, R8
CLI announcement/distinction). No blocker.

### Conventions for the doc-writer (phase 5)

- Read the **shipped code** for exact field names, the exact `RUN RESULT`
  wording, the exact announcement block layout, the exact exit-code value, and
  the exact env-var names. This plan deliberately does **not** fix those.
- Keep the **clean-run-unchanged** guarantee (R9/AC14) visible wherever a new
  state is introduced, so readers do not expect new output on a healthy run.
- Match the surrounding prose voice, heading depth, and comment density of each
  file; do not restructure unaffected sections.

---

## Task D1 — README: document misconfigured-agent skipping in the run lifecycle

**Goal.** Update the README's run narrative so a reader understands that a
misconfigured tester is detected (pre-flight and at runtime), does no further
work in any phase, is excluded from re-selection and from pass/fail accounting,
and that a clean run is unchanged.

**Audience.** Skillsmith users running evaluations and harness contributors who
need to reason about what happens to a defective agent across iterations.

**Files to change.** `README.md` — the "How the Skill Tester works" lifecycle
(esp. the agent-loop / per-agent steps), and the "How the Self-Improvement
works" lifecycle (esp. the re-selection-by-scope step and the final full pass).

**Sections-scope.** The lifecycle bullet(s) covering testing-agent dispatch,
the judge pairing, and iteration re-selection. Add the concept of a
misconfigured agent being skipped everywhere for the rest of the run; do not
duplicate the credential/exit-code detail that D3/D4 own — cross-link instead.

**Depends on.** None (can start once code tasks 8, 9, 10 are stable enough to
confirm the observable lifecycle).

**Traces to.** Spec R2, R3, R9; AC1, AC2, AC6, AC14 / code tasks 8, 9, 10.

**Acceptance.** A reader of the lifecycle sections can state: when a tester is
misconfigured, it is skipped (not run, not graded, not re-selected) and its
skip does not count as a failure; and that this changes nothing for a run with
no misconfigured agents. The reader is told detection happens both pre-flight
and at runtime without the prose pinning a specific function or signature.

## Task D2 — README: document judge fail-fast and improver graceful degrade

**Goal.** Document the asymmetric single-instance-role consequences: a
misconfigured judge terminates the run with a clear message naming the judge
and reason; a misconfigured improver degrades the run to test-only (valid
matrix, no skill edits, no redundant identical iterations).

**Audience.** Users who configure `roles.judge` / `roles.improver` and need to
predict what happens when those agents' credentials are wrong.

**Files to change.** `README.md` — the "Rubrics and the judge" / judge prose
and the "How the Self-Improvement works" improver prose; the Configuration
block prose around `roles.judge` and `roles.improver` may need a one-line note
or cross-link.

**Sections-scope.** The judge and improver role descriptions only. State the
two outcomes and why they differ (judge is the single point that produces the
matrix; improver is non-blocking). Do not specify the error type or exact
message text.

**Depends on.** None (confirm against code task 10 behavior).

**Traces to.** Spec R6; AC12, AC13, AC10 (same id in multiple roles) / code
task 10.

**Acceptance.** A reader configuring a judge or improver can predict that a bad
judge stops the run with a named reason (no partial matrix, no repeated per-pair
failures) while a bad improver still yields a graded matrix and simply skips
self-improvement — and understands these are role-specific, decided per agent
id once.

## Task D3 — README: document the INCONCLUSIVE outcome, verdict, and exit code

**Goal.** Introduce the new run/scenario outcome for an empty surviving-tester
set: a scenario whose testers are all misconfigured is marked inconclusive
(siblings still roll up normally); a whole-run all-misconfigured set yields an
explicit non-pass "inconclusive" run result with its own exit code — never a
silent pass over an empty set, and visibly distinct from a real test failure.

**Audience.** Users who read the `RUN RESULT` line / process exit code (incl.
anyone scripting CI on skillsmith's exit status), and contributors reasoning
about verdict computation.

**Files to change.** `README.md` — wherever the run verdict / `RUN RESULT` /
pass-fail outcome and exit semantics are described (lifecycle close-out and any
verdict prose). If no dedicated verdict/exit subsection exists, add a brief one
at the altitude of the surrounding sections.

**Sections-scope.** The verdict/exit-code semantics and the empty-set case.
Cover: the three observable run outcomes (pass / fail / inconclusive), that
inconclusive is non-pass and never silent, that it is surfaced with the
misconfigured ids and reasons, and the per-scenario vs whole-run granularity.
Do not hard-code the exact exit-code integer or the exact rendered string — the
doc-writer reads `summary.ts` for those.

**Depends on.** Depends conceptually on D4 (announcement) for cross-linking;
otherwise none. Confirm against code tasks 6, 7, 11.

**Traces to.** Spec R5, R5a, R5b, R8; AC11a, AC11b, AC4 / code tasks 6, 7, 11.

**Acceptance.** A reader can distinguish, from the README, an inconclusive run
(every tester misconfigured) from a genuine FAIL and from a PASS, knows it is
never reported as a silent pass, knows it carries a distinct exit status, and
knows a single all-misconfigured scenario does not derail healthy sibling
scenarios.

## Task D4 — README: document the one-time misconfigured-agent CLI announcement and its distinctness from a real failure

**Goal.** Document that each misconfigured/skipped agent is announced exactly
once per run, with its id and the reason it was skipped, in a presentation
visually distinct from a genuinely-failing well-configured agent — replacing the
old repeated per-(scenario, iteration) failure rows. Note that a real test
failure is still reported as a failure and still counts.

**Audience.** Users reading the CLI summary / `summary.txt` and the live
progress dashboard.

**Files to change.** `README.md` — the CLI/summary and report-output prose
(near the per-iteration reports / `summary.txt` description and any
dashboard/progress mention).

**Sections-scope.** The console/`summary.txt` output description and (briefly)
the live dashboard. Describe the once-per-run skipped-agents announcement and
its visual distinctness from the red failure block; preserve the statement that
genuine failures are still failures. Do not reproduce the exact block layout or
color names verbatim — describe the coverage and let the doc-writer match the
shipped rendering.

**Depends on.** D3 (cross-link verdict ↔ announcement).

**Traces to.** Spec R8; AC3, AC4 / code tasks 11, 12.

**Acceptance.** A reader knows that a misconfigured agent shows up once, with
its reason, in a section distinct from real failures, and that a real test
failure still appears as a counted failure — so the two are never confused in
the output.

## Task D5 — README: document the hooks-visible misconfigured set on the run context

**Goal.** Document that hooks can read the set of misconfigured/skipped agents
as **passive data keyed by agent id** (including the role(s) each fills) on the
existing run context — pre-flight skips readable from the earliest run-scoped
hook so per-agent provisioning is not wasted, runtime-discovered skips readable
by end-of-run hooks — with **no new mandatory callback** required of hooks that
don't need it, and the field empty/inert on a clean run.

**Audience.** Hook authors (project forks implementing provisioning/reporting
hooks against the harness runtime contract).

**Files to change.** `README.md` — the Hooks table / hooks narrative and the
`beforeTestAgent` provisioning example (note that provisioning does not fire for
a misconfigured agent); cross-reference the in-code contract (D7).

**Sections-scope.** The hooks contract narrative. Cover: the field is passive
(read-only data, not a callback), keyed by agent id with roles, the
temporal/progressive availability (`beforeAll` sees pre-flight, `afterAll` sees
accumulated), that provisioning hooks never fire for a skipped agent, and that
on a clean run the set is empty and changes nothing. Do not pin the exact field
name or TypeScript type signature — defer to the code.

**Depends on.** Pairs with D7 (the in-code field comment). Confirm against code
tasks 3, 9, 10.

**Traces to.** Spec R7; AC8, AC9, AC10 / code tasks 3, 9, 10.

**Acceptance.** A hook author can determine from the README how to read which
agents were skipped (and their roles) without implementing any new callback,
understands which hook timings see pre-flight vs runtime entries, and knows
provisioning is not wasted on a skipped agent.

## Task D6 — examples config: document credential/provider-skip behavior and the unknown-provider change

**Goal.** Update the annotated reference config's inline comments so a reader
copying it understands that an agent whose credential is missing/invalid (or
whose provider id is unknown) is now skipped per-agent rather than failing the
run or repeatedly erroring, and that an unknown `provider` id no longer aborts
config-load.

**Audience.** New users copying `examples/skillsmith.config.ts` into their own
project who need to know what happens when a credential or provider id is wrong.

**Files to change.** `examples/skillsmith.config.ts` — the per-provider
credential comments (one per env-var provider, plus the ambient-auth lines)
and, where relevant, the `provider` field comment.

**Sections-scope.** Inline comments on the `agents` entries and provider lines.
Add a short, accurate note that a missing/invalid credential or an unknown
provider skips that agent (not the whole run); keep it terse to match the file's
comment style. Do not change the config's executable shape or add new fields.
Source each provider's exact credential env-var name from the shipped code (the
classifier's `CREDENTIAL_ENV_VAR` map / the provider modules introduced by code
task 1) — do not copy literals from this plan or from the file's existing
comments. In particular, the current Gemini credential comment
(`examples/skillsmith.config.ts:75`) is **stale** and names a credential the
harness never reads; it must be corrected to match the env var the Gemini
provider actually probes in the shipped code.

**Depends on.** Confirm against code tasks 1, 4, 5, 10 (which env vars are
probed, unknown-provider demotion).

**Traces to.** Spec R1, R2; KD1, KD2 / code tasks 1, 4, 5, 10.

**Acceptance.** A reader copying the example understands, from the comments,
that a bad/absent credential or an unknown provider id for one agent skips that
agent rather than aborting the run, and which credential each provider uses.

## Task D7 — In-code contract comment: the run-context misconfigured field reads coherently for hook authors

**Goal.** Ensure the doc-comment introduced with the new passive misconfigured
field on the run-context type (added by code task 3) reads as coherent contract
documentation alongside the surrounding interface narrative — clearly conveying
that it is passive, keyed by agent id, and progressive (pre-flight at
`beforeAll`, accumulating by `afterAll`).

**Audience.** Hook authors reading the TypeScript types in `src/config/types.ts`
as the in-code contract (IDE hover / source reading).

**Files to change.** `src/config/types.ts` — the doc-comment on the new field
and any neighboring `RunContext` / `Hooks` narrative that should reference it.

**Sections-scope.** Only the documenting comment for the new field and minimal
neighboring narrative. This is a documentation-coherence check, not a code
change: the field itself and its type are owned by code task 3. Do not restate
the type signature in prose or duplicate D5's README narrative — keep the
in-code comment concise and consistent with the existing comment style in the
file.

**Depends on.** Code task 3 (field exists); pairs with D5.

**Traces to.** Spec R7; AC8 / code task 3.

**Acceptance.** A hook author reading the type in-editor understands from its
comment that the field is passive data keyed by agent id with roles, and when
pre-flight vs runtime entries are visible — without needing to leave the source
file.

## Task D8 — Landing page: verify no stale verdict/behavior claim

**Goal.** Confirm the GitHub-Pages landing page contains no claim the feature
contradicts (it shows an illustrative `RUN RESULT: PASS` and a sample matrix at
marketing altitude). Apply a minimal correction only if a concrete claim is now
false; otherwise leave it unchanged.

**Audience.** Prospective users reading the public landing page.

**Files to change.** `docs/index.html` — only if a stale claim is found; default
expectation is no edit.

**Sections-scope.** The "Example result" / matrix and verdict illustration and
any judge/improver/hook prose. Verify-only: the page is illustrative, not a
behavior reference, so an example `PASS` is not made stale by adding an
INCONCLUSIVE state. The reviewer must explicitly confirm this rather than assume
it.

**Depends on.** D3, D4 (so the verifier knows the new verdict/announcement
shape to check against).

**Traces to.** Spec R8, R9 / code task 11 (verdict surface).

**Acceptance.** The landing page is confirmed to make no claim contradicted by
the new skip/inconclusive behavior; if any concrete stale claim existed it is
corrected, and the verification outcome (edited or confirmed-clean) is stated.
