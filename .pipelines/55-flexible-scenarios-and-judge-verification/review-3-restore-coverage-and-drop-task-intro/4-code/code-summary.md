# Code Phase Summary

## What

Twelve files changed, nothing else: the 11 `testing-project/eval/scenarios/<id>/JUDGE.md` briefs rewritten to a fixed two-section template, and `src/__tests__/testing-project-scenarios.test.ts` realigned to guard that template. Each brief now consists of exactly a fixed task-free decision-rule opener ("Judge the produced work against the checks below … Pass only if every check, including the rubric check, is satisfied."), a `## Code checks` section carrying its trunk scenario's `acceptance:` bullets verbatim (63 across the 11 scenarios) and closing with the fixed bare-id rubric sentence, and a `## Behavior checks` section carrying its trunk `e2e.spec.mjs` observable assertions as live action → observation bullets. Three briefs open Behavior checks with a coverage-relevant setup bullet (independent-counters and shared-state: block embedded twice in one post; paginated-list: 5 extra published posts via the WP-CLI bridge); config-fetch additionally opens with a WP-CLI title-lookup setup bullet so no expected title is hard-coded. Exactly two briefs carry a mandatory explicit conditional-fallback bullet (async-fetch's live-unobservable rendered-joke outcome; config-fetch's `X-WP-Nonce` header when tooling does not expose request headers), each naming its covering code check. Zero Skillsmith core changes, zero config changes, no changeset.

## Why

A prior conversion pass to the two-file scenario model had dropped real judging coverage (counter lost all four trunk acceptance checks) and opened every brief with a narrative restating the task the harness already injects. This revision restores exactly trunk's judging coverage — nothing dropped, nothing added — with no task repetition and no duplication of harness-supplied material, per the review-3 spec (R1–R5) and design.

## How

A three-stage sandwich kept the suite green at every commit. Task 1 (`ce29231`) trimmed the conformance test to transition-safe invariants true of both brief shapes and deleted the `liveChecks` coverage anchors that spec R8/AC7 reject. Tasks 2–12 (`ff8bbca`…`aed9cca`) rewrote one brief per commit — counter first as the byte-exact worked example, then the rest alphabetically — each transcribing its scenario's bullets fresh from `origin/trunk` (per R10), unescaping YAML-quoted scalars, and applying the single permitted edit (derived-double bullet 1 drops "from the Interactivity API skill"). Task 13 (`bd72be0`) finalized the conformance test to seven uniform, scenario-independent invariants (both headings, bare rubric id present, rubric sentinel absent, no pre-stated output shape, no dead env vars, the opener fragment `pass only if every check`, no `# Rubrics` heading) — deliberately never a coverage checker; coverage parity is reviewer-verified, and was verified programmatically against trunk at review time (63/63 bullets exact, all e2e observable assertions covered).

## Key decisions

- Config-fetch's warm-env assumption (post ID 1 exists) was discharged with a one-time verification against a running warm wp-env, recorded in `0f3a1fa`'s commit message (`judge-wp.mjs post get 1 --field=post_title` → "Hello world!").
- Toggle-visibility's single-quoted YAML bullet was unescaped under the design's general unescaping rule even though it was absent from the design's illustrative list.
- No new tests were added for brief content in Tasks 2–12 — the TDD habit was explicitly overridden per R8; the only mechanical guards live in the conformance test's structural invariants.

## Known limitations

- Coverage parity with trunk is not machine-asserted anywhere (by spec R8 design); future brief edits rely on reviewer discipline plus the structural conformance test.
- The README example brief still shows the pre-template shape; deliberately deferred to the docs phase (design Decision 6).
- Whether the judge's Playwright MCP tooling exposes request headers remains unverified; the config-fetch nonce bullet's in-brief conditional makes the check deterministic either way.
