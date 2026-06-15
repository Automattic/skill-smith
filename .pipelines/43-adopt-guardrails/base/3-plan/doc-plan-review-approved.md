# Doc plan review — APPROVED

Reviewed: `.pipelines/43-adopt-guardrails/base/3-plan/doc-plan.md` (commit 29b7415, two tasks)
Against: `1-spec/spec.md`, `2-design-doc/design-doc.md`, `3-plan/code-plan.md`, and the live repo.

**Verdict: APPROVED.** The doc plan is complete, drift-resistant, and aligned with the spec,
design doc, and code plan. Every traceability claim checks out against the source artifacts, and
every empirical assertion I tested holds.

## What the plan gets right

### Scope and completeness
The plan correctly frames this as a documentation-and-configuration change where most of the
"documentation" (the `.rp.md` `## Guardrails` and `## Worktree bootstrap` prose) is the **code
phase's** deliverable (code-plan T4/T5), so the docs phase does not re-author it — it verifies it
and fills the two genuine gaps:

1. **`CONTRIBUTING.md` "Running tests and checks locally"** (Task 1b) — a real gap. The section
   (CONTRIBUTING.md:5–12) lists exactly the four checks the plan names (`npm run lint`,
   `npm run typecheck`, `npm test`, `npm run smoke`) and mentions neither `check:config` nor the
   declared guardrail set.
2. **The changeset decision for this PR** (Task 2) — required by AGENTS.md:5 and
   `CONTRIBUTING.md#adding-a-changeset`. The plan makes this an explicit, verified
   *determination* ("no changeset, and here's the basis") rather than a silent omission, which is
   the correct treatment.

All three spec/design audiences (orchestrator, human contributor, changeset reader) are mapped to
an owner, with a clear code-phase/docs-phase boundary.

### Drift-resistance (the plan's strongest dimension)
- Task 1 forbids reproducing the six-row guardrail table in `CONTRIBUTING.md` and cross-references
  `.rp.md` instead — closing the most obvious drift trap.
- Sub-step 1a is a **read-only verification** with an explicit "stop and report a BLOCKER; do not
  edit `.rp.md`" rule that respects the phase boundary (the section is the code phase's artifact).
- Task 1b instructs reading the *real* `check:config` command from `testing-project/package.json`
  rather than trusting the plan.
- Task 2 instructs verifying the changed-path set against the *actual* diff
  (`git diff --name-only origin/trunk...HEAD`) and carries a well-specified flip condition.
- The "Out of scope" section directly targets the failure modes (re-authoring `.rp.md`, table
  duplication, restating changeset semantics, speculative empty changesets, touching versionable
  paths).

### Alignment — every traceability claim verified
- The six-row table in Task 1's verification matches spec R2 / design §4.1 / code-plan T4
  byte-for-byte, including `--since=origin/trunk` and the `code, docs` phase value.
- The no-over-claiming constraints (changeset-format = shape-only/presence-agnostic;
  changeset-status = conditional-presence) match spec R6 and design §4.3/D3.
- The `## Worktree bootstrap` placement-verification matches design §6.2/D2 and code-plan T5.
- The changeset-exclusion reasoning matches the live `.changeset/config.json` `changedFilePatterns`
  (`src/**`, `bin/**`, `package.json`, `examples/**`, `README.md`, `!src/__tests__/**`) and the
  `CONTRIBUTING.md` exclusion list (CONTRIBUTING.md:31). The plan correctly distinguishes the
  **root** `package.json` (in-pattern) from `testing-project/package.json` (not in-pattern).

## Empirical verification performed
- `npx changeset status --since=origin/trunk` → **exit 0** ("NO packages to be bumped") on the
  current branch. Task 2's central determination ("no changeset required", changeset-status exits 0)
  is correct.
- `npx tsx scripts/validate-changesets.ts` → **exit 0**. The changeset-format gate passes on the
  existing committed changesets (`.changeset/initial-scaffolding.md`), as Task 2 asserts.
- Referenced artifacts exist: `scripts/validate-changesets.ts`, `.github/workflows/changeset-gate.yml`,
  the root `smoke` script (package.json:33).
- `testing-project/package.json` still has the bare `"skillsmith": "file:.."` key and no
  `check:config` script, confirming Task 1's "depends on T1 having landed" sequencing is necessary
  and real.

## Non-blocking observations
- Task 1's style guidance ("terse, each bullet maps a command to one line") accurately describes the
  existing CONTRIBUTING.md bullet shape (lines 9–12).
- Task 1's optional one-line human pointer to the bootstrap commands is correctly framed as optional
  and is gated against implying the pipeline relies on a human running it (consistent with design
  §6.2: "AGENTS.md is intentionally not the trigger").

No gaps, no drift traps, no misalignments. Approved for the docs phase.
