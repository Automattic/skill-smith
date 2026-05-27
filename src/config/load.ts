import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeConfig } from "./normalize";
import { CONFIG_FILENAME, PreconditionError } from "./resolve-cwd";
import type { SkillsmithConfig, SkillsmithConfigInput } from "./types";
import { collectConfigErrors } from "./validate";

/**
 * Dynamically import `skillsmith.config.ts` from the project root,
 * validate the raw user input, then normalize it into the
 * `SkillsmithConfig` the rest of the harness consumes.
 */
export async function loadConfig(
	projectRoot: string,
): Promise<SkillsmithConfig> {
	const configPath = join(projectRoot, CONFIG_FILENAME);
	if (!existsSync(configPath)) {
		throw new PreconditionError([`${configPath} not found`]);
	}
	const mod = (await import(pathToFileURL(configPath).href)) as {
		default?: SkillsmithConfigInput;
	};
	if (!mod.default) {
		throw new PreconditionError([
			`${configPath} has no default export — use \`export default defineConfig({...})\``,
		]);
	}
	const errors = collectConfigErrors(mod.default);
	if (errors.length > 0) {
		throw new PreconditionError(errors);
	}
	return normalizeConfig(mod.default);
}
