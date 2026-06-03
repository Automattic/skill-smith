import type { ProviderId } from "../providers/types";
import type {
	AgentDefinition,
	SkillsmithConfig,
	SkillsmithConfigInput,
} from "../config/types";

/**
 * Providers whose credentials live in a known environment variable. A
 * provider absent from this map (e.g. `claude-code`, `mock`, `codex`)
 * cannot be statically misconfigured and is therefore always runnable.
 */
export const PROVIDER_CREDENTIAL_ENV: Partial<Record<ProviderId, string>> = {
	"openai-api": "OPENAI_API_KEY",
	"anthropic-api": "ANTHROPIC_API_KEY",
	"gemini-api": "GOOGLE_GENERATIVE_AI_API_KEY",
};

/** Prefix on every reason string that explains an excluded/stopped agent. */
export const MISCONFIGURED_REASON_PREFIX = "misconfigured: ";

/**
 * The single source of truth for whether a provider can run: it needs no
 * credential, or the credential it needs is present in `env`.
 */
export function providerRunnable(
	provider: ProviderId,
	env: NodeJS.ProcessEnv,
): boolean {
	const required = PROVIDER_CREDENTIAL_ENV[provider];
	return required === undefined || Boolean(env[required]);
}

function missingCredentialReason(provider: ProviderId): string {
	return `${MISCONFIGURED_REASON_PREFIX}${PROVIDER_CREDENTIAL_ENV[provider]} is not set`;
}

/**
 * Whether the named agent can run given `env`. `agentId` must name a
 * declared agent; an id absent from `config.agents` throws rather than
 * coercing to `false`, so a config error is never silently masked.
 */
export function agentRunnable(
	config: SkillsmithConfigInput,
	agentId: string,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	// Unknown ids throw — the documented contract for third-party callers;
	// internal callers only ever pass validated ids. Throwing (rather than
	// returning false) keeps a config error from being silently masked.
	const agent = config.agents[agentId];
	if (agent === undefined) {
		throw new Error(`unknown agent id "${agentId}"`);
	}
	return providerRunnable(agent.provider, env);
}

/** The test-role agent ids that can run given `env`. */
export function runnableTestAgentIds(
	config: SkillsmithConfigInput,
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	return config.roles.test.agents.filter((id) =>
		agentRunnable(config, id, env),
	);
}

export interface RunnabilityPlan {
	testAgents: {
		run: AgentDefinition[];
		excluded: { agent: AgentDefinition; reason: string }[];
	};
	judge: { stop: boolean; reason?: string };
	improver: { degrade: boolean; reason?: string };
}

/**
 * The single policy seam. Future "fail"/"skip" policies are localized
 * edits to this body, not to its callers.
 */
export function decideRunnability(
	config: SkillsmithConfig,
	env: NodeJS.ProcessEnv = process.env,
): RunnabilityPlan {
	const run: AgentDefinition[] = [];
	const excluded: { agent: AgentDefinition; reason: string }[] = [];
	for (const agent of config.roles.test.agents) {
		if (providerRunnable(agent.provider, env)) {
			run.push(agent);
		} else {
			excluded.push({ agent, reason: missingCredentialReason(agent.provider) });
		}
	}

	const judgeProvider = config.roles.judge.agent.provider;
	const judgeStop = !providerRunnable(judgeProvider, env);

	const improverProvider = config.roles.improver.agent.provider;
	const improverDegrade = !providerRunnable(improverProvider, env);

	return {
		testAgents: { run, excluded },
		judge: {
			stop: judgeStop,
			reason: judgeStop ? missingCredentialReason(judgeProvider) : undefined,
		},
		improver: {
			degrade: improverDegrade,
			reason: improverDegrade
				? missingCredentialReason(improverProvider)
				: undefined,
		},
	};
}
