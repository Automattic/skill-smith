import { google } from "@ai-sdk/google";
import { runVercel } from "./lib/vercel-runner";
import type { Provider } from "./types";

export const geminiApiProvider: Provider = {
	id: "gemini-api",
	invoke: (params) => {
		if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
			return Promise.resolve({
				finalText: "",
				toolUseCount: 0,
				error: "GOOGLE_GENERATIVE_AI_API_KEY is not set",
			});
		}
		return runVercel(params, google(params.agent.model));
	},
};
