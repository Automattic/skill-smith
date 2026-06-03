import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@automattic/skillsmith";
import { scaffoldPlugin } from "./eval/utils/scaffold-plugin";
import { runE2eVerification } from "./eval/utils/verify-e2e";

const here = dirname(fileURLToPath(import.meta.url));
const testingAgentPrompt = readFileSync(
	resolve(here, "eval/prompts/testing-agent.md"),
	"utf8",
);
const improverPrompt = readFileSync(
	resolve(here, "eval/prompts/improver.md"),
	"utf8",
);

export default defineConfig({
	mode: "test-only",
	agents: {
		haiku: {
			provider: "claude-code",
			model: "claude-haiku-4-5",
		},
		opus: {
			provider: "claude-code",
			model: "claude-opus-4-7",
			effort: "xhigh",
		},
	},
	roles: {
		test: {
			agents: ["haiku"],
			prompt: testingAgentPrompt,
		},
		judge: "opus",
		improver: { agent: "opus", prompt: improverPrompt },
	},
	selfImprovement: {
		maxIterations: 3,
		scope: "failed-scenarios",
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
