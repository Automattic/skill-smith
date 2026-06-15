# Code plan review — APPROVED

**Pipeline:** `43-adopt-guardrails` (GitHub Automattic/skillsmith#43)
**Artifact reviewed:** `3-plan/code-plan.md` (commit `0a69953`; tasks T1–T5)
**Reviewed against:** `1-spec/spec.md`, `2-design-doc/design-doc.md`
**Outcome:** Approved.

## Verdict

The code plan is complete, feasible, and faithfully aligned with the approved
spec and design doc. Every requirement (R1–R6) and every acceptance criterion
(AC1–AC5) is covered by a task or explicitly and correctly scoped out. Tasks are
independently executable by a fresh code-writer, each carries concrete
acceptance checks expressed as runnable commands with expected exit codes, and
the ordering constraint (T1 before any assertion that config-smoke is green) is
correct. I verified the load-bearing claims empirically against the live
worktree rather than trusting the prose; all held.

## What I verified empirically (not just read)

I ran the actual guardrail commands and the actual fix mechanism in the worktree
(`worktree-43-adopt-guardrails`, `origin/trunk` = `7ffa5cd`), restoring all
state afterward (final `git status` clean):

- **The four "green today" gates pass on this branch:** `npm run typecheck`
  exit 0, `npm run lint` exit 0 (96 files), `npx tsx scripts/validate-changesets.ts`
  exit 0, `npx changeset status --since=origin/trunk` exit 0. `npm test` exit 0
  with **147 pass / 0 fail / 2 skipped** — byte-for-byte matching the spec's
  stated test posture and confirming the "do not skip validate-changesets tests"
  out-of-scope item.
- **config-smoke genuinely fails today (premise of T1):** running
  `node --import tsx -e "await import('./skillsmith.config.ts')"` from
  `testing-project/` exits 1 with `ERR_MODULE_NOT_FOUND` — exactly the failure
  design §2.3 describes. The current `node_modules` state is a bare
  `node_modules/skillsmith -> ../..` symlink with **no** `@automattic` scoped
  dir, confirming the dependency-key mismatch is real and unfixed on trunk.
- **The T1 fix mechanism works (AC2 for config-smoke):** with the scoped symlink
  `node_modules/@automattic/skillsmith` present (the exact state the dependency-key
  rename + `npm install` produces) and the `check:config` script injected
  byte-for-byte from the plan, the **exact declared gate**
  `npm --prefix testing-project run check:config` run **from the worktree root**
  exits 0. This also retires a real adversarial concern: npm's `--prefix` sets
  the script CWD to `testing-project/`, so the script's relative
  `./skillsmith.config.ts` resolves correctly.
- **Structural claims confirmed by reading the live files:**
  - `testing-project/package.json` keys the dep as `"skillsmith": "file:.."`
    (line 13); `testing-project/skillsmith.config.ts` imports
    `@automattic/skillsmith` (line 4); root `package.json` `name` is
    `@automattic/skillsmith` — the mismatch and its fix are exactly as described.
  - Root `tsconfig.json` `include` is `["src/**/*", "skillsmith.config.ts",
    "examples/**/*"]` — does **not** include `testing-project/`, confirming the
    rename cannot regress the `typecheck` gate (R3 / design §5.1).
  - `verify-e2e.ts:11` imports `from "skillsmith"` (bare) — T2's target line.
  - `.changeset/config.json` `changedFilePatterns` is exactly
    `src/**, bin/**, package.json, examples/**, README.md, !src/__tests__/**` —
    the R6 / design §4.3 prose constraints match the real config.
  - `scripts/validate-changesets.ts` confirms the R6 prose: empty changeset
    (`---\n---\n`) passes (lines 97–99), `none` is a valid bump (line 27),
    pre-1.0 `major` is rejected (lines 145–151), `README.md` excluded but
    `.changeset/*.md` enumerated.
  - `.changeset/initial-scaffolding.md` is a `none`-bump changeset with a
    non-empty body — the committed "present" changeset that explains why
    changeset-status is green on trunk (design §4.3).
  - Both root and `testing-project` lockfiles are `lockfileVersion: 3`,
    confirming `npm ci` is valid in both (T3).
  - `.github/workflows/changeset-gate.yml` runs
    `npx tsx scripts/validate-changesets.ts` and
    `npx changeset status --since=origin/<base>` — confirming T4's optional
    "one-to-one lift / continuity" framing is accurate.
  - `.rp.md` line anchors are correct: `## Claude Code worktrees` at 59–63,
    `## Branch names` at 65, `## Health monitoring` is the last section ending at
    81, `### Orchestrator updates during a run` at 26–39 (T5's cited precedent).

## Coverage check (requirements and ACs)

- **R1, R2** → T4 (the `## Guardrails` table, six rows byte-exact incl.
  `code, docs`, `docs`, and `--since=origin/trunk`). **R6** → T4's
  no-over-claiming prose constraints, which match the verified script behavior.
- **R3** → T1 (dep-key rename + lockfile refresh via `npm install`) and the
  optional T2 (specifier alignment). The `npm install` vs `npm ci` distinction is
  correctly drawn: T1 uses `npm install` to re-key (R3, one-time), T3 uses
  `npm ci` for the per-run bootstrap (R5).
- **R4** → T1 (the `check:config` script, byte-identical string).
- **R5** → T3 (the helper script, two `npm ci`s, `set -euo pipefail`, the
  two-workspace rationale) and T5 (the `## Worktree bootstrap` orchestrator
  run-step that *names* the script). The standalone-vs-folded and
  placement decisions (D1, D2) are carried through faithfully.
- **AC1, AC2** → T1 + T4 acceptance + the cross-cutting section, all verified
  above. **AC3** and **AC5's un-bootstrapped-BLOCKER** are correctly marked
  "not verifiable inside this run" with accurate reasons (AC3 needs the v3
  branch; un-bootstrapping would be self-sabotage). **AC4** → T4 prose, matching
  verified script behavior.
- **Out of Scope** items are all restated and respected (no plugin change, no
  full run, no circular-import fix, no test skip).

## Non-blocking observations (for the code-writer's awareness; none require a revision)

1. **T1's lockfile diff will be large and that's expected.** The plan already
   flags this (absorbing pre-existing `zod`/`@changesets`/`name` drift). The
   code-writer should not be alarmed by a lockfile diff far exceeding the
   one-line key rename, and reviewers downstream should expect it. The plan
   handles this correctly; I note it only so it isn't mistaken for scope creep at
   code-review time.
2. **T1 acceptance step runs `npm install --prefix testing-project` in the live
   worktree.** This mutates `testing-project/node_modules` and the lockfile (both
   intended deliverables). Harmless here, but the code-writer should run it once
   and commit the resulting lockfile rather than re-running speculatively.
3. **T2 / T5 / T4 `.rp.md` line numbers will shift** once edits are applied. The
   plan already instructs separate writers to re-read `.rp.md` before editing and
   notes the two `.rp.md` edits (T4 append-at-end, T5 insert-after-line-63) touch
   non-overlapping regions. This guidance is sufficient.
4. **T2 is advisory and the plan permits skipping it with a recorded reason.**
   That is consistent with the spec/design ("recommended, not required").
   Applying it is the cheap, expected path; the escape hatch is fine.

None of these change any gate's exit code or any acceptance criterion, so none
blocks approval.
