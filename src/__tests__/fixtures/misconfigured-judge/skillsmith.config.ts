import { defineConfig } from "../../../index";

// The judge needs OPENAI_API_KEY. When it is absent the judge cannot
// grade, so the run aborts before any scenario starts. Test and
// improver are mock.
export default defineConfig({
	mode: "test-only",
	agents: {
		runnable: { provider: "mock", model: "mock" },
		"needs-openai-key": { provider: "openai-api", model: "gpt-4.1-nano" },
		fixer: { provider: "mock", model: "mock" },
	},
	roles: {
		test: { agents: ["runnable"] },
		judge: "needs-openai-key",
		improver: "fixer",
	},
	paths: {
		base: "./.skillsmith",
	},
});
