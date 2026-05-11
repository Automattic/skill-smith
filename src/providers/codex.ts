import type { Provider } from "./types";

export const codexProvider: Provider = {
	id: "codex",
	async invoke() {
		throw new Error("codex provider is not implemented yet");
	},
};
