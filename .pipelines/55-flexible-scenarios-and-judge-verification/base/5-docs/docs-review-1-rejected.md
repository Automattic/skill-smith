# Docs Review

## Verdict: rejected

## Batch scope

Tasks reviewed (iteration 1):

- **DocT1** — Rewrite the README to the two-file scenario + live-judge model (`README.md`)
- **DocT2** — Rewrite the public landing page (`docs/index.html`)
- **DocT3** — Update the reference example config (`examples/skillsmith.config.ts`)
- **DocT4** — Audit and correct old-model references in `CONTRIBUTING.md` (no-op)
- **DocT5** — Update the `testing-project` improver-prompt narrative (`testing-project/eval/prompts/improver.md`)

Diff base ref: `95c86bd` → current HEAD (`0959c69`).

## Summary

The prose across all five surfaces is accurate, well-targeted, and matches the shipped code closely — the new two-file scenario model, the `# Skills` parsing rules, the `JudgeCapabilities` keys, the `{ pass, notes }` verdict, `roles.judge.concurrency`, the workspace-copy no-modify guarantee, and the `beforeJudgeAgent`/`afterJudgeAgent` env-ownership hooks are all described correctly, and every spot-checked concrete claim was verified against the worktree source. DocT2, DocT3, DocT4 (correctly a no-op), and DocT5 are all clean. The batch is rejected for **one** substantive defect in **DocT1**: the README still embeds the `assets/skill-tester-workflow.png` workflow diagram (line 89), which visually renders three removed old-model concepts as the current contract (`scenario.prompt`, "the rubrics it references", and a `judge-review.yaml` output) and directly contradicts the prose DocT1 rewrote two lines below it. That fails DocT1's acceptance ("no remaining README text references ... rubrics, an `acceptance`/`prompt`/`description` scenario field") on the most load-bearing docs surface. Only DocT1 needs to be re-dispatched.

## Checks

Guardrail gates were **not run**: the step-2/3 review already produced a rejection finding, so per the review workflow the gates are skipped this iteration (they would not change the verdict — the batch returns to the writer regardless). They must run and pass on the re-review before approval.

| Check | Command | Result |
| ----- | ------- | ------ |
| Changeset format | `npx tsx scripts/validate-changesets.ts` | skipped |
| Changeset present | `npx changeset status --since=origin/trunk` | skipped |
| Typecheck | `npm run typecheck` | skipped |
| Lint | `npm run lint` | skipped |

## Accuracy spot-check

Every claim below was verified against the **worktree** source (`.../worktrees/55-flexible-scenarios-and-judge-verification/src/...`), not the separate `trunk` main checkout.

- **DocT1 — `Scenario`/`Paths` shape, `# Skills` parsing, error strings, verdict, concurrency.**
  - `src/config/types.ts:187` — `Scenario { name, skills, testingBrief, judgeBrief }`; `Paths { base, skills, scenarios }` (line 146, no `rubrics`). README's "Two briefs" and "Configuration" sections match.
  - `src/scenarios/enumerate.ts:6-8` — constants `TESTING-AGENT.md` / `JUDGE.md`; discovery gated on **both** present (line 162); `# Skills` parsing (lines 41-70) matches the README's described rules (any-depth heading, same-or-shallower terminates, list items only, backtick/link strip, empty section valid, first heading wins). Missing-section error string is exactly `missing required # Skills section in TESTING-AGENT.md` (line 216); unknown-skill error is `unresolved reference: skill "<id>", ...` (lines 224-228). README's prose on these is accurate.
  - `src/reports/verdict.ts:47-48` — the `pass === false` branch pushes non-empty `notes` into failures; README's "notes surfaced on FAIL" claim holds.
  - `src/pipeline/judge-agent.ts:154-164` — judge system prompt = verbatim `judgeBrief` + `{ "pass": <bool>, "notes": "<string>" }` instruction + optional `roles.judge.prompt`; matches README "Per-iteration reports" and "Configuration".
  - `src/pipeline/agent-loop.ts:162,250-257,294-295,342` — copies `agentWorkspace` → `judge-workspace`, snapshots/diff-guards the canonical workspace around the judge phase, and serializes the whole `beforeJudgeAgent → judge → afterJudgeAgent` bracket under a run-wide mutex when `serial` (released in `finally`). Matches the README lifecycle and the "Environment ownership and judge concurrency" section.
