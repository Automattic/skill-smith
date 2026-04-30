import type { AgentConfig, AgentSettings } from "../config/types";

export const ALIASES = ["haiku", "sonnet", "opus"] as const;
export type AgentAlias = (typeof ALIASES)[number];

/**
 * Maps full model id strings (the legal "string form") to their alias.
 * Run.md §1 alias-table.
 */
export const MODEL_TO_ALIAS: Record<string, AgentAlias> = {
	"claude-haiku-4-5-20251001": "haiku",
	"claude-sonnet-4-6": "sonnet",
	"claude-opus-4-7": "opus",
};

export interface NormalizedEntry {
	alias: AgentAlias;
	settings: AgentSettings;
}

export interface SkippedEntry {
	source: string;
	reason: string;
}

export interface NormalizeResult {
	entries: NormalizedEntry[];
	skipped: SkippedEntry[];
	emptyReason?: string;
}

function isAlias(s: string): s is AgentAlias {
	return (ALIASES as readonly string[]).includes(s);
}

/**
 * Normalize an `AgentConfig` to a list of `(alias, settings)` entries
 * per run.md §1.
 *
 * - String form: look up alias from MODEL_TO_ALIAS; unknown id → skip
 *   with `model not dispatchable` (V15).
 * - Object form: each key must be in {haiku, sonnet, opus}; otherwise
 *   skip the entry with `unknown alias <key>` (V14). Value is either a
 *   model id string or an `AgentSettings` object.
 *
 * After normalization, an entry whose `settings.model` is empty/missing
 * is skipped with `missing model` (V16). If the resulting entry list is
 * empty, the slot is treated as `empty agent config` (V12).
 */
export function normalizeAgentConfig(config: AgentConfig): NormalizeResult {
	const entries: NormalizedEntry[] = [];
	const skipped: SkippedEntry[] = [];

	if (typeof config === "string") {
		const alias = MODEL_TO_ALIAS[config];
		if (alias === undefined) {
			skipped.push({
				source: config,
				reason: `model not dispatchable: "${config}" not in alias table`,
			});
		} else {
			entries.push({ alias, settings: { model: config } });
		}
	} else if (config !== null && typeof config === "object") {
		for (const [key, value] of Object.entries(config)) {
			if (!isAlias(key)) {
				skipped.push({ source: key, reason: `unknown alias "${key}"` });
				continue;
			}
			let settings: AgentSettings;
			if (typeof value === "string") {
				settings = { model: value };
			} else if (value !== null && typeof value === "object") {
				settings = value as AgentSettings;
			} else {
				skipped.push({ source: key, reason: `invalid value for "${key}"` });
				continue;
			}
			if (typeof settings.model !== "string" || settings.model.length === 0) {
				skipped.push({ source: key, reason: "missing model" });
				continue;
			}
			entries.push({ alias: key, settings });
		}
	}

	const result: NormalizeResult = { entries, skipped };
	if (entries.length === 0) {
		result.emptyReason = "empty agent config";
	}
	return result;
}
