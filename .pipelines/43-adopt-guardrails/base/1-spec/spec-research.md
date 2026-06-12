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

### F5 — Worktree bootstrap distinction and ownership (Q5) — RESOLVED (analyst, from RP 0.3.0 plugin + this repo's docs)

The "cannot execute ⇒ blocker" rule (F4) is exactly why bootstrap matters: a
fresh `EnterWorktree` checkout has no `node_modules`, so every proposed gate
(all `npm run …` / `npx …`) would hit command-not-found and **block** the
pipeline — a bootstrap omission, not a guardrail defect.

**The plugin does NOT bootstrap, and this repo doesn't document it.** Verified:

- `EnterWorktree` is described only in
  `conventions/claude-code.md:14-15,20,23` — it "creates the worktree and
  enters it"; it says **nothing** about installing dependencies. There is **no**
  `npm ci` / `npm install` / `node_modules` step anywhere in the RP 0.3.0 skill
  references (`autonomous-workflow.md`, `autonomous-phases/4 - code.md`, etc.) —
  grep across `skills/` finds zero such steps tied to worktree entry.
- This repo's own docs likewise document no bootstrap: grep of `.rp.md`,
  `AGENTS.md`, `CONTRIBUTING.md` finds no worktree `npm ci`/install step (the
  CONTRIBUTING.md hits are about package consumers and an unrelated CI step).
  `.rp.md` has no Claude Code "Setup actions" section.

⇒ Because the constraint forbids changing the plugin, **bootstrap is a
project-owned responsibility the spec must require**: after `EnterWorktree` and
before launching any phase agent or running any guardrail, the orchestrator must
run `npm ci` (root) **and** `npm ci --prefix testing-project` (the
`testing-project/` workspace, which has its own `node_modules` — confirmed
present in this bootstrapped worktree). The intent's mitigation (intent.md:39)
is correct and necessary.

**The drift guard still does its job.** Note the bootstrap requirement does NOT
weaken the guardrail contract: if the orchestrator forgets to bootstrap, the
gates fail the *execute* test → the agent reports a BLOCKER (F4), surfacing the
omission loudly rather than silently passing. So "command-not-found in an
un-bootstrapped worktree is a bootstrap omission, not a guardrail blocker"
(intent.md:39) is about *diagnosis/ownership* (whose bug it is), not about
suppressing the blocker — the agent still correctly blocks; the fix is to
bootstrap, not to touch the guardrail.

**Spec implication.** The spec must (a) require the project to declare the
guardrails in `.rp.md`, and (b) require the orchestrator/run procedure to
bootstrap both npm workspaces before any gate runs — ideally captured durably
(e.g. in `.rp.md` and/or `AGENTS.md`) so every future run does it, not just this
one. Whether that durable home is `.rp.md` prose, a documented run step, or a
helper script is a design/plan decision; the spec's requirement is that the
bootstrap is owned and performed before gates, given the plugin won't do it.

### F7 — "bootstrapped" must mean a COMPLETE `npm ci`; partial node_modules is a real, observed failure mode (analyst)

Concrete evidence that reinforces F5: when first inspected, this worktree's
`node_modules` was **missing the entire `@changesets/*` subtree** (19 packages
the lockfile expects, including `@changesets/cli`) and had **no `changeset`
binary in `node_modules/.bin`** — even though the team-lead reported `npm ci`
had been run. In that partial state `npx changeset status` only "worked" by
npx's network fetch-on-miss, which is nondeterministic and offline-fragile — NOT
acceptable for a deterministic gate.

