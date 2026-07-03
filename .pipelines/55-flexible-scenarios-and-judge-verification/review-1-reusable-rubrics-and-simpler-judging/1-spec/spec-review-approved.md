# Spec Review

## Verdict: approved

## Reviewer

Owner (assisted workflow)

## Notes

Approved as drafted. Key decisions settled during Q&A:

- **Judge-driven setup (option a):** the judge runs the full live e2e from the human-language `JUDGE.md` (activate, insert produced block(s), open, check). The earlier "setup adds flake" concern was withdrawn — these are deterministic wp-cli/navigation steps, and trunk's existing e2e harness already boots one env and does deactivate-all/activate-one per test (proven). The harness keeps the deterministic clean-slate guarantee (only this pair's plugin active).
- **Block naming not enforced:** the testing agent may produce one or more blocks under any name; the judge discovers (e.g. from `block.json`) and inserts the produced block(s). The plugin slug stays deterministic for activation.
- **Rubrics:** reusable prose criteria referenced by id, auto-supplied to the judge as grading material (skills-symmetric mechanism is the obvious path; design decides). Optional; unknown id → clear per-scenario error; verdict stays `{ pass, notes }`.
- **Env-once is testing-project-only** (run-level hook, warm, per-pair install/clean-slate/activate); judges stay serial; only core change is rubric support.
- **Testing posture** carries over from the base run (manual full testing; no self-improvement-loop / full-suite-green dependency in the pipeline; deterministic gates green).
