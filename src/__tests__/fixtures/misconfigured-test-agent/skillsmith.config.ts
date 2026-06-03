import { defineConfig } from "../../../index";

// One test agent needs OPENAI_API_KEY (excluded when it is unset); the
// other runs on the mock provider and passes. Judge and improver are
// mock so grading is deterministic with no real credentials.
export default defineConfig({
	mode: "test-only",
	agents: {
		"needs-openai-key": { provider: "openai-api", model: "gpt-4.1-nano" },
		runnable: { provider: "mock", model: "mock" },
		grader: { provider: "mock", model: "mock" },
		fixer: { provider: "mock", model: "mock" },
	},
	roles: {
		test: { agents: ["needs-openai-key", "runnable"] },
		judge: "grader",
		improver: "fixer",
	},
	paths: {
		base: "./.skillsmith",
	},
});
