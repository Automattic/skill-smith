import { defineConfig } from "../../../index";

export default defineConfig({
	agents: {
		testing: [
			{ id: "ok", provider: "mock", model: "mock-model" },
			{ id: "mock-fail-testing", provider: "mock", model: "mock-model" },
		],
		judge: [{ id: "opus", provider: "mock", model: "mock-model" }],
	},
	paths: {
		base: "./.skillsmith",
	},
});
