import type { ModelDefaults, Paths } from "./types";

export const DEFAULT_MODEL_DEFAULTS: ModelDefaults = {
	temperature: 0,
	maxTokens: 8000,
	retry: {
		maxAttempts: 3,
		backoff: "exponential",
	},
};

export const DEFAULT_PATHS: Paths = {
	skills: "./skills",
	scenarios: "./eval/scenarios",
	rubrics: "./eval/rubrics",
	environment: "./eval/environment.ts",
};
