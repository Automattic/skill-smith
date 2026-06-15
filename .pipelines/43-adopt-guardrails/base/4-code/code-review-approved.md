# Code review — APPROVED

Batch: **T1, T2, T3, T4, T5** for pipeline `43-adopt-guardrails` (Automattic/skillsmith#43,
"Adopt Radical Pipelines guardrails").

Reviewed `7ffa5cd → current HEAD` against the approved code plan
(`3-plan/code-plan.md`), spec (`1-spec/spec.md`), and design doc
(`2-design-doc/design-doc.md`).

## Verdict

Approved. All five tasks are implemented exactly as planned, the diff touches only
the five files the design's §8 net-artifacts list specifies (no `src/` edits, no
plugin changes, no stray files), and all six guardrail commands exit 0 from the
worktree root.

## Scope of changed code (excluding `.pipelines/` bookkeeping)

```
.rp.md                                   | 33 +
scripts/bootstrap-worktree.sh            |  5 +
testing-project/eval/utils/verify-e2e.ts |  2 +-
testing-project/package-lock.json        | 15 +-
testing-project/package.json             |  5 +-
```

## Per-task verification

### T1 — config-smoke enablers (commit d30f530)

- `testing-project/package.json`: dependency key renamed
  `"skillsmith": "file:.."` → `"@automattic/skillsmith": "file:.."`; the bare key
  is gone. ✓
- `check:config` script added; its value parses to the byte-identical string
  `node --import tsx -e "await import('./skillsmith.config.ts')"` (verified via
  `JSON.parse`). ✓
- `testing-project/package-lock.json` re-keyed to `@automattic/skillsmith`, the
  scoped `node_modules/@automattic/skillsmith` link added, the bare
  `node_modules/skillsmith` link removed. The pre-existing drift the plan/spec
  predicted is absorbed in the same update: `zod ^3.25.76 → ^4.0.0`, the
  `@changesets/*` devDeps, and the root `name` field. Expected, not scope creep. ✓
- Runtime resolution confirmed: `testing-project/node_modules/@automattic/skillsmith`
  is a symlink to `../../..` (repo root) and resolves; the bare `skillsmith` link
  is gone.
- Empirical: `npm --prefix testing-project run check:config` → exit 0;
  `npm run typecheck` → exit 0 (rename does not regress typecheck). ✓

### T2 — verify-e2e import alignment (commit 044470c)

- `testing-project/eval/utils/verify-e2e.ts:11` now imports from
  `"@automattic/skillsmith"`. ✓
- Non-blocking task applied cleanly; `npm run typecheck` and `npm run lint` both
  exit 0, so it regresses no declared gate. ✓

### T3 — bootstrap helper script (commit 8bdd094)

- `scripts/bootstrap-worktree.sh` created with exactly the planned content:
  `#!/usr/bin/env bash`, `set -euo pipefail`, `npm ci`, `npm ci --prefix testing-project`
  (in that order). ✓
- `test -x` passes (executable bit set); `bash -n` passes (valid syntax). Not
  executed in-worktree, per the plan's instruction (deps already installed). ✓

### T4 — `## Guardrails` section (commit 59370e5)

- Appended as the final top-level section, a peer `##` after `## Health monitoring`
  (heading order confirmed: `… → Team spawning → Health monitoring → Guardrails`). ✓
- Six-row table with header `| Name | Command | Phase |`; every Command and Phase
  cell is byte-for-byte the spec R2 table, including `code, docs` for
  changeset-format, `docs` for changeset-status, and `--since=origin/trunk`
  (not `--since=trunk`). ✓
- Changeset prose satisfies R6 with no over-claiming: states the conditional
  guarantee for changeset-status ("release-relevant (versionable) changes carry a
  changeset"; explicitly does **not** force a changeset for non-versionable
  docs-phase changes), the shape-only/presence-agnostic guarantee for
  changeset-format, both empirical properties (empty changeset counts as present;
  real teeth incl. `README.md` with the `!src/__tests__/**` exclusion), and the
  GitHub-Actions continuity note. ✓
- Empirical: `npx tsx scripts/validate-changesets.ts` → exit 0;
  `npx changeset status --since=origin/trunk` → exit 0. ✓

### T5 — `## Worktree bootstrap` section (commit c13022c)

- Standalone peer `##` section inserted immediately after `## Claude Code worktrees`
  and before `## Branch names`; the `## Claude Code worktrees` block itself is
  unchanged (the diff only adds the new section after it). ✓
- Reads as an imperative orchestrator run-step: runs
  `bash scripts/bootstrap-worktree.sh` after `EnterWorktree` and before launching
  any phase agent or guardrail; names the script rather than restating the two
  commands; explains the two-workspace `npm ci` rationale (no `workspaces` key) and
  the BLOCKER-on-omission behavior. ✓

## Cross-cutting acceptance (all from the worktree root)

| Gate              | Command                                          | Exit |
| ----------------- | ------------------------------------------------ | ---- |
| typecheck         | `npm run typecheck`                              | 0    |
| lint              | `npm run lint`                                   | 0    |
| tests             | `npm test`                                       | 0    |
| config-smoke      | `npm --prefix testing-project run check:config`  | 0    |
| changeset-format  | `npx tsx scripts/validate-changesets.ts`         | 0    |
| changeset-status  | `npx changeset status --since=origin/trunk`      | 0    |

`npm test` reports 149 tests (147 pass, 0 fail, 2 skipped), matching the spec's
documented baseline — `validate-changesets.test.ts` was not skipped or pre-fixed,
as required.

AC3 (issue-37 regression demonstration against the v3 branch) and the
un-bootstrapped-BLOCKER demonstration were documented as out of scope for this
worktree and were not attempted, per the task brief.

## Issues

None.
