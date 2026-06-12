# Spec research — Adopt Radical Pipelines guardrails (#43)

Running record of the spec-analyst ↔ spec-researcher Q&A that turns the
intent (`0-intent/intent.md`) into clear, testable requirements. The
spec-writer consumes this to produce `spec.md`.

## Intent in one paragraph

Declare a **Guardrails** table in `.rp.md` so the pipeline's code and docs
phases run a fixed set of deterministic, exit-code gates that the project
owns — rather than letting agents pick verification commands ad hoc. The
headline gate is `config-smoke`, which loads `testing-project`'s config and
its full import graph without spawning agents; it must catch the
issue-37-style regression (a broken config load that passed typecheck, lint,
and unit tests) while staying green on trunk. Out of scope: changing the
Radical Pipelines plugin, running a full `skillsmith` eval in any gate, and
fixing the issue-37 circular import itself.

## Proposed guardrails table (from intent, to be validated/refined)

| Name             | Command                                         | Phase      |
| ---------------- | ----------------------------------------------- | ---------- |
| typecheck        | `npm run typecheck`                             | code       |
| lint             | `npm run lint`                                  | code       |
| tests            | `npm test`                                      | code       |
| config-smoke     | `npm --prefix testing-project run check:config` | code       |
| changeset-format | `npx tsx scripts/validate-changesets.ts`        | code, docs |
| changeset-status | `npx changeset status --since=origin/trunk`     | docs       |

## Open questions

- **Q1** — Does `config-smoke` work as claimed: fail on the issue-37 bug,
  green on trunk after the dep-key fix? Full set of `skillsmith` /
  `@automattic/skillsmith` import specifiers in the config-smoke graph.
- **Q2** — Are typecheck / lint / tests green on a freshly bootstrapped trunk
  worktree? Scope and right remedy for the known `validate-changesets.test.ts`
  failures.
- **Q3** — Exact behavior of `changeset-format` and `changeset-status`; why
  format is code+docs and status is docs-only; behavior with/without
  changesets present.
- **Q4** — The Guardrails declaration format in Radical Pipelines 0.3.0:
  table shape/columns, phase tags, where in `.rp.md` it lives, how the four
  mandated agents consume it.
- **Q5** — Worktree bootstrap: confirm `npm ci` (root) + `npm ci --prefix
  testing-project` expectation; how command-not-found (bootstrap omission) is
  distinguished from a real gate failure, and whose responsibility each is.
- **Q6** — Acceptance criteria, including how we prove `config-smoke` fails on
  the `37-skip-misconfigured-agents-v3` branch and passes on trunk.

## Findings

### F4 — Guardrails declaration format and agent-consumption contract (Q4) — RESOLVED (analyst, from RP 0.3.0 plugin)

Sources: installed plugin `~/.claude/plugins/cache/automattic/radical-pipelines/0.3.0`
— `README.md:147,159`, `skills/.../conventions/load.md:22-46`,
`skills/.../conventions/setup.md:171-204`, `agents/code-writer.md:13,44-55,72`,
`agents/code-reviewer.md:18,32,97-102`, and a worked example table at
`radical-pipelines/.claude/worktrees/51-guardrails-convention-v2/.rp.md:104-114`.

**Declaration format.** Guardrails are an optional convention in the *shared*
section of `.rp.md` (not the per-tool section), under a `### Guardrails`
heading, expressed as a three-column markdown table:

```
### Guardrails

<one-line description of what the gates are>

| Name | Command | Phase |
| ---- | ------- | ----- |
| ...  | ...     | code  |
```

- **Name**: short label (e.g. `tests`, `lint`).
- **Command**: the exact literal command, judged pass/fail *solely by exit
  code* (0 = pass, any non-zero = fail). "Run the tests" is not a guardrail;
  `npm test` is.
- **Phase**: the only valid targets are `code`, `docs`, or both (`code, docs`).
- An absent/empty Guardrails declaration is a valid, complete state — never a
  blocker, never a warning.
- Guardrails is committed-only: it is never taken from `.rp.local.md`
  (`load.md:46`).

