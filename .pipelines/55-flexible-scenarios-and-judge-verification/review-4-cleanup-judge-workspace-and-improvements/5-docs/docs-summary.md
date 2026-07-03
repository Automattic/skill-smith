# Docs Phase Summary

## What

Phase 5 realigned every consumer-facing documentation surface to the shipped
review-4 state (spec R8), across three files and eight plan tasks:

- **`README.md`** — five workstreams:
  - The judge-material sections were rewritten to the judge-library model: the
    retired `### Reusable rubrics` load-all section became `### The judge library`
    (single `roles.judge.library` directory, entry `README.md` inlined as the
    environment manual, whole directory copied per pair to `judge-library/`,
    manifest, tool-less inline fallback, path-form brief references), and
    `### The judge brief` gained the harness-owned decision-rule default (brief
    prose overrides) and the always-present missing-material failure duty.
  - The `### Configuration` reference now presents the judge's `library` knob
    (with its start-up existence gate), a `paths` block without `rubrics`, the
    shipped judge system-prompt assembly order, and the load-time rejection of
    the two removed keys.
  - The lifecycle walkthrough, Mermaid diagram, and `### Per-iteration reports`
    were realigned: no `dirName` on scenario records, the per-pair library copy
    staged before `beforeJudgeAgent`, and the new `judging: { duration,
    tokenUsage? }` report block with its exact presence rule.
  - The top-of-file `> [!IMPORTANT]` breaking note and `## Migrating from the
    old model` were updated for this wave, adding an `### Upgrading to the judge
    library` subsection with the two removed keys (and their verbatim rejection
    messages), the `dirName → id` hook change, and the dropped per-brief
    decision-rule opener.
  - A crash-recovery one-liner (`npx wp-env stop` from `testing-project/`)
    replaced the deleted `env:stop` npm script in the warm-environment section.
- **`examples/skillsmith.config.ts`** — the judge-role comment block was expanded
  (comment-only) from the code phase's minimal rewrite into full library-model
  guidance: what belongs in the directory, what Skillsmith does with each part,
  the tool-less fallback, and a rubric-by-path illustration replacing the deleted
  `paths.rubrics` bare-id comment.
- **`.changeset/flexible-scenarios-judge-verification.md`** — the cross-surface
  sweep struck the changeset's false "no existence gate" claim, replacing it with
  the accurate start-up path-existence gate description.

## Why

Phase 4 shipped the judge-library model, the centralized decision rule, the
`dirName` removal, and the `judging` report block, but deliberately deferred the
consumer-docs realignment (spec R8). Without this phase the README, the reference
example config, and the pending release record would describe a retired model —
config keys that now fail validation, a `dirName` field that no longer exists, and
a rubric-supply mechanism that was replaced. The phase makes the docs match what
actually ships so a reader configuring a project, authoring a brief, parsing a
report, or upgrading from the previous model works from accurate instructions.

## How

Each task derived its wording from the shipped branch state (config types,
validate messages, `judge-agent.ts`/`judge-library.ts`/`agent-loop.ts`, the
migrated testing-project library and briefs, and the three shipping changesets)
rather than from the plan, and finished by running both docs-phase gates
(`npx tsx scripts/validate-changesets.ts`, `npx changeset status
--since=origin/trunk`). No task added a changeset — the code phase's three
changeset actions already record every semantic change, and the README/`examples`
edits are prose/comment realignment that CONTRIBUTING exempts. Task 7 was a
verify-only pass over the pending changeset set (its planned
`nested-scenario-folders.md` edit had already shipped with code Task 12), and
Task 8 was a repository-wide drift sweep that confirmed the retired surfaces
survive only in permitted migration/removal/validation-error contexts.

## Key decisions

- The retired `### Reusable rubrics` section was retitled `### The judge library`
  to match the shipped concept, and all eight referring anchor links were updated
  to the new target (every internal README anchor resolves).
- The missing-material failure duty and the decision rule are documented as
  harness-owned defaults living in the always-present output instruction, so the
  docs describe them as unconditional (holding in mounted, inline, and
  unconfigured cases) — matching the shipped `buildJudgeSystemPrompt`.
- No new changeset was authored in this phase; the changeset consistency work was
  limited to striking falsified prose from the existing feature changeset.

## Known limitations

- The docs describe the shipped surface only; any residue that would have required
  a source-code change was to be reported as a blocker rather than fixed in this
  phase, and none was found.
