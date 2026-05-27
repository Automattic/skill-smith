import type { SkillsmithConfigInput } from "./types";

/**
 * Passthrough used in `skillsmith.config.ts` so projects get the input
 * type-checked at authoring time. The harness validates and normalizes
 * the result at load time (see `src/config/load.ts`), so this stays a
 * plain identity function.
 */
export function defineConfig(
	input: SkillsmithConfigInput,
): SkillsmithConfigInput {
	return input;
}
