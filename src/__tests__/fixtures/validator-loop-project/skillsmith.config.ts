import { defineConfig } from "../../../index";

// Deterministic validator-loop fixture (AC3 converge). Mirrors
// `loop-project/` but adds a validator: the gated improver appends the
// success marker AND a leak token on round 0, the mock validator flags
// the leak (`revise`), the improver strips it on the revise round, and
// the next validation `approve`s — the inner loop converges. The opt-in
// marker VALIDATOR_LOOP_FIXTURE (in the pristine skill) is what selects
// the new mock-improver behaviour; without it the improver keeps the
// unchanged `applyMarkerToSkills` path (the AC4 byte-identity guarantee).
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
