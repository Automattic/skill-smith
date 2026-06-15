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

Topics driven one at a time with the design-doc-researcher; findings recorded
below as they resolve.

### D2 grounding (analyst, from RP 0.3.0 plugin source — pre-Q&A)

Where does the orchestrator actually read run-start instructions, so the
bootstrap home is one it will honour every run?

- **The orchestrator's run-start procedure has no bootstrap step.**
  `reference/autonomous-workflow.md:36-39` ("At run start") lists exactly three
  steps: (1) create the team, (2) start the health monitor, (3) capture the base
  ref. There is **no** "install dependencies" / `npm ci` / worktree-bootstrap
  step. The per-phase loop (`autonomous-workflow.md:46-55`) creates the phase
  subfolder, reads the phase reference, and runs the phase — also no bootstrap.
- **`EnterWorktree` does not install dependencies** (`conventions/claude-code.md:14`
  — "Creates the worktree … and enters it"; nothing about `node_modules`).
  Confirms spec F5.
- **"Setup actions" is NOT a per-run bootstrap hook.** `setup.md:205-209` and
  `pi.md:43` define a "Setup actions" step, but it runs once at *project setup*
  (when `.rp.md` is authored), and the Claude Code rules file (`claude-code.md`)
  has **no** "Setup actions" section at all (it's a Pi-specific agent-install
  step). So we cannot lean on a plugin "Setup actions" auto-run to bootstrap each
  worktree.
- **What the orchestrator *does* read every run: `.rp.md`.** Both `load.md:5`
  ("Read it at the start of any workflow") and this repo's `.rp.md:3` ("Read it
  at the start of any workflow") make `.rp.md` the orchestrator's run-start
  reading. ⇒ A bootstrap instruction placed in `.rp.md` as an orchestrator
  run-step is the one the orchestrator actually loads at the start of every run.

**Analyst's pre-Q&A lean for D2 (to be corroborated/refuted by the researcher):**
the durable home is **`.rp.md` prose** — a short orchestrator run-step that says
"after `EnterWorktree`, before launching any phase agent or running any
guardrail, run `npm ci` (root) and `npm ci --prefix testing-project`." It is
agent/orchestrator-facing, machine-relevant, lives where the orchestrator reads
at run start, and is committed (travels to every worktree). `AGENTS.md` and
`CONTRIBUTING.md` are human-facing and not part of the orchestrator's run-start
read; a helper script still needs an instruction telling the orchestrator to run
it, so the script alone is not self-durable. Open sub-question: should the home
be the worktree convention block (co-located with `## Claude Code worktrees`) or
a standalone `## Worktree bootstrap` section? And is a helper script worth adding
as the *body* the `.rp.md` step invokes?

### D3 grounding (analyst, from this repo's policy docs — pre-Q&A)

Confirming the *intended* changeset-status guarantee against what the repo
already documents:

- **AGENTS.md** states the contract as "Record a changeset for every
  **release-relevant** change."
- **CONTRIBUTING.md:16** restates it: "every PR that **affects consumers**
  carries a small `.changeset/*.md`."
- **CONTRIBUTING.md:22-31** enumerates *when required* (CLI/`bin`, hook/
  `defineConfig` schema, report-JSON shape, provider support, bug fixes to those,
  behaviour-affecting dep bumps) and *when NOT required* — explicitly listing
  **`.rp.md`, `.pipelines/**`, the `testing-project/` fixture, the `docs/`
  landing page, `package-lock.json`-only, tests, docs prose-only**.
- The gate's "versionable" set (from `.changeset/config.json changedFilePatterns`,
  F3) = `src/**`, `bin/**`, `package.json`, `examples/**`, `README.md`,
  `!src/__tests__/**`. **This is the machine proxy for "release-relevant," and it
  does not fire on the paths CONTRIBUTING.md exempts** (`.rp.md`, `.pipelines/**`,
  `testing-project/`, `docs/`, `src/__tests__/**`). So a docs-phase change
  confined to those non-versionable paths is correctly NOT forced to carry a
  changeset.