**Run-time contract — how the four mandated agents consume it.** code-writer
(step 5, `code-writer.md:44-55`) and code-reviewer (`code-reviewer.md:32,97-102`)
select the guardrails whose phase includes the current phase and run **every**
one, exactly as written, no invented or omitted commands, no bypass
(`--no-verify`/skip/comment-out). Two questions sort every result:

1. **Did the command execute?**
   - **A declared guardrail's command cannot execute** (missing binary,
     renamed script, unresolved) ⇒ **BLOCKER**. The agent stops and reports per
     the blocker protocol. This is the "drift guard," and it is the crux for
     this pipeline: a gate that is declared but un-runnable halts the pipeline.
   - **No guardrails apply (empty selection)** ⇒ run none and proceed; not a
     blocker, no warning.
2. **Did the gate pass (exit 0)?**
   - **Runs and exits non-zero** ⇒ normal work, *not* a blocker. code-writer
     fixes the underlying issue before committing; code-reviewer records it in
     the Checks table and rejects the batch.

doc-writer/doc-reviewer consume the `docs`-tagged guardrails by the same model.

**Implication for the spec (sharp version).** For the pipeline to run green on
a freshly bootstrapped trunk worktree, every *declared* gate must satisfy BOTH:
(a) be runnable in the worktree (else it blocks the pipeline), and (b) exit 0
(else code-writer must "fix work" / code-reviewer rejects). So the acceptance
bar "all code-phase guardrails exit 0 on a freshly bootstrapped trunk worktree"
is exactly the right bar — and it presupposes the worktree is bootstrapped
(see F5/Q5), because an un-bootstrapped `npm`/`npx` gate fails the *execute*
test (blocker), not the *pass* test.

**Setup-time vs run-time pass bar (important nuance for whoever authors the
table).** At *setup/validation* time (when `.rp.md` is authored), the bar is
"**did it execute**," NOT "exit 0": a command that runs and exits non-zero is
still written as a valid guardrail (today's red state). Only an *unrunnable*
command (command-not-found) is withheld. At *run time*, agents additionally
require exit 0. This pipeline's intent goes further than the minimum: it wants
every code gate green *from the start* on trunk, so the spec should require
exit 0 on trunk, not merely "executes."

### F5 — Worktree bootstrap distinction (Q5) — PARTIALLY RESOLVED (analyst)

The "cannot execute ⇒ blocker" rule (F4) is exactly why bootstrap matters: a
fresh `EnterWorktree` checkout has no `node_modules`, so `npm run …` / `npx …`
gates would hit command-not-found and **block** the pipeline — a bootstrap
omission, not a guardrail defect. The intent's mitigation (orchestrator runs
`npm ci` + `npm ci --prefix testing-project` before any agent/guardrail runs)
aligns with the contract. Open sub-question for the researcher: confirm the
orchestrator is the right owner of this bootstrap and whether anything in the
RP 0.3.0 setup/worktree conventions already covers it, or whether this repo's
`.rp.md` / docs must state it (since the constraint forbids changing the
plugin). Tracked in Q5 below.

### F2 — code-phase gate state on a bootstrapped trunk worktree (Q2) — STRONG EVIDENCE (analyst, ran in this worktree)

