import { isProviderId, PROVIDER_IDS } from "../providers/registry";
import type {
	AgentDefinitionInput,
	EvaluationScope,
	RunMode,
	SingleRoleInput,
	SkillsmithConfigInput,
} from "./types";

const VALID_MODES: RunMode[] = ["test-only", "self-improvement"];
const VALID_SCOPES: EvaluationScope[] = [
	"failed-pairs",
	"failed-scenarios",
	"all",
];

export function collectConfigErrors(config: SkillsmithConfigInput): string[] {
	const errors: string[] = [];

	if (config === undefined || config === null || typeof config !== "object") {
		errors.push("config must be an object");
		return errors;
	}

	if (!VALID_MODES.includes(config.mode)) {
		errors.push(
			`mode must be one of ${VALID_MODES.map((m) => `"${m}"`).join(", ")}`,
		);
	}

	const agentIds = validateAgents(config, errors);
	validateRoles(config, agentIds, errors);
	validateSelfImprovement(config, errors);

	return errors;
}

function validateAgents(
	config: SkillsmithConfigInput,
	errors: string[],
): Set<string> {
	const ids = new Set<string>();
	if (
		config.agents === undefined ||
		config.agents === null ||
		typeof config.agents !== "object" ||
		Array.isArray(config.agents)
	) {
		errors.push("agents must be an object keyed by agent id");
		return ids;
	}
	const entries = Object.entries(config.agents);
	if (entries.length === 0) {
		errors.push("agents must contain at least one entry");
		return ids;
	}
	for (const [id, entry] of entries) {
		if (id.length === 0) {
			errors.push("agents: id keys must be non-empty strings");
			continue;
		}
		ids.add(id);
		validateAgentEntry(entry, `agents.${id}`, errors);
	}
	return ids;
}

function validateAgentEntry(
	entry: AgentDefinitionInput | undefined,
	path: string,
	errors: string[],
): void {
	if (entry === undefined || entry === null || typeof entry !== "object") {
		errors.push(`${path} must be an object`);
		return;
	}
	if (typeof entry.model !== "string" || entry.model.length === 0) {
		errors.push(`${path}.model must be a non-empty string`);
	}
	if (!isProviderId(entry.provider)) {
		errors.push(
			`${path}.provider must be one of ${PROVIDER_IDS.map((id) => `"${id}"`).join(", ")}`,
		);
	}
}

function validateRoles(
	config: SkillsmithConfigInput,
	agentIds: Set<string>,
	errors: string[],
): void {
	const roles = config.roles;
	if (roles === undefined || roles === null || typeof roles !== "object") {
		errors.push("roles must be an object with `test`, `judge`, `improver`");
		return;
	}

	validateTestRole(roles.test, agentIds, errors);
	validateSingleRole(roles.judge, "roles.judge", agentIds, errors);
	validateSingleRole(roles.improver, "roles.improver", agentIds, errors);
	if (roles.validator !== undefined)
		validateSingleRole(roles.validator, "roles.validator", agentIds, errors);
}

function validateTestRole(
	role: SkillsmithConfigInput["roles"]["test"] | undefined,
	agentIds: Set<string>,
	errors: string[],
): void {
	if (role === undefined || role === null || typeof role !== "object") {
		errors.push("roles.test must be an object with an `agents` array");
		return;
	}
	if (!Array.isArray(role.agents)) {
		errors.push("roles.test.agents must be a non-empty string array");
		return;
	}
	if (role.agents.length === 0) {
		errors.push("roles.test.agents must be a non-empty string array");
		return;
	}
	const seen = new Set<string>();
	role.agents.forEach((id, index) => {
		if (typeof id !== "string" || id.length === 0) {
			errors.push(`roles.test.agents[${index}] must be a non-empty string`);
			return;
		}
		if (seen.has(id)) {
			errors.push(`roles.test.agents: duplicate id "${id}"`);
		}
		seen.add(id);
		if (!agentIds.has(id)) {
			errors.push(`roles.test.agents references unknown agent "${id}"`);
		}
	});
	if (role.prompt !== undefined && typeof role.prompt !== "string") {
		errors.push("roles.test.prompt must be a string");
	}
}

function validateSingleRole(
	role: SingleRoleInput | undefined,
	path: string,
	agentIds: Set<string>,
	errors: string[],
): void {
	if (role === undefined || role === null) {
		errors.push(
			`${path} must be a string agent id or an object { agent, prompt? }`,
		);
		return;
	}
	if (typeof role === "string") {
		if (role.length === 0) {
			errors.push(`${path} must be a non-empty string`);
			return;
		}
		if (!agentIds.has(role)) {
			errors.push(`${path} references unknown agent "${role}"`);
		}
		return;
	}
	if (typeof role !== "object") {
		errors.push(
			`${path} must be a string agent id or an object { agent, prompt? }`,
		);
		return;
	}
	if (typeof role.agent !== "string" || role.agent.length === 0) {
		errors.push(`${path}.agent must be a non-empty string`);
	} else if (!agentIds.has(role.agent)) {
		errors.push(`${path} references unknown agent "${role.agent}"`);
	}
	if (role.prompt !== undefined && typeof role.prompt !== "string") {
		errors.push(`${path}.prompt must be a string`);
	}
}

function validateSelfImprovement(
	config: SkillsmithConfigInput,
	errors: string[],
): void {
	const block = config.selfImprovement;
	if (block === undefined) return;
	if (block === null || typeof block !== "object") {
		errors.push("selfImprovement must be an object");
		return;
	}

	if (block.maxIterations !== undefined) {
		if (
			!Number.isInteger(block.maxIterations) ||
			(block.maxIterations as number) < 1
		) {
			errors.push("selfImprovement.maxIterations must be an integer >= 1");
		}
	}
	if (block.maxValidationRounds !== undefined) {
		if (
			!Number.isInteger(block.maxValidationRounds) ||
			(block.maxValidationRounds as number) < 1
		) {
			errors.push(
				"selfImprovement.maxValidationRounds must be an integer >= 1",
			);
		}
	}
	if (block.scope !== undefined && !VALID_SCOPES.includes(block.scope)) {
		errors.push(
			`selfImprovement.scope must be one of ${VALID_SCOPES.map((m) => `"${m}"`).join(", ")}`,
		);
	}
	if (block.finalPass !== undefined && typeof block.finalPass !== "boolean") {
		errors.push("selfImprovement.finalPass must be a boolean");
	}
}
