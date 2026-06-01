import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "../../../index";

// Task 10 fixture for the live `RunContext.misconfigured` view (AC8) and the
// multi-role union (AC10). Two distinct misconfigured ids drive the run:
//
//   - `bad-multi` references an unknown provider and fills BOTH the test and
//     improver roles, so the pre-flight probe records it once with roles
//     ["test", "improver"] (AC10). Being ledgered at pre-flight, it is present
//     in the `beforeAll` snapshot and is dropped from dispatch (true absence).
//   - `mock-misconfig-testing` is a mock sentinel whose first call fails with a
//     leading `[HTTP 401]`, so it is recorded at RUNTIME (role "test"). It is
//     absent from the `beforeAll` snapshot but present by `afterAll`.
//
// The judge is a healthy mock. The beforeAll/afterAll hooks serialize the
// `misconfigured` view to disk so the test can assert the two boundary states.
export default defineConfig({
	mode: "self-improvement",
	agents: {
		"mock-misconfig-testing": { provider: "mock", model: "mock" },
		grader: { provider: "mock", model: "mock" },
		// biome-ignore lint/suspicious/noExplicitAny: deliberately invalid provider
		"bad-multi": { provider: "nope-provider" as any, model: "mock" },
	},
	roles: {
		test: { agents: ["mock-misconfig-testing", "bad-multi"] },
		judge: "grader",
		improver: "bad-multi",
	},
	paths: {
		base: "./.skillsmith",
	},
	selfImprovement: {
		maxIterations: 3,
		scope: "failed-scenarios",
	},
	hooks: {
		beforeAll: (ctx) => {
			writeFileSync(
				join(ctx.runDirectory, "misconfigured-beforeAll.json"),
				`${JSON.stringify(ctx.misconfigured, null, 2)}\n`,
			);
		},
		afterAll: (ctx) => {
			writeFileSync(
				join(ctx.runDirectory, "misconfigured-afterAll.json"),
				`${JSON.stringify(ctx.misconfigured, null, 2)}\n`,
			);
		},
	},
});
