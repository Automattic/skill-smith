# Spec: Reconcile the skip-misconfigured-agents branch with current `trunk`

## Overview

The skip-misconfigured-agents feature branch (pull request #45, _"Skip misconfigured agents across all phases of a run"_) is open against `trunk` but reports as `CONFLICTING`. The branch is 89 commits behind `trunk`, which has since adopted Biome 2.5.0 "WordPress" formatting across the whole repository and merged further feature work (notably nested scenario folders). Merging current `trunk` into the branch conflicts in 19 files. The branch has already delivered, across its prior `base`, `review-1-fix-circular-import`, and `review-2-early-skip-announcement` runs, the behavior that skips statically misconfigured agents across every phase of a run.

This work reconciles the branch with current `trunk` so the pull request can land. The reconciliation must incorporate `trunk` into the branch and resolve every conflict so that **both** sides are retained — `trunk`'s intervening changes (the Biome 2.5.0 reformat, nested scenario folders, and other merged work) **and** the branch's already-shipped skip-misconfigured-agents behavior. After reconciliation, the pull request must be mergeable, every repository guardrail must pass, the shipped skip behavior must be observably unchanged, and the changesets must continue to coherently describe what ships. This is a reconciliation only: the feature itself is not re-litigated, redesigned, or extended.

## Requirements

Each requirement is an observable outcome of a successful reconciliation. Unless noted otherwise, verification commands are run from the worktree root after installing dependencies in both the root and the `testing-project` workspace.

1. **The pull request is mergeable into `trunk`.** After reconciliation the branch incorporates current `trunk` and has no remaining merge conflicts with `trunk`; GitHub no longer reports the pull request as `CONFLICTING`.

2. **Every merge conflict is resolved with both sides preserved.** All 19 conflicting files are resolved so that `trunk`'s intervening change (the Biome reformat plus nested scenario folders and other merged feature work) **and** the branch's skip-misconfigured-agents feature are both retained. No conflict is resolved by dropping or weakening either side, and no code is deleted merely to make a conflict disappear. The 19 files are: `README.md`; `examples/skillsmith.config.ts`; `src/__tests__/progress-render.test.ts`; `src/__tests__/progress-tracker.test.ts`; `src/__tests__/summary.test.ts`; `src/config/types.ts`; `src/improvement/improver.ts`; `src/pipeline/agent-loop.ts`; `src/pipeline/pipeline.ts`; `src/progress/render.ts`; `src/progress/tracker.ts`; `src/providers/anthropic-api.ts`; `src/providers/gemini-api.ts`; `src/providers/openai-api.ts`; `src/providers/types.ts`; `src/reports/iteration-report.ts`; `src/reports/summary.ts`; `testing-project/eval/utils/verify-e2e.ts`; `testing-project/skillsmith.config.ts`.

3. **The reconciled code conforms to `trunk`'s Biome 2.5.0 "WordPress" formatting and lint rules.** Running the formatter in verify mode (`npx biome format .`, no rewrite) exits 0 with no files reported as needing reformatting, and `npm run lint` exits 0. The reconciled branch uses the same exactly-pinned Biome 2.5.0 toolchain as `trunk`.

4. **The code typechecks against `trunk`'s current types.** `npm run typecheck` exits 0, including at the call sites where `trunk`'s nested-scenario-folders shape and the branch's skip fields meet — the per-scenario run call carries both `trunk`'s nested-folders plumbing and the branch's agent-filter and skipped data, and the run-report writer retains its skip-bearing signature.

5. **The skip-misconfigured-agents behavior is observably unchanged.** `npm test` exits 0 with the nine skip-feature test files green as written (`runnability.test.ts`, `providers-required-env.test.ts`, `iteration-report-skipped.test.ts`, `project-args.test.ts`, `config-loads.test.ts`, `skip-misconfigured.test.ts`, `summary.test.ts`, `progress-render.test.ts`, `progress-tracker.test.ts`). Collectively these pin the shipped behavior:
   - **Per-provider static misconfiguration detection.** An agent backed by a provider that requires a credential which is missing or empty is classified as misconfigured; providers that need no static credential are always runnable.
   - **Cross-phase skip.** A misconfigured agent is skipped in every phase of a run — it is not invoked, not provisioned, not accounted for, and not re-selected.
   - **Role-aware consequences.** A skipped test agent is excluded from its lane; a skipped judge stops the run before any post-run hook or report runs; a skipped improver finishes the current iteration and then halts; an agent in multiple roles takes the most-severe consequence.
   - **Exit codes.** Exit `0` for a clean run, `1` for a genuine evaluation failure, and `2` for any configuration skip, with the configuration-skip code taking precedence over a failure code, and an all-misconfigured run never reported as a vacuous pass.
   - **End-of-run surfacing.** Each skip is announced once, with its agent id and reason, visually distinct from a failure, both in the CLI summary and in the run report's top-level `skipped` array.
   - **Early surfacing.** Each skip is also announced at detection — as a distinct live-dashboard section in interactive mode and as an early line on standard error in non-interactive/verbose mode — while the end-of-run summary remains unchanged. A run with no skips emits no early skip announcement.
   - **Hook contract.** The skipped set is readable from the earliest run-context hook onward.

6. **The `testing-project` import-cycle fix is preserved.** `npm --prefix testing-project run check:config` exits 0 (the `testing-project` config import graph loads without throwing) and `config-loads.test.ts` passes. The e2e verification helper still obtains project names from caller-passed parameters together with the dedicated project-args module, with no module-initialization-time read of the imported config, and the project selector forwarding preserves runnable-set order.

7. **`trunk`'s intervening feature work is intact.** Nested-scenario-folders behavior and any other non-conflicting `trunk` changes remain present and functional after the reconciliation. This is observable via the full `npm test` suite passing (not only the skip-feature subset).

8. **Changesets stay coherent with what ships.** `npx tsx scripts/validate-changesets.ts` exits 0 and `npx changeset status --since=origin/trunk` exits 0, reporting `@automattic/skillsmith` to be bumped at `minor` (not patch-only, not none-only, not empty, not an error). The existing changesets continue to accurately describe the shipped feature: the skip-misconfigured-agents changeset (`minor`), the early-skip-announcement changeset (`patch`), and the scaffolding changeset (`none`). No changeset is deleted, emptied, or downgraded, and the reconciliation itself introduces no new changeset.

9. **The change is minimal.** Only the changes needed to reconcile with `trunk` and keep the guardrails green are made. There are no gratuitous refactors beyond faithful conflict resolution and applying the formatter.

10. **No internal-process vocabulary leaks.** No phase names, no spec/design/plan references, and no acceptance-criteria or task identifiers appear in any reconciled code, comment, test, or documentation.

## Out of Scope

- Re-litigating, redesigning, or extending the skip-misconfigured-agents feature itself — its policy, classifier scope, role rules, exit codes, or surfacing. This work only reconciles the already-shipped behavior with `trunk`.
- Adding any behavior beyond what the prior runs shipped (for example, additional skip/fail policies, or runtime or deep error classification).
- Authoring a new changeset for the reconciliation, or modifying the changeset configuration or the changeset-validation script; none is needed.
- Verifying the live, end-to-end browser-based exclusion as a guardrail. That path requires the e2e test environment and is design-verifiable rather than part of `npm test`; only its selector logic (covered by `project-args.test.ts`) is guardrail-observable.
- Choosing the integration mechanics (a `trunk`-into-branch merge commit versus any alternative strategy). The mechanism is a later-phase decision; only the observable outcome — mergeable, guardrails green, behavior preserved — is required here.
- Changes to CI workflows or to the set of guardrails defined on `trunk`.

## Acceptance Criteria

- **Given** the reconciled branch, **when** its merge state against `trunk` is evaluated, **then** there are no remaining merge conflicts and the pull request is no longer reported as `CONFLICTING`.

- **Given** each of the 19 previously-conflicting files after reconciliation, **when** it is inspected, **then** it contains both `trunk`'s intervening change and the branch's skip-misconfigured-agents contribution, with neither side dropped or weakened and no code deleted solely to resolve a conflict.

- **Given** the reconciled worktree with dependencies installed, **when** `npx biome format .` (verify, no rewrite) and `npm run lint` are run, **then** both exit 0 and the formatter reports no files needing reformatting.

- **Given** the reconciled worktree, **when** `npm run typecheck` is run, **then** it exits 0, including at the per-scenario run call site (which carries `trunk`'s nested-folders plumbing together with the branch's agent-filter and skipped data) and the skip-bearing run-report writer signature.

- **Given** the reconciled worktree, **when** `npm test` is run, **then** it exits 0 with all nine skip-feature test files passing as written, demonstrating that per-provider misconfiguration detection, cross-phase skipping, role-aware consequences, the `0`/`1`/`2` exit codes with configuration-skip precedence, the once-per-run id-and-reason surfacing in both the CLI summary and the run report's top-level `skipped` array, and the early-at-detection announcement (with the end-of-run summary unchanged) all still hold.

- **Given** a run in which every test agent is misconfigured, **when** the run completes (as exercised by the integration test), **then** the result is a non-passing matrix with exit code `2`, never a vacuous pass.

- **Given** a run in which a judge agent is misconfigured, **when** the run executes (as exercised by the integration test), **then** the run stops before any post-run hook or report runs.

- **Given** a run in which an improver agent is misconfigured, **when** the run executes (as exercised by the integration test), **then** the improver finishes the current iteration and then halts.

- **Given** a run with at least one genuine evaluation failure and at least one configuration skip, **when** it completes, **then** the exit code is `2` (configuration-skip precedence over the failure code).

- **Given** a mock run with no misconfigured agents, **when** it executes, **then** no early skip announcement is emitted.

- **Given** the reconciled `testing-project` workspace, **when** `npm --prefix testing-project run check:config` is run, **then** it exits 0, and the e2e verification helper still derives project names from caller-passed parameters plus the project-args module with no module-initialization-time read of the imported config and order-preserving project forwarding.

- **Given** the reconciled worktree, **when** `npx tsx scripts/validate-changesets.ts` and `npx changeset status --since=origin/trunk` are run, **then** both exit 0 and the status reports `@automattic/skillsmith` to be bumped at `minor`, with the three existing changesets unchanged and no new changeset added.

- **Given** the full reconciled diff against the pre-reconciliation branch tip, **when** it is reviewed, **then** it contains only conflict resolutions and formatter output — no gratuitous refactors — and no phase names, spec/design/plan references, or task/acceptance-criteria identifiers appear anywhere in code, comments, tests, or documentation.
