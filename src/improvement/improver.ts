import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ResolvedSelfImprovement } from "../config/self-improvement";
import type {
	AgentDefinition,
	IterationCompleteHookContext,
	IterationInfo,
	RunScenario,
	SkillsmithConfig,
} from "../config/types";
import { getProvider } from "../providers/registry";
import type { IterationReport } from "../reports/iteration-report";
import type { EnumeratedScenario } from "../scenarios/enumerate";
import { tryHook } from "../util/hooks";
import type { RunLog } from "../util/run-log";
import { buildImprovementContext } from "./context";

const DEFAULT_PROMPT = `# Improver instructions

You are the improver agent in the skillsmith self-improvement loop. The
scenarios below failed, and your job is to edit the SKILL.md files (and
their supporting files) so the next iteration passes.

- Work directly in your cwd, which is the skills root. Edit the files in
  place — there is no proposal step and no separate executor.
- Touch only the skills referenced by the failing scenarios.
- Make the smallest change that addresses the failures. Prefer additive,
  surgical edits over rewrites; every line should earn its place.
- Use the failure summary to understand *why* each scenario failed,
  including any verification (e.g. end-to-end) failures the judges never
  saw, and fix the underlying guidance — not just the symptom.
- Do not commit, push, or run git. Leave your edits in the working tree.
`;

export interface RunImprovementParams {
	projectRoot: string;
	runId: string;
	runDirectory: string;
	iterations: IterationInfo[];
	scenarios: RunScenario[];
	config: SkillsmithConfig;
	selfImprovement: ResolvedSelfImprovement;
	agent: AgentDefinition;
	iteration: number;
	iterationDirectory: string;
	iterationReport: IterationReport;
	allScenarios: EnumeratedScenario[];
	log: RunLog;
}

export interface ImprovementResult {
	improvementPath?: string;
	skipped?: string;
}

/**
 * Run the single improver agent between iteration N and N+1. The agent
 * runs with role=testing (Read/Write/Edit/Glob/Grep/Bash) and a cwd
 * jailed to `paths.skills`, so any edit lands inside the skill tree. It
 * edits the files directly — no proposal, no reviewer, no executor, and
 * no git. Its transcript is written to `iteration-N/improvement.md` for
 * the evidence trail. Errors are logged; the loop keeps moving.
 */
export async function runImprovement(
	params: RunImprovementParams,
): Promise<ImprovementResult> {
	const {
		projectRoot,
		runId,
		config,
		selfImprovement,
		agent,
		iteration,
		iterationDirectory,
		iterationReport,
		allScenarios,
		log,
		runDirectory,
		iterations,
		scenarios,
	} = params;

	log.section(`improvement (after iteration ${iteration})`);

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

	const context = buildImprovementContext({
		projectRoot,
		config,
		selfImprovement,
		iterationReport,
		allScenarios,
	});

	await tryHook(
		"beforeImprove",
		`iteration:${iteration}`,
		config.hooks?.beforeImprove,
		baseCtx,
		log,
	);

	const skillsDir = resolve(projectRoot, config.paths.skills);
	const instructions = context.improverPrompt ?? DEFAULT_PROMPT;

	const systemPrompt = [
		"You are the improver agent in the skillsmith self-improvement loop.",
		`Your working directory is the skills root: ${skillsDir}.`,
		"You have Read/Write/Edit/Glob/Grep/Bash tools — use them to edit the skills in place.",
		"",
		instructions,
		"",
		"# Recursion guard",
		"Do not invoke `skillsmith` or any wrapper that would re-enter the harness.",
	].join("\n");

	const userMessage = [
		`# Iteration ${iteration} failures`,
		context.failureSummary,
		"",
		"# Skills referenced by the failing scenarios",
		`skill ids: ${context.skillIds.join(", ") || "(none)"}`,
		"",
		context.skillsBlob || "(no skill text available)",
	].join("\n");

	log.info(`improver starting: provider=${agent.provider} model=${agent.model} cwd=${skillsDir}`);

	const provider = getProvider(agent.provider);
	const result = await provider.invoke({
		agent,
		systemPrompt,
		prompt: userMessage,
		cwd: skillsDir,
		role: "testing",
	});

	const improvementPath = join(iterationDirectory, "improvement.md");
	const body =
		result.error !== undefined
			? `<!-- improver error: ${result.error} -->\n\n${result.finalText}`
			: result.finalText;
	writeFileSync(improvementPath, body);

	if (result.error !== undefined) {
		log.info(`improver error: ${result.error}`);
	} else {
		log.info(`improver done: tool-uses=${result.toolUseCount}`);
	}

	await tryHook(
		"afterImprove",
		`iteration:${iteration}`,
		config.hooks?.afterImprove,
		{ ...baseCtx, improvementPath },
		log,
	);

	return { improvementPath };
}
