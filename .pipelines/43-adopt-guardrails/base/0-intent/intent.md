# Adopt Radical Pipelines guardrails

> Source: GitHub issue [Automattic/skillsmith#43](https://github.com/Automattic/skillsmith/issues/43).
> This file is self-contained; agents do not need to open the source issue.

## Goal

The pipeline code and docs phases are gated by deterministic verification commands declared by this project, so a regression like the one in pipeline `37-skip-misconfigured-agents-v3` — a broken `skillsmith` CLI that passed typecheck, lint, and unit tests — cannot ship green again. Agents should run gates the project declares, not commands they choose ad hoc.

## Context

- Pipeline `37-skip-misconfigured-agents-v3` introduced a circular import (`testing-project/skillsmith.config.ts` ↔ `testing-project/eval/utils/verify-e2e.ts`) that only manifests when the CLI actually loads the config — a path no existing check exercises.
- Radical Pipelines 0.3.0 added a Guardrails convention: exact commands, pass/fail by exit code, tagged `code`/`docs`, declared in `.rp.md`, mandatory for code-writer, code-reviewer, doc-writer, and doc-reviewer. This repo declares none yet.
- The `@automattic/skillsmith` rename left `testing-project/package.json` depending on `"skillsmith": "file:.."` while `skillsmith.config.ts` imports `@automattic/skillsmith`, so config loading is broken on trunk today.

## Constraints

- No changes to the Radical Pipelines plugin itself (e.g. a first-class bootstrap concept for guardrails).
- A full `skillsmith` run must not be part of any gate — it spawns real agents via the local `claude` CLI, so it is slow and nondeterministic.
- Fixing the v3 circular import itself is out of scope — that belongs to the issue-37 pipeline.

## Assumptions / directions to explore

These reflect the owner's worked-out proposal; later phases may confirm or revise them.

- Proposed guardrails table for `.rp.md` (commands run from the repo root):

  | Name             | Command                                         | Phase      |
  | ---------------- | ----------------------------------------------- | ---------- |
  | typecheck        | `npm run typecheck`                             | code       |
  | lint             | `npm run lint`                                  | code       |
  | tests            | `npm test`                                      | code       |
  | config-smoke     | `npm --prefix testing-project run check:config` | code       |
  | changeset-format | `npx tsx scripts/validate-changesets.ts`        | code, docs |
  | changeset-status | `npx changeset status --since=origin/trunk`     | docs       |

  `changeset-status` is docs-only because the changeset is authored by the doc-writer; `changeset-format` is safe on both phases (passes when no changesets exist). `config-smoke` is the gate that would have caught the issue-37 bug: it loads the testing-project config and its full import graph without spawning agents, requiring API keys, or booting wp-env.

- Worktree bootstrap: a fresh `EnterWorktree` checkout has no `node_modules`, so the orchestrator should run `npm ci` and `npm ci --prefix testing-project` before any agent or guardrail runs; a command-not-found failure in an un-bootstrapped worktree is a bootstrap omission, not a guardrail blocker.
- The `config-smoke` script could be `"check:config": "node --import tsx -e \"await import('./skillsmith.config.ts')\""` in `testing-project/package.json`.
- Fixing the `testing-project` dependency key (`skillsmith` → `@automattic/skillsmith`) and lockfile is a prerequisite for any of the above to work.
- `npm test` has two pre-existing `validate-changesets.test.ts` CLI smoke failures (`ERR_MODULE_NOT_FOUND` for `tsx` in a temp-dir subprocess); fixing or skipping-with-reason may be needed before the `tests` gate can be green from the start.
- A proposed acceptance bar (for phase 1 to refine): each declared command executes in the main checkout; all `code`-phase guardrails exit 0 on a freshly bootstrapped trunk worktree; `config-smoke` exits non-zero on the `37-skip-misconfigured-agents-v3` branch (proving it catches the original bug) and 0 on trunk.
