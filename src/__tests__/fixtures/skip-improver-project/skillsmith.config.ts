import { defineConfig } from "../../../index";

// Self-improvement run whose improver is misconfigured when
// OPENAI_API_KEY is unset. Iteration 1 fails on the gated skill and would
// normally trigger the improver and a second iteration; instead the run
// completes iteration 1's matrix and halts, with no improver edit and no
// iteration 2.
export default defineConfig({
	mode: "self-improvement",
	agents: {
		tester: { provider: "mock", model: "mock-model" },
		grader: { provider: "mock", model: "mock-model" },
		gpt: { provider: "openai-api", model: "gpt-4o-mini" },
	},
	roles: {
		test: { agents: ["tester"] },
		judge: "grader",
		improver: "gpt",
	},
	paths: {
		base: "./.skillsmith",
	},
	selfImprovement: {
		maxIterations: 3,
		scope: "failed-scenarios",
	},
});
