# Spec review — APPROVED

Reviewer: spec-reviewer (round 1)
Subject: `.pipelines/39-changelog-and-versioning/1-spec/spec.md`
Verdict: **APPROVED**

## Why it passes

The spec is faithful to `requirements.md` and the original prompt, internally consistent on second reading, and standalone enough that a reader can proceed to design without re-opening the Q&A record.

- **Faithfulness.** Every Q1–Q5 decision in `requirements.md` lands in `spec.md`: the changeset-required vs. not-required cut (R1.1/R1.2), the empty-changeset escape hatch (R1.3, R2.4, R8.6), the three R1.4 edge cases (examples, new provider, README mix), the steady-state bump table verbatim (R3.1), the pre-1.0 policy with the `BREAKING:` prefix and validator guard (R3.4, R2.5), the rationale and upstream-issue link justifying it ([changesets/changesets#1887](https://github.com/changesets/changesets/issues/1887)), the 1.0.0 cut criteria (R3.5), the `0.1.0` backfill entry (R3.6), the workflow shape (`changesets/action` Version Packages PR pattern; trigger `on: push: branches: [trunk]`; concurrency guard; pre-publish lint/typecheck/test; `fetch-depth: 0`; the three minimum permissions exactly), npm trusted publishing as primary auth with `NPM_TOKEN` as documented fallback (R5.3), `@changesets/changelog-github` v0.7.0 as the changelog plugin (R5.6), and the `.changeset/config.json` JSON verbatim (R8.4) matching the Q3 working-assumption file.

- **Testability.** Section A (file presence and shape), B (validator behaviour), C (CI gate on a real PR), D (post-merge release behaviour), and F (post-merge verification) read as a concrete reviewer checklist. The validator behaviour items B1–B8 are directly executable against `scripts/validate-changesets.ts` once written. D2's claim about the no-op Version Packages PR diff being "just the deletion of the empty changeset" is concrete and was empirically verified upstream in `/tmp/changesets-test-39` per `requirements.md`.

- **Changesets constraint honored.** Changesets is the genuine mechanism throughout — `changedFilePatterns` is the gate, `changesets/action` is the release workflow, `@changesets/changelog-github` is the changelog plugin, `changeset status` is the CI command, `changeset publish` is the publish step. The shape validator (`scripts/validate-changesets.ts`) is an additive safety net around Changesets, not a replacement.

- **Scope hygiene.** The "Out of Scope" section is coherent and explicit (Renovate/Dependabot, `mscharley/dependency-changesets-action`, `@changesets/bot` install, 1.0.0 cut refinements, prerelease branches, aging-reminder workflow, README split, CI-enforced summary linting, custom tag format, disputing the unscoped npm name). Section E cleanly separates the four owner-level operational actions (npm-name confirmation, "Allow Actions to create PRs" setting, branch protection for the bot, npm trusted-publisher binding) from the code deliverables in R8/A — with the explicit lead-in "owner-level actions, not code deliverables" and a note that E2–E4 are also documented in `CONTRIBUTING.md` for ongoing auditability.

- **Standalone.** The bump-type table (R3.1), `changedFilePatterns` array (R2.3), `.changeset/config.json` (R8.4), permissions block (R4.6), `package.json` additions (R8.2), and validator obligations (R2.5) are all reproduced inline. A design-doc author or implementer can work from `spec.md` alone.

## Minor notes for the next phase (non-blocking)

These do not change the verdict. Capturing them so they aren't lost between phases.

- **Inaccurate line citation in R2.5.** Spec says `yaml@2.8.3` is at `package.json:46`; it is actually at line 45. (`requirements.md:608` has the same off-by-one — spec is faithfully reproducing it.) The substance — that `yaml` is already a project dependency and no new dep is needed — is correct. Worth a one-character correction in the design or implementation phase.

- **A2 could explicitly assert `package.json.version` remains `"0.1.0"`** in this PR. R3.6 states the constraint and A1 covers the `## 0.1.0` `CHANGELOG.md` entry, but A2 only enumerates name / `publishConfig` / `devDependencies` / `scripts` / `repository.url` / `homepage`. A one-line addition ("`version` is unchanged at `"0.1.0"`") would tighten the section-A checklist.

- **A11 has one vague item.** "Correct trigger" is looser than the rest of A11 (which calls out concurrency, exact permissions, `fetch-depth`, lint/typecheck/test sequence, and the `workflow_dispatch` input by name). Suggest restating as: "trigger is `on: push: branches: [trunk]`".

- **R4.10 vs A11 mild "should/must" inconsistency.** R4.10 marks the `workflow_dispatch` `skip_publish` input as **should** be present; A11 lists it without that hedge. Either tighten R4.10 to **must** (the requirements.md Q5d sketch treats it as recommended-but-included) or relax A11's bullet to "if present, accepts a `skip_publish: boolean` input". Pick one in the design phase.

- **R4.9 conflates two `changesets/action` built-in behaviours** ("must only open/update when at least one non-README changeset exists" + "must force-push the release branch on subsequent changesets"). These are properties the project depends upon, not behaviours the implementer enforces; the actionable contributor-side rule is the closing "must not be disabled". A reword in the design doc clarifying this could prevent confusion during implementation, but the intent is clear.

- **Pinned tool versions (`actions/checkout@v6`, `actions/setup-node@v6`, Node 22) appear only inside R8.11 / A11** rather than being surfaced as their own R4 requirement. Not strictly wrong — R8 is the file-by-file deliverable list — but a reader scanning R4 alone would miss them. Cosmetic.

None of these defects warrant another spec round. The design phase has a clean, comprehensive starting point.
