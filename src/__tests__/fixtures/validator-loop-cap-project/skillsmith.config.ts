import { defineConfig } from "../../../index";

// Deterministic validator-loop CAP fixture (AC5 never-approve). Identical
// to `validator-loop-project/` except the pristine skill carries
// NEVER_APPROVE, so the mock validator returns `revise` on every round
// and the inner loop hits its `maxValidationRounds` cap. On the cap the
// harness KEEPS the last improver edit and logs the warning literal — it
// does NOT revert (the advisory-gate contract, D2).
export default defineConfig({
	mode: "self-improvement",
	agents: {
		tester: { provider: "mock", model: "mock" },
		grader: { provider: "mock", model: "mock" },
		improver: { provider: "mock", model: "mock" },
		checker: { provider: "mock", model: "mock" },
	},
	roles: {
		test: { agents: ["tester"] },
		judge: "grader",
		improver: "improver",
		validator: "checker",
	},
	paths: {
		base: "./.skillsmith",
	},
	selfImprovement: {
		maxIterations: 3,
		maxValidationRounds: 2,
		scope: "failed-scenarios",
	},
});
