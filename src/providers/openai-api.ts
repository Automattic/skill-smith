import type { Provider } from "./types";

export const openaiApiProvider: Provider = {
	id: "openai-api",
	async invoke() {
		throw new Error("openai-api provider is not implemented yet");
	},
};