⇒ The repo's own stated guarantee is unambiguously **"release-relevant
(versionable) changes carry a changeset,"** and `changeset-status` delivers
exactly that. This strongly supports answering D3 "yes, confirmed." Residual
checks to hand the researcher: confirm the gate's `changedFilePatterns` set does
not *contradict* CONTRIBUTING's required/exempt lists in a way that would (a)
block a legitimate docs-phase change confined to non-versionable paths, or (b)
wave through a release-relevant change the policy says needs a changeset. Two
nuances to test: README.md cosmetic-prose edits (policy allows an *empty*
changeset escape — does `changeset-status` accept an empty changeset as
"present"?), and the docs-phase doc-writer's own typical outputs
(`AGENTS.md`/`CONTRIBUTING.md` = non-versionable, so no false block).

### D1 precedent (analyst, from the RP repo's own `.rp.md` files — cross-check for the researcher)

Checked the worked-example `.rp.md` the spec-research F4 cited and the RP repo's
own dogfooded conventions file:

- **`51-guardrails-convention-v2/.rp.md`** (the worked example) section order:
  `## Shared conventions` → `### Managing tasks` → `### Pipeline slugs` →
  `### Artifact folders` → `### Commit format` → `### Worktrees` →
  `### Branch names` → `### Team spawning` → `### Agent models` →
  `### Health monitoring` → **`### Guardrails` (line 104, LAST)**.
- **The RP repo's trunk `.rp.md`** has the same `## Shared conventions` →
  `### …` structure but no Guardrails section yet (Guardrails is the v2 worktree's
  in-progress addition). The RP plugin's bundled `0.3.0/.rp.md` is identical in
  shape (two-level: one `## Shared conventions` wrapper, conventions as `###`).

**Key mapping (resolves the level question and the position question together).**
The RP repo nests every convention as a `###` under a single `## Shared
conventions` grouping heading, so *their* Guardrails is `### Guardrails` placed
**last in the group**. **This repo's `.rp.md` has no `## Shared conventions`
wrapper** — it is a flat list of `##` conventions. The structure-preserving image
of "last `###` under the shared group" in a flat-`##` file is a **`## Guardrails`
appended last**. That is exactly what spec R1 mandates (peer `##`, not a `###`
under a grouping heading) and what my D1 hypothesis proposed. So the precedent
**independently corroborates** both the heading level (peer `##` here) and the
position (last). Pending the researcher's confirmation on loader
position-independence, D1 resolves to **append `## Guardrails` as the final
top-level section, after `## Health monitoring`.**

### D1 — RESOLVED (researcher confirmed loader position-independence; one precedent correction)

**Decision: append `## Guardrails` as the final top-level section of `.rp.md`,
immediately after `## Health monitoring` (the file's current last section, ending
at line 81).** A peer `##`, committed to `.rp.md` (never `.rp.local.md`).

Researcher verdict (all from installed plugin v0.3.0, the version this repo runs):

1. **Loader independence from position — CONFIRMED.** Selection is purely
   phase-membership, never positional: `load.md:30` — "select the guardrails
   whose phase(s) include the current phase." Every run-time consumer echoes
   phase-only selection: code-writer (`agents/code-writer.md:13,44,46,48,52`),
   code-reviewer (`agents/code-reviewer.md:18,32,97,98`), doc-writer
   (`agents/doc-writer.md:38,40,42,45`), doc-reviewer
   (`agents/doc-reviewer.md:33,98,99`) — all select by the Phase column, not by
   where the section sits. A grep for order/position/first/last/above/below/
   adjacent wording in the guardrail/`.rp.md` consumers found only false
   positives (a doc's own layout, the `.rp.local.md` merge note, an intra-
   `setup.md` cross-ref). The canonical `.rp.md` template
   (`claude-code.md:9-44`) prescribes no Guardrails placement at all. ⇒ middle
   vs. end is machine-irrelevant.

2. **Precedent — corrected and strengthened.** My framing of the v2 example was
   imprecise: `51-guardrails-convention-v2/.rp.md` is a *nested* file
   (`## Shared conventions` group, conventions as `###`), with `### Guardrails`
   last (line 104, after `### Health monitoring`) — so it is precedent for
   "Guardrails goes last," not a structural template for our flat file. The
   **directly analogous** precedent is the v1 sibling
   `/Users/darerodz/Code/radical-pipelines/.claude/worktrees/51-guardrails-convention/.rp.md`:
   there Guardrails is a **top-level `## Guardrails` peer at line 103 — the last
   section** — which matches skillsmith's target shape (peer `##`, committed)
   exactly, and it too is last. (radical-pipelines' main `.rp.md` declares no
   Guardrails yet.) Net: across both example files that declare Guardrails, it is
   the last section and immediately follows Health monitoring.

