# Spec review — APPROVED

Re-review of `1-spec/spec.md` (revised at commit `e0a5026`) against
`0-intent/intent.md` and `1-spec/spec-research.md`, after rejection iteration 1
(`1-spec/spec-review-1-rejected.md`). Load-bearing claims re-verified against the
live worktree.

**Verdict: APPROVE.** The single blocking defect B1 is fixed correctly and
completely, and the rest of the spec remains accurate against the current tree.

---

## B1 — FIXED (verified)

B1 was: R1's placement locator instructed adding a `### Guardrails` **subsection**
to the **shared** section of `.rp.md`, but this repo's `.rp.md` has no shared
section — it is a flat list of `##` conventions — so R1 was unsatisfiable as
written.

The revision (diff at `e0a5026`) rewrites R1's first paragraph to:

> Add a top-level `## Guardrails` section to this repo's `.rp.md`. This repo's
> `.rp.md` is a flat list of `##` conventions with no shared/per-tool grouping
> heading, so Guardrails is a peer `##` section, not a `###` subsection nested
> under a grouping heading. […] The exact placement of the section within
> `.rp.md` is delegated to the design phase.

This is exactly the fix the rejection recommended, and it resolves B1 on every
count I can check:

- **The locator now matches the real file.** I re-read `.rp.md`'s heading
  structure: top-level `##` conventions only — `## Managing tasks`,
  `## Pipeline slugs`, `## Artifact folders`, `## Commit format`,
  `## Claude Code worktrees`, `## Branch names`, `## Team spawning`,
  `## Health monitoring` — with the only `###` subsections (`### Creating an
  issue`, `### Modifying an issue`, `### Orchestrator updates during a run`)
  nested under `## Managing tasks`. There is no `## Shared conventions` or any
  grouping `##`. A peer `## Guardrails` is the house-consistent, satisfiable
  placement.
- **No residual contradictory language.** The only remaining occurrence of
  "subsection" in the spec is inside the new corrective sentence that explicitly
  states Guardrails is *not* a `###` subsection. "Shared section" no longer
  appears. `### Guardrails` no longer appears as an instruction.
- **The machine-consumption rationale is sound and preserved.** R1 still records
  that the plugin's loader is prose-driven and does not parse by heading level
  (matching `load.md:24-30` from the previous verification), so `## Guardrails`
  is valid for the loader. The committed-only / never-`.rp.local.md` constraint
  is retained verbatim.
- **Delegating placement to design is consistent** with how the spec already
  delegates R5's durable-home decision to design — and it does not re-introduce
  the defect, because R1 no longer *asserts* a section that doesn't exist; it
  names a satisfiable `##` peer and hands only the position to design.

## Re-verification of the rest of the spec (still CORRECT)

The worktree advanced since iteration 1 (`HEAD` is now the spec-revision commit
`e0a5026`; `origin/trunk` is still `7ffa5cd`). I re-checked the load-bearing
facts against the current tree to be sure nothing drifted:

- **R2 gate commands** map to real scripts/files: root `package.json` `name` is
  `@automattic/skillsmith`; `typecheck`=`tsc --noEmit`, `lint`=`biome lint .`,
  `test`=`node --import tsx --test src/__tests__/*.test.ts`;
  `scripts/validate-changesets.ts` exists. The R2 table in spec.md matches the
  intent and research tables exactly (six gates, same commands, same phases).
- **R3/R4 prerequisites are still genuinely pending** on trunk:
  `testing-project/package.json` still has the bare `"skillsmith": "file:.."`
  dependency key (no `@automattic/skillsmith`) and **no** `check:config` script —
  so config-smoke is still RED on trunk and the prerequisite edits are real.
- **R3's "typecheck stays green" argument holds:** root `tsconfig.json` `include`
  is `["src/**/*", "skillsmith.config.ts", "examples/**/*"]`, `exclude`
  `["node_modules", "dist"]` — it does not compile `testing-project/`, so the
  post-rename bare-`skillsmith` TS2307 on `verify-e2e.ts:11` is invisible to
  `npm run typecheck`. Confirmed `verify-e2e.ts:11` is the type-only
  `import … from "skillsmith"` and `config.ts:4` is the value
  `import { defineConfig } from "@automattic/skillsmith"`.
- **R6 changeset-gate semantics** match `.changeset/config.json`:
  `changedFilePatterns` = `["src/**", "bin/**", "package.json", "examples/**",
  "README.md", "!src/__tests__/**"]`, `baseBranch: trunk`. The "versionable"
  enumeration and conditional-presence framing are accurate.

The non-blocking notes from iteration 1 (N1: the stale `HEAD == origin/trunk`
research snapshot; N2: AC3's `verify-e2e.ts:24` being a v3 fact, correctly scoped)
were never blocking and required no spec text change; they remain non-issues. The
spec text does not lean on a literal "HEAD == origin/trunk" framing, and AC3
explicitly scopes its `TypeError` signature to the
`37-skip-misconfigured-agents-v3` branch.

## Conclusion

B1 is resolved; no new defects introduced; all re-verified empirical claims hold.
Approved for the design phase.