Running a fresh `npm ci` from the repo root fixed it (exit 0, "added 222
packages"): afterward `node_modules/@changesets/` has all 19 packages,
`node_modules/.bin/changeset` exists, and `npx changeset status
--since=origin/trunk` resolves the **local** binary and exits 0. So:

- This was a **stale/partial node_modules**, not a dep-key consequence — a clean
  `npm ci` installs everything; the changeset binary is local after bootstrap
  (no network dependency at run time).
- **Lesson for the spec:** "bootstrapped" must mean a *complete, clean* `npm ci`
  (and `npm ci --prefix testing-project`), not merely "node_modules exists." A
  partial tree makes `npx`-based gates either fail-to-execute (BLOCKER, correctly
  caught by the drift guard) or silently fall back to a network fetch. The spec
  should require the bootstrap be a full `npm ci` of both workspaces, and the
  acceptance check should run the gates from a *freshly and fully* installed
  worktree.
- **Determinism note for the design:** prefer the locally-installed binary
  (`node_modules/.bin/changeset`, present after `npm ci`) over relying on `npx`'s
  fetch behavior. `npx changeset` resolves the local bin when present, so the
  intent's command is fine **post-bootstrap** — the design/plan should just
  ensure the bin is installed (it is, after a complete `npm ci`) so `npx` never
  reaches the network. (Note the worktree was left with a complete install after
  this check; git working tree remains clean — node_modules is gitignored.)

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

### F1d — precise prerequisite edit set + third specifier correction (Q1, researcher-confirmed)

**Third specifier (correction to F1a's "exactly two").** The researcher found a
third skillsmith-related import I missed because it's a *relative* path, not a
package specifier: `testing-project/playwright.config.ts:4` →
`import config from "./skillsmith.config"`. It resolves regardless of the dep
key and is **not** in the config-smoke import graph (playwright.config isn't
loaded by `import('./skillsmith.config.ts')`), so it's inert for this work. Full
set: two package specifiers (config.ts `@automattic/skillsmith` value import;
verify-e2e.ts bare `skillsmith` type-only import) + one relative import
(playwright.config). No tsconfig `paths` aliases exist in
`testing-project/tsconfig.json` or the root tsconfig — resolution is pure
node_modules, no TS path trickery.

**Why the dep-key rename works (mechanism, researcher-confirmed).** The root
package's `name` IS `@automattic/skillsmith`, so a dep entry
`"@automattic/skillsmith": "file:.."` resolves to the repo root and `npm
install` links `node_modules/@automattic/skillsmith -> ../..`. The researcher
simulated exactly this state (created the scoped symlink, ran config-smoke →
exit 0, then removed it; git tree left clean) and confirmed the value import
then resolves.

**Precise prerequisite edits the spec must require (researcher-confirmed):**
1. `testing-project/package.json`: rename dependency key
   `"skillsmith": "file:.."` → `"@automattic/skillsmith": "file:.."`.
2. Run `npm install` in `testing-project/` to update
   `testing-project/package-lock.json` (re-key to `@automattic/skillsmith`,
   link the scoped symlink) — the lockfile is part of the change, not just
   `package.json`.
3. Add to `testing-project/package.json` scripts:
   `"check:config": "node --import tsx -e \"await import('./skillsmith.config.ts')\""`
   (absent today).

After these, `config-smoke` = `npm --prefix testing-project run check:config`
exits 0 on trunk. The dep-key rename **alone** suffices for config-smoke runtime
(verify-e2e's bare `skillsmith` is type-erased by tsx, never resolved at run
time — confirmed empirically: `import type` from a nonexistent package loads
exit 0 under `node --import tsx`).

**STILL-OPEN sub-item (typecheck after the rename) — delegated to researcher.**
The one unverified path: after renaming the dep key to `@automattic/skillsmith`,
does `tsc --noEmit` (the `typecheck` gate) still resolve `verify-e2e.ts:11`'s
bare `skillsmith` type-only import, or does it then fail (forcing the
prerequisite to ALSO update verify-e2e.ts to the scoped name)? `tsc` resolves
type-only imports (unlike tsx). This determines whether the prerequisite edit
set is 3 items or 4. Researcher is running this check now; result will finalize
the edit set. Until then the spec should state the edit set as "at minimum the 3
edits above, plus aligning `verify-e2e.ts:11` to `@automattic/skillsmith` if the
typecheck gate requires it (pending verification)."

### F1e — prerequisite is firmly 3 edits; typecheck stays green; lockfile-drift note (Q1 CLOSED, researcher did the real edit)

The researcher performed the **real** edit (not a symlink simulation) and
restored the worktree pristine afterward (`git checkout HEAD --
testing-project/package.json testing-project/package-lock.json`, removed the
stray `@automattic` dir, re-confirmed config-smoke back to exit 1, `git status`
shows only the spec artifact folder). Results:

- **config-smoke green after the rename: confirmed for real.** Edited the dep
  key → `npm install` (exit 0) → config-smoke `node --import tsx -e "await
  import('./skillsmith.config.ts')"` → **exit 0, clean**.
- **`npm install` REPLACES the symlink:** it links
  `node_modules/@automattic/skillsmith -> ../../..` and **removes** the old bare
  `node_modules/skillsmith` symlink (not kept alongside). So after the rename
  the bare `skillsmith` specifier has no node_modules target.
- **Typecheck stays green — the decisive subtlety.** `tsc --noEmit` run *inside*
  `testing-project/` fails after the rename: `verify-e2e.ts(11,55): error TS2307:
  Cannot find module 'skillsmith'`. BUT the **declared** `typecheck` gate is
  `npm run typecheck` = `tsc --noEmit` from the **repo root**, and the root
  `tsconfig.json` `include` is only `["src/**/*", "skillsmith.config.ts",
  "examples/**/*"]` with `exclude: ["node_modules", "dist"]` — it **does not
  compile `testing-project/`**. So `npm run typecheck` after the rename →
  **exit 0**. The bare-`skillsmith` inconsistency is invisible to ALL declared
  gates (config-smoke type-erases it at runtime; root typecheck never compiles
  testing-project). It would only surface if someone ran `tsc` inside
  testing-project, which is not a declared guardrail.

⇒ **The prerequisite is firmly the 3 edits** (rename + `npm install` +
`check:config`). Changing `verify-e2e.ts:11` to `@automattic/skillsmith` is
**OPTIONAL cleanup** — recommended for consistency (removes a latent TS2307 for
anyone running `tsc` inside testing-project), but **not required by any declared
gate**. The spec can mandate it or merely note it.

- **Lockfile-drift heads-up (pre-existing, not caused by this work).** The
  committed `testing-project/package-lock.json` is already stale vs the current
  root `package.json`: it records the mirrored root `zod ^3.25.76` (root now
  `^4.0.0`), and is missing the `@changesets/changelog-github` +
  `@changesets/cli` devDeps and the root `name` field. So the prerequisite `npm
  install` will pick up these drifted entries in the same lockfile update,
  making the PR's lockfile diff larger than just the dep-key rename. The spec
  should note this so the diff doesn't look like scope creep.

---

## Synthesis for the spec-writer — testable requirements

Derived from the findings above. Two data points are still pending from the
researcher and are marked **[PENDING]**; everything else is verified.

### Requirements

**R1 — Declare a Guardrails convention in `.rp.md`.** Add a `### Guardrails`
subsection to the shared section of this repo's `.rp.md` (committed; never in
`.rp.local.md`), as a three-column `| Name | Command | Phase |` markdown table.
Each command is judged pass/fail solely by exit code; the only valid Phase
values are `code`, `docs`, or `code, docs`. (Format per F4.)

**R2 — The declared gates.** Declare exactly these, validated as runnable and
green on a freshly + fully bootstrapped trunk worktree (F2):

| Name             | Command                                          | Phase      |
| ---------------- | ------------------------------------------------ | ---------- |
| typecheck        | `npm run typecheck`                              | code       |
| lint             | `npm run lint`                                   | code       |
| tests            | `npm test`                                       | code       |
| config-smoke     | `npm --prefix testing-project run check:config`  | code       |
| changeset-format | `npx tsx scripts/validate-changesets.ts`         | code, docs |
| changeset-status | `npx changeset status --since=origin/trunk`      | docs       |

(The Name column may be capitalized/styled to match the repo's house format;
the Command and Phase columns are load-bearing. `changeset-status`'s
docs-only justification is **[PENDING F3]** — see R6.)

**R3 — Dependency-key prerequisite (config-smoke enabler).** Make
`@automattic/skillsmith` resolvable from `testing-project/` so config-smoke
imports cleanly. **Firmly 3 required edits** (verified by a real edit, F1, F1d,
F1e):
1. `testing-project/package.json`: rename dep key `"skillsmith": "file:.."` →
   `"@automattic/skillsmith": "file:.."`.
2. Update `testing-project/package-lock.json` via `npm install` in
   `testing-project/` (re-keys to `@automattic/skillsmith`; npm replaces the bare
   `node_modules/skillsmith` symlink with the scoped one). **Note:** this same
   `npm install` will also absorb pre-existing lockfile drift (root `zod`
   `^3.25.76`→`^4.0.0`, missing changesets devDeps, missing root `name`), so the
   PR's lockfile diff is larger than the rename alone — not scope creep (F1e).
3. Add the `check:config` script (R4).

These three make config-smoke green-on-trunk AND keep the declared `typecheck`
gate green (the root tsconfig does not compile `testing-project/`, so the
post-rename TS2307 on `verify-e2e.ts:11` is invisible to `npm run typecheck`).

**Optional cleanup (recommended, not required):** change
`testing-project/eval/utils/verify-e2e.ts:11`'s `import type … from "skillsmith"`
→ `"@automattic/skillsmith"` for consistency — it removes a latent TS2307 for
anyone running `tsc` inside testing-project, but no declared gate requires it.

**R4 — Add the `check:config` script.** Add to `testing-project/package.json`
scripts: `"check:config": "node --import tsx -e \"await
import('./skillsmith.config.ts')\""`. It must import the config (and its full
graph) with no agent spawn, no wp-env, no API key, no network (F1b) — satisfying
the constraint that no full `skillsmith` run is part of any gate.

**R5 — Worktree bootstrap is project-owned and must run before any gate.** Since
the RP plugin does not install dependencies on `EnterWorktree` and the
constraint forbids changing the plugin, this repo must own the bootstrap: a
complete `npm ci` (root) **and** `npm ci --prefix testing-project` after entering
a fresh worktree and before launching any phase agent or running any guardrail.
"Bootstrapped" means a *complete* install, not merely "node_modules exists"
(F5, F7). Capture this durably (e.g. `.rp.md` / `AGENTS.md` / a run step) so
every future run does it. (A missing/partial install makes gates fail the
*execute* test → BLOCKER, which is the correct loud signal, not a silent pass.)

**R6 — State what each gate guarantees (no over-claiming).** The spec must
describe each gate's guarantee accurately. In particular: `changeset-format`
validates changeset *shape* and passes when no changesets exist (F3,
`validate-changesets.test.ts` B2); whether `changeset-status` enforces changeset
*presence* or is effectively a no-op on this repo's config is **[PENDING F3]** —
the spec must reflect the verified behavior, not the assumed one, and the
design phase may revisit the gate's invocation if it doesn't do what its
rationale claims.

**Out of scope (from intent, reaffirmed):** changing the RP plugin; including a
full `skillsmith` run in any gate; fixing the issue-37 circular import itself
(that's the issue-37 pipeline). Note the intent's assumption of pre-existing
`validate-changesets.test.ts` failures is **stale** — do NOT add a skip/fix for
it; the `tests` gate is already green (F2).

### Acceptance criteria

**AC1 — Each declared command executes** in the main checkout (the setup-time
"did it execute?" bar, F4).

**AC2 — All `code`-phase guardrails exit 0 on a freshly + fully bootstrapped
trunk worktree** (typecheck, lint, tests, config-smoke, changeset-format).
Verified today for all but config-smoke as-is; config-smoke reaches exit 0 only
after R3 (F1, F2).

**AC3 — config-smoke catches the issue-37 regression class.** Recommended
(stronger) form: with the dep-key fix applied on the
`37-skip-misconfigured-agents-v3` branch, config-smoke exits non-zero **with the
`TypeError: Cannot read properties of undefined (reading 'roles')` at
`verify-e2e.ts:24`** (the circular import), AND exits 0 on a dep-key-fixed trunk.
Weaker fallback: config-smoke exits non-zero on v3 as-is (conflates dep-key +
cycle). Spec should adopt the stronger form (F1, F6).

**AC4 — `docs`-phase guardrails behave as specified** (changeset-format +
changeset-status). Exact assertion for changeset-status is **[PENDING F3]**.

**AC5 — Bootstrap precedes gates.** The run procedure performs the complete
`npm ci` of both workspaces before any guardrail runs; a deliberately
un-bootstrapped worktree makes the `npm`/`npx` gates report a BLOCKER (cannot
execute), confirming the drift guard (F5, F7).
