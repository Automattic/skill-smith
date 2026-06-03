import { defineConfig } from "../../../index";

// The improver needs OPENAI_API_KEY. When it is absent the improver
// cannot edit skills, so the run degrades to a single test-only grading
// despite maxIterations > 1. Test and judge are mock and pass on the
// first sweep.
export default defineConfig({
	mode: "self-improvement",
	agents: {
		runnable: { provider: "mock", model: "mock" },
		grader: { provider: "mock", model: "mock" },
		"needs-openai-key": { provider: "openai-api", model: "gpt-4.1-nano" },
	},
	roles: {
		test: { agents: ["runnable"] },
		judge: "grader",
		improver: "needs-openai-key",
	},
	paths: {
		base: "./.skillsmith",
	},
	selfImprovement: {
		maxIterations: 3,
	},
});