3. **No anchoring constraint.** No loader or agent requires Guardrails to
   precede/follow any section or sit adjacent to anything. The only structural
   constraints are the ones spec R1 already fixed (peer `##`, committed-only —
   `load.md:46`). "Append at end" is unconstrained and safe.

Worktree left pristine (no scratch edits).

### D2 grounding addendum (analyst, verified directly while researcher works)

Two D2 sub-questions I confirmed from this repo's own files:

- **No npm `workspaces` key in root `package.json`** (`grep -c '"workspaces"'` =
  0; root `name` is `@automattic/skillsmith`, scripts `lint`/`typecheck`/`test`
  present). ⇒ A single root `npm ci` does **not** install `testing-project/`;
  `testing-project/` is an independent install with its own
  `testing-project/package-lock.json` (present, ~890 KB). **The two-command
  bootstrap (root `npm ci` + `npm ci --prefix testing-project`) is genuinely
  required, not belt-and-suspenders.** Confirms spec R5's two-command form.
- **Strong in-repo precedent for orchestrator-directed imperative run-steps in
  `.rp.md`.** The `### Orchestrator updates during a run` subsection
  (`.rp.md:26-39`, under `## Managing tasks`) is exactly project-authored,
  orchestrator-addressed, imperative prose that is **not** one of the plugin's
  named conventions, yet the orchestrator obeys it (Linear sync + branch push).
  It even uses the identical idiom the bootstrap needs — "**At run start** — …
  before launching anything." ⇒ `.rp.md` prose addressed to the orchestrator is
  demonstrably a thing this orchestrator honours; the bootstrap step fits the
  same mold. (Memory corroborates the orchestrator already performs these Linear
  steps live.)

  **Refined placement consideration for D2:** there are now three candidate homes
  inside `.rp.md`, and the choice is semantic: (a) the existing `## Claude Code
  worktrees` block (bootstrap is a *post-EnterWorktree worktree-lifecycle*
  action — strong semantic fit, but the block is plugin-canonical content that a
  future `setup` could regenerate); (b) a standalone `## Worktree bootstrap`
  section (clean, owns the requirement, immune to worktrees-block regeneration);
  (c) the `### Orchestrator updates during a run` block (already the orchestrator
  run-start home, but its subject is issue-tracking sync, not worktree setup — a
  semantic mismatch). I lean (a) or (b); handed to the researcher to settle
  whether `setup`/`load` ever regenerates the worktrees block (which would
  decide between folding-in vs. standalone).

### D2 — RESOLVED (researcher confirmed `.rp.md`-prose home; standalone section + helper script)

**Decision:**
- **Home = `.rp.md` prose**, written as an orchestrator run-step: "after
  `EnterWorktree` and before launching any phase agent or running any guardrail,
  run the bootstrap." A new **standalone `## Worktree bootstrap` section placed
  immediately after `## Claude Code worktrees`** (peer `##`, committed) — NOT
  folded into the worktrees block.
- **Body = a committed helper script `scripts/bootstrap-worktree.sh`** that runs
  `npm ci` (root) then `npm ci --prefix testing-project`, with `set -euo
  pipefail` so a partial/failed install surfaces as a non-zero exit. The `.rp.md`
  step invokes it by name (e.g. `bash scripts/bootstrap-worktree.sh`); the
  `.rp.md` step is the durable *trigger*, the script is the *body*.
- The two `npm ci` commands are **genuinely required** (no npm `workspaces`
  config — the two installs are independent). Both must be `npm ci` (not `npm
  install`) to honour R5's "complete, clean install" definition.
- AGENTS.md is intentionally **not** the trigger (it is not the orchestrator's
  run-start read); a one-line human-facing pointer there is optional
  belt-and-suspenders the writer may add for human contributors.

Researcher evidence (installed plugin v0.3.0):

