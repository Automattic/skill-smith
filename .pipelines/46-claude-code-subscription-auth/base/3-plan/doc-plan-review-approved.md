# Doc Plan Review

## Verdict: approved

## Summary

The doc plan is complete, drift-resistant, traceable, and correctly scoped for a small internal bugfix. I swept the repository end-to-end for prose that names `claude-code` authentication or the affected pay-as-you-go credentials, and the plan accounts for every surface that could go stale: the mandatory changeset (Task 1), the `.env.example` omission that currently misleads readers into thinking `ANTHROPIC_API_KEY` powers `claude-code` (Task 2), and the vague "uses your local CC auth" comment in `examples/skillsmith.config.ts` (Task 3). Every "deliberately left unchanged" justification holds up against the live repo. Most importantly, the plan caught and corrected a bump-type error present in both the code plan and the design doc — it correctly specifies `patch`, with explicit reasoning grounded in `CONTRIBUTING.md` and the validator, where the upstream artifacts mistakenly said "recorded pre-1.0 as `minor`." Approving.

## Verification notes (for the record)

These are confirmations, not issues — recorded so the docs phase does not re-litigate them.

### Surface sweep — no missed surface

- `grep` across all `*.md`, `*.ts`, `*.mjs`, `*.html`, `*.json`, `*.example` (excluding `node_modules`, `dist`, and `.pipelines`) for `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN` / `claude-code` / `local CC` / `anthropic-api` surfaces only: the two prose files the plan targets (`.env.example`, `examples/skillsmith.config.ts`), the implementation/test files owned by `code-plan.md`, `README.md`, `.rp.md`, `testing-project/skillsmith.config.ts`, and pipeline artifacts.
- `README.md` (lines 175–176, 202) names `claude-code` only as a provider id and describes no authentication mechanism; the README contains zero env-var/credential mentions and no setup/auth section. The "left unchanged" justification is correct.
- `docs/index.html` contains no provider, env-var, or auth references. Correct to leave unchanged (and it is changeset-gate-exempt).
- `.rp.md` references to "Claude Code" are about worktrees/tooling, not provider auth. Correctly out of scope.
- `testing-project/skillsmith.config.ts` shows `claude-code` usage with no auth comment and has no README/`.env`; it is changeset-gate-exempt. Correct to leave unchanged.
- `examples/` contains only `skillsmith.config.ts`; no additional README or prompt file mentions auth.

### Bump type `patch` is correct (and the plan corrected an upstream error)

- `package.json`: name `@automattic/skillsmith`, version `0.1.0` (pre-1.0). The changeset front-matter key the plan specifies matches `package.json:name`.
- `CONTRIBUTING.md` bump table (line 45): "Bug fix to existing ... provider behaviour" = `patch`. This change corrects which credential the existing provider uses; it adds/removes no provider and does not widen/narrow `ProviderId`, so it is not `minor`.
- `CONTRIBUTING.md` pre-1.0 policy (line 51): the `minor`-instead-of-`major` rule applies **only to breaking changes**. A bug fix is not breaking, so the rule does not force `minor`.
- `scripts/validate-changesets.ts` (lines 27, 80, 145): the `changeset-format` guardrail accepts `patch`, `minor`, `none` and rejects **only** `major` pre-1.0. So `patch` passes the guardrail.
- The code plan (line 17) and design doc (line 178) both say "a `patch`, recorded pre-1.0 as `minor`," which is wrong. The doc plan (Task 1) correctly chose `patch` with reasoning that refutes that phrasing. The doc plan is the controlling instruction for the doc-writer, so the upstream error does not propagate. No rejection is warranted; rejecting would force a wrong changeset.

### Guardrail satisfiability

- `.changeset/` currently holds only scaffolding (`README.md`, `config.json`, `initial-scaffolding.md`) and no pending package changeset, so Task 1 correctly creates a new file.
- `scripts/validate-changesets.ts` exists; `npx tsx scripts/validate-changesets.ts` (the `changeset-format` guardrail) and `npx changeset status --since=origin/trunk` (the `changeset-status` guardrail) are both satisfiable by a single new `patch` file mapping `"@automattic/skillsmith"` with a non-empty body.
- Task 3 correctly notes that a comment-only edit to `examples/skillsmith.config.ts` does not trigger a separate changeset (it exercises no new public API per `CONTRIBUTING.md` line 36) and rides under Task 1.

### Drift-resistance, traceability, scope

- Every task instructs the writer to verify wording against the shipped provider code and not to restate design-internal identifiers (helper/constant names). No task hard-codes function names, parameter lists, or return shapes.
- Each task names a concrete audience and traces to specific spec requirements and (for Tasks 2–3) code-plan Task 1.
- Tasks are independent, single-surface, and small enough for one doc-writer each; no false dependencies or ordering cycles.
- Explicit non-goals (cloud-backend switches, base-URL overrides) match the spec's Out of Scope. No code task appears in the plan.

## Issues

None.
