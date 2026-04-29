import { DEFAULT_PATHS } from "./defaults";
import type { AgentsConfig, Hooks, Paths, SkillsmithConfig } from "./types";

interface SkillsmithConfigInput {
	agents: AgentsConfig;
	paths?: Partial<Paths>;
	hooks?: Hooks;
}

export function defineConfig(input: SkillsmithConfigInput): SkillsmithConfig {
	return {
		...input,
		paths: { ...DEFAULT_PATHS, ...input.paths },
	};
}
