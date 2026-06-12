# Spec review — REJECTED (iteration 1)

Reviewed `1-spec/spec.md` against `0-intent/intent.md` and `1-spec/spec-research.md`,
and verified the load-bearing claims directly against the worktree and the
installed Radical Pipelines 0.3.0 plugin.

**Verdict: REJECT** — for one blocking defect (B1). The spec is otherwise
excellent: thorough, well-scoped, and almost every empirical claim it makes
checks out against the live tree. B1 is a single, narrowly-scoped fix.

---

## Blocking

### B1 — R1's placement locator ("the **shared** section") does not exist in this repo's `.rp.md`, so R1 is unsatisfiable as written

R1 (spec.md:47-51) instructs:

> Add a `### Guardrails` **subsection** to the **shared** section of this repo's `.rp.md`.

This repo's `.rp.md` has **no "shared section."** I read the whole file (81
lines). Its top-level structure is a flat list of `##` conventions with no
shared-vs-per-tool grouping heading:

```
## Managing tasks      ## Pipeline slugs     ## Artifact folders
## Commit format       ## Claude Code worktrees   ## Branch names
## Team spawning       ## Health monitoring
```

There is no `## Shared conventions` (or any grouping `##`) to nest a `###`
under. The only existing `###` subsections are `### Creating an issue` /
`### Modifying an issue` / `### Orchestrator updates during a run`, all nested
under `## Managing tasks` — unrelated to Guardrails.

**Where "shared section" came from.** The term is the plugin's own `.rp.md`
structure. Per `radical-pipelines/0.3.0/README.md:159`, a *standard* RP consumer
organizes `.rp.md` as "a shared section … followed by a per-tool section," and
the plugin's dogfood `.rp.md` literally has `## Shared conventions` with
`### Guardrails` under it (confirmed in
`0.3.0/.pipelines/51-guardrails-convention-v2/base/4-code/code-review-approved.md:21`).
But **this repo's `.rp.md` was never organized that way** — it predates that
convention and is a flat file. So R1 imported a locator that fits the plugin's
file, not this repo's.

**Why this is blocking, not cosmetic.** R1 is the load-bearing "where does the
declaration live" requirement — the plugin reads Guardrails only from the
committed `.rp.md` (correctly captured at spec.md:50-51). An implementer
following R1 *literally* cannot comply: there is no shared section to add a
subsection to. They must improvise, and the two plausible improvisations are
both worse than a one-line spec fix:

- dangle a `### Guardrails` as a `###` with no parent `##` (the exact
  malformed-heading hazard the plugin's own design review flagged at
  `0.3.0/.pipelines/51-guardrails-convention-v2/base/2-design-doc/design-doc-review-approved.md:23`),
  or
- guess a parent and nest Guardrails under an unrelated existing `##` (e.g.
  jam it under `## Managing tasks`), which misfiles it.

The correct mapping for this repo's flat file is a **top-level `## Guardrails`
section** (a `##`, not a `###`), matching the file's existing one-`##`-per-
convention shape. The plugin's loader (`load.md:24-30`) does not parse by
heading level — it's prose-driven and finds Guardrails semantically — so a
top-level `## Guardrails` is fully valid for machine consumption and is the
house-consistent choice here.

**Fix (one requirement, one sentence).** Rewrite R1's locator to match this
repo's actual `.rp.md`. Suggested:

> Add a top-level `## Guardrails` section to this repo's `.rp.md` (the file is a
> flat list of `##` conventions with no shared/per-tool grouping, so Guardrails
> is a peer `##`, not a `###` subsection). It must be committed to `.rp.md`
> itself; it must never live in `.rp.local.md`.

Then drop "subsection" and "**shared** section" everywhere they imply nesting.
(The heading-level choice could alternatively be punted to design — the spec
already delegates the *durable home* of the R5 bootstrap to design at
spec.md:152-154 — but R1 should at least not assert a section that doesn't
exist. State it as a top-level `## Guardrails`, or explicitly hand the placement
to design; either resolves B1.)

---

## Non-blocking notes (fix opportunistically; not gating)

### N1 — "HEAD == origin/trunk" snapshot in the research is now stale (no spec text to change)

