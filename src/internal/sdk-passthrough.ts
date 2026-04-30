import type { AgentSettings } from "../config/types";

/**
 * The subset of `AgentSettings` keys we currently know how to pass to
 * `query()` (V27). Anything outside this set lands in `unplumbed` and
 * gets logged under `gaps.unplumbedSettings` in the run log.
 *
 * `model` is mapped separately — the alias is what the harness uses
 * for directory naming and reports, while the SDK gets the full id
 * from `settings.model`.
 */
const PLUMBED_KEYS: ReadonlySet<string> = new Set(["model"]);

export interface MappedSdkOptions {
	model: string;
	unplumbed: Record<string, unknown>;
}

/**
 * Map an `AgentSettings` to the SDK-facing options + a record of
 * extras the SDK doesn't currently accept. `model` is required; all
 * other keys flow into `unplumbed` (V27).
 */
export function mapSettings(settings: AgentSettings): MappedSdkOptions {
	const unplumbed: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(settings)) {
		if (PLUMBED_KEYS.has(k)) continue;
		unplumbed[k] = v;
	}
	return { model: settings.model, unplumbed };
}
