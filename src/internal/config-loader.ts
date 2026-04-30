import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SkillsmithConfig } from "../config/types";
import { PreconditionError } from "./cwd";

const CONFIG_FILENAME = "skillsmith.config.ts";

/**
 * Dynamically import `skillsmith.config.ts` from the project root and
 * return the resolved {@link SkillsmithConfig}. The config is expected
 * to be authored with `defineConfig(...)`, so defaults are already
 * merged before we see it.
 *
 * Loaded via the tsx ESM loader registered in `bin/skillsmith.mjs`.
 */
export async function loadConfig(
	projectRoot: string,
): Promise<SkillsmithConfig> {
	const configPath = join(projectRoot, CONFIG_FILENAME);
	if (!existsSync(configPath)) {
		throw new PreconditionError([`${configPath} not found`]);
	}
	const mod = (await import(pathToFileURL(configPath).href)) as {
		default?: SkillsmithConfig;
	};
	if (!mod.default) {
		throw new PreconditionError([
			`${configPath} has no default export — use \`export default defineConfig({...})\``,
		]);
	}
	return mod.default;
}
