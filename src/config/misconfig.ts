import { isProviderId } from "../providers/registry";
import type { ProviderId } from "../providers/types";
import type { AgentDefinition } from "./types";

/**
 * Why an agent is considered misconfigured rather than failed. This is the
 * single verdict type both the pre-flight check (`preflightMisconfig`) and the
 * runtime error classifier (`classifyRuntimeError`) produce, so every surface
 * (ledger, hook, CLI, log) reasons about the same closed set:
 *
 *   - `missing-credential` — the provider needs an API-key env var that is
 *     absent or empty; `envVar` is its name (e.g. `ANTHROPIC_API_KEY`).
 *   - `unknown-provider` — the agent's `provider` is not a known
 *     {@link ProviderId}; `provider` is the offending id as written.
 *   - `invalid-credential` — the provider rejected the credential at runtime
 *     with an HTTP 401 or 403; `status` is that code.
 *   - `model-not-found` — the provider returned HTTP 404 for the requested
 *     model; `status` is that code.
 */
export type MisconfigReason =
	| { kind: "missing-credential"; envVar: string }
	| { kind: "unknown-provider"; provider: string }
	| { kind: "invalid-credential"; status: number }
	| { kind: "model-not-found"; status: number };

/**
 * Providers whose pre-flight signal is a single API-key env var, mapped to
 * that var's name. A provider absent from this map (`claude-code`, `codex`,
 * `mock`) has no pre-flight credential signal. Kept private so the env-var
 * wording lives in exactly one place; `preflightMisconfig` is the only reader.
 */
const CREDENTIAL_ENV_VAR: Partial<Record<ProviderId, string>> = {
	"anthropic-api": "ANTHROPIC_API_KEY",
	"openai-api": "OPENAI_API_KEY",
	"gemini-api": "GOOGLE_GENERATIVE_AI_API_KEY",
};

/**
 * Classify an agent before any dispatch, using only its static definition and
 * the current environment. Returns the misconfiguration reason if one is
 * already determinable, or `undefined` when the agent looks dispatchable.
 *
 * Order matters: an unrecognized `provider` is reported as `unknown-provider`
 * without ever resolving a provider instance (we test membership via
 * {@link isProviderId}, never `getProvider`). A known provider with a
 * credential env-var entry that is unset or empty yields `missing-credential`.
 * Everything else — providers with no credential signal, or one whose env var
 * is present — returns `undefined`.
 */
export function preflightMisconfig(
	agent: AgentDefinition,
): MisconfigReason | undefined {
	if (!isProviderId(agent.provider)) {
		return { kind: "unknown-provider", provider: String(agent.provider) };
	}
	const envVar = CREDENTIAL_ENV_VAR[agent.provider];
	if (envVar !== undefined && !process.env[envVar]) {
		return { kind: "missing-credential", envVar };
	}
	return undefined;
}

/**
 * The exact missing-key error strings the three env-var providers emit, mapped
 * back to the env-var name they name. These are the literals those providers
 * produce when their key is unset, so a runtime error carrying one is a
 * `missing-credential` misconfiguration. Kept in sync with
 * `providers/{anthropic-api,openai-api,gemini-api}.ts`.
 */
const MISSING_KEY_MESSAGE: Record<string, string> = {
	"ANTHROPIC_API_KEY is not set": "ANTHROPIC_API_KEY",
	"OPENAI_API_KEY is not set": "OPENAI_API_KEY",
	"GOOGLE_GENERATIVE_AI_API_KEY is not set": "GOOGLE_GENERATIVE_AI_API_KEY",
};

/**
 * Matches the leading `[HTTP <status>]` form that providers prepend to a
 * runtime error string once they have surfaced the HTTP status of a rejected
 * request. The capture group is the numeric status. Only this recognizable
 * leading form counts; an HTTP code mentioned elsewhere in free text is
 * deliberately ignored so unrelated prose cannot trip a false skip.
 */
const HTTP_STATUS_PREFIX = /^\[HTTP (\d+)\]/;

/**
 * Classify a runtime error into a misconfiguration reason, or `undefined` when
 * the error is an ordinary failure. Operates on the error string providers
 * produce — either one of the exact missing-key literals or a string whose
 * leading `[HTTP <status>]` form carries the status of a rejected request.
 *
 * This is an allowlist: only a recognized missing-key string, or a leading
 * HTTP 401/403 (`invalid-credential`) or 404 (`model-not-found`), classifies
 * as a misconfiguration. Every other case — 429, any 5xx, network timeouts,
 * context-length-exceeded, content-filter, MAX_STEPS exhaustion, and any error
 * with no readable leading status — returns `undefined` and is treated as an
 * ordinary failure, never a false skip.
 */
export function classifyRuntimeError(
	err: unknown,
): MisconfigReason | undefined {
	const message = err instanceof Error ? err.message : String(err);

	const envVar = MISSING_KEY_MESSAGE[message];
	if (envVar !== undefined) {
		return { kind: "missing-credential", envVar };
	}

	const match = HTTP_STATUS_PREFIX.exec(message);
	if (match !== null) {
		const status = Number(match[1]);
		if (status === 401 || status === 403) {
			return { kind: "invalid-credential", status };
		}
		if (status === 404) {
			return { kind: "model-not-found", status };
		}
	}

	return undefined;
}

/**
 * Render a {@link MisconfigReason} as a short human-readable phrase, e.g.
 * `invalid-credential (HTTP 401)`, `unknown-provider "claud-code"`, or
 * `ANTHROPIC_API_KEY is not set`. The wording lives here so every surface that
 * reports a misconfiguration (ledger, hook, CLI, log) shares one phrasing.
 */
export function describeReason(reason: MisconfigReason): string {
	switch (reason.kind) {
		case "missing-credential":
			return `${reason.envVar} is not set`;
		case "unknown-provider":
			return `unknown-provider "${reason.provider}"`;
		case "invalid-credential":
			return `invalid-credential (HTTP ${reason.status})`;
		case "model-not-found":
			return `model-not-found (HTTP ${reason.status})`;
	}
}

/**
 * Prefix tagging a `SKIPPED` cell whose skip was caused by a misconfiguration,
 * written as `{ skipped: "misconfigured: <reason>" }`. Pass-math code uses
 * {@link isMisconfiguredSkipReason} rather than this constant directly so the
 * "is this cell excluded?" test is defined in one place.
 */
export const MISCONFIG_SKIP_PREFIX = "misconfigured: ";

/**
 * True iff a `SKIPPED` cell's reason was produced via the misconfigured marker
 * (i.e. begins with {@link MISCONFIG_SKIP_PREFIX}). Distinguishes a
 * misconfiguration skip — which pass math excludes from the denominator — from
 * an ordinary skip such as `"testing failed: ..."`.
 */
export function isMisconfiguredSkipReason(skipReason: string): boolean {
	return skipReason.startsWith(MISCONFIG_SKIP_PREFIX);
}
