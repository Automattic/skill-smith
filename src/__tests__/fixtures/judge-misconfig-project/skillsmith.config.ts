import { defineConfig } from "../../../index";

// Task 10 fixture: the judge agent references an unknown provider, so the
// pre-flight probe records it as misconfigured and the pipeline must fail fast
// with a PreconditionError before any tester is dispatched (AC12). The testers
// are ordinary mock agents; they must never run.
export default defineConfig({
	mode: "test-only",
	agents: {
		tester: { provider: "mock", model: "mock-model" },
		// biome-ignore lint/suspicious/noExplicitAny: deliberately invalid provider
		"bad-judge": { provider: "nope-provider" as any, model: "mock-model" },
	},
	roles: {
		test: { agents: ["tester"] },
		judge: "bad-judge",
		improver: "tester",
	},
	paths: {
		base: "./.skillsmith",
	},
});
