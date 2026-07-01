/**
 * Reference `skillsmith.config.ts` showing every provider and option.
 *
 * Copy the parts you need into your project's `skillsmith.config.ts`.
 * The minimal config (see README) is much shorter — this file exists to
 * document the surface area.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@automattic/skillsmith';

const here = dirname( fileURLToPath( import.meta.url ) );

// Prompts can be inlined as strings or loaded from files. Loading from
// disk keeps the config readable and lets you version the prompts on
// their own.
const testingAgentPrompt = readFileSync(
	resolve( here, 'prompts/testing-agent.md' ),
	'utf8'
);
// The judge prompt is the project's reusable "environment manual" — see
// `roles.judge` below for what belongs in it.
const judgePrompt = readFileSync(
	resolve( here, 'prompts/judge.md' ),
	'utf8'
);
const improverPrompt = readFileSync(
	resolve( here, 'prompts/improver.md' ),
	'utf8'
);

export default defineConfig( {
	// Default run mode. CLI flag `--mode test-only|self-improvement`
	// overrides this for a single invocation.
	//   - "test-only" (default): one iteration, no improver.
	//   - "self-improvement": loop up to `selfImprovement.maxIterations`,
	//     letting `roles.improver` edit failing skills between iterations.
	mode: 'test-only',

	// Roster of every agent the run can use. Keyed by a stable id —
	// the key appears in directory names and reports. Each entry takes
	// `provider` and `model`; extra keys (e.g. `effort`) flow through
	// to the provider that interprets them.
	agents: {
		// Anthropic via Claude Code CLI. Authenticates with your Claude Code
		// subscription (interactive `/login`, or `CLAUDE_CODE_OAUTH_TOKEN` in
		// headless/CI). It uses the subscription even when a pay-as-you-go
		// Anthropic credential is also exported — that credential is ignored
		// here, so it stays billed to `anthropic-api` below, not to this agent.
		'cc-haiku': {
			provider: 'claude-code',
			model: 'claude-haiku-4-5',
		},
		'cc-opus': {
			provider: 'claude-code',
			model: 'claude-opus-4-7',
		},

		// Anthropic via the public API (uses ANTHROPIC_API_KEY).
		'anthropic-sonnet': {
			provider: 'anthropic-api',
			model: 'claude-sonnet-4-6',
		},

		// OpenAI via the public API (uses OPENAI_API_KEY).
		'openai-nano': {
			provider: 'openai-api',
			model: 'gpt-5.4-nano',
		},

		// OpenAI via the Codex SDK. Supports `effort: "low"|"medium"|
		// "high"|"xhigh"` to set reasoning effort on the model call.
		'codex-mini': {
			provider: 'codex',
			model: 'gpt-5.4-mini',
		},

		// The judge agent verifies each artifact against the scenario's
		// JUDGE.md brief — live, against the environment the project stands
		// up (see `hooks` below), not by reading files alone. It carries its
		// own capabilities, declared right here on the agent definition.
		// Absent these keys the judge defaults to read-only file access; set
		// them to widen what it may do while grading:
		//   - `tools`      — built-in tools it may use (e.g. `Bash` to curl a
		//                    page or run a CLI as part of verification).
		//   - `mcpServers` — MCP servers it can call (e.g. to drive a browser
		//                    or query a database).
		//   - `allowWrite` — whether it may write to its workspace
		//                    (default false; the judge grades a throwaway copy
		//                    of the artifact, so it can never alter the real
		//                    one regardless of this knob).
		//   - `network`    — whether it may reach the network.
		// These are generic knobs: Skillsmith core assumes no WordPress or
		// browser toolset. Any project-specific vocabulary (which MCP server,
		// which CLI) lives here in the project's config, never in core.
		'codex-judge': {
			provider: 'codex',
			model: 'gpt-5.5',
			effort: 'xhigh',
			tools: [ 'Read', 'Bash' ],
			mcpServers: {
				playwright: {
					command: 'npx',
					args: [ '@playwright/mcp@latest' ],
				},
			},
			allowWrite: false,
			network: false,
		},

		// Google Gemini via the public API (uses GEMINI_API_KEY).
		'gemini-flash': {
			provider: 'gemini-api',
			model: 'gemini-2.5-flash',
		},
	},

	// Role assignments. Every role references an agent id from `agents`
	// above. Reusing the same agent across roles is fine.
	roles: {
		// Testing role takes an array of agents — the harness fans every
		// scenario out across all of them. `prompt` is appended to the
		// harness-built system prompt as a `# Role instructions` section,
		// so it augments (does not replace) the skill blob, workspace
		// dump, write constraint, and recursion guard.
		test: {
			agents: [
				'cc-haiku',
				'cc-opus',
				'anthropic-sonnet',
				'gemini-flash',
			],
			prompt: testingAgentPrompt,
		},

		// The judge grades each artifact against the scenario's JUDGE.md
		// brief, verifying behavior on the live environment the project
		// stood up. The object form lets you pin a project-specific prompt
		// and set `concurrency`:
		//   - `prompt` — a reusable "environment manual" the judge memorizes
		//     for every scenario. Keep the per-scenario `JUDGE.md` briefs
		//     short and behavior-focused (what to exercise and what counts
		//     as correct); put the shared runtime mechanics here once: how
		//     to reach the live environment the `hooks` stood up (a CLI
		//     bridge, a base URL, the env vars the hooks export), how to
		//     discover what the test agent produced (e.g. read a manifest
		//     file rather than assume a fixed name), and how to drive the
		//     environment to exercise it. Like `test`, this prompt is
		//     appended to the harness-built judge prompt — it augments, not
		//     replaces. This is also where project-specific command strings
		//     live (the exact CLI invocations, URL shapes, and file globs
		//     for your stack), keeping that vocabulary out of Skillsmith
		//     core and out of the per-scenario briefs.
		//   - `concurrency`:
		//     - "parallel" (default) — every (scenario, agent) pair may grade
		//       at once.
		//     - "serial" — a run-wide lock serializes the whole judge bracket
		//       (beforeJudgeAgent → judge → afterJudgeAgent), so no two pairs
		//       stand up / grade / tear down at the same time. Use it when
		//       each grade shares a single non-reentrant environment (e.g. one
		//       server on a fixed port). The testing phase stays fully
		//       parallel either way.
		judge: {
			agent: 'codex-judge',
			prompt: judgePrompt,
			concurrency: 'serial',
		},

		// Single-agent roles also accept a string shorthand. For `improver`,
		// the prompt REPLACES the built-in instructions entirely (different
		// from `test`/`judge`, which augment).
		improver: { agent: 'cc-opus', prompt: improverPrompt },
	},

	// Project layout. Every entry is a directory the harness scans;
	// `base` is where it writes run artifacts. Each scenario under
	// `scenarios` is a directory holding a `TESTING-AGENT.md` (the brief
	// handed to the test agents, including a `# Skills` section) and a
	// `JUDGE.md` (the brief handed to the judge).
	paths: {
		base: './.skillsmith',
		skills: './skills',
		scenarios: './eval/scenarios',

		// Optional. Point this at a directory of reusable rubric files
		// (`<id>.md` each) to share grading criteria across scenarios
		// instead of re-pasting them into every `JUDGE.md`. A scenario
		// opts in by naming the rubric in plain-language prose in its
		// `JUDGE.md` (e.g. "grade the code against the WordPress
		// Interactivity API best-practices rubric"); Skillsmith loads the
		// rubric content and supplies it to the judge automatically — there
		// is no `# Rubrics` id list and no reserved grammar. Omit this key
		// entirely if no scenario uses rubrics: it has no default and no
		// existence gate, so leaving it unset (or pointing it at an empty
		// directory) simply runs the judge with no rubric context and no
		// error.
		rubrics: './eval/rubrics',
	},

	// Behavior of the self-improvement loop. Only consulted when
	// `mode: "self-improvement"` (or `--mode self-improvement`).
	selfImprovement: {
		// Hard cap on iterations. The loop stops earlier when every
		// scenario passes.
		maxIterations: 3,

		// What carries forward into the next iteration after a failure:
		//   - "failed-pairs"     — only the exact (scenario, agent) pairs that failed.
		//   - "failed-scenarios" — every agent of every scenario where any agent failed.
		//   - "all"              — re-run the full matrix each iteration.
		scope: 'failed-scenarios',

		// After the loop ends, re-run the full matrix once with the
		// final skill edits. Useful for catching regressions the
		// scoped iterations didn't exercise.
		finalPass: false,
	},

	// Hooks fire at well-defined points in the lifecycle. Every hook is
	// fire-and-forget except `afterAllScenarios`, whose return value the
	// harness consumes (see README for the full lifecycle table).
	//
	// Skillsmith never starts or stops a server, browser, or container —
	// the project owns its environment. The hooks split that ownership
	// along a line: the project keeps the deterministic, infrastructural
	// setup, while the judge performs the live behavioral checks per its
	// `JUDGE.md` brief. Anything shared across the whole sweep — a server
	// or container the judge verifies against — boots once in the run-level
	// `beforeAllScenarios` and stops in `afterAllScenarios`, kept warm in
	// between rather than booted per pair. The per-pair `beforeJudgeAgent` /
	// `afterJudgeAgent` hooks then ready (and clean up) just what each pair
	// needs on that warm environment and export the facts the judge reads to
	// reach it. (There is no bundled e2e gate: live verification is the
	// judge's job. `afterAllScenarios` still exists as an optional, generic
	// post-sweep gate for any extra check you want across the whole
	// iteration — most projects can leave it unset.)
	hooks: {
		beforeAll: ( { runDirectory } ) => {
			console.log( `run directory: ${ runDirectory }` );
		},
		// Boot anything shared across the sweep once and keep it warm — e.g.
		// start a server or container the judge will verify against. Stop it
		// in `afterAllScenarios`. Booting here (not per pair) avoids paying
		// the start-up cost for every (scenario, agent) pair.
		beforeAllScenarios: () => {
			// e.g. start one server / container for the whole run.
		},
		afterAllScenarios: () => {
			// e.g. stop that shared environment and clear the host state it
			// owns. (Return a verdict here only if you want a post-sweep gate;
			// returning nothing folds the run back as a pass.)
		},
		beforeTestAgent: ( { scenario, agent, agentWorkspace } ) => {
			// Scaffold project-specific fixtures into the workspace here.
			void scenario;
			void agent;
			void agentWorkspace;
		},
		// `beforeJudgeAgent` is the first lifecycle point where the produced
		// artifact exists AND the environment can be readied before the judge
		// grades. Do the deterministic setup here, from `judgeWorkspace` (the
		// isolated copy the judge runs against, never the canonical artifact):
		// build the artifact, install it into the warm environment, give the
		// pair a clean slate, and export the per-pair facts the `JUDGE.md`
		// brief needs to reach it (e.g. a base URL or slug as environment
		// variables). Leave the live behavioral checks — exercising the
		// running environment and verifying the result — to the judge.
		beforeJudgeAgent: ( { judgeWorkspace } ) => {
			// e.g. build the artifact from `judgeWorkspace`, install it into
			// the warm environment, and set the process.env facts the
			// JUDGE.md brief references.
			void judgeWorkspace;
		},
		// Clean this pair off the shared environment once the judge has graded
		// it — leaving the environment warm for the next pair, not torn down.
		// Pair this with `roles.judge.concurrency: 'serial'` above when the
		// environment is shared and cannot grade two pairs at once.
		afterJudgeAgent: ( { judgeWorkspace } ) => {
			// e.g. uninstall this pair's artifact and clear its per-pair env
			// vars; the shared environment stays up.
			void judgeWorkspace;
		},
	},
} );
