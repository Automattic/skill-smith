import { defineConfig } from "../../../index";

// Fixture for the verification gate. The judges always pass (the mock
// provider's default), but `verifyIteration` fails the first iteration
// — standing in for an e2e suite that breaks even though the artifact
// passed review. Iteration 2 verifies clean, so the loop converges.
export default defineConfig({
	agents: {
		testing: [{ id: "tester", provider: "mock", model: "mock" }],
		judge: [{ id: "grader", provider: "mock", model: "mock" }],
		improver: { id: "improver", provider: "mock", model: "mock" },
	},
	paths: {
		base: "./.skillsmith",
	},
	selfImprovement: {
		mode: "loop",
		maxIterations: 3,
		evaluationMode: "failed-scenarios",
	},
	hooks: {
		verifyIteration: ({ iteration }) => {
			if (iteration === 1) {
				return {
					failures: [
						{
							scenario: "verify-scenario",
							details: "e2e suite failed even though the judge passed",
						},
					],
				};
			}
			return true;
		},
	},
});
