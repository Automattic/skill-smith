import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { ResolvedSelfImprovement } from "../config/self-improvement";
import type { SkillsmithConfig } from "../config/types";
import type { AgentVerdict } from "../reports/agent-verdict";
import type { IterationReport } from "../reports/iteration-report";
import type { ScenarioReport } from "../reports/scenario-report";
import { loadSkill } from "../scenarios/skill-loader";
import type { EnumeratedScenario } from "../scenarios/enumerate";

export interface BuildImprovementContextParams {
	projectRoot: string;
	config: SkillsmithConfig;
	selfImprovement: ResolvedSelfImprovement;
	iterationReport: IterationReport;
	allScenarios: EnumeratedScenario[];
}

export interface ImprovementContext {
	/** YAML-formatted summary of failing scenarios and per-agent failures. */
	failureSummary: string;
	/** Concatenated text of every skill referenced by a failing scenario. */
	skillsBlob: string;
	/** Skill ids that contributed to `skillsBlob`. Always sorted. */
	skillIds: string[];
	/** Body of `selfImprovement.paths.proposerGuidelines` if configured. */
	proposerGuidelines?: string;
	/** Body of `selfImprovement.paths.executorGuidelines` if configured. */
	executorGuidelines?: string;
}

/**
 * Bundle the context the proposer / reviewer / executor sub-agents
 * share: a human-readable failure summary, the verbatim text of every
 * skill referenced by a failing scenario, and the optional guideline
 * files configured on the project.
 */
export function buildImprovementContext(
	params: BuildImprovementContextParams,
): ImprovementContext {
	const { projectRoot, config, selfImprovement, iterationReport, allScenarios } =
		params;

	const failingScenarios = collectFailingScenarios(iterationReport);
	const failureSummary = renderFailureSummary(failingScenarios);

	const skillIds = collectSkillIds(failingScenarios, allScenarios);
	const skillsRoot = resolve(projectRoot, config.paths.skills);
	const skillsBlob = skillIds
		.map((id) => loadSkill(id, skillsRoot))
		.join("\n\n");

	const context: ImprovementContext = {
		failureSummary,
		skillsBlob,
		skillIds,
	};

	const proposerPath = selfImprovement.paths.proposerGuidelines;
	const executorPath = selfImprovement.paths.executorGuidelines;
	if (proposerPath !== undefined) {
		context.proposerGuidelines = readGuidelines(projectRoot, proposerPath);
	}
	if (executorPath !== undefined) {
		context.executorGuidelines = readGuidelines(projectRoot, executorPath);
	}

	return context;
}

interface FailingScenario {
	name: string;
	body: ScenarioReport;
}

function collectFailingScenarios(report: IterationReport): FailingScenario[] {
	const out: FailingScenario[] = [];
	for (const [name, body] of Object.entries(report.scenarios)) {
		if (!("agents" in body)) continue;
		if (body.pass === true) continue;
		out.push({ name, body });
	}
	return out;
}

function renderFailureSummary(failing: FailingScenario[]): string {
	if (failing.length === 0) return "No failures recorded.";
	const out: unknown[] = [];
	for (const { name, body } of failing) {
		const agents: Record<string, unknown> = {};
		for (const [agentId, entry] of Object.entries(body.agents ?? {})) {
			if (entry.error !== undefined) {
				agents[agentId] = { error: entry.error };
				continue;
			}
			const review = entry.review as AgentVerdict | undefined;
			if (review === undefined) {
				agents[agentId] = { error: "missing review" };
				continue;
			}
			if ("skipped" in review) {
				agents[agentId] = { skipped: review.skipped };
				continue;
			}
			if (review.pass === true) continue;
			const failureEntry: Record<string, unknown> = { pass: false };
			if (review.error !== undefined) failureEntry.error = review.error;
			if (review.failures !== undefined && review.failures.length > 0) {
				failureEntry.failures = review.failures;
			}
			agents[agentId] = failureEntry;
		}
		out.push({ scenario: name, agents });
	}
	return stringifyYaml(out);
}

function collectSkillIds(
	failing: FailingScenario[],
	allScenarios: EnumeratedScenario[],
): string[] {
	const byName = new Map(allScenarios.map((s) => [s.scenario.name, s.scenario]));
	const ids = new Set<string>();
	for (const { name } of failing) {
		const scenario = byName.get(name);
		if (scenario === undefined) continue;
		for (const id of scenario.skills) ids.add(id);
	}
	return [...ids].sort();
}

function readGuidelines(projectRoot: string, p: string): string {
	const abs = isAbsolute(p) ? p : resolve(projectRoot, p);
	if (!existsSync(abs)) return "";
	return readFileSync(abs, "utf8");
}
