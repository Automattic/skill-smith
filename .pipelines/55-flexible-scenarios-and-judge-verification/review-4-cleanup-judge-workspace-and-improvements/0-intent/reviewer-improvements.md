# Independent reviewer report: improvements and new ideas

*Produced by an independent read-only reviewer against branch tip `0addcb8`, commissioned by the owner after the review-3 close-out, with an explicit owner mandate to evaluate the judge-scoped workspace seriously ("design the tool first"; prior art inside this repo is NOT a valid rejection reason). Preserved verbatim as intent source material for the review-4 run. These are proposals with the reviewer's recommendation attached — the design phase owns the final decisions.*

## Part 1 — The judge workspace (the owner-requested evaluation)

**Reviewer verdict: adopt it, with two amendments — call it something other than `workspace`, and supply it by mounting files with a small inlined manifest rather than inlining everything.**

### Why the design history doesn't stand against it

Review-3 rejected a *both-roles* `paths.workspace` because no content needed a shared testing+judge channel — a correct conclusion that says nothing about a judge-only directory. Meanwhile the current pair it would replace has accumulated real awkwardness:

- `roles.judge.prompt` requires config boilerplate (`readFileSync` in `testing-project/skillsmith.config.ts:18-21`) to load what is conceptually a *file*, and it lands at the *end* of the system prompt as `# Role instructions` even though it's an environment manual the judge needs before acting.
- `paths.rubrics` inlines **every** rubric into **every** judge call (`loadAllRubrics`), then needs the selection lead-in (`RUBRIC_SELECTION_LEAD_IN`, `src/pipeline/judge-agent.ts:167`) to tell the judge to ignore most of what it was just handed. That guardrail exists purely to mitigate the load-all mechanism. Token cost scales linearly with rubric count × pairs, and a mistyped rubric name in a brief fails silently.
- Helper scripts can't live in either channel. The reference project smuggles its bridge script in via an absolute path in the manual (`$SKILLSMITH_PROJECT_ROOT/eval/utils/judge-wp.mjs`) — the "everything the judge needs, in one place" abstraction is *already* being expressed, just informally.

A single judge-supplied directory unifies all three, and it matches the philosophy the tool itself tests: progressive disclosure — an always-read entry file plus reference material read on demand is exactly the SKILL.md model.

### Config shape

```ts
roles: {
  judge: {
    agent: 'opus',
    library: './eval/judge',      // replaces roles.judge.prompt + paths.rubrics
    concurrency: 'serial',
  },
}
```

**Naming:** avoid `workspace`. `AgentContext.judgeWorkspace` is already the isolated artifact copy the judge cwd's into; a second "judge workspace" meaning "reference directory" would be genuinely confusing. `library` (or `kit`/`context`) is unclaimed and describes the content.

**Directory convention:**

```
eval/judge/
├── README.md                                  # the manual — always inlined verbatim
├── rubrics/wp-interactivity-api-best-practices.md
└── bin/wp.mjs                                 # helper scripts, referenced by path
```

### Supply mechanism: mount + manifest, not inline-everything

1. *Inline everything* — works for tool-less judges, but token cost grows with the directory; inlined scripts are dead weight; forces the selection lead-in back into existence.
2. *Mount only* — zero eager tokens, but the load-bearing manual becomes skippable.
3. **Two-tier (recommended):** `README.md` inlined verbatim (this *is* the environment manual, replacing `roles.judge.prompt`); everything else copied per pair to a **sibling** of the judge workspace — `<agent-dir>/judge-library/` — announced with a generated manifest section listing the files. Copy, don't reference the original (a write-capable judge or parallel pool must not corrupt the shared library). Keep it a *sibling* of `judge-workspace/`, not inside it, so a judge globbing its cwd for produced files never confuses library files with the artifact. Scripts with `node_modules` deps should shell out (`npx …`) or be invoked from the project root — `judge-wp.mjs` already does this correctly.

**Degradation for tool-less judges:** when the resolved judge capabilities include no file-reading tool, inline the whole library instead — keeps api/text judges at parity.

