import { isProviderId, PROVIDER_IDS } from "../providers/registry";
import type {
	AgentDefinition,
	EvaluationMode,
	SelfImprovementMode,
	SkillsmithConfig,
} from "./types";

const VALID_MODES: SelfImprovementMode[] = ["test-only", "loop"];
const VALID_EVALUATION_MODES: EvaluationMode[] = [
	"failed-pairs",
	"failed-scenarios",
	"all",
];

export function collectConfigErrors(config: SkillsmithConfig): string[] {
	const errors: string[] = [];
	for (const slot of ["testing", "judge"] as const) {
		const list = config.agents[slot];
		if (!Array.isArray(list)) {
			errors.push(`agents.${slot} must be an array of AgentDefinition`);
			continue;
		}
		if (list.length === 0) {
			errors.push(`agents.${slot} must contain at least one entry`);
			continue;
		}
		const seenIds = new Set<string>();
		list.forEach((entry, index) => {
			validateAgentEntry(entry, `agents.${slot}[${index}]`, errors);
			if (
				typeof entry?.id === "string" &&
				entry.id.length > 0 &&
				seenIds.has(entry.id)
			) {
				errors.push(`agents.${slot}: duplicate id "${entry.id}"`);
			}
			if (typeof entry?.id === "string") seenIds.add(entry.id);
		});
	}
	validateSelfImprovement(config, errors);
	return errors;
}

function validateAgentEntry(
	entry: AgentDefinition | undefined,
	path: string,
	errors: string[],
): void {
	if (entry === undefined || entry === null || typeof entry !== "object") {
		errors.push(`${path} must be an object`);
		return;
	}
	if (typeof entry.id !== "string" || entry.id.length === 0) {
		errors.push(`${path}.id must be a non-empty string`);
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

function validateSelfImprovement(
	config: SkillsmithConfig,
	errors: string[],
): void {
	const block = config.selfImprovement;
	if (block === undefined) return;
	if (block === null || typeof block !== "object") {
		errors.push("selfImprovement must be an object");
		return;
	}

	if (block.mode !== undefined && !VALID_MODES.includes(block.mode)) {
		errors.push(
			`selfImprovement.mode must be one of ${VALID_MODES.map((m) => `"${m}"`).join(", ")}`,
		);
	}
	if (block.maxIterations !== undefined) {
		if (
			!Number.isInteger(block.maxIterations) ||
			(block.maxIterations as number) < 1
		) {
			errors.push("selfImprovement.maxIterations must be an integer >= 1");
		}
	}
	if (
		block.evaluationMode !== undefined &&
		!VALID_EVALUATION_MODES.includes(block.evaluationMode)
	) {
		errors.push(
			`selfImprovement.evaluationMode must be one of ${VALID_EVALUATION_MODES.map((m) => `"${m}"`).join(", ")}`,
		);
	}
	if (
		block.finalPass !== undefined &&
		typeof block.finalPass !== "boolean"
	) {
		errors.push("selfImprovement.finalPass must be a boolean");
	}

	const agents = block.agents;
	if (agents !== undefined) {
		if (agents === null || typeof agents !== "object") {
			errors.push("selfImprovement.agents must be an object");
		} else {
			for (const role of ["proposer", "reviewer", "executor"] as const) {
				const entry = agents[role];
				if (entry !== undefined) {
					validateAgentEntry(entry, `selfImprovement.agents.${role}`, errors);
				}
			}
		}
	}

	const paths = block.paths;
	if (paths !== undefined) {
		if (paths === null || typeof paths !== "object") {
			errors.push("selfImprovement.paths must be an object");
		} else {
			for (const key of [
				"proposerGuidelines",
				"executorGuidelines",
			] as const) {
				const value = paths[key];
				if (value !== undefined && typeof value !== "string") {
					errors.push(`selfImprovement.paths.${key} must be a string`);
				}
			}
		}
	}
}
