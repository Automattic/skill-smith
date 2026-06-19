# Doc Plan Review

## Verdict: rejected

## Summary

The plan is strong on almost every axis: the single doc task is correctly scoped
and genuinely warranted (the `CONTRIBUTING.md` "Running tests and checks locally"
section does list `npm run lint` but is silent on code formatting, and a `format`
script already exists in `package.json` and is unmentioned — verified), the
acceptance criteria are framed as reader outcomes rather than brittle wording,
the Biome version is deliberately kept out of prose, the two authoritative design
corrections (lockfiles not reformatted; multiline imports get an `es5` trailing
comma) are carried as guardrails on any prose, and the plan correctly leaves the
changeset/CHANGELOG work to the code phase. I independently swept the repo and
confirmed the "surfaces deliberately not changed" list is sound and complete:
no documentation prose anywhere describes skillsmith's own code style (e.g. as
"double quotes") in a way that would go out of sync, the README's WordPress
mentions concern the reference project under test, `AGENTS.md`/`CLAUDE.md` carry
no style content, the `.rp.md` and `release.yml` `npm run lint` references keep
working, and the `CONTRIBUTING.md` "lint/format config" changeset rule (line 32)
is unaffected. The plan is one fix away from approvable. It is rejected for a
single, concrete internal inconsistency in Task 1 that could let a doc-writer
silently drop a documented check while still "passing" the acceptance criterion.

## Issues

### Issue 1: Task 1 acceptance criterion drops `npm run smoke` from the existing-checks enumeration, contradicting the plan's own "Files to change" bullet and the actual file

**What's wrong:** Task 1 enumerates the existing local checks inconsistently
across its own sections, and the enumeration is incomplete versus the real file.

- The actual `CONTRIBUTING.md` "Running tests and checks locally" section lists
  **five** checks: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run smoke`, and `npm --prefix testing-project run check:config`
  (verified — `CONTRIBUTING.md` lines 9–13, including `npm run smoke` on line 12).
- The plan's **"Files to change"** bullet correctly says the section "currently
  lists `npm run lint`, `npm run typecheck`, `npm test`, `npm run smoke`, and the
  `testing-project` `check:config` command" — i.e. it names `npm run smoke`.
- But **Acceptance criterion #3** drops `npm run smoke`: it reads "The existing
  local-checks guidance (`npm run lint`, `npm run typecheck`, `npm test`, the
  `testing-project` `check:config` command) remains present and accurate."

The acceptance enumeration is therefore (a) internally inconsistent with the
task's own Files-to-change bullet and (b) inconsistent with the file it governs.
The general catch-all ("nothing that still works is described as removed")
technically covers `smoke`, but the explicit enumeration is the part a
doc-writer will check against, and it is wrong.

**Where in plan:** Task 1 — "Acceptance" bullet 3 (the explicit enumeration of
preserved checks), read against the same task's "Files to change" bullet.

**Suggestion:** Add `npm run smoke` to the acceptance criterion's enumeration so
it matches the Files-to-change bullet and the real file — e.g. "(`npm run lint`,
`npm run typecheck`, `npm test`, `npm run smoke`, and the `testing-project`
`check:config` command)." Optionally, to make the criterion fully drift-proof,
reframe it as "every local check the section listed before this change remains
present and accurate" so it does not depend on a hand-maintained list at all.

**Why it matters:** If a doc-writer restructures the bullet list into a code-style
subsection (which the task explicitly invites — "the doc-writer may add a brief
subsection rather than overloading the existing bullet list"), the incomplete
acceptance enumeration gives no signal that `npm run smoke` must survive the
edit. A doc-writer could drop or bury the `smoke` line and still satisfy the
literal acceptance check, leaving the contributor checklist quietly incomplete.
Two doc-writers executing this plan independently could also produce different
preserved-check sets, which is exactly the consistency property the acceptance
criteria are supposed to pin down.