This worktree is already bootstrapped (`node_modules` present in root and
`testing-project/`, per team-lead's `npm ci`). Ran each proposed code gate from
the repo root on trunk (HEAD = `origin/trunk` = `7ffa5cd`):

| Gate             | Command                                          | Exit | Notes |
| ---------------- | ------------------------------------------------ | ---- | ----- |
| typecheck        | `npm run typecheck`                              | 0    | clean |
| lint             | `npm run lint`                                   | 0    | clean |
| tests            | `npm test`                                       | 0    | 149 tests: 147 pass, 0 fail, **2 skipped** |
| changeset-format | `npx tsx scripts/validate-changesets.ts`         | 0    | one changeset present (`initial-scaffolding.md`); validator passes |
| changeset-status | `npx changeset status --since=origin/trunk`      | 0    | "NO packages to be bumped" (HEAD == origin/trunk, so no *new* changesets in the diff) |

**INTENT CORRECTION (load-bearing).** intent.md:42 assumes `npm test` has "two
pre-existing `validate-changesets.test.ts` CLI smoke failures
(`ERR_MODULE_NOT_FOUND` for `tsx`)" that may need fixing/skipping before the
`tests` gate can be green. **This is stale.** On current trunk:

- The two `validate-changesets.test.ts` CLI smoke tests **pass** — `ok 127`
  (`B8 CLI smoke (failing)`) and `ok 128` (`B8 CLI smoke (passing)`). The
  `ERR_MODULE_NOT_FOUND` cwd-relative-`tsx` problem was already fixed: the test
  spawns `node --import <abs file:// URL of node_modules/tsx/dist/loader.mjs>`
  instead of the bare `tsx` specifier (`validate-changesets.test.ts:36-39,
  158-196`, with an explanatory comment at lines 22-39).
- The **2 skipped** tests are unrelated: `codex provider end-to-end (testing
  role)` and `(judge role)` (`smoke`/codex e2e, `# SKIP`), not changeset tests.

⇒ The `tests` gate is green on trunk **as-is**; no skip-with-reason or pre-fix
is required. The researcher should independently re-confirm `npm test` exit 0
and the identity of the 2 skips so the spec can drop the intent's prerequisite
about changeset-test failures.

### F3 — changeset gate semantics (Q3) — PARTIAL (analyst), needs researcher confirmation

- `changeset-format` (`npx tsx scripts/validate-changesets.ts`) is a *shape*
  validator over `.changeset/*.md` (front-matter fence, valid bump, known
  package name, non-empty body, pre-1.0 `major` forbidden — see the unit tests
  `validate-changesets.test.ts:66-156`). It passes when **no** changesets exist
  (the canonical empty case `B2`), which is why the intent tags it `code, docs`:
  safe on both phases. Confirmed exit 0 on trunk.
- `changeset-status` (`npx changeset status --since=origin/trunk`) reports which
  packages would be bumped relative to `origin/trunk`. **Open question for the
  researcher:** does this command *enforce changeset presence* (exit non-zero
  when the branch adds no changeset), or does it exit 0 regardless? On trunk it
  exits 0 with "NO packages to be bumped" because HEAD == origin/trunk (no diff).
  The intent's rationale ("docs-only because the changeset is authored by the
  doc-writer") presumes this gate *fails* when the doc-writer hasn't written a
  changeset — but `changeset status` historically exits 0 even with zero
  changesets, and only some configurations/flags make it fail. The researcher
  must determine the *actual* exit-code behavior of
  `npx changeset status --since=origin/trunk` on a branch that (a) has a new
  changeset, and (b) has none, so the spec can state precisely what this gate
  guarantees — or whether it's effectively a no-op and the real presence-check
  is something else. (Direct `.bin/changeset` invocation isn't available; the
  binary resolves only via `npx`/`@changesets/cli`.)

### F1b — config-smoke is import-only, no agents / no API keys / no wp-env (supports Q1 + the "full skillsmith run not a gate" constraint) — VERIFIED (analyst)

The proposed `config-smoke` command imports `testing-project/skillsmith.config.ts`,
whose default export is built by `defineConfig(...)`. `defineConfig`
(`src/config/define-config.ts:9-13`) is a **pure identity passthrough** — it
returns its input unchanged; the harness validates/normalizes only later at
*load* time (`src/config/load.ts`), which `config-smoke` does NOT invoke. So
importing the config:

- reads two prompt files via `readFileSync` (cheap, deterministic),
- pulls in the module graph of `@automattic/skillsmith` (= `src/index.ts`,
  which only re-exports functions/types like `run`, providers, `defineConfig`)
  plus `scaffold-plugin` and `verify-e2e`,
- executes **no** agent spawn, **no** wp-env boot, **no** network/API-key
  requirement at import time.

⇒ Confirms the intent's correctness claim for the gate and satisfies the
constraint that "a full `skillsmith` run must not be part of any gate." The
gate's value is precisely that it exercises the import/resolution graph (where
the issue-37 circular import lives) without the expensive nondeterministic run.

### F6 — proving config-smoke catches the issue-37 bug (Q6) — PARTIAL (analyst), needs researcher

