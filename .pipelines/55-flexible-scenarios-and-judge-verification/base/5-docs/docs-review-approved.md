# Docs Review

## Verdict: approved

## Batch scope

Tasks reviewed:

- **DocT1** — Rewrite the README to the two-file scenario + live-judge model (`README.md`)
- **DocT2** — Rewrite the public landing page (`docs/index.html`)
- **DocT3** — Update the reference example config (`examples/skillsmith.config.ts`)
- **DocT4** — Audit and correct old-model references in `CONTRIBUTING.md` (no-op)
- **DocT5** — Update the `testing-project` improver-prompt narrative (`testing-project/eval/prompts/improver.md`)

Diff base ref: `95c86bd` → current HEAD (`5084844`). This is re-review iteration N = 2, after DocT1 was revised to fix the iteration-1 blocker.

## Summary

The single iteration-1 blocker is resolved and all four guardrail gates pass, so the batch is approved. DocT1's stale `assets/skill-tester-workflow.png` embed has been replaced (commit `5084844`) with an inline Mermaid `flowchart TD` lifecycle diagram that is accurate to the shipped model: it depicts the verbatim `testingBrief` + `# Skills` testing input, the `workspace/` → `judge-workspace/` copy, the `beforeJudgeAgent` env-up step built from `judge-workspace/`, the live judge with project-configured capabilities running against the copy, the `{ pass, notes }` verdict with the diff-guard on the canonical workspace, the `afterJudgeAgent` teardown, and the improver consuming the judge's `notes`. It contains none of the old-model concepts the iteration-1 reject flagged — no `scenario.prompt`, no "rubrics it references", no `judge-review.yaml`. The remaining `rubric`/`scenario.yaml`/`acceptance` strings in the README all live in the explicit Breaking-change callout and the Migrating section (describing what the old model *was* and what replaced it) or in the new-model guidance to inline a rubric into `JUDGE.md` as freeform prose — none present a removed concept as the current contract. DocT2–DocT5 are byte-for-byte unchanged from their iteration-1 approval (the only file touched since the rejection is `README.md`), so they carry forward their prior clean assessment and were not re-litigated. The previously-accepted `assets/self-improvement-loop.png` was not re-litigated.

## Checks

All four gates were run this iteration (they were deliberately skipped in the reject-first iteration 1) and all passed.

| Check | Command | Result |
| ----- | ------- | ------ |
| Changeset format | `npx tsx scripts/validate-changesets.ts` | pass |
| Changeset present | `npx changeset status --since=origin/trunk` | pass |
| Typecheck | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass |

Notes: Gate 2 reports `@automattic/skillsmith` bumped at `minor` (the breaking change recorded as `minor` + `BREAKING:` per the pre-1.0 policy) — correct. Gate 4 prints one non-fatal Biome `info` (a config-migration suggestion); the command exits 0 and applies no fixes, so it is a pass, not a lint error.

## Accuracy spot-check

The DocT1 fix was verified claim-by-claim against the **worktree** source (`.../worktrees/55-flexible-scenarios-and-judge-verification/src/...`), and DocT2–DocT5 carry forward their iteration-1 spot-checks (unchanged files).

- **DocT1 — new Mermaid lifecycle diagram (`README.md:89-99`).** Every node was checked against shipped code:
  - Node A (`testingBrief`, `# Skills`) — `src/config/types.ts:187-197`: `Scenario { name, skills, testingBrief, judgeBrief }`; the testing agent's user message is the verbatim `testingBrief`. Matches.
  - Node C (`workspace/` → `judge-workspace/` copy) — `src/pipeline/agent-loop.ts:162` builds `join(agentDirectory, 'judge-workspace')` and line 257 calls `copyWorkspaceForJudge( agentWorkspace, judgeWorkspace )`. Matches.
  - Nodes D/G (`beforeJudgeAgent` env-up from the copy, `afterJudgeAgent` teardown) — `agent-loop.ts:261-263` fires `beforeJudgeAgent` and line 335-337 fires `afterJudgeAgent`, both receiving `judgeWorkspace` (line 278). Matches.
  - Node E (live judge, project-configured capabilities, against the copy) — judge runs with `cwd` = `judgeWorkspace`; matches the prose and `src/pipeline/judge-agent.ts`.
  - Node F (`{ pass, notes }` verdict + diff-guard on the canonical workspace) — `agent-loop.ts:258` `snapshotWorkspace( agentWorkspace )` before, line 294-295 `diffSnapshots` after, on the canonical `agentWorkspace`. Verdict shape `{ pass, notes }` matches `src/config/types.ts` and the report JSON. Matches.
  - Serial bracket — `agent-loop.ts:245-251` acquires the run-wide `judgeMutex` around the whole `beforeJudgeAgent` → judge → `afterJudgeAgent` bracket when `config.roles.judge.concurrency === 'serial'`. Matches the diagram's framing and the "Environment ownership and judge concurrency" prose.
  - **No old-model concept present:** `grep` over `README.md` for `scenario.prompt`, `judge-review.yaml`, and bare `rubric` confirms the only surviving matches are in the Breaking-change callout / Migrating section (describing the removed model) and the new-model "inline a rubric into `JUDGE.md`" guidance — none in the diagram, none presented as the current contract.
  - The stale `assets/skill-tester-workflow.png` is referenced nowhere in the repo anymore (`grep` over `.md`/`.html`/`.ts` outside pipeline artifacts returns nothing).
- **DocT2–DocT5 — unchanged.** `git diff --stat 13834b6 HEAD` shows `README.md` as the only changed file since the rejection commit, so `docs/index.html`, `examples/skillsmith.config.ts`, `CONTRIBUTING.md`, and `testing-project/eval/prompts/improver.md` are identical to their iteration-1-approved state; their iteration-1 spot-checks stand.

## Known limitations

- The stale `assets/skill-tester-workflow.png` (~2 MB) remains on disk but is now referenced nowhere in the repo (the README embed was replaced by an inline Mermaid diagram). It is an orphaned asset — harmless, removable in a later cleanup; not a docs-content defect.
- `src/improvement/improver.ts:31` (`DEFAULT_PROMPT`) retains stale "end-to-end" wording. This is shipped source code, classified as a code-phase observation, not a docs-task surface — out of scope for this docs review.