1. **`.rp.md` is the orchestrator's reliable per-run read, and a prose run-step
   is honoured — with a direct precedent.** The orchestrator must load `.rp.md`
   conventions before any workflow: `SKILL.md:42-46`, `load.md:5,7`, and this
   repo's `.rp.md:3`. The run-start gap is verbatim-confirmed: `autonomous-
   workflow.md:35-39` has exactly three steps (create team, start health monitor,
   capture base ref), no bootstrap; the per-phase loop `:50-56` has none;
   `EnterWorktree` doesn't install deps (`claude-code.md:14`). **Precedent for
   obeyed non-convention orchestrator prose exists in the plugin author's OWN
   example:** `51-guardrails-convention-v2/.rp.md:26-34` has an `#### Orchestrator
   updates during a run` subsection of imperative run-steps ("At run start … before
   launching anything", "Push at run close-out…") — and none of these map to a
   named convention in the `load.md:11-22` table (the 10 named conventions are
   Pipeline base slug, Artifact folder, Commit format, Issues, Worktrees, Branch
   names, Team spawning, Agent models, Health monitoring, Guardrails). skillsmith's
   own `.rp.md:26-39` already mirrors this. ⇒ a bootstrap run-step is the same
   shape and within the orchestrator's remit.

2. **Standalone section, not folded into Worktrees — overwrite risk is real.**
   `## Claude Code worktrees` is plugin-canonical content (`claude-code.md:7`
   calls it "the canonical content for `.rp.md`"; `claude-code.md:10-16` prescribes
   the exact block). A future `setup` re-run regenerates canonical blocks, so
   project-specific steps folded inside would be lost first. (`setup.md:213-218`
   does require owner confirmation before overwriting and only merges/appends when
   the owner explicitly chooses — so not silent — but a standalone section is
   structurally safer and survives a careless merge.) Place it right after
   `## Claude Code worktrees` for the post-EnterWorktree adjacency without the
   overwrite coupling. Orthogonal to D1 (bootstrap near Worktrees; Guardrails at
   end).

3. **Helper script recommended over inline prose.** Centralizes the exact
   install semantics (the `npm ci` complete-install guarantee R5 demands) in one
   testable place; the `.rp.md` prose names the script rather than restating
   commands, so it can't drift. `scripts/` already exists
   (`scripts/validate-changesets.ts`) — no new structure. No plugin obstacle: the
   orchestrator already runs project-named commands on instruction (guardrail
   commands verbatim, `/loop`, `gh`, Linear MCP). Durability comes from the
   `.rp.md` step naming the script, not the script's existence. Must use `npm ci`
   in both workspaces and `set -euo pipefail`. (Inline prose is an acceptable
   zero-new-files fallback but loses the testable, centralized contract.)

4. **`npm ci --prefix testing-project` is correct; two commands genuinely
   required.** Root `package.json` has **no** `workspaces` key, so a single root
   `npm ci` does not install `testing-project/` — independent installs. Both
   lockfiles present (`package-lock.json` 112 KB; `testing-project/package-lock.json`
   889 KB, `lockfileVersion: 3`), so `npm ci` is valid in both. `--prefix` verified
   non-destructively to target the subdir (`npm run --prefix testing-project`
   resolves `skillsmith-testing-project@0.1.0`); `--prefix` is a global npm flag
   valid with `ci` (env: node v20.19.4, npm 10.8.2). Confirms analyst's addendum.

Worktree left pristine (npm calls were read-only).

### D3 grounding addendum (analyst, from CONTRIBUTING.md — predicts the researcher's empirical result)

