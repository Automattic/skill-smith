import { anthropic } from "@ai-sdk/anthropic";
import { runVercel } from "./lib/vercel-runner";
import type { Provider } from "./types";

export const anthropicApiProvider: Provider = {
	id: "anthropic-api",
	invoke: (params) => {
		if (!process.env.ANTHROPIC_API_KEY) {
			return Promise.resolve({
				finalText: "",
				toolUseCount: 0,
				error: "ANTHROPIC_API_KEY is not set",
			});
		}
		return runVercel(params, anthropic(params.agent.model));
	},
};