### How briefs reference items, and the fate of the lead-in

Briefs reference by relative path in prose — still fully opaque to core, no parsing:

> As a further code check, verify the produced code against `judge-library/rubrics/wp-interactivity-api-best-practices.md`.

This dissolves the structured-`# Rubrics`-vs-fuzzy-matching dilemma: the path is mechanical enough to lint and fails *observably* (the judge reports "file not found" instead of silently grading without criteria), yet core still parses nothing. **The selection lead-in is deleted** — nothing unnamed is ever in the prompt. The `# Testing task` auto-injection and `{ pass, notes }` output instruction are untouched.

### Symmetric `roles.test.workspace`?

**No — deliberately asymmetric.** The testing agent's reference material *is the skill under test*; a parallel always-supplied library would contaminate the measurement. What projects legitimately want on the testing side is *starting state*, per-scenario — see Proposal 10 (seed workspaces). Keep `roles.test.prompt` for the small role framing it carries.

### Migration for testing-project

- `eval/prompts/judge.md` → `eval/judge/README.md` (drop the `readFileSync` from config).
- `eval/rubrics/…` → `eval/judge/rubrics/…`; update the one rubric sentence in each of the 11 briefs to the path form.
- Optionally `eval/utils/judge-wp.mjs` → `eval/judge/bin/wp.mjs`, letting the manual drop `$SKILLSMITH_PROJECT_ROOT` for that purpose.
- Remove `paths.rubrics` and `roles.judge.prompt` from config and types; changeset `minor` with `BREAKING:` prefix per pre-1.0 policy.

### Trade-offs, honestly

- **Token cost:** strictly better than today for rubrics (pay-per-read vs all-inlined); slightly worse discoverability of unread content (mitigated by briefs naming paths explicitly).
- **Secrets boundary:** the library is copied per pair — document "no secrets in the library; pass secrets via `beforeJudgeAgent` env vars".
- **Grading-leak boundary:** unchanged; state as an invariant — the library reaches judges only.
- **Discoverability vs magic:** one conventional directory beats two config channels; the README-eager/rest-lazy rule is a convention to learn — `skillsmith inspect` (Proposal 4) makes the assembled prompt observable.
- **Effort:** medium. Touches `judge-agent.ts` (prompt assembly), `agent-loop.ts` (per-pair copy), config types/validate/normalize, rubric-loader retirement, docs, and the 11 briefs.

## Part 2 — Ranked proposals (value-for-effort, highest first)

