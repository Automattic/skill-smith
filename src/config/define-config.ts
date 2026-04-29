import { DEFAULT_PATHS } from "./defaults";
import type { AgentsConfig, Hooks, Paths, SkillSmithConfig } from "./types";

interface SkillSmithConfigInput {
	agents: AgentsConfig;
	paths?: Partial<Paths>;
	hooks?: Hooks;
}

export function defineConfig(input: SkillSmithConfigInput): SkillSmithConfig {
	return {
		...input,
		paths: { ...DEFAULT_PATHS, ...input.paths },
	};
}
