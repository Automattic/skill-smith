import { defineConfig } from "../../../index";

// Deterministic self-improvement loop fixture. The mock provider gates
// the judge on a marker in the skill (see src/providers/mock.ts):
// iteration 1 fails, the mock executor appends the marker to SKILL.md
// between iterations, and iteration 2 passes.
export default defineConfig({
	agents: {
		testing: [{ id: "tester", provider: "mock", model: "mock" }],
		judge: [{ id: "grader", provider: "mock", model: "mock" }],
	},
	paths: {
		base: "./.skillsmith",
	},
	selfImprovement: {
		mode: "loop",
		maxIterations: 3,
		evaluationMode: "failed-scenarios",
		agents: {
			proposer: { id: "proposer", provider: "mock", model: "mock" },
			reviewer: { id: "reviewer", provider: "mock", model: "mock" },
			executor: { id: "executor", provider: "mock", model: "mock" },
		},
	},
});