1. **Judge library** — as above. Adopt.
2. **Slot-pool judge concurrency (`concurrency: number`)** — judging is the wall-clock bottleneck; every bracket queues on one run-wide mutex solely because the reference project runs one wp-env on fixed port 8987. `JudgeConcurrency = 'serial' | 'parallel' | number`; N = counting semaphore leasing slot ids; `AgentContext` gains `judgeSlot?: number` so hooks map slot → environment (port 8987+slot, per-slot staging). Wrinkle worth solving in core: per-pair facts currently ride global `process.env` (`installPluginForPair`), which races under parallelism — let `beforeJudgeAgent` return an env map applied to the judge invocation. Risk low; semantics preserved at N=1.
3. **Centralize the all-must-pass decision rule** — every brief opens with the identical sentence; it's verdict *semantics*, not scenario *content*, and N copies can drift. Fold the default into the harness output instruction ("Unless the brief states a different decision rule, pass only if every check the brief asks for is satisfied"); briefs drop the opener; a brief wanting a different rule states it in prose and wins. Conformance test shrinks. Tiny effort.
4. **Authoring DX bundle:** `skillsmith inspect <scenario>` (print the exact assembled judge/testing prompts — near-zero effort, both builders are pure functions); `skillsmith new <scenario-id>` (stamp the two files from a template); `skillsmith lint` (skills resolve; library paths in briefs exist; warn on high JUDGE.md/TESTING-AGENT.md overlap). Lint stays warnings.
5. **Per-check verdicts** (`{ pass, checks: [{ description, pass, notes }], notes }`) — `{ pass, notes }` collapses a 10-check brief into one bit; the improver must re-parse prose to learn which check failed; `summarizeFailures` still carries dead code for shapes the judge can no longer emit. Keep briefs opaque; change only the output instruction; core derives `pass` = all checks pass. Pre-1.0 breaking (`minor` + `BREAKING:`). Risks: bigger JSON = more parse failures (balanced-brace fallback mitigates); check identity not stable across iterations (v1: don't correlate mechanically).
6. **Judge-phase observability** — `report.json` records nothing for the judge (usage dropped, duration only in the tracker); add `judging: { duration, tokenUsage? }` beside `testing`; persist per-agent `judge-transcript.md`/`testing-transcript.md` from the provider stream. Low effort.
7. **Capability manifest injection** — briefs hard-code environment assumptions ("cannot be mocked in this environment"); core injects a `# Judge capabilities` section derived from the resolved surface (`judgeCapabilities()`), plus a project vocabulary knob (`roles.judge.caps: string[]`); briefs condition on capabilities instead of hand-written facts. Low effort.
8. **Statistical honesty: `repeats` + `skillsmith compare`** — one run per (scenario × agent) cell is coin-flip-grade; `repeats: N` yields per-cell pass-rates with per-trial artifacts; `compare <runA> <runB>` emits the regressed/fixed/unchanged matrix delta. `compare` is trivial and could ship first.
9. **Improver memory** — the improver is memoryless across iterations (oscillation unguarded); snapshot `paths.skills` per iteration via the existing workspace-snapshot utilities, write `iteration-N/skills.diff`, feed a `# Previous attempts` digest (cap at last K).
10. **Scenario seed workspaces** (`<scenario>/workspace/` copied into `agentWorkspace` before `beforeTestAgent`) — makes modification-task scenarios expressible without `scenario.name` branching in hooks; define seed-then-hook order; seeds are testing-visible by design.
11. **Provider capability honesty** — two silent lies today: testing-agent `tools`/`mcpServers` silently ignored (`toolSurfaceFor` consults capabilities only for judges, yet the types accept them for every agent); `network` honored by codex but silently ignored by claude-code. Warn at config validation; longer-term honor testing-agent surfaces.
12. **Cache-friendly prompt assembly** — the judge prompt starts with the per-scenario brief, so provider prompt caching gets zero cross-pair reuse; reorder to a stable prefix (manual/library manifest, capabilities, output instruction) + per-pair suffix (brief, task); also inline file *listings* instead of bodies when the judge has file tools. Tiny change but shifts judge behavior — re-baseline the 11-scenario suite.

**Future directions (flagged, not proposed):** judge ensembles/majority vote (expensive; `repeats` buys similar confidence cheaper); a judge calibration suite (`skillsmith calibrate` running known-good/known-bad fixtures through the judge; pairs with seed workspaces).

| # | Proposal | Value | Effort |
|---|----------|-------|--------|
| 1 | Judge library | High | Medium |
| 2 | Slot-pool judge concurrency | High | Low-Med |
| 3 | Centralized decision rule | Medium | Tiny |
| 4 | inspect / new / lint DX | Med-High | Low |
| 5 | Per-check verdicts | High | Medium |
| 6 | Judge observability | Medium | Low |
| 7 | Capability manifest | Medium | Low |
| 8 | repeats + compare | High | Medium |
| 9 | Improver memory | Medium | Low-Med |
| 10 | Scenario seed workspaces | Medium | Low |
| 11 | Provider capability honesty | Medium | Low |
| 12 | Cache-friendly assembly | Low-Med | Tiny (+re-baseline) |

Proposals 1, 3, 5, and the `paths.rubrics`/`roles.judge.prompt` removals compose into one coherent pre-1.0 breaking wave (single `BREAKING:` changeset); 2, 4, 6, 7, 9, 10, 11 are additive and can land independently.
