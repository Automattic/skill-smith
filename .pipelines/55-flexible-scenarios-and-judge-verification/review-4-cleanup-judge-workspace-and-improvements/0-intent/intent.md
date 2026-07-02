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
