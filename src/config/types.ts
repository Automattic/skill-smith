export interface SkillSmithConfig {
	models: ModelsConfig;
	defaults?: DeepPartial<ModelDefaults>;
	paths?: Partial<Paths>;
}

export interface ModelsConfig {
	agentUnderTest: string[];
	judge: string;
}

export interface ModelDefaults {
	temperature: number;
	maxTokens: number;
	retry: RetryPolicy;
}

export interface RetryPolicy {
	maxAttempts: number;
	backoff: "exponential" | "linear" | "constant";
}

export interface Paths {
	skills: string;
	scenarios: string;
	rubrics: string;
	environment: string;
}

type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
