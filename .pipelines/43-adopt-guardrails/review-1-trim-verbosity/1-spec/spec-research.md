# Spec research — Trim over-explanation from the guardrails adoption

Review run: `review-1-trim-verbosity` (incremental, on issue #43).
Base run: COMPLETE — the "guardrails adoption" already shipped. This review changes only **how** the shipped guardrails are *presented*; it does not change the guardrails, their commands, or their phase assignments.

This document is the running Q&A record between `spec-analyst` and `spec-researcher`. All "before" text and verification claims below were read from the worktree at `/Users/darerodz/Code/skillsmith/.claude/worktrees/43-adopt-guardrails` during this phase.

---

## Scope (one paragraph)

Four edits, all behaviour-preserving for the gates:

- **A.** `.rp.md` Worktree bootstrap section → collapse the body to one sentence; keep the heading.
- **B.** `.rp.md` Guardrails section → reduce to heading + the existing table; drop the lead paragraph and all five trailing explanatory paragraphs.
- **C.** Delete `scripts/bootstrap-worktree.sh`.
- **D.** `CONTRIBUTING.md` → drop the guardrails cross-reference paragraph; tighten the `check:config` bullet to the surrounding terse style.

Explicitly out of scope (leave intact from the base run): the guardrail set / commands / phases (the table content), the `@automattic/skillsmith` dependency rename, the `verify-e2e` import-specifier fix, the `check:config` script in `testing-project/package.json`, the lockfile, and the Radical Pipelines plugin itself. `scripts/validate-changesets.ts` stays (it is the `changeset-format` gate's command, referenced by `.github/workflows/changeset-gate.yml`).

---

## Q1 — Current "before" state (verbatim)

### 1. `.rp.md` `## Guardrails` section (lines 93–115)

Structure: 1 lead paragraph + the 6-row table + FIVE trailing explanatory paragraphs.

```markdown
## Guardrails

Gates are exit-code-only verification commands the pipeline runs at the named phase(s). Each runs from the repo root and is judged pass/fail solely by its exit code — `0` passes, anything else fails.

| Name             | Command                                         | Phase      |
| ---------------- | ----------------------------------------------- | ---------- |
| typecheck        | `npm run typecheck`                             | code       |
| lint             | `npm run lint`                                  | code       |
| tests            | `npm test`                                      | code       |
| config-smoke     | `npm --prefix testing-project run check:config` | code       |
| changeset-format | `npx tsx scripts/validate-changesets.ts`        | code, docs |
| changeset-status | `npx changeset status --since=origin/trunk`     | docs       |

The two changeset gates are a one-to-one lift of the repo's existing GitHub Actions changeset gate (`.github/workflows/changeset-gate.yml`), so adopting them here is continuity, not a new contract.

**changeset-format** validates the _shape_ of every `.changeset/*.md` that exists — front-matter fence, a valid bump type, a known package name, a non-empty body, and the pre-1.0 ban on `major`. It is presence-agnostic: it passes when no changeset exists and never asserts that one is present. That is exactly why it is safe on both phases, including the code phase, where no changeset has been authored yet.

**changeset-status** is a conditional changeset-presence check. It exits non-zero **if and only if** the branch changed a _versionable_ path **and** no `.changeset/*.md` file exists. "Versionable" is the set matching `.changeset/config.json`'s `changedFilePatterns` — `src/**`, `bin/**`, `package.json`, `examples/**`, `README.md` — excluding `src/__tests__/**`. The guarantee is the conditional one: release-relevant (versionable) changes carry a changeset. It does **not** force a changeset for every docs-phase change — a change confined to non-versionable paths (e.g. `AGENTS.md`, `CONTRIBUTING.md`, `.rp.md`, `.pipelines/**`) is correctly left alone.

Two properties are worth stating so they don't create false expectations. First, an empty changeset counts as "present": the gate keys off whether a `.changeset/*.md` file exists, not whether it bumps a package, so an empty (`---\n---\n`) or `none`-bump changeset satisfies it — matching the project's documented "empty changeset" escape. Second, the gate has real teeth, including for `README.md`: a versionable-path change with no changeset exits non-zero, while the `!src/__tests__/**` exclusion lets test-only changes pass.

The `--since=origin/trunk` form is deliberate — it compares against the remote-tracking ref, which is safe in a pipeline worktree where the local `trunk` branch may be stale or absent.
```

The five prose paragraphs after the table, in order: (a) changeset-gate continuity note; (b) **changeset-format** para; (c) **changeset-status** para; (d) "Two properties" para; (e) `--since=origin/trunk` para.

### 2. `.rp.md` `## Worktree bootstrap` section (lines 65–73)

Located between `## Claude Code worktrees` and `## Branch names`.

```markdown
## Worktree bootstrap

After `EnterWorktree`, and **before launching any phase agent or running any guardrail**, the orchestrator runs `bash scripts/bootstrap-worktree.sh` from the worktree root.

The script performs a complete, clean install of **both** npm workspaces: `npm ci` at the repo root and `npm ci --prefix testing-project`. The root `package.json` has no `workspaces` key, so the two workspaces must each be installed on their own — a single root install does not reach `testing-project`. "Bootstrapped" means a complete, clean install (`npm ci`), not merely that `node_modules` exists: a partial dependency tree makes the `npx`-based gates nondeterministic, so a clean install is the contract.

`.rp.md` names the script rather than restating the two commands, so the prose and the script cannot drift apart.

If the bootstrap is omitted, the gates fail their *execute* test and the running agent reports a **BLOCKER**, surfacing the omission loudly rather than passing silently. A command-not-found in an un-bootstrapped worktree is a bootstrap omission — the fix is to bootstrap — not a guardrail defect.
```

### 3. `scripts/bootstrap-worktree.sh` (full content)

Path confirmed exactly: `scripts/bootstrap-worktree.sh` (abs: `/Users/darerodz/Code/skillsmith/.claude/worktrees/43-adopt-guardrails/scripts/bootstrap-worktree.sh`). 5 lines, 78 bytes, executable.

```bash
#!/usr/bin/env bash
set -euo pipefail

npm ci
npm ci --prefix testing-project
```

### 4. `CONTRIBUTING.md` `## Running tests and checks locally` (lines 6–15)

```markdown
## Running tests and checks locally

Run these before pushing a PR. Each maps to a script in [`package.json`](./package.json):

- `npm run lint` — Biome lint over the repo.
- `npm run typecheck` — `tsc --noEmit` against the project's `tsconfig.json`.
- `npm test` — Node test runner over `src/__tests__/*.test.ts`.
- `npm run smoke` — runs `bin/skillsmith.mjs` end-to-end against the working directory.
- `npm --prefix testing-project run check:config` — imports `testing-project/skillsmith.config.ts` and its full module graph (no agents, no API key, no wp-env, no network), catching config-load and import regressions the other checks miss because none of them loads the fixture config through its real runtime import graph.

These same commands are declared as **Guardrails** in [`.rp.md`](./.rp.md), which the Radical Pipelines code and docs phases run automatically and judge by exit code — so the checks you run locally are the ones the pipeline gates on.
```

Pin-points:
- Paragraph to DROP entirely: the final `These same commands are declared as **Guardrails** in [`.rp.md`]…` cross-reference (line 15).
- Bullet to TIGHTEN: the `check:config` bullet (line 13). Sibling terse style to match (lines 9–12): `` `command` `` + em dash + a single short clause + period. The current `check:config` bullet is the only multi-clause bullet in the list.

---

## Q2 — Target "after" text (pinned)

### A. Worktree bootstrap (heading kept, body → one sentence)

Reuses the current first sentence verbatim (the only sentence the owner wanted kept), swaps the script for the two commands named directly, drops the remaining four paragraphs:

```markdown
## Worktree bootstrap

After `EnterWorktree`, and **before launching any phase agent or running any guardrail**, the orchestrator runs `npm ci` and `npm ci --prefix testing-project` from the worktree root.
```

### B. Guardrails (heading + table only)

After = the `## Guardrails` heading immediately followed by the existing 6-row table, table **unchanged** (same 6 rows, same commands, same phases: typecheck/lint/tests/config-smoke = `code`; changeset-format = `code, docs`; changeset-status = `docs`). Lead paragraph and all five trailing paragraphs removed. No intro sentence retained.

Rationale for keeping NO intro sentence (grounded):
1. The skill's convention loader already defines a guardrail and that it is judged by exit code — `reference/conventions/load.md` (line 26): "A guardrail is an exact command, judged pass/fail solely by its exit code (0 = pass, any non-zero = fail)…" The current `.rp.md` lead paragraph is a near-duplicate of that — the redundancy the owner flagged.
2. Owner's verbatim words: "guardrails should not need to be explained, just listed in the corresponding table." A retained intro sentence would re-introduce the explanation they asked to cut.

### C. CONTRIBUTING.md `check:config` bullet (tightened)

Single recommended replacement (sibling style: `` `command` `` + em dash + one short clause + period):

```markdown
- `npm --prefix testing-project run check:config` — loads the fixture config through its real import graph, catching config-load and import regressions the other checks miss.
```

The parenthetical "(no agents, no API key, no wp-env, no network)" is dropped — no sibling bullet carries that elaboration, and "real import graph" already implies the no-agent/no-network smoke load. The testable core (what any acceptable phrasing must retain): one bullet, single clause, still names (a) that it loads the fixture config through its real import graph, and (b) that this catches regressions the other checks miss.

---

## Q3 — Deletion + reference integrity (verified against files)

1. **Deleting `scripts/bootstrap-worktree.sh` + editing the `.rp.md` worktree-bootstrap body breaks nothing.** Verified:
   - `package.json` (root) and `testing-project/package.json`: zero references to the script.
   - `.github/`: only hit is a *different* file — `.github/workflows/changeset-gate.yml:24` runs `npx tsx scripts/validate-changesets.ts`. No reference to `bootstrap-worktree.sh`.
   - `AGENTS.md`, `CLAUDE.md`, `README.md`: zero references.
   - Repo-wide grep for `bootstrap-worktree` (excluding `node_modules`/`.git`/`.pipelines`): the only live hit is the `.rp.md` worktree-bootstrap line. Every other hit is under `.pipelines/**` (immutable base-run phase artifacts) plus this review's own `0-intent/intent.md` — none of these is live config; nothing executes or imports them.
   - Conclusion: after the `.rp.md` body edit + file deletion, no dangling live reference remains.

2. **`scripts/` survives.** It contains two files: `bootstrap-worktree.sh` (deleted) and `validate-changesets.ts` (kept — it is the `changeset-format` gate's command, referenced by `.github/workflows/changeset-gate.yml:24`; out of scope for this trim). Deleting `bootstrap-worktree.sh` leaves the directory non-empty.

3. **Guardrails trim is prose-only and section-confined.**
   - `## Guardrails` starts at `.rp.md:93` and is the **last** section in the file (file ends line 115). There is no heading after Guardrails, so removing prose cannot touch a following section.
   - The table (lines 97–104) is the only structural element retained; the edit removes the lead paragraph and the five trailing explanatory paragraphs. Table rows/commands/phases untouched.
   - The preceding section `## Health monitoring` (ends line 91) is untouched.

---

## Requirements (testable)

- **R1 — `.rp.md` Guardrails reduced to heading + table.** The `## Guardrails` section contains only the `## Guardrails` heading and the existing 6-row table. The lead paragraph and all five trailing explanatory paragraphs are removed. The table is byte-for-byte unchanged in rows, commands, and phase assignments (typecheck/lint/tests/config-smoke = `code`; changeset-format = `code, docs`; changeset-status = `docs`).
- **R2 — `.rp.md` Worktree bootstrap collapsed to one sentence.** The `## Worktree bootstrap` heading is retained; its body is a single sentence that (a) keeps the timing cue ("after `EnterWorktree`, and before launching any phase agent or running any guardrail"), and (b) names `npm ci` and `npm ci --prefix testing-project` directly instead of referencing a script. No reference to `scripts/bootstrap-worktree.sh` remains in `.rp.md`.
- **R3 — `scripts/bootstrap-worktree.sh` deleted.** The file no longer exists. `scripts/validate-changesets.ts` remains, so `scripts/` is not removed. No live config (`package.json` x2, `.github/**`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `.rp.md`) references the deleted script.
- **R4 — `CONTRIBUTING.md` guardrails cross-reference dropped.** The "These same commands are declared as **Guardrails** in `.rp.md`…" paragraph is removed entirely.
- **R5 — `CONTRIBUTING.md` `check:config` bullet tightened.** The bullet is a single clause matching the sibling terse style (`` `command` `` + em dash + one short clause + period). It still names that the check loads the fixture config through its real import graph and that this catches regressions the other checks miss. Recommended text in Q2.C.
- **R6 — Behaviour preserved.** No guardrail command or phase assignment changes. The base run's other changes are left intact: the `@automattic/skillsmith` dependency rename, the `verify-e2e` import-specifier fix, the `check:config` script in `testing-project/package.json`, the lockfile, and the Radical Pipelines plugin.

## Acceptance criteria

1. `.rp.md` `## Guardrails` section = heading + 6-row table only; the six rows/commands/phases are identical to the "before"; no prose paragraphs remain (R1).
2. `.rp.md` `## Worktree bootstrap` = heading + one sentence naming both `npm ci` commands and keeping the timing cue; no `scripts/bootstrap-worktree.sh` reference anywhere in `.rp.md` (R2).
3. `scripts/bootstrap-worktree.sh` does not exist; `scripts/validate-changesets.ts` still exists; repo-wide grep for `bootstrap-worktree` returns no live (non-`.pipelines`, non-intent) hit (R3).
4. `CONTRIBUTING.md` no longer contains the guardrails cross-reference paragraph (R4).
5. `CONTRIBUTING.md` `check:config` bullet is a single em-dash clause matching siblings and still conveys "loads the fixture config through its real import graph" + "catches regressions the other checks miss" (R5).
6. The guardrail gates still pass and no out-of-scope base-run change is modified (R6).

## Out of scope

- Changing any guardrail command, name, or phase assignment.
- The `@automattic/skillsmith` dependency rename, the `verify-e2e` import-specifier fix, the `check:config` script in `testing-project/package.json`, the lockfile.
- The Radical Pipelines plugin itself.
- `scripts/validate-changesets.ts` and `.github/workflows/changeset-gate.yml`.
