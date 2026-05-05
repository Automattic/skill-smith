import { defineConfig } from "../../../index";

export default defineConfig({
	agents: {
		testing: [
			{ id: "haiku", provider: "mock", model: "claude-haiku-4-5-20251001" },
			{ id: "sonnet", provider: "mock", model: "claude-sonnet-4-6" },
		],
		judge: [{ id: "opus", provider: "mock", model: "claude-opus-4-7" }],
	},
	paths: {
		base: "./.skillsmith",
	},
});