- **DocT2 — `docs/index.html`.** The "never-touched" list now reads "scenarios and harness" (rubrics removed); "Judge live" / live-verification copy matches the project-configured-capabilities + project-owned-environment model. Accurate against `JudgeCapabilities` (`src/providers/types.ts:26`) and the env-hook timing.
- **DocT3 — `examples/skillsmith.config.ts`.** `paths` block drops `rubrics` (matches `src/config/defaults.ts:3-7` `DEFAULT_PATHS`); judge agent demonstrates `tools`/`mcpServers`/`allowWrite`/`network` (matches `AgentDefinitionInput` typed fields, `src/config/types.ts:59-71`); `judge: { agent, concurrency: 'serial' }` matches `SingleRoleInput` (line 109-111); the `beforeJudgeAgent`/`afterJudgeAgent` hooks receive `judgeWorkspace` (matches `AgentContext.judgeWorkspace`, line 268). The read-only default and the Codex `workspace-write`-when-live behavior in the comments match `src/providers/claude-code.ts:26,80-88` and `src/providers/codex.ts:35,84-96`.
- **DocT4 — `CONTRIBUTING.md`.** Confirmed unchanged in the diff and genuinely clean: no `scenario.yaml`, rubric, acceptance-field, `e2e.spec`, Playwright, or duplicate-`scenario.name` terminology. The single `Scenario`-type mention (line 104) is a generic illustrative changeset example that remains accurate — `Scenario` is still an exported public type and `Hooks.afterScenario` still carries a `Scenario`. The no-op was the correct call.
- **DocT5 — `testing-project/eval/prompts/improver.md`.** The prose now frames the judge's verdict/notes as the signal and "each a testing-agent brief and a judge brief" as the scenario model; the old "e2e results" and "scenarios and rubrics" phrasings are gone. Consistent with `testing-project/skillsmith.config.ts` (judge `tools: ['Read','Bash']` + Playwright MCP, `concurrency: 'serial'`, `beforeJudgeAgent`/`afterJudgeAgent` env hooks).

## Issues

### Issue 1: README embeds a workflow diagram that depicts the removed old model

**Task:** DocT1: Rewrite the README to the two-file scenario + live-judge model

**What's wrong:** The README still embeds the `skill-tester-workflow.png` diagram, which visually renders the old model and now contradicts the rewritten prose around it. Specifically, the diagram's nodes state:

- **TESTING AGENT** node: "Recieves **`scenario.prompt`**, `scenario.skills`, `agentWorkspace`." — `scenario.prompt` is a removed field (the shipped `Scenario` is `{ name, skills, testingBrief, judgeBrief }`), and README step 3 (line 90 in the new text) was explicitly rewritten to say the testing agent "Receives the verbatim `testingBrief`". The diagram directly contradicts the prose beside it.
- **JUDGE AGENT** node: "Recieves `scenario`, **the rubrics it references**, `agentWorkspace`." — rubrics are removed entirely; the judge receives the verbatim `judgeBrief` and runs against the copied `judge-workspace`. This presents a removed old-model concept (rubrics) as the current contract, which DocT1's acceptance explicitly forbids.
- Judge output node reads **`judge-review.yaml`** — the shipped verdict is `{ pass, notes }` JSON persisted under `review` (see `src/pipeline/judge-agent.ts:154-164`); there is no `judge-review.yaml`.
- The diagram shows no workspace-copy step and none of the `beforeJudgeAgent`/`afterJudgeAgent` env-ownership framing the new lifecycle centers on.

A README reader encounters this diagram immediately above the rewritten Lifecycle section, so it actively misinforms on the most load-bearing docs surface. This falls inside DocT1's file scope (`README.md`) and trips its acceptance criterion: "no remaining README text references `scenario.yaml`, rubrics, an `acceptance`/`prompt`/`description` scenario field, `Paths.rubrics`, `e2e.spec.mjs`, or Playwright as part of the model." The companion `self-improvement-loop.png` (line 151) was reviewed and is **fine** — it depicts only the hook lifecycle and the retained generic `afterAllScenarios` gate, with no removed concept presented as current; it does not need changing.

**Where:** `README.md:89` (the `![Skill Tester workflow diagram](assets/skill-tester-workflow.png)` embed), rendering `assets/skill-tester-workflow.png`.

**Expected:** Resolve the stale embed within DocT1's file scope. Regenerating the PNG art is out of scope (no diagram source ships, and image-asset authoring is not a docs-task file), so the fix is a README edit — for example, remove the embed, or replace it with a brief accurate textual/Mermaid depiction of the new lifecycle, or (at minimum) caption it explicitly as illustrating an earlier model and not the current contract. The README must not present `scenario.prompt`, "the rubrics it references", or `judge-review.yaml` as the shipped model. (If the owner decides a stale-but-captioned diagram is acceptable, that is a deliberate disposition to record — but as shipped, the uncaptioned embed contradicts the rewritten prose and must change.)

## Tasks to re-dispatch

- **DocT1** (only). DocT2–DocT5 are approved as-is and must not be re-touched.