The empty-changeset escape's *documented intent* is explicit at
**CONTRIBUTING.md:72-80** ("Empty changesets"): for a PR that touches
release-relevant paths but warrants no release entry (e.g. a cosmetic README
edit), `npx changeset --empty` "writes a file with no front matter and no body
(just `---\n---` on disk). `changeset version` consumes and deletes the file
without bumping anything; **the CI gate still passes because the changeset
exists.**" So the project's stated design is that an empty changeset *satisfies
presence*. This predicts the researcher's D3 sub-question 1 will find
empty-changeset → `changeset status` exit 0 (gate aligned with policy). If the
empirical check instead shows exit 1, that is a real gate-vs-policy discrepancy
R6 must flag; CONTRIBUTING asserts alignment, so I expect confirmation, not a
surprise. (Awaiting the researcher's empirical exit code to settle it.)

### D3 — RESOLVED (researcher confirmed empirically; gate aligned with policy, not stricter)

**Decision: CONFIRMED — the intended guarantee is the conditional one,
"release-relevant (versionable) changes carry a changeset," and
`changeset-status` delivers exactly that. R6's wording is correct as written; no
rewording needed.** `changeset-format` is the presence-agnostic shape gate;
`changeset-status` is the conditional presence check — exactly R6's division of
labor.

Researcher evidence (isolated scratch repos with this repo's exact
`changedFilePatterns`, an `origin/trunk` ref, package `@automattic/skillsmith`,
changeset CLI 2.31.0 — the repo's version; scratch repos deleted, worktree
pristine):

1. **Empty changeset counts as "present" — gate aligned, NOT stricter.** Measured
   `npx changeset status --since=origin/trunk` after changing README.md (a
   versionable path): no changeset → exit **1**; **empty changeset** (`---\n---\n`,
   verified by `od -c`) → exit **0**; `none`-bump changeset → exit **0**.
   `changeset status` keys off *"does a `.changeset/*.md` file exist,"* not *"does
   it bump a package"* — matching CONTRIBUTING.md:80 ("the CI gate still passes
   because the changeset exists") and :37 (README cosmetic edits use the
   empty-changeset escape). ⇒ the doc-writer is not forced to author a non-empty
   changeset for a cosmetic versionable-path edit; an empty one suffices. R6 needs
   no "stricter than policy" caveat. (Also explains trunk's green status today:
   the committed `none`-bump `.changeset/initial-scaffolding.md` already counts as
   present.)

