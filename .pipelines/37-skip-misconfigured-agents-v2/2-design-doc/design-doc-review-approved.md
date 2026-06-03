# Design doc review — APPROVED

Target: `2-design-doc/design-doc.md`. Reviewed adversarially against `1-spec/spec.md`
(R1–R7, AC1–AC6, Out of Scope, Open items), with `design-doc-research.md` and
`spec-research.md` as context. Every load-bearing code anchor was verified against the
actual source in the worktree, and the baseline build was confirmed green
(`tsc --noEmit` clean; `npm test` → 135 pass / 0 fail / 2 skipped — the 2 are the
`CODEX_E2E`-gated tests).

I would stake the implementation on this design.

## What I verified (with anchors)

### The central anti-regression (R3.3 / R3.4) — traced end-to-end, yields exit 1
The exclusion marker `{ testing: { duration: 0 }, review: { skipped: "misconfigured: …" } }`
threads to the single exit chokepoint through the *unchanged* scoring chain:

- `aggregateScenarioReport` reads agent rows from disk (`scenario-report.ts:53-79`); the
  marker file becomes a row. `classifyVerdict(entry.review)` → SKIPPED ⇒ the scenario's
  `allPass` is false (`scenario-report.ts:83-92`).
- `mergeIntoRunningReport` / `agentsAllPass` keep it non-PASS (`iteration-report.ts:179-188`);
  `scenariosAllPass` false (`iteration-report.ts:166-177`).
- `prepareSummary` / `isRowPass`: a SKIPPED cell makes `isRowPass` false
  (`summary.ts:309-317`) ⇒ `exitCode: 1` (`summary.ts:66-76`).

It does **not** collapse to exit 0: no scoring code changes, and the marker is a real row
that the existing "non-PASS ⇒ fail" machinery scores. **Ordering holds** — the marker is
written inside `runAgents` (awaited at `pipeline.ts:527`) before `aggregateScenarioReport`
runs (`pipeline.ts:542`), so the on-disk row exists when the scenario report is built.

**R3.4 (all-excluded)** is auto-preserved: every row is SKIPPED ⇒ `agentsAllPass` /
`scenariosAllPass` false and `isRowPass` false; the empty-agents guards
(`scenario-report.ts:85`, `summary.ts:311`) never even need to fire. Confirmed.

**Multi-iteration survival**: `collectFailingAgents` marks the SKIPPED agent failing
(`select-scenarios.ts:90`) ⇒ it is re-selected in `failed-pairs` / `failed-scenarios`,
re-excluded and re-marked; `mergeIntoRunningReport` (`iteration-report.ts:115-146`) merges
agent rows (new wins, untouched inherit) so the marker is never dropped. In `all` scope it
is re-written each iteration. The design's "exclusion + marker-write happen together inside
the per-scenario loop" rule (Section 7.4) is correct and necessary.

### Verdict reuse (R3.2 / AC2.4)
`classifyVerdict` maps **only** `{ skipped: string }` to SKIPPED (`verdict.ts:26-27`); a
novel key falls through to FAIL "no rubrics or acceptance in verdict" (`verdict.ts:76-78`)
— exactly as the design argues, so reuse of `{ skipped }` is the right call. The
`"misconfigured: "` prefix machine-distinguishes the exclusion from the testing-failure
skip `"testing failed: …"` (`agent-loop.ts:220-222`) and from any FAIL (no `skipped` key).
Human distinguishability via the detail line `<agent>: SKIPPED <reason>` (`summary.ts:331-333`)
is real; yellow coloring applies to both skip kinds but is correctly not the distinguisher.
Zero enum / `Cell` / tracker-counter churn — consistent with minimal change.

### Role-aware soundness (R4)
- **Judge stop**: `UserFacingError` is already imported in `runPipeline`
  (`pipeline.ts:40`). The outer `try` begins at `pipeline.ts:141`; placing the throw after
  `resolveSelfImprovement` (`pipeline.ts:84`) puts it *outside* the try, so the
  `finally`/`afterAll` (`pipeline.ts:249-263`) never fires, no iteration runs, no
  `report.json`, and `prepareSummary` (`pipeline.ts:248`) is never reached. `run()` catches
  `UserFacingError` and returns 1 (`runner.ts:40-42`). No graded matrix — observably
  distinct from FAILs. Confirmed (R4.1 / AC3.1).
- **Improver degrade**: `resolveSelfImprovement` returns a fresh, mutable object
  (`self-improvement.ts:44-49`); flipping `.mode = "test-only"` before
  `maxIterations` (`pipeline.ts:118`) collapses the loop to 1 and turns off both the
  per-iteration improvement guard (`pipeline.ts:191`) and the finalPass sweep
  (`pipeline.ts:218`). `prepareSummary` is mode-agnostic, so degrade does **not** force
  non-zero — a clean test-only matrix exits 0 (R4.2 / AC3.2). Confirmed.
