import { defineConfig } from "../../../index";

// Task 10 fixture: a self-improvement run whose improver references an unknown
// provider. The pre-flight probe records the improver as misconfigured, so the
// pipeline degrades to test-only (AC13): it runs a single test/judge sweep
// (which fails on the marker-free skill, exactly as loop-project's iteration 1
// does), invokes no improver, and never applies the marker. The tester and
// judge are ordinary mock agents and run normally.
export default defineConfig({
	mode: "self-improvement",
	agents: {
		tester: { provider: "mock", model: "mock" },
		grader: { provider: "mock", model: "mock" },
		// biome-ignore lint/suspicious/noExplicitAny: deliberately invalid provider
		"bad-improver": { provider: "nope-provider" as any, model: "mock" },
	},
	roles: {
		test: { agents: ["tester"] },
		judge: "grader",
		improver: "bad-improver",
	},
	paths: {
		base: "./.skillsmith",
	},
	selfImprovement: {
		maxIterations: 3,
		scope: "failed-scenarios",
	},
});
