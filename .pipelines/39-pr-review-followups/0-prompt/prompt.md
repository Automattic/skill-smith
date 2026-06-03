# Prompt: Changelog/versioning follow-ups from the PR #41 review

## Background

PR #41 ("Add a changelog and automate package version bumps", issue #39) introduced
Changesets-based changelog tracking and release automation for skillsmith: it renamed
the package to `@automattic/skillsmith`, added `.changeset/config.json`, a
`changeset-gate.yml` CI gate, a `release.yml` publish workflow (npm via OIDC), a
`validate-changesets.ts` shape validator, and a `CONTRIBUTING.md` policy.

A review of that PR — comparing it against the equivalent Changesets adoption in the
**radical-pipelines** repository — surfaced three follow-up improvements. The owner wants
all three implemented **on the existing PR #41 branch** (`worktree-39-changelog-and-versioning`),
so they ship as part of PR #41 rather than as a separate PR.

This pipeline implements those three follow-ups. Each is described below as a problem and
the outcome the owner wants. The exact implementation is yours to determine and validate in
the later phases — investigate the real state of the repo rather than assuming the review's
framing is complete or correct.

## The three changes

### 1. Give the project's coding agents a standing instruction to record a changeset

**Problem.** The changeset policy introduced by PR #41 is documented only in
`CONTRIBUTING.md`, which is human-facing. Most changes in this repository are produced by
radical-pipelines coding agents, which read the project's agent-instruction files, not
`CONTRIBUTING.md`. The only thing currently enforcing a changeset is the `changeset-gate.yml`
CI check — so a forgotten changeset is caught reactively (a red gate and an extra round-trip)
instead of being added while the change is being made.

**Desired outcome.** A standing, agent-facing instruction that every release-relevant change
must record a changeset, so the agents add it proactively. For precedent, the
radical-pipelines repo added an equivalent rule to a root `AGENTS.md` file. Note that this
repo's `.rp.md` is **synced from the radical-pipelines upstream** (see recent commits such as
"Copy `.rp.md` from Radical Pipelines project"), so the rule must live somewhere that an
upstream `.rp.md` re-sync will not clobber. Determine the correct home and the exact wording,
and make it consistent with the policy already written in `CONTRIBUTING.md`.

### 2. Make `npm run lint` pass on the branch

**Problem.** `release.yml` runs `npm run lint` before publishing. Lint currently **fails** on
pre-existing issues that PR #41 did not touch — reported in `src/progress/*` and
`docs/styles.css`. As a result the first real release would be blocked by a red lint gate.

**Desired outcome.** `npm run lint` passes cleanly on the branch. Investigate the actual
failures first, then fix them at the source. Do not simply disable the linter or blanket-ignore
files to make it pass; if a specific rule is genuinely inappropriate for a specific location,
narrowly justify and scope that. Be aware that `src/progress/**` falls under the changeset
gate's `changedFilePatterns`, so source changes there likely require their own changeset;
`docs/**` is excluded from that gate.

### 3. Align Changesets' formatting with this repo's Biome toolchain

**Problem.** `.changeset/config.json` does not set the `prettier` option, so it defaults to
`true`, while this repo formats with **Biome** (tab indentation) and has no Prettier installed.
Separately, the committed `.changeset/config.json` uses 2-space indentation even though the
repo's Biome config enforces tabs, and it is unverified whether `changeset version` preserves
the repo's established formatting when it rewrites version-bearing files such as `package.json`
and `CHANGELOG.md` during a release.

**Desired outcome.** Changesets' formatting behaviour is aligned with the Biome-only toolchain
(no coupling to a formatter the repo does not use), and the files the release flow generates or
edits keep the repo's established style so they don't fight `biome` afterwards. Verify the
actual `changeset version` behaviour empirically rather than assuming it.

## Constraints

- All work lands on the existing `worktree-39-changelog-and-versioning` branch (PR #41). Do
  not open a new branch or a new PR.
- Follow this repository's own changeset policy for any release-relevant source change made in
  the course of this work (notably change #2 if it edits `src/**`).
- Keep changes minimal and scoped to these three items; this is a follow-up to an already-open
  PR, not a rework of it.
