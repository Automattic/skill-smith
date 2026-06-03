# Doc Plan: Changelog/versioning follow-ups from the PR #41 review

Turns the approved [`1-spec/spec.md`](../1-spec/spec.md) and
[`2-design-doc/design-doc.md`](../2-design-doc/design-doc.md) (19 acceptance criteria across three
PR #41 review follow-ups), as sequenced by the approved
[`3-plan/code-plan.md`](./code-plan.md), into the **documentation-phase** work — the what / where /
who of any documentation needed beyond what the Code phase already ships.

Issue thread: PR [#41](https://github.com/Automattic/skillsmith/pull/41) (issue
[#39](https://github.com/Automattic/skillsmith/issues/39)), branch
`worktree-39-changelog-and-versioning`. All paths are absolute, rooted at the worktree:
`/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning`.

## Why this Docs phase is small (read first — it justifies the scope against AC19)

This follow-up's documentation footprint is **deliberately near-zero**, and that is the correct
outcome, not an omission. Two structural facts force it:

1. **The primary documentation deliverables are CREATED in the Code phase, not here.** `AGENTS.md`
   and `CLAUDE.md` — the standing agent-facing changeset instruction (Change 1) — are authored by
   **code-plan Task 1 (T1)**, with their exact byte content fixed in the design doc. They are
   agent-instruction files (read by Pi directly and by Claude Code via the `@AGENTS.md` import), so
   they are produced as code artifacts. By the time this Docs phase runs they already exist; the
   Docs-phase job is to **verify** they read correctly for their audience, not to write them.
   (Confirmed live while writing this plan: `AGENTS.md` and `CLAUDE.md` do **not** yet exist at the
   repo root — correct, since they are *new* files the Code phase will create.)

2. **AC19 closes the repo file manifest at exactly 7 files**, and the two canonical human-facing
   docs are **explicitly excluded**. The complete, closed manifest is: `AGENTS.md`, `CLAUDE.md`,
   `src/progress/tracker.ts`, `src/__tests__/progress-tracker.test.ts`,
   `src/__tests__/progress-render.test.ts`, `docs/styles.css`, `.changeset/config.json`.
   **`CONTRIBUTING.md` and `README.md` are NOT in it** and must not be modified by this work
   (spec §"Out of scope", AC19, the design-doc manifest, and the code-plan cross-cutting
   constraints).

   This is the critical divergence from the **original** `39-changelog-and-versioning` pipeline,
   whose [doc-plan](../../39-changelog-and-versioning/3-plan/doc-plan.md) wrote `CONTRIBUTING.md`,
   `.changeset/README.md`, and the `README.md` pointer sections. Those files already exist on the
   branch and are correct — including the exact anchors the new `AGENTS.md` depends on
   (`CONTRIBUTING.md#adding-a-changeset` and `CONTRIBUTING.md#pre-10-policy`, both verified present
   on disk: `## Adding a changeset` at `CONTRIBUTING.md:18`, `### Pre-1.0 policy` at
   `CONTRIBUTING.md:48`). This **follow-up** PR must not re-touch them. Re-opening `CONTRIBUTING.md`
   to "add a note" (e.g. the out-of-scope `GITHUB_TOKEN` finding, or restating the agent rule) is an
   explicit Non-goal and would break the closed manifest.

Given (1) and (2), **no Docs-phase task creates or edits any repo file.** Inventing
`CONTRIBUTING.md` / `README.md` / `.changeset/README.md` edits, or any other doc file, would violate
AC19 and introduce unreviewed new scope. The genuine Docs work is exactly two non-mutating
verification activities, neither of which writes a repo file:

- **DT1 — Verify the as-shipped `AGENTS.md` + `CLAUDE.md` read correctly** for their dual audience
  (human contributors browsing the repo, and the Claude Code / Pi agents that auto-load them at
  runtime), and that every cross-reference in `AGENTS.md` resolves against the live `CONTRIBUTING.md`.
  This is a documentation-quality gate over a Code-phase artifact; it writes nothing unless it finds a
  defect that traces to a Change-1 acceptance criterion, in which case it surfaces a **blocker** — it
  does **not** silently rewrite, because the content is contract-fixed by the design doc and code-plan
  T1.
- **DT2 — Confirm and hand off the AC16 `prettier: false` trade-off note** for the **PR #41
  description**. This is the one genuinely outstanding cross-phase *prose* obligation. It is **not** a
  repo file (AC16 places it in the PR description precisely because `.changeset/config.json` is JSON
  with no prose slot and `CONTRIBUTING.md`/`README.md` are excluded by AC19). Code-plan **T6** already
  drafted the verbatim text; this phase confirms it is accurate against the shipped
  `.changeset/config.json` and hands it to whoever updates the PR description (team lead). The brief
  confirms T6 will write that note into the artifacts folder so it is durable and verifiable.

> **Self-check against the brief.** The brief anticipated this would "very likely [be] VERIFY-only:
> e.g. DT1 (confirm the as-shipped `AGENTS.md`/`CLAUDE.md` read correctly for both audiences … and
> that the doc-relevant ACs hold) and DT2 (confirm the AC16 PR-description trade-off note
> exists/accurate and that no CONTRIBUTING/README edit sneaked in)," and directed that if that is the
> conclusion, to state it explicitly and justify it against AC19 rather than invent doc edits. That is
> exactly the finding here: **DT1 + DT2, zero repo-file authoring.**

## Cross-cutting constraints (apply to every task below)

- **No repo file is created or modified in the Docs phase.** The AC19 manifest is closed by the Code
  phase. DT1 is read-and-verify; DT2 targets the PR description (not a repo file). If DT1 finds a real
  defect, it raises a blocker rather than editing — see DT1 Acceptance.
- **Do not touch `CONTRIBUTING.md`, `README.md`, `.rp.md`, or any file outside the 7-file manifest.**
  In particular, do not "improve" `CONTRIBUTING.md` or add the out-of-scope `GITHUB_TOKEN` note
  (spec Non-goals).
- **`AGENTS.md`/`CLAUDE.md` content is contract-fixed** by the design doc (§"Exact content") and
  code-plan T1. The Docs phase verifies; it does not redesign wording. Any proposed change to that
  content is a blocker raised to the team lead, not a unilateral edit.
- **One branch, no new PR.** Everything is on `worktree-39-changelog-and-versioning` (PR #41).

## Task overview

| Task | Goal | Where | Audience | Writes a repo file? | Depends on |
|---|---|---|---|---|---|
| DT1 | Verify shipped `AGENTS.md` + `CLAUDE.md` read correctly and cross-refs resolve | `AGENTS.md`, `CLAUDE.md` (read-only); live `CONTRIBUTING.md` anchors | Human contributors + Claude Code / Pi agents | **No** | code-plan T1 |
| DT2 | Confirm + hand off the AC16 `prettier: false` trade-off note | PR #41 description (not a repo file) | PR reviewers / future maintainers | **No** | code-plan T5, T6 |

---

## Task DT1 — Verify the shipped `AGENTS.md` + `CLAUDE.md` read correctly for their audience

**Goal.** Act as the documentation-quality gate over the Change-1 artifacts the Code phase ships.
Confirm that `AGENTS.md` and `CLAUDE.md`, **as committed by code-plan T1**, (a) read as coherent,
correctly-targeted documentation for their dual audience, and (b) carry cross-references that actually
resolve against the live repo. This task **authors nothing**; its product is a pass/blocker verdict.
It exists because `AGENTS.md`/`CLAUDE.md` are documentation (standing instructions an agent or human
reads), and the Code phase only asserts they were *written* — the Docs phase confirms they
*communicate*.

**Audience (who the docs serve — verify the artifact works for each).**
- **Pi (radical-pipelines agent runtime)** — reads `AGENTS.md` **directly**. The single changeset
  bullet must be actionable on its own: a clear imperative obligation plus a working pointer to the
  detail it deliberately does not inline.
- **Claude Code (agent runtime)** — auto-loads `./CLAUDE.md` (or `./.claude/CLAUDE.md`), **not**
  `AGENTS.md`. The `@AGENTS.md` import is the only bridge that delivers the rule; verify `CLAUDE.md` is
  exactly that import so the rule actually reaches Claude Code.
- **Human contributor browsing the repo root** — sees `AGENTS.md` next to `.rp.md` / `CONTRIBUTING.md`.
  The identity header must keep it from reading as an orphaned one-liner, and its links must land on
  the right `CONTRIBUTING.md` sections.

**Files.**
- Read-only: `AGENTS.md`, `CLAUDE.md` (repo root; created by code-plan T1). **No edits.**
- Cross-reference targets to confirm resolvable (read-only): `CONTRIBUTING.md` headings
  `## Adding a changeset` (slug `#adding-a-changeset`) and `### Pre-1.0 policy` (slug `#pre-10-policy`).
  **Both confirmed present on disk** while writing this plan (`CONTRIBUTING.md:18` and `:48`); DT1
  re-confirms post-Code-phase and is a no-edit read.
- **Writes no file.**

**Sections-scope (what to verify — a checklist over a fixed artifact, not authoring):**

1. **`AGENTS.md` reads as a coherent standalone doc (AC1, R1.4).** Identity header `# Skillsmith`
   + one descriptive identity sentence naming the published package (`@automattic/skillsmith`), then
   the changeset bullet. Mirrors radical-pipelines' short `AGENTS.md` header shape
   (`# Radical Pipelines` + one identity sentence). Not an orphaned one-liner.
2. **The changeset instruction is correctly framed for an agent (AC3, R1.5).** A single imperative
   bullet ("Record …") stating that every release-relevant change records a committed `.changeset/*.md`
   that travels with the PR, and **deferring detail** via a cross-reference to
   `CONTRIBUTING.md#adding-a-changeset` (rather than restating the "when required" list or the
   bump-type table).
3. **The pre-1.0 sub-clause communicates all four required elements (AC4, R1.6),** action-framed, as
   the trailing sentences of the *same* bullet (not a second top-level bullet): (a) condition "while
   pre-1.0 / version `0.x`"; (b) action "use `minor` with a `BREAKING:` summary prefix"; (c) "`major`
   is rejected/disallowed pre-1.0"; (d) a pointer to `CONTRIBUTING.md` (`#pre-10-policy`). The
   **literal token `BREAKING:` appears** (it is load-bearing — it carries the break into
   `CHANGELOG.md`).
4. **No forbidden / audience-wrong content (AC5, AC6, R1.7, R1.8).** No inlined semver bump mapping
   (no "fix→patch / feature→minor / breaking→major"); no "breaking change → major" wording (it would
   instruct an agent to author a changeset the live `0.x` validator hard-rejects); no restated "when
   required" path list; no duplicated bump-type table; no "the README" pointer as the policy source
   (skillsmith's README has no such section); no "keep README/docs current" rule; no other behavioral
   rule. File = identity header + the one bullet, nothing else.
5. **Cross-references actually resolve (the doc-quality check that spans files).** Confirm the two
   anchors exist in the live `CONTRIBUTING.md` (`#adding-a-changeset`, `#pre-10-policy`) so an agent or
   human following them lands on real sections. Confirm `#pre-10-policy` matches the slug the validator
   emits (`scripts/validate-changesets.ts:149` message references `CONTRIBUTING.md#pre-10-policy` — the
   dot in "1.0" is stripped by GitHub's auto-slug). Confirm the link **form** (Markdown link vs. inline
   code) is consistent with how `README.md:239` and `.changeset/README.md` already cite the same anchor
   (both use Markdown links), so the repo's pointers agree visually (design-doc trade-off: the
   Markdown-link form is the default; inline-code is an acceptable equivalent — the contract is the
   anchor text, not the link syntax).
6. **`CLAUDE.md` is exactly the import (AC2).** Entire contents are the single line `@AGENTS.md` — no
   heading, no blank-line padding, no trailing prose — so Claude Code actually picks up the rule.
7. **`.rp.md` untouched (AC7).** Confirm the rule was **not** placed in `.rp.md` (the re-sync-clobber
   hazard) and that `.rp.md` is byte-unchanged.

**Depends on.** code-plan T1 (the files must exist). No dependency on DT2.

**Traces to.** AC1, AC2, AC3, AC4, AC5, AC6, AC7 (documentation-quality verification of the Change-1
artifacts). Requirements R1.1, R1.2, R1.3, R1.4, R1.5, R1.6, R1.7, R1.8. Design-doc §"Change 1";
code-plan T1.

**Acceptance.**
- A written pass verdict that, for the **dual audience**, `AGENTS.md` reads as a coherent standalone
  doc (identity header + single imperative changeset bullet with the action-framed pre-1.0 sub-clause,
  literal `BREAKING:` present) and contains **none** of the forbidden content (no semver mapping, no
  "breaking → major", no "when required" restatement, no bump-table duplication, no "the README"
  pointer, no "keep README current" or other behavioral rule).
- `CLAUDE.md` confirmed to be exactly `@AGENTS.md` (single line, nothing else) — so the rule reaches
  Claude Code.
- **Both** `CONTRIBUTING.md` anchors confirmed live and reachable from `AGENTS.md`'s links
  (`#adding-a-changeset`, `#pre-10-policy`), and `#pre-10-policy` confirmed to match the validator's
  emitted slug. Link form confirmed consistent with the repo's other citations of the anchor.
- `.rp.md` confirmed byte-unchanged (rule not placed there) — `git diff --quiet -- .rp.md` is clean
  (AC7).
- **No repo file is created or modified by this task.** If any check fails, the task raises a
  **blocker to the team lead** (the content is contract-fixed by code-plan T1 / the design doc; the
  Docs phase does not silently rewrite a contract artifact) — it does **not** edit `AGENTS.md`,
  `CLAUDE.md`, `CONTRIBUTING.md`, or anything else.

---

## Task DT2 — Confirm and hand off the AC16 `prettier: false` trade-off note (PR description)

**Goal.** Finalize the one outstanding cross-phase **prose** obligation: the AC16 note explaining the
`prettier: false` decision (Change 3). It documents a **deliberate decoupling trade-off, not a bug
fix**, and AC16 fixes its home as the **PR #41 description** — not a repo file — because
`.changeset/config.json` is JSON with no prose slot and `CONTRIBUTING.md`/`README.md` are excluded by
AC19. Code-plan T6 already produced the verbatim text; this task **confirms** that text is accurate
against the shipped config and **hands it to the team lead** to paste into the PR description. It
writes no repo file.

**Audience (who the prose serves).**
- **PR #41 reviewers** — must see that `prettier: false` is an intentional decoupling choice (with a
  named, owner-selectable alternative), not an accidental or cosmetic flip, so they can review the
  *decision* rather than the diff alone.
- **Future maintainers** — read the PR description later to understand why Changesets' Prettier
  integration is disabled in a repo with no Prettier config, and what the (cosmetic, changelog-only)
  cost is.

**Files.** **None in the repo.** The deliverable is text for the **PR #41 description**, handed to the
team lead (the brief notes the trade-off note is a hand-off, code-plan T6, and that T6 writes that note
into the artifacts folder so it is durable and verifiable). This task creates and edits no file under
the AC19 manifest or anywhere else.

**Sections-scope (the note must carry all three AC16 elements; confirm each against the shipped
artifact before hand-off):**

1. **Recommendation + framing.** `.changeset/config.json` now sets `"prettier": false`; this is the
   **recommended default** and a **deliberate decoupling trade-off, not a bug fix** — the single switch
   that disables Prettier across both Changesets paths that use it (`changeset version` via
   `@changesets/apply-release-plan`, and `changeset add` via `@changesets/write`), removing the repo's
   tacit reliance on the undeclared transitive `prettier@2.8.8` (pulled via `@changesets/cli`) so the
   changelog tooling no longer couples to a formatter the Biome-only toolchain does not use.
2. **Exact `CHANGELOG.md` before/after (the cosmetic cost; minor-bump example).**
   - `prettier: true` → `## 0.2.0` · blank line · `### Minor Changes` · blank line · `- <entry>`
     (normalized spacing).
   - `prettier: false` → `## 0.2.0` · `### Minor Changes` (no blank line) then the entry with tighter
     spacing.
   Both render correctly; the cost is purely cosmetic and on a file **Biome cannot format anyway**
   (Biome 2.4.x does not format Markdown). `package.json` is unaffected either way (`changeset version`
   preserves its tabs via `detect-indent`).
3. **Owner-selectable alternative.** Keep `prettier: true` for normalized changelog spacing — but then
   the repo should honestly declare Prettier as an explicit `devDependency`, reintroducing a second
   formatter alongside Biome (the dual-formatter coupling this change set out to remove).
   Recommendation remains `prettier: false`.

Use code-plan T6's verbatim block as the source text (trim to PR house style if needed, but keep all
three elements). **Confirm it is accurate** against the shipped `.changeset/config.json` (the file
actually carries top-level `"prettier": false`) before hand-off — i.e. the note describes what in fact
shipped.

**Depends on.** code-plan T5 (the `prettier: false` change the note documents must be the shipped
state) and code-plan T6 (which drafted the verbatim text). Run after the Change-3 code lands.

**Traces to.** AC16. Requirement R3.1 (the decision being documented). Design-doc §"Change 3", 3-ii.
Code-plan T6 (source text).

**Acceptance.**
- The trade-off note is confirmed to carry **all three** AC16 elements — (a) `prettier: false` as the
  recommended default and a deliberate decoupling trade-off (not a bug fix), (b) the exact
  `CHANGELOG.md` before/after spacing, (c) the `prettier: true` + explicit-`devDependency`
  owner-selectable alternative — and to match what actually shipped in `.changeset/config.json`.
- The note is **handed to the team lead** for the PR #41 description (the named home per AC16).
- **No repo file is created or modified by this task** (manifest discipline — AC19). The note does
  **not** land in `CONTRIBUTING.md`, `README.md`, `.changeset/config.json`, or any other repo file.

---

## What this Docs phase explicitly does NOT do (guard against scope creep / AC19 breakage)

These are deliberate non-actions. Doing any of them would break AC19's closed manifest or introduce
unreviewed scope (all are spec Non-goals):

- **No new or edited repo documentation file.** Not `CONTRIBUTING.md`, not `README.md`, not
  `.changeset/README.md`, not `.rp.md`, not any new `.md`. The human-facing docs already exist on the
  branch from the original pipeline and are correct (their anchors are what `AGENTS.md` relies on).
- **Does not author `AGENTS.md`/`CLAUDE.md`** — those are Code-phase artifacts (code-plan T1) with
  design-doc-fixed content. The Docs phase verifies (DT1); it does not write or reword them.
- **No `CONTRIBUTING.md` `GITHUB_TOKEN` note** — a real finding but an explicit Non-goal for this
  follow-up; adding it would touch an excluded file.
- **No "keep README/docs current" rule** anywhere — explicit Non-goal (R1.8); skillsmith has no such
  documented expectation and `CONTRIBUTING.md` treats prose-only edits more loosely.
- **Does not put the AC16 trade-off prose in a repo file** — AC16 fixes its home as the PR
  description; routing it into `CONTRIBUTING.md`/`README.md` would break AC19.

## Verification (Docs-phase slice; full criteria live in the code-plan's final verification)

| Check | How | ACs |
|---|---|---|
| `AGENTS.md` reads correctly for human + agent audience; single bullet; pre-1.0 sub-clause; no forbidden content | read `AGENTS.md` (DT1) | AC1, AC3, AC4, AC5, AC6 |
| `CLAUDE.md` is exactly `@AGENTS.md` (rule reaches Claude Code) | read `CLAUDE.md` (DT1) | AC2 |
| `AGENTS.md` cross-refs resolve against live `CONTRIBUTING.md`; `#pre-10-policy` matches validator slug | confirm `## Adding a changeset` / `### Pre-1.0 policy` headings exist; check validator message (DT1) | AC3, AC4 |
| `.rp.md` unchanged (rule not placed there) | `git diff --quiet -- .rp.md` (DT1) | AC7 |
| AC16 trade-off note confirmed (3 elements) + handed off for PR description; matches shipped config | confirm against `.changeset/config.json`; hand to team lead (DT2) | AC16 |
| No repo file created/modified by the Docs phase | `git diff --name-only` shows only the 7 Code-phase manifest files; no Docs-only additions | AC19 |
