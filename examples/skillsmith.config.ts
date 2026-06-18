/**
 * Reference `skillsmith.config.ts` showing every provider and option.
 *
 * Copy the parts you need into your project's `skillsmith.config.ts`.
 * The minimal config (see README) is much shorter — this file exists to
 * document the surface area.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@automattic/skillsmith";

const here = dirname(fileURLToPath(import.meta.url));

// Prompts can be inlined as strings or loaded from files. Loading from
// disk keeps the config readable and lets you version the prompts on
// their own.
const testingAgentPrompt = readFileSync(
	resolve(here, "prompts/testing-agent.md"),
	"utf8",
);
const improverPrompt = readFileSync(
	resolve(here, "prompts/improver.md"),
	"utf8",
);
const validatorPrompt = readFileSync(
	resolve(here, "prompts/validator.md"),
	"utf8",
);

export default defineConfig({
	// Default run mode. CLI flag `--mode test-only|self-improvement`
	// overrides this for a single invocation.
	//   - "test-only" (default): one iteration, no improver.
	//   - "self-improvement": loop up to `selfImprovement.maxIterations`,
	//     letting `roles.improver` edit failing skills between iterations.
	mode: "test-only",

	// Roster of every agent the run can use. Keyed by a stable id —
	// the key appears in directory names and reports. Each entry takes
	// `provider` and `model`; extra keys (e.g. `effort`) flow through
	// to the provider that interprets them.
	agents: {
		// Anthropic via Claude Code CLI (uses your local CC auth).
		"cc-haiku": {
			provider: "claude-code",
			model: "claude-haiku-4-5",
		},
		"cc-opus": {
			provider: "claude-code",
			model: "claude-opus-4-7",
		},

		// Anthropic via the public API (uses ANTHROPIC_API_KEY).
		"anthropic-sonnet": {
			provider: "anthropic-api",
			model: "claude-sonnet-4-6",
		},

		// OpenAI via the public API (uses OPENAI_API_KEY).
		"openai-nano": {
			provider: "openai-api",
			model: "gpt-5.4-nano",
		},

		// OpenAI via the Codex SDK. Supports `effort: "low"|"medium"|
		// "high"|"xhigh"` to set reasoning effort on the model call.
		"codex-mini": {
			provider: "codex",
			model: "gpt-5.4-mini",
		},
		"codex-gpt55": {
			provider: "codex",
			model: "gpt-5.5",
			effort: "xhigh",
		},

		// Google Gemini via the public API (uses GEMINI_API_KEY).
		"gemini-flash": {
			provider: "gemini-api",
			model: "gemini-2.5-flash",
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
			agents: ["cc-haiku", "cc-opus", "anthropic-sonnet", "gemini-flash"],
			prompt: testingAgentPrompt,
		},

		// Single-agent roles accept a string shorthand…
		judge: "codex-gpt55",

		// …or the object form when you want a project-specific prompt.
		// For `improver`, the prompt REPLACES the built-in instructions
		// entirely (different from `test`/`judge`, which augment).
		improver: { agent: "cc-opus", prompt: improverPrompt },

		// Optional anti-leakage reviewer for the self-improvement loop.
		// Omit it entirely and the validator is off — the loop behaves
		// exactly as it does without this key. It runs read-only on the
		// same surface as the judge (it never writes a skill). Like
		// `improver`, its `prompt` REPLACES the built-in validator
		// instructions (not append) — an override must keep the verdict
		// JSON schema the harness parses.
		validator: { agent: "cc-opus", prompt: validatorPrompt },
	},

	// Project layout. Every entry is a directory the harness scans;
	// `base` is where it writes run artifacts.
	paths: {
		base: "./.skillsmith",
		skills: "./skills",
		scenarios: "./eval/scenarios",
		rubrics: "./eval/rubrics",
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
		scope: "failed-scenarios",

		// After the loop ends, re-run the full matrix once with the
		// final skill edits. Useful for catching regressions the
		// scoped iterations didn't exercise.
		finalPass: false,

		// Cap on the validator's revise rounds per improver edit (the
		// improver's first pass plus up to this many re-reviews). Integer
		// ≥ 1, default 2; a `0` clamps to `1` rather than disabling. This
		// only tunes the cap — the validator's on/off is governed solely
		// by whether `roles.validator` is present above.
		maxValidationRounds: 2,
	},

	// Hooks fire at well-defined points in the lifecycle. Every hook is
	// fire-and-forget except `afterAllScenarios`, whose return value the
	// harness consumes (see README for the full lifecycle table).
	hooks: {
		beforeAll: ({ runDirectory }) => {
			console.log(`run directory: ${runDirectory}`);
		},
		beforeTestAgent: ({ scenario, agent, agentWorkspace }) => {
			// Scaffold project-specific fixtures into the workspace here.
			void scenario;
			void agent;
			void agentWorkspace;
		},
		afterAllScenarios: ({ iteration, iterationDirectory, scenarios }) => {
			// Run your own verification (e.g. a real e2e suite) against
			// this iteration's artifacts. Return a list of failures to
			// mark scenarios/pairs failed even if the judge passed them.
			void iteration;
			void iterationDirectory;
			void scenarios;
			return true;
		},
	},
});