The `37-skip-misconfigured-agents-v3` worktree exists at
`/Users/darerodz/Code/skillsmith/.claude/worktrees/37-skip-misconfigured-agents-v3`
(branch `worktree-37-skip-misconfigured-agents-v3`). Observed there:

- `testing-project/package.json` still has the **old** dep key
  `"skillsmith": "file:.."` (line 13) and `skillsmith.config.ts:4` imports
  `@automattic/skillsmith` — i.e. the v3 branch has the SAME dep-key mismatch as
  trunk, *plus* the circular import (`config.ts` ↔ `verify-e2e.ts`, intent.md:12).
- `verify-e2e.ts:11` imports the bare `skillsmith` (same as trunk).

**Subtlety the acceptance criterion must handle:** because the dep-key mismatch
exists on BOTH trunk and v3, a naive `import('./skillsmith.config.ts')` would
fail on v3 for the *dep-key* reason, not necessarily the *circular-import*
reason — so a v3 failure alone does not prove config-smoke catches the
*circular import* specifically. To make the acceptance demonstration meaningful,
the proof must show config-smoke fails on v3 **with the dep-key fix applied**
(isolating the circular import as the cause), and passes on trunk with the same
fix. The researcher should determine the exact failure signature config-smoke
produces against the issue-37 circular import (e.g. a `ReferenceError`/
`undefined` from the import cycle, or an unresolved export) so the spec's
acceptance criterion can cite a concrete, reproducible signal rather than "it
fails somehow." (The v3 design docs describe the pipeline broadly but do not
pin the circular-import mechanism; intent.md:12 is the authoritative statement.)

### F1a — full skillsmith import-specifier set under testing-project/ (Q1b) — VERIFIED (analyst), runtime-vs-typecheck nuance flagged for researcher

Exhaustive grep of `testing-project/` (excluding node_modules) for every
`skillsmith` / `@automattic/skillsmith` specifier yields exactly **two**:

| File:line | Specifier | Kind |
| --------- | --------- | ---- |
| `skillsmith.config.ts:4` | `@automattic/skillsmith` | **value** import (`defineConfig`) |
| `eval/utils/verify-e2e.ts:11` | `skillsmith` (bare/old name) | **type-only** import (`import type { RunScenario, VerificationFailure }`) |

No deep-subpath imports (`skillsmith/...`) exist. **Crucial nuance:** the
`verify-e2e.ts` specifier is `import type`, which `tsx`/esbuild **erases at
runtime** — so at `config-smoke` run time (`node --import tsx -e "await
import('./skillsmith.config.ts')"`) the bare `skillsmith` name is stripped and
never resolved; only `@automattic/skillsmith` (config.ts:4) must resolve. So:

- **Renaming the dep key `skillsmith` → `@automattic/skillsmith` is sufficient
  to make config-smoke import-resolve at runtime.** The mismatched bare type
  import in verify-e2e.ts does NOT break the runtime smoke.
- **BUT `typecheck` (`tsc --noEmit`) DOES resolve type-only imports.** After the
  rename, `verify-e2e.ts:11`'s bare `skillsmith` would no longer resolve to a
  declared dependency — so the `typecheck` gate could break unless
  `verify-e2e.ts:11` is ALSO updated to `@automattic/skillsmith` (or the package
  is made resolvable under both names). This is the second half of the
  prerequisite the spec must capture: rename the dep key **and** update the
  `verify-e2e.ts` specifier so both gates stay green. (Today `tsc` passes
  because the dep key is `skillsmith`, matching verify-e2e's import, while
  config.ts's `@automattic/skillsmith` import is... the open Q1(a) question for
  the researcher: how does typecheck currently resolve config.ts:4's
  `@automattic/skillsmith` when the dep is keyed `skillsmith`? Possibly via the
  `exports`/package self-reference or a node_modules symlink — researcher to
  confirm, because it determines whether trunk's `typecheck` truly passes today,
  which I observed as exit 0.)

**Net prerequisite for the spec (pending researcher confirmation of Q1a/c):**
to adopt config-smoke green-on-trunk AND keep typecheck green, the package must
be resolvable under `@automattic/skillsmith` from `testing-project/` for BOTH
the value import (config.ts) and the type import (verify-e2e.ts) — i.e. rename
the dep key, refresh the lockfile/`node_modules` link, and align verify-e2e's
specifier. The researcher's Q1(a)/(c) results will confirm the exact minimal
edit set and the observed exit codes before/after.

