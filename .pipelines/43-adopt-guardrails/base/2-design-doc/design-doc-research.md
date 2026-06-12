# Design-doc research — Adopt Radical Pipelines guardrails (#43)

Running record of the design-doc-analyst ↔ design-doc-researcher Q&A that turns
the approved spec (`1-spec/spec.md`) into the design decisions the design-writer
consumes. The spec is fully verified; this phase resolves only the items the
spec explicitly delegated to design, plus any design-level structuring the spec
left open.

## Input recap

The spec (`1-spec/spec.md`) requires six artifacts of work:

1. **R1/R2** — a `## Guardrails` section in `.rp.md` declaring six gates (a
   `| Name | Command | Phase |` table).
2. **R3** — the dependency-key rename in `testing-project/package.json` +
   lockfile refresh.
3. **R4** — a `check:config` script in `testing-project/package.json`.
4. **R5** — a durable home for the worktree bootstrap requirement (`npm ci`
   root + `npm ci --prefix testing-project`, before any gate).
5. **R6** — accurate prose describing what each changeset gate guarantees.

All technical unknowns are closed by the spec research (`1-spec/spec-research.md`,
findings F1–F7). The spec is a documentation/config change with no new code
modules; there is no algorithm to design. The design phase's job is therefore
**placement and wording decisions** plus making the three delegated questions
explicit and answered.

## Open items the spec delegated to design

- **D1 — `## Guardrails` placement within `.rp.md`.** The spec (R1) fixes the
  heading *level* (a peer `## Guardrails`, not a `###` under a grouping heading)
  and that it is committed-only. It delegates *where in the file* the section
  sits.
- **D2 — Home of the worktree bootstrap steps (R5).** The spec lists candidate
  homes (`.rp.md` prose, a documented run step, `AGENTS.md`, or a helper script)
  and requires the choice be durable so every future run honours it.
- **D3 — Confirm the changeset-status guarantee.** The spec (R6) asks design to
  confirm the intended guarantee is "release-relevant (versionable) changes
  carry a changeset" — what `changeset-status` delivers — rather than "the
  doc-writer always authors a changeset regardless of what changed," which the
  gate does not deliver.

## Grounding facts (analyst, verified before opening the Q&A)

- **`.rp.md` is a flat list of `##` conventions.** Current top-level headings
  (in order): `## Managing tasks`, `## Pipeline slugs`, `## Artifact folders`,
  `## Commit format`, `## Claude Code worktrees`, `## Branch names`,
  `## Team spawning`, `## Health monitoring`. There is **no** shared/per-tool
  grouping heading — every convention is one `##`. So a peer `## Guardrails`
  matches the file's shape (confirms R1).
- **The plugin loads Guardrails semantically, not by heading path.** RP 0.3.0
  `reference/conventions/load.md:22` lists Guardrails in the conventions table;
  `load.md:24` documents it under a top-level `## Guardrails`; `load.md:30`
  selects "the guardrails whose phase(s) include the current phase." The
  `### Guardrails` in `setup.md:171` is a subsection only because `setup.md` is
  itself a multi-level document. Nothing in the loader requires a particular
  parent heading — a top-level `## Guardrails` is valid for machine consumption.
- **No `.rp.local.md` exists** in the worktree; Guardrails is committed-only
  regardless (`load.md:46`).
- **`AGENTS.md` is a thin file** — one `# Skillsmith` heading plus a single
  bullet about changesets, with `CLAUDE.md` doing `@AGENTS.md`.
- **`CONTRIBUTING.md` has a `## Running tests and checks locally` section**
  (line 5) — a candidate anchor for human-facing bootstrap prose, distinct from
  the agent-facing `.rp.md`.
- **The v3 worktree exists** at
  `/Users/darerodz/Code/skillsmith/.claude/worktrees/37-skip-misconfigured-agents-v3`
  (for the AC3 demonstration), and `testing-project/package.json` still has the
  bare `"skillsmith": "file:.."` key with **no** `check:config` script — matching
  the spec's pre-state.
- **`.changeset/config.json` `changedFilePatterns`** = `src/**`, `bin/**`,
  `package.json`, `examples/**`, `README.md`, `!src/__tests__/**` — exactly what
  R6/F3 cite for "versionable."

## Q&A

(Topics driven one at a time with the design-doc-researcher; findings recorded
below as they resolve.)
