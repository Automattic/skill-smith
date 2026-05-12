import { appendFileSync } from "node:fs";
import { defineConfig } from "../../../index";

declare global {
	var __skillsmithTargetProjectHooks: string[] | undefined;
}

function record(name: string): void {
	globalThis.__skillsmithTargetProjectHooks ??= [];
	globalThis.__skillsmithTargetProjectHooks.push(name);

	if (process.env.SKILLSMITH_HOOK_LOG !== undefined) {
		appendFileSync(process.env.SKILLSMITH_HOOK_LOG, `${name}\n`);
	}
}

export default defineConfig({
	agents: {
		testing: [{ id: "haiku", provider: "mock", model: "mock-haiku" }],
		judge: [{ id: "opus", provider: "mock", model: "mock-opus" }],
	},
	paths: {
		base: "./.skillsmith",
	},
	hooks: {
		beforeAll() {
			record("beforeAll");
		},
		beforeScenario({ scenario }) {
			record(`beforeScenario:${scenario.name}`);
		},
		beforeTestAgent({ scenario }) {
			record(`beforeTestAgent:${scenario.name}`);
		},
		afterAll({ scenarios }) {
			record(
				`afterAllScenarios:${scenarios.map(({ dirName }) => dirName).join(",")}`,
			);
			record("afterAll");
		},
	},
});