2. **No false-block on the doc-writer's outputs — confirmed for the exact files.**
   Changing AGENTS.md + CONTRIBUTING.md + .rp.md + .pipelines/**/notes.md +
   docs/index.md together, no changeset → exit **0** ("NO packages to be
   bumped"); `git diff --name-only origin/trunk` confirmed none match
   `changedFilePatterns`. The "docs-only tag doesn't falsely block" leg holds.
   Controls proving teeth + exclusion: `bin/skillsmith.mjs` changed, no changeset
   → exit **1**; `src/__tests__/foo.test.ts` changed, no changeset → exit **0**
   (the `!src/__tests__/**` exclusion works).

3. **No unconditional-changeset reading exists — the repo's own CI proves it.**
   `.github/workflows/changeset-gate.yml:25-26` is the decisive evidence: the step
   is named **"Require a changeset for release-relevant changes"** and runs
   `npx changeset status --since=origin/${{ github.event.pull_request.base.ref }}`
   — the conditional, versionable-path check by name and command, not an
   unconditional per-PR presence check. **The pipeline's two changeset guardrails
   are a faithful lift of this existing CI gate:** `changeset-gate.yml:23-24`
   "Validate changeset shape" = `npx tsx scripts/validate-changesets.ts`
   (= changeset-format), and `:25-26` = `changeset status` (= changeset-status).
   `validate-changesets.ts` `main()` (lines 167-187) enumerates whatever `.md`
   files exist and validates each — zero files → returns 0; it never asserts
   presence, and the empty form `---\n---\n` is explicitly accepted (lines 95-99).
   CONTRIBUTING.md frames the rule conditionally throughout (:16, :22, :31). The
   changeset config has no `ignore`/`linked`/`fixed` and `commit:false` — nothing
   imposing an unconditional requirement; `release.yml` is publish automation, not
   a per-PR gate.

**Design note worth surfacing in the doc:** the two pipeline changeset guardrails
mirror the project's existing GitHub Actions changeset gate one-to-one
(`changeset-gate.yml`). Adopting them as Guardrails brings the same gate the
project already trusts in CI into the pipeline's code/docs phases — a continuity
argument, not a new policy.

---

## Design complete — synthesis for the design-doc-writer

All three design questions the spec delegated are resolved on verified evidence.
This work is a documentation/config change: no new runtime modules, no algorithm
to design. The design is the placement + wording + one helper script below. The
six spec requirements (R1–R6) and five acceptance criteria (AC1–AC5) are
unchanged; nothing here revises the spec.

### Decision 1 (D1) — `## Guardrails` placement

Append `## Guardrails` as the **final top-level section** of `.rp.md`,
immediately after `## Health monitoring` (currently the last section). Peer `##`
(not a `###` under a grouping heading — this repo's `.rp.md` is a flat
one-`##`-per-convention file), committed to `.rp.md` (never `.rp.local.md`).
Rationale: the plugin loader selects guardrails by the Phase column, never by
position (`load.md:30`; all four phase agents select by phase tag), so placement
is machine-irrelevant; "last" matches both RP worked examples (v1 sibling's
top-level `## Guardrails` is last; v2's `### Guardrails` is last) and reads
naturally as an operational run-time convention. The section content is R2's
table verbatim, preceded by a one-line description, with R6's accurate per-gate
prose.

### Decision 2 (D2) — worktree-bootstrap home

A new standalone **`## Worktree bootstrap`** section in `.rp.md`, placed
**immediately after `## Claude Code worktrees`** (peer `##`, committed), written
as an orchestrator run-step: "after `EnterWorktree`, before launching any phase
agent or running any guardrail, run `bash scripts/bootstrap-worktree.sh`." The
body is a committed **`scripts/bootstrap-worktree.sh`** with `set -euo pipefail`
that runs `npm ci` (repo root) then `npm ci --prefix testing-project`.

Why this shape:
- `.rp.md` is the only artifact the orchestrator reliably reads at the start of
  every run (`SKILL.md:42-46`, `load.md:5,7`, this repo's `.rp.md:3`), and its
  run-start procedure has no bootstrap step (`autonomous-workflow.md:35-39`), so
  the project must own it there. Orchestrator-directed imperative prose in
  `.rp.md` that isn't a named convention is an established, obeyed pattern — the
  plugin author's own v2 example has an `#### Orchestrator updates during a run`
  subsection, and this repo's `.rp.md:26-39` already mirrors it.
- **Standalone, not folded into `## Claude Code worktrees`:** that block is
  plugin-canonical content (`claude-code.md:7,10-16`) a future `setup` re-run can
  regenerate, which would drop folded-in project steps. A standalone section is
  immune and more discoverable; adjacency to the worktrees section preserves the
  "post-EnterWorktree" reading.
- **Helper script as the body:** centralizes the exact `npm ci` (complete-,
  clean-install) semantics R5 demands in one testable place the `.rp.md` step
  names rather than restates (no drift). `scripts/` already exists. The `.rp.md`
  step is the durable trigger; the script is the body.
- **Two `npm ci` commands are genuinely required** — root `package.json` has no
  npm `workspaces` key, so the two installs are independent. Both must be `npm
  ci` (not `npm install`) per R5's complete-clean-install definition;
  `set -euo pipefail` makes a partial/failed install a non-zero exit (loud
  BLOCKER), honouring AC5.
- AGENTS.md is not the trigger (not the orchestrator's run-start read); an
  optional one-line human-facing pointer there is allowed but not required.

### Decision 3 (D3) — changeset-status guarantee

**Confirmed.** The intended guarantee is the conditional one: "release-relevant
(versionable) changes carry a changeset," which `changeset-status` delivers (exits
non-zero IFF a versionable path changed AND no `.changeset/*.md` exists; an empty
or `none`-bump changeset satisfies it). `changeset-format` is the
presence-agnostic shape gate. R6's wording stands; **no spec change.** The two
guardrails are a one-to-one lift of the project's existing CI gate
(`.github/workflows/changeset-gate.yml:23-26`), so adopting them is continuity
with a gate the project already trusts — a useful framing for the design doc's
rationale.

### Net artifacts the code/docs phases will produce (all already in spec scope)

1. `.rp.md`: append `## Guardrails` (last) + insert `## Worktree bootstrap`
   (after `## Claude Code worktrees`). [D1, D2; R1, R2, R5, R6]
2. `scripts/bootstrap-worktree.sh` (new, committed, `set -euo pipefail`, two
   `npm ci`s). [D2; R5]
3. `testing-project/package.json`: rename dep key `skillsmith` →
   `@automattic/skillsmith`; add `check:config` script. [R3, R4]
4. `testing-project/package-lock.json`: refreshed by `npm install` (absorbs the
   pre-existing drift noted in spec R3). [R3]
5. Optional-but-advised: align `testing-project/eval/utils/verify-e2e.ts:11` to
   `@automattic/skillsmith` (removes a latent TS2307; not required by any
   declared gate). The mandate decision was left to design — **recommendation:
   make it, as cheap drift-elimination consistent with this pipeline's purpose,
   but it is not load-bearing for any guardrail.**

No code changes to `src/` and no plugin changes (out of scope per spec).
