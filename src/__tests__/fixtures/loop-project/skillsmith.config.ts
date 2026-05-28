import { defineConfig } from "../../../index";

// Deterministic self-improvement loop fixture. The mock provider gates
// the judge on a marker in the skill (see src/providers/mock.ts):
// iteration 1 fails, the mock improver appends the marker to SKILL.md
// between iterations, and iteration 2 passes.
export default defineConfig({
	mode: "self-improvement",
	agents: {
		tester: { provider: "mock", model: "mock" },
		grader: { provider: "mock", model: "mock" },
		improver: { provider: "mock", model: "mock" },
	},
	roles: {
		test: { agents: ["tester"] },
		judge: "grader",
		improver: "improver",
	},
	paths: {
		base: "./.skillsmith",
	},
	selfImprovement: {
		maxIterations: 3,
		scope: "failed-scenarios",
	},
});
