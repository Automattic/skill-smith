# Doc Plan: Changelog and Versioning

Issue: [Automattic/skillsmith#39](https://github.com/Automattic/skillsmith/issues/39) — _Add a changelog and automate package version bumps_

## Overview

The code phase (per `3-plan/code-plan.md`) lands the Changesets-based release pipeline: a `.changeset/config.json`, a `CHANGELOG.md` with an initial `## 0.1.0` entry, a `none`-bump starter changeset, the `scripts/validate-changesets.ts` validator, and two GitHub Actions workflows (`changeset-gate.yml` and `release.yml`). It deliberately excludes all human-facing documentation. This phase fills that gap.

Three documentation surfaces are added or rewritten:

1. **`CONTRIBUTING.md`** (new file at the repo root, ~150 lines) — the canonical contributor and maintainer reference. Covers the changeset coverage policy, the bump-type table, the pre-1.0 rule, both authoring paths (interactive and direct-write), empty-changeset usage, summary conventions, consumer-perspective writing guidance, a worked `CHANGELOG.md` example, the release process (with a cross-link to `release.yml`), the manual publish escape hatch, the rollback procedure, the "I forgot a changeset" recovery, re-run guidance, the pre-release dry-run guidance, and the repo configuration prerequisites (E2–E4).
2. **`.changeset/README.md`** (new file, replacing the upstream Changesets-seeded boilerplate that would otherwise be created automatically) — a project-specific cheat sheet. Cross-links to `CONTRIBUTING.md#adding-a-changeset`; shows quick-start commands; shows the anatomy of a changeset.
3. **`README.md`** updates (~10 lines appended to the existing 225-line file) — three pointer sections so consumers, contributors, and changelog readers can find the right reference without reading any code: `## Installation`, `## Releases`, `## Contributing`.

Two anchors in `CONTRIBUTING.md` are load-bearing and must be verified against external references:

- **`#adding-a-changeset`** — referenced by `.changeset/README.md` and by the new `## Contributing` section in `README.md`.
- **`#pre-10-policy`** — referenced verbatim by the validator error message that the code phase ships in `scripts/validate-changesets.ts` (per code-plan Task 6, the validator emits `… see CONTRIBUTING.md#pre-10-policy.`). The anchor in the contributor doc MUST match the slug the validator emits. The doc-writer must read the validator's message string in the code and confirm the slug.

Audiences across the three surfaces:

- **First-time contributor** — opens a PR, needs to know whether to add a changeset, and if so, how.
- **Repeat / AI-assisted contributor** — wants the direct-write recipe and the conventions table without re-reading the whole guide.
- **Downstream npm consumer** — installs `@automattic/skillsmith`, reads `CHANGELOG.md` between versions, and only needs `README.md` to find both.
- **Maintainer** — reviews PRs, merges Version Packages PRs, knows what to do when something goes wrong (rollback, recovery, dry-run, re-run), and audits repo-configuration prerequisites.

## Tasks

### Task 1: Write `CONTRIBUTING.md`

- **Goal:** Land the canonical, repo-rooted contributor and maintainer reference. This is the load-bearing doc for everyone who writes a changeset, reviews a PR, releases a version, or recovers from a release problem. Target ~150 lines per spec R8.7. The doc is brand-new — no existing `CONTRIBUTING.md` is in the worktree.

- **Audience:**
  - First-time contributors authoring their first changeset (need the bump-type table, the "when is a changeset required?" rules, and the interactive recipe).
  - Repeat and AI-assisted contributors (need the direct-write recipe and the summary conventions without re-reading prose-heavy sections).
  - Maintainers (need the release process, the escape hatch, the rollback procedure, the recovery procedures, the dry-run guidance, and the repo configuration prerequisites for audit).

- **Files to change:**
  - `CONTRIBUTING.md` (new file at the repo root)

- **Sections / scope:** Create the following sections, in this order, with the indicated heading levels. Section names are guidance; the doc-writer may refine wording. The anchors marked **MUST** are contract — they are referenced by other files or by code.

  1. **Intro / what this file covers.** One short paragraph linking back to `README.md` and pointing at the existing `src/` and `bin/` layout described in `README.md`. Per R6.2 first bullet.
  2. **Running tests and checks locally.** Document the four scripts contributors run before pushing: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run smoke`. Inspect `package.json:scripts` to confirm the exact script names. Per R6.2 second bullet.
  3. **Versioning policy.** Brief framing of how the project uses Changesets and what the contributor's responsibility is.
  4. **Adding a changeset** (MUST be at heading anchor `#adding-a-changeset`). This is the section `.changeset/README.md` and the new README `## Contributing` section link to. Per R6.1, R6.2. The section covers, in subsections:
     - **When a changeset is required.** Enumerate R1.1's six trigger categories (CLI flag / hook contract / `defineConfig` / report-JSON / provider support / bug fix / dep bump with behaviour change) and R1.2's exclusions (docs prose-only / refactors / tests / lint / format / CI config / lockfile / pipeline artefacts / `LICENSE` typo / `package-lock.json`-only / `testing-project/` fixture / `docs/`). Include the four R1.4 edge-case rulings: `examples/skillsmith.config.ts` exercising new public API requires a changeset; new provider is **minor** even with `ProviderId` widening; `README.md` mixes prose and contract, so cosmetic prose-only edits rely on the empty escape; tests-only changes do not require a changeset (the `!src/__tests__/**` negation in `changedFilePatterns`).
     - **Bump types.** Reproduce R3.1's table **verbatim** (patch / minor / major triggers). Per R6.2 "Bump-type table from R3.1".
     - **Pre-1.0 policy** (MUST be at heading anchor `#pre-10-policy`). State that while `package.json:version` starts with `0.`, contributors **must** write `minor` (never `major`) for breaking changes and prepend `BREAKING:` to the summary. Briefly justify per R3.4. Mention the criteria for cutting 1.0.0 from R3.5. The validator error message in `scripts/validate-changesets.ts` references this exact slug; the doc-writer MUST grep the validator file (or the in-code error string) and confirm `#pre-10-policy` is the slug the validator emits. If the validator emits a different slug, the doc-writer must align (the anchor here is the authoritative one; if the validator drifted, surface a blocker to the orchestrator rather than silently editing the validator).
     - **How to add one — interactive vs. direct-write, equal billing.** Per R6.2: the two paths get equal billing. Document `npx changeset` (interactive, suggested for first-timers) and direct file authoring at `.changeset/<name>.md` (suggested for repeat contributors and AI-assisted PRs — interactive is awkward for multi-line summaries; reference [changesets#346](https://github.com/changesets/changesets/issues/346)). Show a worked file (front matter + body example) for the direct-write path. The front-matter package-name key MUST be read from the code task 1 result (`package.json:name`); under E1 the working assumption is `@automattic/skillsmith`, but a name change at merge time propagates here.
     - **Empty changesets** (the contributor-facing escape hatch from R1.3). Document `npx changeset --empty` for PRs that touch release-relevant paths but warrant no release entry. Briefly note the on-disk form (`---\n---`). **Important note for the doc-writer:** the *starter* changeset shipped in this PR is a `none`-bump entry, not the canonical empty form (see design doc's "Empty-changeset mechanics for the first release" section and code-plan Task 5). This is a one-time bootstrap distinction and does NOT need to be documented in `CONTRIBUTING.md` per OQ-5 — contributors invoking R1.3 use the canonical empty form via `--empty`.
     - **Summary format conventions** (from R6.4). Voice/tense: imperative present (`Add`, `Fix`, `Remove`). No conventional-commits prefixes. `BREAKING:` prefix required for pre-1.0 breaks; encourage but don't mandate a `Migration:` line for non-trivial breaks. Soft ~120-char cap (not CI-enforced). No manual PR/author references (`@changesets/changelog-github` auto-appends `(#PR, by @author)`).
     - **Consumer-perspective writing guidance** (from R6.5). Audience is consumers running `npm install -D @automattic/skillsmith`. Cover the type-only-change example, the unobserved-bug-fix example, the `examples/skillsmith.config.ts` writeup convention, and the "zero-consumer-effect → use `--empty`" review flag.
     - **Worked `CHANGELOG.md` example.** Show a small mock `CHANGELOG.md` block illustrating what consumers see with `@changesets/changelog-github` enrichment (`(#PR by @author)` suffixes; `### Minor Changes` / `### Patch Changes` subsections). Use the format the design doc shows in "`CHANGELOG.md` initial format (R3.6, A1)" as the model.
  5. **Release process.** Cross-link to `.github/workflows/release.yml` (which exists after code Task 8 lands). Briefly describe the steady-state flow: merge to `trunk` → action opens Version Packages PR → maintainer reviews and merges → action publishes to npm with OIDC, tags, and creates GitHub Release. Note the bootstrap distinction (until the first real changeset PR adds `push: branches: [trunk]` to `release.yml`, releases are `workflow_dispatch`-only — see the design doc's "Empty-changeset mechanics for the first release" section). Per R6.2 "Release process" bullet.
  6. **Manual publish escape hatch** (emergency only, from R7.1). Document the procedure: `git pull --ff-only` on `trunk` → `npm ci` → `npx changeset version` → inspect, or `git restore .` to abort → commit, push, `npm publish --access public`, `gh release create`. Document the two trade-offs: auth is the maintainer's personal automation token or interactive 2FA OTP (`--otp=<code>`); manual publish does NOT produce npm provenance attestations (provenance is OIDC-only).
  7. **Rollback / bad-publish procedure** (in order, from R7.2):
     1. Cut a fix release through the normal flow.
     2. Deprecate the bad version with `npm deprecate @automattic/skillsmith@<version> "Withdrawn — contained <bug>. Use <fixed-version> or later."`. Note this requires npm auth on the maintainer's machine (OIDC is workflow-only).
     3. Edit the GitHub Release for the bad version (mark pre-release; prepend a WITHDRAWN notice; do not delete).
     4. Unpublish only as last resort within 72 hours, no known consumers, version is dangerous (leaked secret, malware, PII). Burns the version number forever.
     5. `latest` dist-tag rescue when a clean fix release can't ship: `npm dist-tag add @automattic/skillsmith@<previous-good-version> latest`.
  8. **"I forgot a changeset" recovery** (R7.3). Document: open a new PR against `trunk` that adds only the missing changeset; write the summary as if it had been in the original PR; include a `> Backfilled from PR #<original-PR>` line at the bottom of the changeset body so reviewers can trace the lineage. Note the cosmetic wart: `@changesets/changelog-github` attributes the entry to the backfill PR, not the original; the `> Backfilled from PR #<original>` line propagates into `CHANGELOG.md` to preserve discoverability.
  9. **Re-running a failed release** (R7.4). State that `changeset publish` is idempotent per-package (verified in changesets source: `publishPackages.ts` calls `infoAllow404(packageJson)` then skips versions already published on npm). The safe action when a release run fails partway is to re-run the failed job from the Actions UI, not to publish manually.
  10. **Pre-release dry-run guidance** (R7.5). Local version dry-run: `npx changeset version` → inspect with `git status` / `git diff` → `git restore .` to abort. Local publish dry-run: `npm publish --dry-run --access public`.
  11. **Dependency-bump PRs.** Per R6.7: state that dep-bump PRs (Renovate / Dependabot) require a changeset like any other PR; a maintainer merging a bot PR should add the changeset to the bot's branch before merging (`npx changeset` works against any branch). Wiring an auto-bot is out of scope for #39.
  12. **Repo configuration prerequisites.** Per R6.2 last bullet — document items E2, E3, E4 of the pre-merge checklist (E1 is the one-time name decision and is documented only in the implementing PR's description per design decision "Surface E1–E4 + bootstrap as PR-description checklist; persist E2–E4 in `CONTRIBUTING.md`"). For each: what it is, where it's configured, why it matters. Mention `@changesets/bot` GitHub App as optional and complementary to the CI gate.

- **Depends on:** none. (`CONTRIBUTING.md` is brand-new and is read by `.changeset/README.md` and the README, so it must land first to expose the `#adding-a-changeset` and `#pre-10-policy` anchors.)

- **Traces to:**
  - Spec: R1.1, R1.2, R1.3, R1.4, R3.1, R3.4, R3.5, R6.1, R6.2 (every bullet), R6.4, R6.5, R6.7, R7.1, R7.2, R7.3, R7.4, R7.5, R8.7, A7, E2, E3, E4.
  - Design doc: "Empty-changeset mechanics for the first release (R8.6, R2.4, D2)" (bootstrap reference), "Decision: Split contributor doc — `CONTRIBUTING.md` + `.changeset/README.md`", "Decision: Surface E1–E4 + bootstrap as PR-description checklist; persist E2–E4 in `CONTRIBUTING.md`", "Pre-1.0 guard observability".
  - Code plan: Task 6 (validator's error string referencing `CONTRIBUTING.md#pre-10-policy`), Task 8 (release workflow that this doc cross-links).

- **Acceptance:**
  - A first-time contributor reading the file in order can answer: "Does my PR need a changeset?", "What bump type do I write?", "How do I add one?" — each within one section.
  - A repeat contributor can land on the `#adding-a-changeset` anchor and find both the interactive recipe and the direct-write recipe with equal visual billing (neither buried in a sub-bullet of the other).
  - A maintainer reading the file in order can answer: "How does a release ship?", "How do I publish manually in an emergency?", "How do I roll back a bad publish?", "What do I do if I forgot a changeset on a merged PR?", "How do I dry-run before a real publish?" — each within one section.
  - The file includes the R3.1 bump-type table verbatim (the table contents are contract — do not paraphrase the trigger lists; the doc-writer copies the spec table exactly).
  - The heading anchor `#adding-a-changeset` exists and is reachable (i.e. the GitHub-Markdown auto-slug of the section heading produces `adding-a-changeset` — confirm by reading the file and computing the slug, or by linking from `.changeset/README.md` in Task 2 and visually checking the rendered output).
  - The heading anchor `#pre-10-policy` exists and matches the slug the validator emits in its error message. The doc-writer MUST grep `scripts/validate-changesets.ts` for the literal substring `pre-10-policy` and confirm it matches the heading slug. If the validator emits a different slug, flag a blocker to the orchestrator — do not silently rewrite either side.
  - The R7.2 rollback list appears in the documented order (cut a fix release → deprecate → edit the GitHub Release → unpublish-as-last-resort → `latest` dist-tag rescue).
  - The "Repo configuration prerequisites" section names E2, E3, and E4 (or descriptive equivalents — "GitHub Actions can create PRs", "branch protection on `trunk` allows `github-actions[bot]` to push to `changeset-release/trunk`", "npm trusted-publisher binding for `Automattic/skillsmith`") so a future maintainer can audit each.
  - The release-process section cross-links to `.github/workflows/release.yml` (relative path, since the file is in the same repo).
  - The "Empty changesets" subsection does NOT describe the one-time `none`-bump starter; contributors invoking R1.3 use the canonical empty form. The bootstrap-only `none`-bump starter is not contributor-facing.
  - The file does NOT duplicate the implementing PR's first-publish bootstrap checklist (per design OQ-5: bootstrap is one-time, lives in the PR description, not `CONTRIBUTING.md`).
  - The file's prose conventions match the project's existing style (read `README.md` to calibrate voice; the project uses imperative, sentence-case headings, no emojis).

### Task 2: Write `.changeset/README.md`

- **Goal:** Replace the upstream Changesets-seeded boilerplate (which is written for the general Changesets audience and does not reflect skillsmith's policy) with a thin, project-specific cheat sheet that points contributors to `CONTRIBUTING.md#adding-a-changeset` for the full policy. The file is brand-new in the worktree; the seeded boilerplate is what `npx changeset init` would generate if a contributor ran it locally, and we replace it preemptively.

- **Audience:**
  - Contributors who open the `.changeset/` directory first (a common reflex when they hear "add a changeset") and need a quick orientation without reading 150 lines of `CONTRIBUTING.md`.
  - Future-proofing: replaces the generic upstream boilerplate so contributors see project-specific guidance, not generic Changesets prose.

- **Files to change:**
  - `.changeset/README.md` (new; the `.changeset/` directory is created in code-plan Task 3)

- **Sections / scope:** Create a short doc (target ~30–50 lines) with these elements:
  1. **What this folder is.** One short paragraph: this directory holds pending changesets that the release workflow consumes; the policy lives in `CONTRIBUTING.md`.
  2. **Link to the full policy.** A prominent cross-link to `../CONTRIBUTING.md#adding-a-changeset`. This MUST be the relative path with the exact anchor — the relative path resolves because `.changeset/` and `CONTRIBUTING.md` are sibling-and-parent in the repo root.
  3. **Quick-start.** Two commands with one-line descriptions:
     - `npx changeset` — interactive; pick package, bump type, write summary.
     - `npx changeset --empty` — for PRs that touch release-relevant paths but warrant no release entry. Per R1.3.
  4. **Anatomy of a changeset.** Show the on-disk file format with a small worked example: front matter (package-name string mapped to bump type — read `package.json:name` from the code result, defaults to `@automattic/skillsmith`) plus body (imperative present, no PR/author refs). Show what an empty changeset looks like (`---\n---`).

- **Depends on:** Task 1 (so the `#adding-a-changeset` anchor in `CONTRIBUTING.md` is in place and resolvable from this file's cross-link).

- **Traces to:**
  - Spec: R6.1, R6.3, R8.5, A5.
  - Design doc: "Decision: Split contributor doc — `CONTRIBUTING.md` + `.changeset/README.md`".
  - Code plan: Task 3 (the `.changeset/` directory is created by code Task 3; this file lives there).

- **Acceptance:**
  - The file exists at `.changeset/README.md`, replacing the upstream Changesets-seeded boilerplate (i.e. it does NOT begin with the upstream "Changesets — Hello and welcome!" prose; the doc-writer should check by reading the upstream template at [`@changesets/cli`'s default-README](https://github.com/changesets/changesets/blob/main/packages/cli/default-files/README.md) and confirming no copy-paste).
  - A contributor landing here can identify, in under thirty seconds: (a) what the folder is for, (b) where the full policy lives, (c) how to create a changeset (two commands), (d) what one looks like on disk.
  - The cross-link to `../CONTRIBUTING.md#adding-a-changeset` is present and uses that exact relative path and anchor.
  - The "anatomy" example shows a real-looking front matter line using the package name from `package.json:name` (after code Task 1's rename, this is `@automattic/skillsmith`).
  - The file does NOT duplicate the bump-type table, the pre-1.0 rule, the summary conventions, the release process, the recovery procedures, or any policy that lives in `CONTRIBUTING.md`. It is a pointer, not a copy.
  - The file is short (target ~30–50 lines; spec calls this a "cheat sheet replacing the seeded boilerplate", so brevity is a feature).

### Task 3: Add `## Installation`, `## Releases`, `## Contributing` sections to `README.md`

- **Goal:** Append three short pointer subsections to the existing `README.md` so consumers can install the package, find the changelog, and find the contributor guide without grepping the repo. Spec R6.6 caps the total addition at ~10 lines.

- **Audience:**
  - **Downstream npm consumer** — lands on the README (linked from the GitHub repo and from the `docs/index.html` landing page), wants to install the package and read the changelog between versions. Currently the README does not mention installation or releases at all.
  - **Future contributor** — lands on the README, wants to know where to find the contributor guide.

- **Files to change:**
  - `README.md` (existing — append to the end; the file is currently 225 lines and ends with the `### Hooks` table)

- **Sections / scope:** Append three new top-level (`##`) sections to the end of `README.md`, in this order. Each is short (2–4 lines including the heading). Per R6.6 "(~10 lines added in total)".

  1. **`## Installation`** — Two lines: `npm install -D @automattic/skillsmith` (the package name is read from `package.json:name` after code Task 1's rename — under E1 it is `@automattic/skillsmith`), and a Node-version constraint line that reads `Requires Node.js ≥ 20.17.` (read `package.json:engines.node` to verify the floor — the code plan does not change it; current value is `>=20.17`).
  2. **`## Releases`** — Two short lines pointing readers to `CHANGELOG.md` (relative link, file created by code Task 4) and the GitHub Releases page (`https://github.com/Automattic/skillsmith/releases`).
  3. **`## Contributing`** — One short line pointing readers to `CONTRIBUTING.md` (relative link, file created by Task 1 of this plan). If natural, also pin the deep-link `CONTRIBUTING.md#adding-a-changeset` for first-time contributors.

- **Depends on:** Task 1 (so `CONTRIBUTING.md` exists for the `## Contributing` link to resolve). Does NOT depend on Task 2 (the `.changeset/README.md` cheat sheet is not linked from README). Depends on code Tasks 1 (package rename so the install command is correct) and 4 (`CHANGELOG.md` exists for the Releases section to link to) — but those code changes are guaranteed to land before phase 5 starts.

- **Traces to:**
  - Spec: R6.6, R8.8, A8.
  - Design doc: "`package.json` rename and pre-merge confirmation (E1)" (the `## Installation` line is the first place a consumer sees the new package name).
  - Code plan: Task 1 (`package.json:name` rename), Task 4 (`CHANGELOG.md` exists).

- **Acceptance:**
  - The three new sections — `## Installation`, `## Releases`, `## Contributing` — appear in the file in that order, appended after the existing content (the README's current last section is `### Hooks`; the new sections come after it).
  - The total line count added is approximately ten (per R6.6 "(~10 lines total)"). A doc-writer producing thirty lines of explanatory prose under these headings is over-scoping; the design intent is "pointer subsections", not "expanded reference".
  - The `## Installation` section contains an `npm install -D <package-name>` command where `<package-name>` matches `package.json:name` after the rename (read it to confirm).
  - The `## Installation` section states the Node-version floor in a form that matches `package.json:engines.node`.
  - The `## Releases` section links to (a) the repo-relative `CHANGELOG.md` and (b) the GitHub Releases URL `https://github.com/Automattic/skillsmith/releases`.
  - The `## Contributing` section links to the repo-relative `CONTRIBUTING.md`.
  - The new sections introduce no other release/contributor content beyond pointers (per R6.6 "No other release/contributor content in `README.md`."). A doc-writer adding a "release cadence", a "code of conduct", or a "code review process" subsection has gone out of scope.
  - The existing 225 lines of `README.md` are unmodified except for the appended sections; no rewording of the existing prose.
  - The style of the new sections matches the rest of `README.md` (sentence-case headings, no emojis, imperative prose where natural).
