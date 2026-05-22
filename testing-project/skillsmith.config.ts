import { defineConfig } from "skillsmith";
import { scaffoldPlugin } from "./eval/utils/scaffold-plugin";
import { runE2eVerification } from "./eval/utils/verify-e2e";

export default defineConfig({
	agents: {
		testing: [
			{
				id: "haiku",
				provider: "claude-code",
				model: "claude-haiku-4-5-20251001",
			},
			{
				id: "opus",
				provider: "claude-code",
				model: "claude-opus-4-6",
			},
			{
				id: "anthropic-sonnet",
				provider: "anthropic-api",
				model: "claude-sonnet-4-6",
			},
			{
				id: "openai-api-nano",
				provider: "openai-api",
				model: "gpt-5.4-nano",
			},
			{ id: "codex-mini", provider: "codex", model: "gpt-5.4-mini" },
			{
				id: "codex-gpt55",
				provider: "codex",
				model: "gpt-5.5",
			},
			{
				id: "gemini-flash",
				provider: "gemini-api",
				model: "gemini-2.5-flash",
			},
		],
		judge: [
			{
				id: "codex",
				provider: "codex",
				model: "gpt-5.5",
				effort: "xhigh",
			},
		],
		// Single agent that edits the failing skills between iterations in
		// loop mode. It edits SKILL.md files in place — no proposal,
		// reviewer, or git.
		improver: {
			id: "improver",
			provider: "claude-code",
			model: "claude-opus-4-6",
		},
	},

	// Self-improvement is opt-in. With `agents.improver` set, a run with
	// `--mode loop` will, after each failing iteration, let the improver
	// edit the relevant SKILL.md files and re-run the failing scenarios.
	// `--mode test-only` (the default) ignores it entirely. Point
	// `paths.improverPrompt` at a file to replace the built-in improver
	// instructions with a project-specific strategy.
	selfImprovement: {
		mode: "test-only",
		maxIterations: 3,
		evaluationMode: "failed-scenarios",
		// paths: { improverPrompt: "./eval/improvement/improver.md" },
	},

	hooks: {
		// Scaffold the WordPress plugin each testing agent works inside.
		beforeTestAgent: ({ scenario, agent, agentWorkspace }) =>
			scaffoldPlugin(agentWorkspace, scenario.name, agent.id),

		// Run the e2e suite against the artifacts this iteration produced,
		// after the judges have graded them but before the improver runs.
		// A spec failure marks that exact (scenario, agent) pair failed —
		// even if the judge passed it — so the improver learns the code
		// looked right but broke in a real runtime, and the loop iterates.
		afterAllScenarios: ({ scenarios, iterationDirectory }) => {
			const failures = runE2eVerification(iterationDirectory, scenarios);
			return failures.length > 0 ? { failures } : true;
		},
	},
});