- **Test agent** follows "warn" (R4.3) via the split in `runAgents`.

### The single seam (R2 / AC4.1)
`decideRunnability(config: SkillsmithConfig, env)` is the one decision point; call sites
only read the plan. `runnableTestAgentIds` is the shared determinant consumed at **both**
the runtime exclusion and the e2e `projects` array, over the same `providerRunnable` atom
— the two cannot disagree (R5.2). "fail"/"skip" are addable inside the seam without
touching call sites; Out of Scope is respected (neither is implemented; the design only
describes how they would slot in, and flags the future-"skip" R3.4 guard caveat).

### codex exclusion (R1.3) — substantiated
`codex.ts:64-66` passes `apiKey: process.env.OPENAI_API_KEY` (may be `undefined`) while
`codexEnv` forwards `CODEX_*` session vars (`codex.ts:28-29,172-184`), so CLI/session auth
can succeed with no `OPENAI_API_KEY`. Absent key is therefore not a reliable signal for
codex — keeping it out of the map is correct and matches R1.3. By contrast `openai-api.ts:8`
gates solely on `OPENAI_API_KEY`, so the gate is exact for the pure-API providers.

### Concrete bits (AC5 / R6 / R4.4)
- `ProviderId` union matches the map keys exactly (`providers/types.ts:3-9`).
- `SkillsmithConfigInput` has `agents: Record<string, {provider, model}>` and
  `roles.test.agents: string[]` (`config/types.ts:25-29,57,99-106`); `defineConfig` is
  identity (`define-config.ts:9-13`) — so the raw-input public signatures are type-sound and
  the testing-project holds exactly that shape. The normalized `SkillsmithConfig` carries
  `AgentDefinition[]` / `.agent` with `.provider` for the internal seam.
- `gpt-4.1-nano` validates: `validateAgentEntry` requires only a non-empty model + known
  provider, no allow-list (`validate.ts:77-84`). Testing-project edits are correct against
  the real config (`testing-project/skillsmith.config.ts:20-38`).
- Playwright `projects` filter is exactly line 23 plus the import
  (`testing-project/playwright.config.ts:23-26`); package `exports` is `{ ".": "./src/index.ts" }`
  (only entry point), so the barrel addition is the only viable surfacing path and
  `import … from "skillsmith"` resolves. The barrel already loads all SDKs via the value
  export `run`, so the SDK-free discipline is correctly framed as isolation/unit-test
  hygiene, **not** as what makes the e2e import cheap — the design states this honestly.
- e2e self-exclusion is double: no Playwright project for the excluded agent, and
  `runE2eVerification` only builds plugins from workspaces that exist
  (`verify-e2e.ts:52-67`) — the excluded agent gets a `report.json` dir but no `workspace`,
  so it contributes no plugin and no `e2e failed` cell (AC5.1 by construction).
- Deterministic role testing via a real `openai-api` fixture with `OPENAI_API_KEY` scrubbed
  exercises the real gate (no network); `mock`/`claude-code` correctly stay out of the map,
  so no fake path is invented (R4.4 / AC3).

### Constraints (R7 / AC6)
Isolated new module; `Provider` contract, every `invoke`, `prepareSummary`/`isRowPass`,
`classifyVerdict`, tracker enums/counters, and `mergeIntoRunningReport`/reselection are all
left untouched (verified). Tracker "skipped" events are display-only and safe: the excluded
agent is in the seeded roster (`pipeline.ts:113`), so `phaseFinished` → `slots` does not
trip the unknown-agent guard (`tracker.ts:335-345`); `TerminalStatus` includes `"skipped"`
(`progress/types.ts:3`). Shipped identifiers are domain words only — no process vocabulary.

## Minor (non-blocking) observation
The design's prose pins the pre-flight "right after `resolveSelfImprovement` and before the
outer `try`". The binding constraint for the degrade is actually slightly tighter — it must
precede the `maxIterations` computation at `pipeline.ts:118` for the loop-collapse to take
effect. "Right after `resolveSelfImprovement` (line 84)" already satisfies this, and the
research record states it explicitly, so there is no defect; I note it only so the plan
phase places the block in the 84–118 window rather than 118–141.

## Verdict
Sound and complete. Every R1–R7 / AC1–AC6 has a coherent design element grounded in real
code; nothing silently dropped; Out of Scope respected; minimal-change and isolation
constraints honored. **APPROVED.**
