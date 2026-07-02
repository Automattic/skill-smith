# Docs Phase Summary

## What

Two illustrative-example alignments, one commit each, approved in a single review pass:

- **`README.md` `### Reusable rubrics`** (`bb45fb6`) — the README's only example judge brief now models the shipped brief conventions: the fixed task-free opener stating the all-must-pass decision rule ("Pass only if every check, including the rubric check, is satisfied"), and rubric selection by the bare id `` `wp-interactivity-api-best-practices` `` via the shipped rubric sentence. A new framing sentence explains that the bare id is the clearest reference because it matches the `# Rubric: <id>` label the judge sees, and a short note after the example points out the verdict-rule opening and the no-task-restatement rationale, cross-linking `### The judge brief`.
- **`examples/skillsmith.config.ts` `paths.rubrics` comment** (`1702014`) — the annotated reference config's rubric illustration swaps the title-style example ("grade the code against the WordPress Interactivity API best-practices rubric") for a bare-id example quoting the shipped rubric sentence fragment. Comment-only; the config value and all surrounding mechanics prose are unchanged.

No changeset was added; the branch's existing `.changeset/flexible-scenarios-judge-verification.md` covers the PR and both docs-phase gates pass with it.

## Why

The code phase of this run rewrote the 11 bundled `testing-project` judge briefs to a fixed two-section template (design Decision 3) with zero core changes. Two documentation surfaces still modeled the superseded style — a task-referencing opener and rubric naming by human-readable title — and design Decision 6 explicitly deferred their alignment to this docs phase. Left stale, a reader copying either example would author briefs inconsistent with the bundled reference project and miss the unambiguous bare-id selection pattern.

## How

Both writers derived the conventions from the shipped briefs on the branch, not from the plan's or design doc's illustrations, making the docs drift-resistant: the README example's opener and rubric sentence are verbatim shipped text (verified byte-identical across all 11 briefs at review), and the config comment quotes a verbatim fragment of the same sentence. All prose describing unchanged core mechanics (optional `paths.rubrics`, no existence gate, no reserved grammar, auto-supplied rubric content, unvalidated references) was kept as-is and re-verified against `src/` at review. Review confirmed both gates green (`npx tsx scripts/validate-changesets.ts`, `npx changeset status --since=origin/trunk`), plus `npm run typecheck` and `npm run lint` for the comment-only config edit, and swept the remaining doc surfaces (README elsewhere, CONTRIBUTING, `docs/`, testing-project prompts, `_candidates.yaml`) for stale brief-style references — none found.

## Key decisions

- The README example stays a condensed shape (opener, placeholder checks bullet, rubric sentence) rather than the full two-section template — per the docs plan's explicit note that Task 1 models the two conventions without inflating the short example.
- Bare-id naming is presented as the clearest convention, not a requirement — both surfaces preserve the truth that rubric selection is plain-language prose Skillsmith never parses or validates.

## Known limitations

- The README example is deliberately not a complete copy of a shipped brief (no `## Code checks` / `## Behavior checks` headings); readers wanting the full template are served by the bundled scenarios' `JUDGE.md` files, which the example is now consistent with.
