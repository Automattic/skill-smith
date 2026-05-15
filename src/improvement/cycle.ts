import type { ResolvedSelfImprovement } from "../config/self-improvement";
import type {
	ExecuteHookContext,
	IterationCompleteHookContext,
	IterationInfo,
	ProposalHookContext,
	ReviewHookContext,
	RunScenario,
	SkillsmithConfig,
} from "../config/types";
import type { IterationReport } from "../reports/iteration-report";
import type { EnumeratedScenario } from "../scenarios/enumerate";
import { tryHook } from "../util/hooks";
import type { RunLog } from "../util/run-log";
import { buildImprovementContext } from "./context";
import { runExecutor } from "./executor";
import { runProposer } from "./proposer";
import { runReviewer } from "./reviewer";

export interface RunImprovementCycleParams {
	projectRoot: string;
	runId: string;
	runDirectory: string;
	iterations: IterationInfo[];
	scenarios: RunScenario[];
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
		runId,
		runDirectory,
		iterations,
		scenarios,
		config,
		selfImprovement,
		iteration,
		iterationDirectory,
		iterationReport,
		allScenarios,
		log,
	} = params;

	log.section(`improvement cycle (after iteration ${iteration})`);

	const baseCtx: IterationCompleteHookContext = {
		runId,
		config,
		runDirectory,
		iterations,
		scenarios,
		iteration,
		iterationDirectory,
		pass: iterationReport.pass,
	};

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

	await tryHook(
		"beforeProposal",
		`iteration:${iteration}`,
		config.hooks?.beforeProposal,
		baseCtx,
		log,
	);

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

	const proposalCtx: ProposalHookContext = {
		...baseCtx,
		proposalPath: proposer.proposalPath,
	};
	await tryHook(
		"afterProposal",
		`iteration:${iteration}`,
		config.hooks?.afterProposal,
		proposalCtx,
		log,
	);

	if (agents.reviewer !== undefined) {
		await tryHook(
			"beforeReview",
			`iteration:${iteration}`,
			config.hooks?.beforeReview,
			proposalCtx,
			log,
		);

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

		const reviewCtx: ReviewHookContext = {
			...proposalCtx,
			reviewedProposalPath: reviewer.reviewedProposalPath,
		};
		await tryHook(
			"afterReview",
			`iteration:${iteration}`,
			config.hooks?.afterReview,
			reviewCtx,
			log,
		);
	} else {
		log.info("improvement cycle: reviewer not configured, skipping");
	}

	const executeBeforeCtx: ProposalHookContext = {
		...baseCtx,
		proposalPath: finalProposalPath,
	};
	await tryHook(
		"beforeExecute",
		`iteration:${iteration}`,
		config.hooks?.beforeExecute,
		executeBeforeCtx,
		log,
	);

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

	const executeAfterCtx: ExecuteHookContext = {
		...executeBeforeCtx,
		skillsDiffPath: executor.skillsDiffPath,
	};
	await tryHook(
		"afterExecute",
		`iteration:${iteration}`,
		config.hooks?.afterExecute,
		executeAfterCtx,
		log,
	);

	return result;
}