### F1 — config-smoke on trunk and v3 (Q1a/c + Q6) — CONFIRMED by researcher (empirical)

- **Q1(a) — config-smoke on current trunk:** `node --import tsx -e "await
  import('./skillsmith.config.ts')"` run in `testing-project/` → **exit 1**,
  `ERR_MODULE_NOT_FOUND` for `@automattic/skillsmith` (dep key is `skillsmith`).
  The headline gate is RED on trunk today purely from the dep-key mismatch.
- **Q1(c) — after the dep-key fix:** renaming the key to
  `@automattic/skillsmith` (+ lockfile) makes config-smoke import cleanly →
  **exit 0 on trunk**. A true, sufficient prerequisite for green-on-trunk.
- **`check:config` does not exist yet** in `testing-project/package.json` — the
  pipeline must ADD it; tested body
  `node --import tsx -e "await import('./skillsmith.config.ts')"`.
- **Gap it fills:** `src/__tests__/config-validate.test.ts` only unit-tests
  `collectConfigErrors`; it never loads the real import graph, so it cannot
  catch an import-cycle. config-smoke does.

**Q6 — config-smoke catches the issue-37 circular import (concrete signature).**
Against the v3 worktree (`@automattic/skillsmith` symlinked there so the import
resolves far enough to hit the bug), config-smoke → **exit 1** with:

```
TypeError: Cannot read properties of undefined (reading 'roles')
  at testing-project/eval/utils/verify-e2e.ts:24
     → const CONFIGURED_PROJECT_NAMES = config.roles.test.agents;
```

Mechanism (v3): `verify-e2e.ts:12` does `import config from
"../../skillsmith.config"`, and `skillsmith.config.ts:6` imports verify-e2e — a
module-eval cycle, so verify-e2e's top-level read of `config.roles` sees
`config === undefined` and throws. **On trunk the cycle is already gone** —
trunk's `verify-e2e.ts` has NO `import config` (only `import type` from
`skillsmith`) — which is why a dep-key-fixed trunk passes config-smoke.

**Acceptance nuance (decided input for the spec).** config-smoke exits non-zero
on v3 either way, for different reasons by dep-key state:
- dep key still broken → fails EARLY with `ERR_MODULE_NOT_FOUND` (never reaches
  the cycle);
- dep key fixed → fails at the cycle with the `TypeError` above.

So "config-smoke fails on v3" proves it catches the *circular import
specifically* only when the dep key resolves. Spec should pick:
- **(weaker)** config-smoke exits non-zero on v3 as-is (rejects the broken
  state; conflates dep-key + cycle); or
- **(stronger, recommended)** with the dep-key fix applied on v3, config-smoke
  exits non-zero **with the `roles`-on-undefined `TypeError`** (isolates the
  cycle) AND exits 0 on a dep-key-fixed trunk.

The stronger form actually demonstrates the gate catches the issue-37
regression class, not merely the dep-key prerequisite.

### F1c — typecheck vs runtime resolution divergence (Q1a follow-up)

Trunk `typecheck` is exit 0 even though config.ts:4 imports
`@automattic/skillsmith` while the dep key is `skillsmith`, yet the **runtime**
import fails with `ERR_MODULE_NOT_FOUND`. So `tsc` resolves the type side
differently from Node's ESM runtime (package self-reference / `exports`, or
`node_modules/@automattic/skillsmith` symlink state — exact path is a
design-phase detail). This divergence is *why* config-smoke (runtime import)
catches what typecheck (type resolution) misses — a useful framing for the
design doc. For the spec it suffices that the runtime import is the gate that
fails on the bug. The `verify-e2e.ts:11` bare `skillsmith` type import is erased
at config-smoke runtime (F1a) but IS resolved by `tsc`; whether the dep-key
rename requires also aligning that specifier to keep `typecheck` green is the
prerequisite-completeness question the design/plan must settle (it did not break
typecheck on trunk only because the key currently matches verify-e2e's name).
