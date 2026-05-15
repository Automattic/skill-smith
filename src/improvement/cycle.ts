import type { ResolvedSelfImprovement } from "../config/self-improvement";
import type { SkillsmithConfig } from "../config/types";
import type { IterationReport } from "../reports/iteration-report";
import type { EnumeratedScenario } from "../scenarios/enumerate";
import type { RunLog } from "../util/run-log";
import { buildImprovementContext } from "./context";
import { runExecutor } from "./executor";
import { runProposer } from "./proposer";
import { runReviewer } from "./reviewer";

export interface RunImprovementCycleParams {
	projectRoot: string;
	config: SkillsmithConfig;
	selfImprovement: ResolvedSelfImprovement;
	iteration: number;
	iterationDirectory: string;
	iterationReport: IterationReport;
	allScenarios: EnumeratedScenario[];
	log: RunLog;
}

export interface ImprovementCycleResult {
	proposalPath?: string;
	reviewedProposalPath?: string;
	skillsDiffPath?: string;
	skipped?: string;
}

/**
 * Drive the proposer → (reviewer) → executor cycle between iteration
 * N and N+1. Both proposer and executor agents are required — without
 * either, the cycle is a no-op and the pipeline falls through to the
 * next iteration without applying any edits. Errors in any sub-agent
 * are logged; the loop keeps moving.
 */
export async function runImprovementCycle(
	params: RunImprovementCycleParams,
): Promise<ImprovementCycleResult> {
	const {
		projectRoot,
		config,
		selfImprovement,
		iteration,
		iterationDirectory,
		iterationReport,
		allScenarios,
		log,
	} = params;

	log.section(`improvement cycle (after iteration ${iteration})`);

	const agents = selfImprovement.agents;
	if (agents.proposer === undefined || agents.executor === undefined) {
		const reason =
			"selfImprovement.agents.proposer and .executor are required for loop mode";
		log.info(`improvement cycle: skipped — ${reason}`);
		return { skipped: reason };
	}

	const context = buildImprovementContext({
		projectRoot,
		config,
		selfImprovement,
		iterationReport,
		allScenarios,
	});

	const proposer = await runProposer({
		projectRoot,
		agent: agents.proposer,
		context,
		iteration,
		iterationDirectory,
		log,
	});

	const result: ImprovementCycleResult = { proposalPath: proposer.proposalPath };
	let finalProposalPath = proposer.proposalPath;

	if (agents.reviewer !== undefined) {
		const reviewer = await runReviewer({
			projectRoot,
			agent: agents.reviewer,
			context,
			iteration,
			iterationDirectory,
			proposalPath: proposer.proposalPath,
			log,
		});
		finalProposalPath = reviewer.reviewedProposalPath;
		result.reviewedProposalPath = reviewer.reviewedProposalPath;
	} else {
		log.info("improvement cycle: reviewer not configured, skipping");
	}

	const executor = await runExecutor({
		projectRoot,
		config,
		agent: agents.executor,
		context,
		iteration,
		iterationDirectory,
		proposalPath: finalProposalPath,
		log,
	});
	result.skillsDiffPath = executor.skillsDiffPath;

	return result;
}
