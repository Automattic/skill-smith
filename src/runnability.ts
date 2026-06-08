import type { AgentDefinition, SkillsmithConfig } from "./config/types";
import { getProvider } from "./providers/registry";

/**
 * The role an agent fills in a run. Distinct from the provider-level
 * `Role` (`"testing" | "judge"`) in `./providers/types`: this is the
 * domain role the runnability classifier reasons about, and it adds
 * `"improver"`, which has no provider-tool surface of its own.
 */
export type AgentRole = "test" | "judge" | "improver";

/** One agent the run will not run, with the role(s) it fills and why. */
export interface SkippedAgent {
	id: string;
	roles: AgentRole[];
	reason: string;
}

/**
 * What skipping an agent does to the run, decided by `decide`. The
 * pipeline switches on this, never on which policy produced it.
 */
export type Consequence =
	| "EXCLUDE_LANE"
	| "STOP_RUN"
	| "HALT_AFTER_ITERATION";

export interface RunnabilityResult {
	runnableTestAgentIds: string[];
	skipped: SkippedAgent[];
	judgeRunnable: boolean;
	improverRunnable: boolean;
}

/** The reason an agent is misconfigured, or `undefined` if it is runnable. */
function misconfiguredReason(
	agent: AgentDefinition,
	env: Record<string, string | undefined>,
): string | undefined {
	const { requiredEnv } = getProvider(agent.provider);
	if (requiredEnv === undefined) {
		return undefined;
	}
	// Mirror the providers' `!process.env.X` guard so the descriptor and
	// the runtime check agree: undefined or empty string counts as absent.
	if (!env[requiredEnv]) {
		return `${requiredEnv} is not set`;
	}
	return undefined;
}

/**
 * Decides which declared agents are runnable given the config and an
 * environment. Pure and synchronous: it reads only the passed-in `env`
 * and the static provider descriptors — no model call, no I/O. Each
 * distinct agent id is classified once, accumulating every role it fills,
 * so an id used in multiple roles produces exactly one `SkippedAgent`.
 */
export function classifyRunnability(
	config: SkillsmithConfig,
	env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): RunnabilityResult {
	const reasons = new Map<string, string>();
	const roles = new Map<string, Set<AgentRole>>();

	const note = (agent: AgentDefinition, role: AgentRole): boolean => {
		const reason = misconfiguredReason(agent, env);
		if (reason === undefined) {
			return true;
		}
		reasons.set(agent.id, reason);
		const set = roles.get(agent.id) ?? new Set<AgentRole>();
		set.add(role);
		roles.set(agent.id, set);
		return false;
	};

	const runnableTestAgentIds: string[] = [];
	for (const agent of config.roles.test.agents) {
		if (note(agent, "test")) {
			runnableTestAgentIds.push(agent.id);
		}
	}
	const judgeRunnable = note(config.roles.judge.agent, "judge");
	const improverRunnable = note(config.roles.improver.agent, "improver");

	const skipped: SkippedAgent[] = [];
	for (const [id, roleSet] of roles) {
		skipped.push({
			id,
			roles: [...roleSet],
			// Set above for every id that landed in `roles`.
			reason: reasons.get(id) as string,
		});
	}

	return { runnableTestAgentIds, skipped, judgeRunnable, improverRunnable };
}

const SEVERITY: Record<Consequence, number> = {
	STOP_RUN: 3,
	HALT_AFTER_ITERATION: 2,
	EXCLUDE_LANE: 1,
};

const ROLE_CONSEQUENCE: Record<AgentRole, Consequence> = {
	judge: "STOP_RUN",
	improver: "HALT_AFTER_ITERATION",
	test: "EXCLUDE_LANE",
};

/**
 * The single seam where skip policy lives. Maps each role an id fills to
 * its consequence and returns the most-severe one
 * (`STOP_RUN` > `HALT_AFTER_ITERATION` > `EXCLUDE_LANE`). A future
 * "fail" or "skip" policy is a localized change here (and, for "skip",
 * the exit-code rule) — the pipeline only ever reacts to the returned
 * `Consequence`.
 */
export function decide(roles: AgentRole[]): Consequence {
	let worst: Consequence = "EXCLUDE_LANE";
	for (const role of roles) {
		const consequence = ROLE_CONSEQUENCE[role];
		if (SEVERITY[consequence] > SEVERITY[worst]) {
			worst = consequence;
		}
	}
	return worst;
}
