import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { ResolvedSelfImprovement } from "../config/self-improvement";
import type { SkillsmithConfig } from "../config/types";
import type { IterationReport } from "../reports/iteration-report";
import type { ScenarioReport } from "../reports/scenario-report";
import { classifyVerdict } from "../reports/verdict";
import type { EnumeratedScenario } from "../scenarios/enumerate";
import { loadSkill } from "../scenarios/skill-loader";

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
	/** Body of `selfImprovement.paths.improverPrompt` if configured. */
	improverPrompt?: string;
}

/**
 * Bundle the context the improver agent needs: a human-readable
 * failure summary (judge verdicts plus any verification-hook failures),
 * the verbatim text of every skill referenced by a failing scenario,
 * and the optional custom prompt configured on the project.
 */
export function buildImprovementContext(
	params: BuildImprovementContextParams,
): ImprovementContext {
	const {
		projectRoot,
		config,
		selfImprovement,
		iterationReport,
		allScenarios,
	} = params;

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

	const promptPath = selfImprovement.paths.improverPrompt;
	if (promptPath !== undefined) {
		context.improverPrompt = readGuidelines(projectRoot, promptPath);
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
		if (body.pass === true && body.error === undefined) continue;
		out.push({ name, body });
	}
	return out;
}

function renderFailureSummary(failing: FailingScenario[]): string {
	if (failing.length === 0) return "No failures recorded.";
	const out: unknown[] = [];
	for (const { name, body } of failing) {
		const entry: Record<string, unknown> = { scenario: name };
		// Scenario-level errors carry verification-hook details (e.g. an
		// e2e failure) the per-agent reviews never saw — surface them so
		// the improver knows the artifact broke beyond what the judge read.
		if (body.error !== undefined) entry.error = body.error;
		const agents: Record<string, unknown> = {};
		for (const [agentId, agentEntry] of Object.entries(body.agents ?? {})) {
			if (agentEntry.error !== undefined) {
				agents[agentId] = { error: agentEntry.error };
				continue;
			}
			const review = agentEntry.review;
			if (review === undefined) {
				agents[agentId] = { error: "missing review" };
				continue;
			}
			const cell = classifyVerdict(review);
			if (cell.kind === "PASS") continue;
			if (cell.kind === "SKIPPED") {
				agents[agentId] = { skipped: cell.reason };
				continue;
			}
			agents[agentId] = { pass: false, failures: cell.failures };
		}
		entry.agents = agents;
		out.push(entry);
	}
	return stringifyYaml(out);
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

function readGuidelines(projectRoot: string, p: string): string {
	const abs = isAbsolute(p) ? p : resolve(projectRoot, p);
	if (!existsSync(abs)) return "";
	return readFileSync(abs, "utf8");
}
