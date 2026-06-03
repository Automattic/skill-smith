# Code Plan Review — APPROVED

**Artifact reviewed:** [`3-plan/code-plan.md`](./code-plan.md) (commit `b12386d`)
**Against:** [`1-spec/spec.md`](../1-spec/spec.md) (19 ACs), [`2-design-doc/design-doc.md`](../2-design-doc/design-doc.md)
**Live repo:** skillsmith worktree `worktree-39-changelog-and-versioning` = open PR #41
**Verdict:** **APPROVED** — proceed to the Code phase.

The 6 tasks are complete (all 19 ACs covered), correctly ordered with a sound dependency, faithful to
the design, precise enough for a fresh per-task code-writer to execute against the shared working tree,
and each independently verifiable. Every load-bearing empirical claim was re-confirmed against the live
repo (not just read).

## Empirical re-verification (live repo)

| Area | What I checked | Result |
|---|---|---|
| Baseline diagnostics | `biome lint .` | Exactly **3 errors + 6 warnings** across 4 files, at the precise lines/cols the plan claims (`tracker.ts:358`; `progress-tracker.test.ts:141` cols 31 & 43; `progress-render.test.ts:64,67,150,295`; `styles.css:596,605`). ✓ |
| T1 preconditions | `AGENTS.md`/`CLAUDE.md` absent; `CONTRIBUTING.md` headings | Both files do not yet exist (correctly *new*). `## Adding a changeset` → `#adding-a-changeset` ✓; `### Pre-1.0 policy` → `#pre-10-policy` (GitHub strips the dot) ✓. Both anchors are real. |
| T2 targets & rule path | `tracker.ts:358` content + indent; `progress-tracker.test.ts:141` indent; rule slug; fixability | `tracker.ts:358` = `const ANSI_SGR = /\x1b\[[0-9;]*m/g;` at module top level (no indent). `progress-tracker.test.ts:141` starts with a **tab** (matches the plan's tab-indented comment). Biome's reported rule path is **exactly** `lint/suspicious/noControlCharactersInRegex` (the ignore will bind). The errors are **not** marked `FIXABLE` → a whole-repo `biome lint --write` can never silently rewrite them. ✓ |
| T2 + T4 reach zero (TS) | Applied both `biome-ignore`s **and** the scoped auto-fix to a temp copy of the 3 TS files, then `biome lint .` | "No fixes applied", **zero diagnostics**. ✓ |
| T3 reorder is correct & neutral | Reordered a temp copy of `styles.css` by **selector text** (bare `pre`→before `.terminal pre`; bare `code`→before `.note-card code`), then `biome lint` | Selector order becomes `pre`(300) → `.terminal pre`(309) and `code`(438) → `.note-card code`(442); **zero `noDescendingSpecificity`**; line count preserved (715→715, pure move); **no double-blank lines** introduced. Only 4 relevant `pre`/`code` selectors exist, so no other rule complicates the move. ✓ |
| T4 transforms & scope | Diffed original vs auto-fixed render test | The 4 flagged lines become exactly `{2}/{5}/{3}/{3}` per the plan's table. The fix is **safe** (no `--unsafe` needed). Diff touches **only** those 4 lines — lines 78 & 84 (also `^scenarios {2}`) were **already** in `{n}` form pre-edit, so they are *not* changed by the fix. AC11/AC12 scope claim holds. |
| T4 tests stay green | `npm test` baseline | 147 pass / 0 fail / 2 skipped. `{n}` on a single space is semantically identical to literal spaces, so the suite stays green. ✓ |
| T5 config reformat | Added `"prettier": false` after `"commit": false`, ran `biome format --write .changeset/config.json`, then re-ran | Output is **byte-identical** to the plan's expected final file (tabs throughout; `changelog` array expanded with inner `{ "repo": ... }` kept inline; `prettier:false` after `commit:false`). Re-run → **"No fixes applied"** (idempotent). AC13 + AC14 hold. ✓ |
| Cross-cutting AC17 | `.changeset/` contents; `changeset status --since=origin/trunk` | Only `initial-scaffolding.md` (`"@automattic/skillsmith": none`) present; status **exits 0**. The plan correctly forbids any new changeset and editing `initial-scaffolding.md`. ✓ |
| `lint` not `check` | Searched the plan for `biome check` | All 3 occurrences are **prohibitive** ("do NOT run `biome check`"). `package.json`: `lint = biome lint .`, `lint:fix = biome lint --write .`. The plan never instructs `check`. AC12/R2.3 honored. ✓ |
| `biome.json` | Read config | `indentStyle: "tab"`, `recommended: true`, and `assist.actions.source.organizeImports: "on"` — confirming the plan's rationale that `biome check` *would* reorder imports (correctly avoided). ✓ |

## The brief's targeted questions

- **T4-after-T2+T3 dependency is sound.** Code-writers run one-at-a-time on the shared tree in dispatch
  order (1→2→3→4→5→6). T4's terminal acceptance is the **repo-wide** `biome lint .` = 0 bar (AC8), which
  only holds once T2 cleared the 3 control-char errors and T3 cleared the 2 CSS warnings. By the time T4
  runs, both have landed, so the gate genuinely passes. Run T4 before either and its own acceptance
  would fail (3 errors + 2 warnings remain) — the ordering is what makes the gate safe. T5 (JSON
  formatting only) and T6 (no repo file) introduce no lint diagnostics, so the gate established at T4
  stays valid through the end. Correct.
- **T6 (PR-description note for AC16) is coherent within the closed manifest.** AC16's text has no valid
  repo home: `.changeset/config.json` is JSON (no prose slot) and `CONTRIBUTING.md`/`README.md` are
  excluded by AC19. The spec (AC16) and design both place this prose in the PR #41 description. Modeling
  it as a task that produces *text for the PR description* but **writes no repo file** is the right way
  to satisfy AC16 without breaching the 7-file manifest. The plan also correctly assigns the actual
  paste to the Docs phase / team lead.
- **No task adds a changeset or edits `initial-scaffolding.md`.** Confirmed — this is stated as a
  cross-cutting invariant binding every task, and no individual task's Changes section violates it.

## AC coverage (all 19)

AC1–7 → T1 · AC8 → T4 (terminal, T2+T3 contribute) · AC9 → T2 · AC10 → T3 · AC11 → T4 · AC12 → T4
(T2+T3 contribute) · AC13/AC14/AC15 → T5 · AC16 → T6 · AC17/AC18/AC19 → cross-cutting invariants +
the final-verification table. AC17/18/19 are whole-effort properties (not discrete edits), so handling
them as invariants + a verification gate rather than a standalone task is correct.

## Minor, non-blocking observations (no rework required)

These do not affect approval; flagged only so the code-writers are not surprised.

1. **T3 line numbers are pre-edit and shift after move #1.** The plan already calls this out prominently
   ("do move #1 FIRST"; "locate targets by selector text"). My temp run located by selector text and it
   worked cleanly — so the guidance is sufficient. Code-writers must heed it.
2. **T5's final `biome format` over-format.** The plan's recommended sequence ("add key → `biome format
   --write` → commit") is exactly what I ran and it is idempotent. Code-writers should scope the format
   to `.changeset/config.json` (as written) and not run a repo-wide `biome format --write`, which would
   be out of scope (though, empirically, `config.json` is the only file failing `biome format`, so even
   a repo-wide run would touch only that file — still, scope it as the plan says).
3. **T6 is a documentation hand-off, not a verifiable repo change.** Its acceptance is "text recorded for
   the PR description" + "no repo file changed." That is the correct shape for AC16; the team lead/Docs
   phase owns the actual paste. No issue.

All checks pass. The plan is approved for the Code phase.
