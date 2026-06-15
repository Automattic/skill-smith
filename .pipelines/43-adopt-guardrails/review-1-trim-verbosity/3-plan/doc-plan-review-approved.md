# Doc Plan Review

## Verdict: approved

## Summary

The doc plan is complete, accurate, traceable, and correctly scoped for this REVIEW/incremental run. It plans exactly the two `CONTRIBUTING.md` edits the spec and design doc call for — removing the guardrails cross-reference paragraph (Task 1) and tightening the `check:config` bullet to the design doc's exact final text (Task 2) — and nothing else. It does not overlap the code plan (no `.rp.md` or script work), it carries verbatim final text that is byte-identical to the spec requirement and design doc edit it traces to, and it correctly declines to add a changeset because only non-versionable paths change. Every claim in the plan was verified against the actual files in the worktree.

## Verification performed

- **Surface coverage / no doc gap.** Repo-wide searches (excluding `node_modules`, `.git`, `.pipelines`) confirm the only references that could go out of sync after the code phase are accounted for:
  - `bootstrap-worktree` appears only in `.rp.md` line 67 (code-plan territory). No doc surface references the deleted script, so no doc update is owed.
  - `guardrail`/`Guardrails` prose appears only in `.rp.md` (code plan) and `CONTRIBUTING.md` (Task 1 removes the cross-reference). No other doc surface.
  - The `check:config` rationale prose (`import graph`, `fixture config`, `config-load`) exists only in `CONTRIBUTING.md`. `testing-project/package.json` holds the script definition (out of scope), not narrative prose.
  - All other-doc links to `CONTRIBUTING.md` (`README.md`, `AGENTS.md`, `CHANGELOG.md`, `.changeset/README.md`) point at `#adding-a-changeset` / `#pre-10-policy` / release sections. None reference the "Running tests and checks locally" section, and neither edit changes a heading or anchor, so no inbound link breaks.
- **Exact-text fidelity (Task 2).** The bullet prescribed in the doc plan is byte-identical (modulo list-nesting indentation) to spec requirement 5 and design doc Edit 5, including a real em dash (U+2014, verified at byte level). It retains both mandated facts — (a) loads the fixture config through its real import graph, (b) catches config-load and import regressions the other checks miss — and drops only the parenthetical and the trailing "because none of them…" clause, exactly as the design doc's decision dictates.
- **Line/structure accuracy (Task 1).** The cross-reference paragraph is at `CONTRIBUTING.md` line 15 and the verbose bullet at line 13, as the plan states. The plan's whitespace end state (bullet → single blank line → `## Versioning policy`) matches the current structure (line 13 bullet, 14 blank, 15 paragraph, 16 blank, 17 heading) after removing the paragraph plus one blank line, consistent with design doc Edit 4.
- **No code overlap / no changeset.** Doc plan confines itself to `CONTRIBUTING.md`; code plan owns `.rp.md` and the script deletion. The cross-cutting acceptance explicitly excludes a changeset (non-versionable paths only) and lists the out-of-scope base-run artifacts to leave intact, reopening no base-run decision.

## Checklist outcome

- Coverage of surfaces: pass — `CONTRIBUTING.md` is the only documentation surface that names the affected behavior; verified by repo-wide search.
- Traceability: pass — each task cites a spec requirement, spec acceptance criterion 6, and the matching design doc edit + decision.
- Per-task acceptance: pass — criteria are reader-outcome framed, evaluable, and consistent with the spec; the verbatim-text criterion is appropriate for a presentation-only trim.
- Drift-resistance: pass — exact final text is the deliverable here (no code exists to drift); acceptance is anchored to the two required facts plus bullet shape.
- Audience clarity: pass — both tasks name "contributors and maintainers running local checks before pushing a PR."
- Granularity: pass — two small, single-surface, single-audience tasks.
- Ordering/dependencies: pass — both correctly marked independent (distinct lines of the same file).
- Feasibility: pass — all file paths, sections, and line numbers verified present and correct.
- No code planning: pass — `.rp.md` and script work are explicitly deferred to the code plan.
- Scope: pass — nothing beyond the two requested edits; out-of-scope artifacts named and excluded.
- Clarity/consistency: pass — two independent doc-writers would produce the same scope and shape given the verbatim text and explicit whitespace end state.
