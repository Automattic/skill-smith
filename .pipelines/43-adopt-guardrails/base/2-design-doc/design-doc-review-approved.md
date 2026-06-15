# Design doc review — APPROVED

**Artifact reviewed:** `2-design-doc/design-doc.md` (commit db3842a)
**Against:** approved spec `1-spec/spec.md`
**Context:** `2-design-doc/design-doc-research.md`
**Reviewer:** design-doc-reviewer
**Verdict:** APPROVED

## Summary

The design doc is complete, sound, and fully aligned with the approved spec. It
correctly treats this as a documentation/configuration change (no new runtime
modules, no algorithm), and its design problem — placement, wording, and one
helper script — is the right framing. All three questions the spec delegated to
design (D1 placement, D2 bootstrap home, D3 changeset guarantee) are resolved on
verified evidence, and every load-bearing claim I independently checked against
the live codebase holds.

## Spec coverage — all six requirements and five ACs are addressed

| Spec item | Where addressed | Verdict |
| --- | --- | --- |
| R1 — `## Guardrails` section, peer `##`, committed-only | §4.2, D1 | Covered. Peer `##` matches the file's flat shape; committed-to-`.rp.md` restated. |
| R2 — the six declared gates | §4.1 table | Byte-for-byte match with the spec's R2 table (names, commands, phases). |
| R3 — dependency-key prerequisite + lockfile | §5.1, §8 | Covered, incl. the pre-existing lockfile-drift note ("not scope creep"). |
| R4 — `check:config` script | §5.2 | Script string is byte-identical to the spec's R4. |
| R5 — project-owned bootstrap before any gate | §6, D2 | Covered: standalone `## Worktree bootstrap` section + `scripts/bootstrap-worktree.sh`, two `npm ci`s, `set -euo pipefail`. |
| R6 — accurate changeset-gate prose | §4.3, D3 | Covered without over-claiming; the conditional guarantee is stated correctly. |
| AC1 — each command executes | §7 | Mapped. |
| AC2 — code-phase gates exit 0 on bootstrapped trunk | §7 | Mapped; config-smoke green only after §5. |
| AC3 — config-smoke catches the issue-37 regression class | §7, §2.2 | Mapped; isolation argument (dep-key fix on v3) is correct. |
| AC4 — docs-phase gates behave as specified | §7, §4.3 | Mapped. |
| AC5 — bootstrap precedes gates | §7, §6.2–6.3 | Mapped; BLOCKER-on-omission preserves the contract. |

## Load-bearing claims independently verified against the codebase

I did not take the doc's empirical claims on faith; I re-checked the ones that
carry the design:

1. **D1 — `## Health monitoring` is genuinely the file's last section.** `.rp.md`
   ends at line 81; `## Health monitoring` is the final `##`. The heading list
   the doc cites (§4.2) matches the file exactly, and there is no
   `## Shared conventions` wrapper — so a peer `## Guardrails` appended last is
   the correct structure-preserving choice.
2. **D2 — two `npm ci` commands are genuinely required.** Root `package.json` has
   no `workspaces` key (verified), so a single root `npm ci` cannot install
   `testing-project/`; the two installs are independent. The doc's "not
   belt-and-suspenders" claim is correct.
3. **R3 — the dependency-key mismatch is real.** `testing-project/package.json`
   carries the bare `"skillsmith": "file:.."`; the root package `name` is
   `@automattic/skillsmith`; `skillsmith.config.ts:4` imports the scoped name.
   The rename is necessary and sufficient as described.
4. **R4 — the script matches.** The `check:config` string in §5.2 is byte-identical
   to the spec's, and `defineConfig` (`src/config/define-config.ts`) is a true
   identity passthrough — confirming the "no validation/normalization at import
   time, no full run" claim.
5. **AC3 — the isolation argument is correct, and I verified the cycle's two
   directions.** On current trunk there is **no** cycle: `skillsmith.config.ts:6`
   imports `verify-e2e` (forward edge), but trunk's `verify-e2e.ts` has no
   back-edge import of the config and no top-level `config.roles` read (line 24 is
   a comment). On the v3 worktree the cycle is present:
   `verify-e2e.ts:24` reads `config.roles.test.agents` at module top level while
   `skillsmith.config.ts:6` imports `verify-e2e`. So config-smoke is green on
   trunk because the cycle isn't there, and red on v3 — exactly as the doc frames
   it. The doc's AC3 signature (`Cannot read properties of undefined (reading
   'roles')`) matches the spec's signature at `verify-e2e.ts:24`.
6. **R6/D3 — the continuity claim is accurate.** The two changeset guardrails are
   a one-to-one lift of `.github/workflows/changeset-gate.yml:23-26` ("Validate
   changeset shape" = changeset-format; "Require a changeset for release-relevant
   changes" = changeset-status). `changedFilePatterns` is exactly
   `src/**, bin/**, package.json, examples/**, README.md, !src/__tests__/**`
   (verified), and the committed `none`-bump `.changeset/initial-scaffolding.md`
   explains trunk's green status — both as the doc states. The empty-changeset
   escape is documented in `.changeset/README.md`, corroborating the
   "present, not stricter than policy" claim.

## Soundness checks

- **No over-claiming on changeset-status (D3).** The doc is careful to state the
  conditional guarantee ("release-relevant changes carry a changeset") and
  explicitly rejects the unconditional reading. Correct.
- **Bootstrap does not weaken the contract (§6.3).** A command-not-found in an
  un-bootstrapped worktree is framed as a bootstrap omission that surfaces as a
  BLOCKER, not a guardrail defect. Consistent with AC5.
- **Non-goals match the spec's Out of Scope** (§3.2): no plugin change, no full
  run in any gate, no fixing the issue-37 cycle, no skipping the changeset tests.
- **The optional `verify-e2e.ts:11` alignment is correctly kept advisory** — no
  declared gate compiles that file, so it cannot block the pipeline. The doc
  recommends it but does not make it load-bearing, matching the spec's "optional
  cleanup."

## Minor, non-blocking observations (no rework required)

These do not affect correctness or alignment and need not be addressed before the
plan phase; flagged only for the code/docs phases' awareness:

- **AC3 row wording (§7, line 403)** states config-smoke "exits 0 on a
  dependency-key-fixed trunk (cycle already gone)." On current trunk the cycle was
  never introduced (it lives only on v3), so "already gone" reads as if a fix
  removed it from trunk. The intent — trunk is green because the cycle isn't
  present there — is correct and is stated more plainly elsewhere (§2.2, §6);
  the code/docs phases need not change anything, but should keep this framing
  precise if they restate it.
- **§5.1's lockfile-refresh prose mentions `npm install`** while §6 mandates
  `npm ci` for the bootstrap. These are different operations for different
  purposes (the one-time R3 lockfile re-key vs. the per-run clean install), and
  the doc distinguishes them correctly; noting only so the plan phase keeps the
  two commands from being conflated.

Neither observation is a defect in the design; both are wording-precision notes
for downstream phases.

## Decision

**APPROVED.** The design is complete against all six requirements and five
acceptance criteria, internally consistent, and corroborated by direct inspection
of the codebase. It is ready for the plan phase.
