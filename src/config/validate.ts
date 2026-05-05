import { isProviderId, PROVIDER_IDS } from "../providers/registry";
import type { AgentDefinition, SkillsmithConfig } from "./types";

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
