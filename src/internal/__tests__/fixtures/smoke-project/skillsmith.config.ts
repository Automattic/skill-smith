import { defineConfig } from "../../../../index";

export default defineConfig({
	agents: {
		testing: {
			haiku: "claude-haiku-4-5-20251001",
			sonnet: "claude-sonnet-4-6",
		},
		judge: { opus: "claude-opus-4-7" },
	},
	paths: {
		base: "./.skillsmith",
	},
});