Research F2 (spec-research.md:206-207) recorded `HEAD = origin/trunk = 7ffa5cd`.
The worktree has since advanced: `HEAD = ff1bc4c`, `origin/trunk = 7ffa5cd`
(the pipeline-artifact commits). This does **not** affect any spec requirement —
`changeset-status --since=origin/trunk` still exits 0 here (I re-ran it: "NO
packages to be bumped"), because the only changed paths since `origin/trunk` are
under `.pipelines/`, which is non-versionable. AC2/AC4 still hold. Flagging only
so the spec-writer doesn't lean on a literal "HEAD == origin/trunk" framing; the
spec text itself doesn't, so no change is strictly required.

### N2 — AC3's `verify-e2e.ts:24` line number is a v3 fact, not a trunk fact (already correct, just confirming)

AC3 (spec.md:226-238) cites `TypeError … at verify-e2e.ts:24`. On *this* trunk
worktree, `verify-e2e.ts:24` is a comment — but that's expected and correct: the
spec scopes the signature to the `37-skip-misconfigured-agents-v3` branch. I
verified the v3 worktree exists and the mechanism holds exactly: there,
`skillsmith.config.ts:6` imports `verify-e2e`, `verify-e2e.ts:12` does
`import config from "../../skillsmith.config"` (the cycle), and
`verify-e2e.ts:24` is `const CONFIGURED_PROJECT_NAMES = config.roles.test.agents;`
— the precise line that throws. AC3 is accurate and reproducible. No change
needed; noting so the next reviewer isn't tripped up by the line-24-is-a-comment
appearance on trunk.

---

## What I verified as CORRECT (so the spec-writer knows the fix surface is small)

All checked against the live worktree / installed plugin:

- **R2 gate commands** map to real scripts: root `package.json` has
  `typecheck` (`tsc --noEmit`), `lint` (`biome lint .`), `test`
  (`node --import tsx --test src/__tests__/*.test.ts`);
  `scripts/validate-changesets.ts` exists; `changeset` binary resolves
  post-bootstrap. `changeset-format` exits 0; `changeset-status
  --since=origin/trunk` exits 0 here.
- **R3 prerequisite** is real and correctly described: `testing-project/package.json`
  has `"skillsmith": "file:.."` (deps) and **no** `check:config` script;
  `skillsmith.config.ts:4` imports `@automattic/skillsmith` (value);
  `verify-e2e.ts:11` imports bare `skillsmith` (type-only). Root `package.json`
  `name` is `@automattic/skillsmith`, so `"@automattic/skillsmith": "file:.."`
  will resolve to the repo root — the rename mechanism is sound.
- **config-smoke is RED on trunk today** exactly as claimed: I ran
  `node --import tsx -e "await import('./skillsmith.config.ts')"` in
  `testing-project/` → `ERR_MODULE_NOT_FOUND: Cannot find package
  '@automattic/skillsmith'`. So the R3/R4 prerequisites are genuinely required
  for AC2.
- **Typecheck-stays-green analysis (R3)** is correct: root `tsconfig.json`
  `include` is `["src/**/*", "skillsmith.config.ts", "examples/**/*"]`, excludes
  `node_modules`/`dist`, and does **not** compile `testing-project/` — so the
  post-rename bare-`skillsmith` TS2307 on `verify-e2e.ts:11` is invisible to
  `npm run typecheck`. The "optional cleanup" framing of the 4th edit is
  justified.
- **R6 changeset-gate semantics** match `.changeset/config.json`:
  `changedFilePatterns` = `["src/**", "bin/**", "package.json", "examples/**",
  "README.md", "!src/__tests__/**"]`, `baseBranch: trunk`. The "versionable"
  enumeration and the conditional-presence framing are accurate.
- **F4 contract** (cannot-execute ⇒ BLOCKER; runs-but-nonzero ⇒ work; committed-
  only, never `.rp.local.md`) matches the installed loader
  (`0.3.0/.../conventions/load.md:24-46`).
- **AC3 mechanism** reproducible on the v3 worktree (see N2).

The spec is one corrected sentence (B1) away from approval.
