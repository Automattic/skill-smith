# DT2 — Confirm and hand off the AC16 `prettier: false` trade-off note (PR #41 description)

**Verdict: PASS.**

This is a VERIFY-ONLY task. No repo file is created or modified. The product is this confirmation
verdict plus a hand-off of the finalized trade-off-note text to the team lead for the PR #41
**description** (the home AC16 fixes for this prose, since `.changeset/config.json` is JSON with no
prose slot and `CONTRIBUTING.md` / `README.md` are excluded by AC19).

Source text under review: [`../4-code/pr-description-note.md`](../4-code/pr-description-note.md)
(authored by code-plan T6, saved by the Code phase).
Shipped artifact checked against: `.changeset/config.json` (Task 5).

---

## 1. The note carries all three AC16 elements

Confirmed by reading `4-code/pr-description-note.md`. Each required element is present:

### (a) Recommendation + framing — PRESENT
- Headline frames it explicitly as **"a deliberate decoupling trade-off, not a bug fix"**
  (note line 3).
- States `prettier: false` is the **recommended default** (note line 4).
- Describes it as the **single switch** that disables Prettier across **both Changesets paths that
  use it** — `changeset version` and `changeset add` (note line 4).
- Names the removal of the **tacit dependence on the undeclared transitive `prettier@2.8.8`**
  (pulled in via `@changesets/cli`), so the changelog tooling no longer couples to a formatter the
  Biome-only toolchain does not use (note line 4).

### (b) Exact `CHANGELOG.md` before/after spacing — PRESENT
- `prettier: true` → `## 0.2.0` · blank line · `### Minor Changes` · blank line · `- <entry>`
  (normalized) (note line 7).
- `prettier: false` → `## 0.2.0` · `### Minor Changes` (no blank line) then the entry with tighter
  spacing (note line 8).
- States **both render correctly** (note line 10).
- States **`package.json` is unaffected** either way — `changeset version` preserves its tabs via
  `detect-indent` (note line 10).
- (Bonus, consistent with the spec: notes the cost is purely cosmetic and on a file Biome cannot
  format anyway — Biome 2.4.x does not format Markdown — note line 6.)

### (c) Owner-selectable alternative — PRESENT
- Keep `prettier: true` for normalized changelog spacing, **but** then declare Prettier as an
  explicit `devDependency` (note line 12).
- Notes this **reintroduces a second formatter alongside Biome** — the dual-formatter coupling this
  change set out to remove (note line 12).
- Closes with **"Recommendation remains `prettier: false`."** (note line 12).

## 2. The note matches the shipped config

- `.changeset/config.json` carries top-level **`"prettier": false`** (line 8 of the file).
- `grep -c '"prettier": false' .changeset/config.json` → **1**.
- The note describes the as-shipped state (`prettier: false`), so the prose is accurate against what
  in fact shipped. No drift.

## 3. Manifest discipline (AC19) — intact

- This task creates/modifies **no repo file**. The only file added is this pipeline artifact under
  `.pipelines/…/5-docs/`.
- `git diff --name-only f1a050d..HEAD -- . ':(exclude).pipelines/**'` remains exactly the 7
  Code-phase manifest files: `AGENTS.md`, `CLAUDE.md`, `src/progress/tracker.ts`,
  `src/__tests__/progress-tracker.test.ts`, `src/__tests__/progress-render.test.ts`,
  `docs/styles.css`, `.changeset/config.json`.

---

## Hand-off

**Ready for PR description: `/Users/santosguillamot/Desktop/Code/skillsmith/.claude/worktrees/39-changelog-and-versioning/.pipelines/39-pr-review-followups/4-code/pr-description-note.md`**

The team lead should paste the block below (verbatim from `4-code/pr-description-note.md`, sans the
`# PR #41 description …` artifact heading) into the PR #41 description:

> **Changesets formatting (`prettier: false`) — a deliberate decoupling trade-off, not a bug fix.**
> `.changeset/config.json` now sets `"prettier": false`. This is the **recommended default**: it is the single switch that disables Prettier across both Changesets paths that use it (`changeset version` and `changeset add`), removing this repo's tacit dependence on the undeclared transitive `prettier@2.8.8` (pulled in via `@changesets/cli`) so the changelog tooling no longer couples to a formatter the Biome-only toolchain does not use.
>
> The cost is **purely cosmetic** — `CHANGELOG.md` spacing only, on a file Biome cannot format anyway (Biome 2.4.x does not format Markdown). Exact before/after for a minor bump:
> - `prettier: true` → `## 0.2.0` · blank line · `### Minor Changes` · blank line · `- <entry>` (normalized).
> - `prettier: false` → `## 0.2.0` · `### Minor Changes` (no blank line) then the entry with tighter spacing.
>
> Both render correctly. `package.json` is unaffected either way (`changeset version` preserves its tabs via `detect-indent`).
>
> **Owner-selectable alternative:** keep `prettier: true` for normalized changelog spacing — but then the repo should honestly declare Prettier as an explicit `devDependency`, which reintroduces a second formatter alongside Biome (the dual-formatter coupling this change set out to remove). Recommendation remains `prettier: false`.
