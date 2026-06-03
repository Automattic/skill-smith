import { defineConfig } from "../../../index";

// Every test agent needs OPENAI_API_KEY, so all are excluded when it is
// unset. The run must still fail (no vacuous pass). Judge and improver
// are mock.
export default defineConfig({
	mode: "test-only",
	agents: {
		"needs-openai-key-a": { provider: "openai-api", model: "gpt-4.1-nano" },
		"needs-openai-key-b": { provider: "openai-api", model: "gpt-4.1-nano" },
		grader: { provider: "mock", model: "mock" },
		fixer: { provider: "mock", model: "mock" },
	},
	roles: {
		test: { agents: ["needs-openai-key-a", "needs-openai-key-b"] },
		judge: "grader",
		improver: "fixer",
	},
	paths: {
		base: "./.skillsmith",
	},
});
