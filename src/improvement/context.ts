import { resolve } from "node:path";
import type { SkillsmithConfig } from "../config/types";
import type { IterationReport } from "../reports/iteration-report";
import type { ScenarioReport } from "../reports/scenario-report";
import type { EnumeratedScenario } from "../scenarios/enumerate";
import { loadSkill } from "../scenarios/skill-loader";

export interface BuildImprovementContextParams {
	projectRoot: string;
	config: SkillsmithConfig;
	iterationReport: IterationReport;
	allScenarios: EnumeratedScenario[];
}

/**
 * The iteration report as handed to the improver: every scenario that
 * ran — passing and failing — with each judge's verbatim `review`. The
 * per-agent `testing` block (durations / token usage) is dropped as
 * noise; everything else is preserved so the improver can see what
 * passed as well as what failed.
 */
export interface ImproverAgentEntry {
	review?: unknown;
	error?: string;
}
export interface ImproverScenarioReport {
	scenario: string;
	pass: boolean;
	error?: string;
	agents: Record<string, ImproverAgentEntry>;
}
export interface ImproverReport {
	iteration: number;
	pass: boolean;
	scenarios: Record<string, ImproverScenarioReport | { error: string }>;
}

export interface ImprovementContext {
	/** Iteration report (passing + failing scenarios), minus `testing` blocks. */
	report: ImproverReport;
	/** Concatenated text of every skill referenced by a failing scenario. */
	skillsBlob: string;
	/** Skill ids that contributed to `skillsBlob`. Always sorted. */
	skillIds: string[];
}

/**
 * Bundle the context the improver agent needs: the iteration report
 * (every scenario that ran, with each judge's verbatim review) and the
 * verbatim text of every skill referenced by a failing scenario. The
 * optional per-project improver prompt is now handled by the caller
 * directly (it lives on `config.roles.improver.prompt`).
 */
export function buildImprovementContext(
	params: BuildImprovementContextParams,
): ImprovementContext {
	const { projectRoot, config, iterationReport, allScenarios } = params;

	const failingScenarios = collectFailingScenarios(iterationReport);

	const skillIds = collectSkillIds(failingScenarios, allScenarios);
	const skillsRoot = resolve(projectRoot, config.paths.skills);
	const skillsBlob = skillIds
		.map((id) => loadSkill(id, skillsRoot))
		.join("\n\n");

	return {
		report: projectReportForImprover(iterationReport),
		skillsBlob,
		skillIds,
	};
}

interface FailingScenario {
	name: string;
	body: ScenarioReport;
}

function collectFailingScenarios(report: IterationReport): FailingScenario[] {
	const out: FailingScenario[] = [];
	for (const [name, body] of Object.entries(report.scenarios)) {
		if (!("agents" in body)) continue;
		if (body.pass === true && body.error === undefined) continue;
		out.push({ name, body });
	}
	return out;
}

/**
 * Project the iteration report into the shape handed to the improver:
 * every scenario and agent is preserved (passing included) along with
 * each judge's verbatim `review`; only the per-agent `testing` block
 * (durations / token usage) is dropped as noise. Scenario-level errors
 * — e.g. an e2e failure the per-agent reviews never saw — ride along on
 * `scenario.error`.
 */
function projectReportForImprover(report: IterationReport): ImproverReport {
	const scenarios: Record<string, ImproverScenarioReport | { error: string }> =
		{};
	for (const [name, body] of Object.entries(report.scenarios)) {
		if (!("agents" in body)) {
			scenarios[name] = body;
			continue;
		}
		const agents: Record<string, ImproverAgentEntry> = {};
		for (const [agentId, entry] of Object.entries(body.agents)) {
			const out: ImproverAgentEntry = {};
			if (entry.review !== undefined) out.review = entry.review;
			if (entry.error !== undefined) out.error = entry.error;
			agents[agentId] = out;
		}
		const scenarioOut: ImproverScenarioReport = {
			scenario: body.scenario,
			pass: body.pass,
			agents,
		};
		if (body.error !== undefined) scenarioOut.error = body.error;
		scenarios[name] = scenarioOut;
	}
	return { iteration: report.iteration, pass: report.pass, scenarios };
}

function collectSkillIds(
	failing: FailingScenario[],
	allScenarios: EnumeratedScenario[],
): string[] {
	const byName = new Map(
		allScenarios.map((s) => [s.scenario.name, s.scenario]),
	);
	const ids = new Set<string>();
	for (const { name } of failing) {
		const scenario = byName.get(name);
		if (scenario === undefined) continue;
		for (const id of scenario.skills) ids.add(id);
	}
	return [...ids].sort();
}
