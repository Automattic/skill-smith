# Spec Research: Unified cleanup, judge workspace, and centralized decision rule

# Unified cleanup, judge workspace, and centralized decision rule

## Origin

This revision follows `review-3-restore-coverage-and-drop-task-intro` (of the #55 pipeline / PR #56), which shipped the trunk-coverage restoration and was approved through phase 5. After close-out, the owner asked three questions about the shipped state, corrected a misunderstanding from the review-3 design phase, commissioned three parallel independent reviewers, and then requested this revision.

**The owner's three questions:** (1) whether the identical decision-rule opener really needs to be repeated in every `JUDGE.md` or could be passed to all judges centrally; (2) why the workspace idea was discarded; (3) whether `wp-env-judge.ts` can be simplified.

**The workspace correction, verbatim** (the review-3 design phase evaluated a *both-roles shared* workspace and rejected it; the owner's actual idea is judge-scoped and was never evaluated):

> For 2, I didn't mean to share the workspace, my idea was to have a judge.workspace that is passed to all the judge. That way we don't have judge.prompt and judge.rubrics and we tell the exact rubric. It is creating a workspace where users can add anything, which looks more flexible. I don't care about the prior art, we are in the design phase of the tool first.

**The three reviewer reports** (simplification, churn pollution, improvements) ran read-only against tip `0addcb8` and are preserved verbatim beside this intent: [`reviewer-simplification.md`](reviewer-simplification.md), [`reviewer-pollution.md`](reviewer-pollution.md), [`reviewer-improvements.md`](reviewer-improvements.md). Their claims were spot-verified during the session but must be re-verified against the code before acting (per the standing R10 discipline of this pipeline).

**The revision request, verbatim:**

> I want to run a unified review with everything we discussed. Not only these last reviews

**The owner's scope decision** (asked explicitly before this run was created): the core items are mandatory — both cleanup tracks, the judge-scoped workspace, and the centralized decision rule; the remaining reviewer proposals are **evaluated in the design phase** — those judged right for this revision ship in it, the rest are recorded as future issues with a disposition each.

Convenience links: issue https://github.com/Automattic/skillsmith/issues/55, PR https://github.com/Automattic/skillsmith/pull/56.

## Goal

One revision that leaves the branch in this state:

1. **No churn residue.** The codebase carries no leftovers from the pipeline's approach pivots: the dead legacy env orchestrators and dead `wp-cli.mjs`, the tombstone/history-pinning tests that block their deletion (including the changeset test that will break future CI and the e2e-removal migration scan), the orphaned workflow PNG, stale pivot-era wording, and the smaller core simplifications (duplicated section scanner, the `loadAllRubrics` self-reparse latent bug, dead judge params, duplicated test helpers). The reviewer reports carry the itemized findings.
2. **A judge workspace.** The judge is configured through a single judge-scoped directory that users can fill with anything — environment manual, rubrics, reference docs, helper scripts — supplied to every judge, **replacing** the `roles.judge.prompt` + `paths.rubrics` pair. Briefs name the exact rubric/file they want applied. The exact config key name, directory conventions, and supply mechanism are design-phase decisions.
3. **One decision rule, stated once.** The all-must-pass verdict rule lives in one shared place instead of being repeated at the top of all 11 briefs, with a brief able to state a different rule when it needs one. The briefs keep exactly the judging coverage review-3 restored.
4. **A disposition for every remaining proposal.** Each improvement proposal in `reviewer-improvements.md` that is not shipped by this revision has a recorded decision (ship now / future issue / rejected with reason) — none silently dropped.

## Constraints

- **Coverage parity is untouchable.** The review-3 achievement — every trunk acceptance bullet as a code check, every trunk e2e observable as a behavior check, the rubric check applied — must survive intact through the brief/template changes this revision makes. Coverage parity remains reviewer-verified, never encoded in code (no coverage-assertion tests, no mapping artifacts).
- **Design-first for the workspace.** Prior art inside this repo (e.g. the rolled-back PR #5 disk materialization, the review-3 both-roles rejection) is NOT a valid reason to reject the judge-workspace direction. Evaluate it as if designing the tool fresh.
- **Cleanup must not change runtime behavior**, with one deliberate exception: fixing the `loadAllRubrics` self-reparse bug is in scope as a bug fix (its mechanism may anyway be superseded by the workspace decision).
- **Pre-1.0 policy applies**: breaking changes (removing `roles.judge.prompt` / `paths.rubrics`, verdict shape changes if adopted, etc.) are recorded as `minor` changesets with a `BREAKING:` summary prefix.
- Grading material must keep reaching **judges only** — the testing agent must never receive rubrics or other grading criteria.

## Context

- Current model (review-3 tip `0addcb8`, this run's base ref): two-file scenarios; judge system prompt = verbatim `JUDGE.md` + auto-injected skill-stripped testing task + `{ pass, notes }` output instruction + all rubrics from `paths.rubrics` with a selection lead-in + `roles.judge.prompt` environment manual; 11 briefs each open with the identical all-must-pass sentence, enforced by the conformance test (`src/__tests__/testing-project-scenarios.test.ts`).
- The reviewer reports beside this intent are the primary findings inventory; the pollution report also lists surfaces verified clean (don't re-litigate those without cause).
- The review-3 design doc (`../review-3-restore-coverage-and-drop-task-intro/2-design-doc/design-doc.md`) documents the current mechanism and the both-roles workspace rejection — useful background, but its Decision 2 explicitly does not apply to the judge-scoped shape.

## Assumptions / directions to explore

*(Owner leanings and reviewer recommendations — open for spec/design to confirm or overturn.)*

- The improvements reviewer recommends adopting the workspace as `roles.judge.library` with a two-tier supply (directory `README.md` inlined as the manual; everything else copied per pair to a read-only sibling of the judge workspace, announced by a file manifest; full-inline fallback for tool-less judges), briefs referencing items by relative path, and deleting the rubric selection lead-in. The *name* should avoid colliding with the existing `judgeWorkspace` (the isolated artifact copy). All open for design.
- The decision rule's suggested home is the harness output instruction, as a default a brief can override in prose. The conformance test shrinks accordingly.
- Reviewer-proposed candidates for ship-now vs future-issue evaluation include: slot-pool judge concurrency, per-check verdicts, `inspect`/`new`/`lint` CLI, judge-phase observability, capability manifest injection, `repeats` + `compare`, improver memory, scenario seed workspaces, provider capability honesty warnings, cache-friendly prompt assembly. The reviewers suggest the workspace + decision rule (+ per-check verdicts, if adopted) compose into one coherent `BREAKING:` changeset wave.
- The owner flagged `wp-env-judge.ts` specifically for simplification; whether `env:start`/`env:stop` npm scripts stay as dev conveniences once their only code consumers are deleted is an open call.

## Q&A

**Q1.** The design phase will evaluate the twelve reviewer proposals for ship-now vs future-issue vs rejected. Before it does: do you have any hard bounds for that evaluation — proposals that MUST ship in this revision regardless of the design phase's judgment, or proposals that must NOT ship here (too big, wrong time) even if design likes them? Naming none is a valid answer (design gets a free hand within the revision's size).

**A1.** "Let design decide" — no hard bounds; the design phase has a free hand on all twelve proposals.

**Q2.** Goal 4 says every proposal not shipped gets a recorded disposition, with some becoming "future issues". What form should that take: real GitHub issues created at the end of this run (each with its Linear mirror, per the project's issue conventions), or only a disposition list recorded in the run's artifacts for you to triage into issues later yourself?

**A2.** "Just a list" — the disposition record lives in the run's artifacts only (e.g. in the design doc); no GitHub/Linear issues are created by this run.

**Q3.** The config key's name: you called it `judge.workspace`, and the improvements reviewer recommends avoiding the word "workspace" because `judgeWorkspace` already means something else in the codebase (the isolated copy of the produced artifact the judge runs against, visible in hook contexts and docs) — it suggests `library` or similar. Do you want to keep the name "workspace" anyway, or is the final name a design-phase decision?

**A3.** "Let design phase decide" — the final key name is a design decision (the collision concern is on record for it to weigh).

**Q4.** (Out-of-scope confirmation.) Proposed exclusions: (1) creating GitHub/Linear issues for future-issue dispositions — artifacts-only list per A2; (2) any change to judging coverage — the trunk-parity check set survives all template/workspace changes verbatim; (3) coverage-encoding tests or mapping artifacts — parity stays reviewer-verified; (4) supplying grading material to the testing agent in any form; (5) changes to `TESTING-AGENT.md` briefs or the testing-agent prompt, except where a design-adopted proposal explicitly requires them; (6) re-litigating surfaces the pollution report verified clean, absent new evidence; (7) merging the PR. Note (not an exclusion): unlike review-3, this revision WILL need at least one changeset — core config surface changes ship, breaking ones as `minor` + `BREAKING:` per pre-1.0 policy. Anything missing or wrong?

**A4.** Confirmed as proposed ("Go ahead").

## Research

- The three reviewer reports beside the intent (`../0-intent/reviewer-simplification.md`, `reviewer-pollution.md`, `reviewer-improvements.md`) are this spec's findings inventory; both cleanup reports were produced read-only against tip `0addcb8` with claims spot-verified during the session (typecheck clean, 379 tests green at that tip). The pollution report additionally lists surfaces verified clean.
- Current mechanism (verified in the review-3 phases and unchanged since): judge system prompt = verbatim `JUDGE.md` + `# Testing task` (skill-stripped) + `{ pass, notes }` output instruction + `# Grading rubrics` (load-all from `paths.rubrics` with a selection lead-in) + `# Role instructions` (`roles.judge.prompt`); assembled in `src/pipeline/judge-agent.ts`.
- The decision-rule opener and rubric sentence are enforced per brief by `src/__tests__/testing-project-scenarios.test.ts` (seven template invariants) — centralizing the rule and re-pointing rubric references both require rewriting that test's invariant set; coverage checks in the briefs are untouched by either change.
- Unlike review-3 (no changeset: briefs + `src/__tests__/**` fall outside `.changeset/config.json` patterns), this revision changes `src/config`/`src/pipeline` surface, which those patterns cover — changeset(s) required.

## Out of Scope

1. Creating GitHub/Linear issues for future-issue dispositions (artifacts-only list).
2. Any change to judging coverage — the trunk-parity check set survives verbatim.
3. Coverage-encoding tests or mapping artifacts.
4. Supplying grading material to the testing agent in any form.
5. Changes to `TESTING-AGENT.md` briefs or the testing-agent prompt, except where a design-adopted proposal explicitly requires them.
6. Re-litigating surfaces the pollution report verified clean, absent new evidence.
7. Merging the PR.

## Out of Scope

## Consolidated Requirements

1. Every churn-pollution finding itemized in `reviewer-pollution.md` and every pure-deletion simplification in `reviewer-simplification.md` (findings 1–5, 8) is resolved — dead code, dead module, tombstone/history-pinning tests, orphaned asset, stale wording — each re-verified against the code before removal, with no runtime behavior change.
2. The safe core simplifications from `reviewer-simplification.md` (findings 6, 7, 9, 10, 13) are applied as judged safe, including the `loadAllRubrics` self-reparse fix (the one permitted behavior change, a bug fix — possibly mooted if the workspace supersedes the loader). Finding 12 (`dirName` removal) is a design-phase disposition like the improvement proposals.
3. The judge is configured through a single judge-scoped directory that users can fill with anything (manual, rubrics, reference docs, helper scripts), supplied to every judge, replacing `roles.judge.prompt` and `paths.rubrics` entirely. Key name, directory conventions, and supply mechanism are design decisions; a judge without file tools must still receive the material; briefs name the exact rubric/file they want applied; grading material reaches judges only.
4. The all-must-pass decision rule is stated once in a shared home (design chooses where); a brief may state a different rule and win; the 11 briefs drop the repeated opener; the conformance test follows the new contract without becoming a coverage checker.
5. The testing-project is migrated to whatever ships (manual/rubric relocation, the 11 briefs' rubric references, config), preserving the exact review-3 check set.
6. Every improvement proposal in `reviewer-improvements.md` (plus simplification finding 12) has a recorded disposition in the design doc — ship-now (then implemented in this revision), future issue, or rejected with reason. Artifacts-only; no tracker issues created.
7. Changesets recorded per CONTRIBUTING; breaking changes as `minor` with `BREAKING:` prefix (pre-1.0).
8. Verification posture: the pipeline's reviewers verify cleanup completeness against the two reports, coverage parity against the unchanged check set, and disposition completeness; all five guardrails plus changeset gates green.
9. Docs realigned in phase 5 to the shipped state (README, examples, migration notes for removed config keys).
