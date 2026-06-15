# Docs Review

## Verdict: approved

## Batch scope

Tasks reviewed:

- Task 1 (`f02605a`): Remove the `CONTRIBUTING.md` guardrails cross-reference paragraph.
- Task 2 (`25e3b61`): Tighten the `CONTRIBUTING.md` `check:config` bullet.

Base ref: `2ea392563e2f734bcb8d4034d32c0b3785a0f0e9` → HEAD (`25e3b61`).

## Summary

This is a presentation-only trim of the base "guardrails adoption" change, scoped entirely to the "Running tests and checks locally" section of `CONTRIBUTING.md`. Both tasks land exactly as the approved spec, design doc, and doc plan require. The guardrails cross-reference paragraph is removed in full with clean single-blank-line spacing, and the `check:config` bullet is now a single em-dash clause matching its sibling bullets while retaining both required facts. The em dash is a real U+2014 with surrounding spaces. The docs are consistent with the shipped code (`.rp.md` trimmed to heading+table and a one-sentence worktree bootstrap; `scripts/bootstrap-worktree.sh` deleted) — `CONTRIBUTING.md` references neither the deleted script nor the removed guardrails prose. No out-of-scope artifact is touched. Both docs-phase guardrails exit 0 without a changeset, as expected for these non-versionable paths.

## Checks

| Check                          | Command                                          | Result                              |
| ------------------------------ | ------------------------------------------------ | ----------------------------------- |
| changeset-format               | `npx tsx scripts/validate-changesets.ts`         | exit 0 (pass)                       |
| changeset-status               | `npx changeset status --since=origin/trunk`      | exit 0 (pass, no bumps)             |
| Diff scope (docs only)         | `git diff --name-status <base> HEAD`             | Only `.rp.md`, `CONTRIBUTING.md`, `scripts/bootstrap-worktree.sh` (deleted), + pipeline artifacts — no out-of-scope source |
| No `bootstrap-worktree` ref    | `grep -rn bootstrap-worktree CONTRIBUTING.md .rp.md` | no match (clean)                |
| Script deletion / scripts dir  | `ls scripts/bootstrap-worktree.sh scripts/validate-changesets.ts` | script absent; `validate-changesets.ts` present |
| Guardrails cross-ref removed   | `grep -n "Guardrails\|declared\|judged by exit code" CONTRIBUTING.md` | no match (prose gone) |

## Accuracy spot-check

**Task 2 — em dash and required facts.** Verified the `check:config` bullet (`CONTRIBUTING.md:13`) byte-for-byte against the design doc's exact final text (Edit 5). A `hexdump` of the bullet shows the dash is `e2 80 94` (U+2014) with a `20` (space) on each side — a real em dash, not a hyphen:

```
60 20 e2 80 94 20 6c 6f  61 64 73 20 74 68 65 20  |` — loads the |
```

The clause is `loads the fixture config through its real import graph, catching config-load and import regressions the other checks miss.` — both mandated facts (a) loads the fixture config through its real import graph and (b) catches config-load and import regressions the other checks miss are present; the verbose parenthetical (`no agents, no API key, no wp-env, no network`) and the trailing "because none of them…" clause are gone. Matches spec requirement 5 and design doc Edit 5 verbatim.

**Task 1 — paragraph removal and spacing.** Verified at `CONTRIBUTING.md:13-15`: the `check:config` bullet is immediately followed by a single blank line and then the `## Versioning policy` heading. No double or orphaned blank line. A `grep` for `Guardrails`, `declared`, `judged by exit code`, and `run automatically` in `CONTRIBUTING.md` returns no match, confirming the cross-reference paragraph (and any statement that local checks are declared as guardrails in `.rp.md` or run/judged by the pipeline) is gone in full. Matches spec requirement 4 / acceptance criterion 6 and design doc Edit 4.

**Code-consistency cross-check.** `grep -rn bootstrap-worktree CONTRIBUTING.md .rp.md` returns no match, and `ls` confirms `scripts/bootstrap-worktree.sh` is deleted while `scripts/validate-changesets.ts` remains — so the docs carry no stale reference to the deleted script or the removed guardrails prose.
