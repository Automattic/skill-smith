import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
	AgentDefinition,
	IterationCompleteHookContext,
	IterationInfo,
	MisconfiguredEntry,
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
- The iteration report below lists every scenario that ran — passing and
  failing — with each judge's full review. Use the failing entries to
  understand *why* a scenario failed (including any verification, e.g.
  end-to-end, failures the judges never saw) and fix the underlying
  guidance, not just the symptom. Use the passing entries to avoid
  regressing what already works.
- Do not commit, push, or run git. Leave your edits in the working tree.
`;

export interface RunImprovementParams {
	projectRoot: string;
	runId: string;
	runDirectory: string;
	iterations: IterationInfo[];
	scenarios: RunScenario[];
	config: SkillsmithConfig;
	agent: AgentDefinition;
	/**
	 * Optional project-specific prompt that fully replaces the built-in
	 * improver instructions. Comes from `config.roles.improver.prompt`.
	 */
	improverPrompt?: string;
	iteration: number;
	iterationDirectory: string;
	iterationReport: IterationReport;
	allScenarios: EnumeratedScenario[];
	log: RunLog;
	/**
	 * Snapshot of the run's misconfiguration ledger (id -> entry), threaded in
	 * from the pipeline so `RunContext.misconfigured` reaches the improver's
	 * hook contexts (KD5/Task 3). The improver runs between sweeps, so a
	 * call-time snapshot is sufficient. Defaults to `{}` when absent.
	 */
	misconfigured?: Record<string, MisconfiguredEntry>;
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
		agent,
		improverPrompt,
		iteration,
		iterationDirectory,
		iterationReport,
		allScenarios,
		log,
		runDirectory,
		iterations,
		scenarios,
		misconfigured,
	} = params;

	log.section(`improvement (after iteration ${iteration})`);

	const baseCtx: IterationCompleteHookContext = {
		runId,
		config,
		runDirectory,
		iterations,
		scenarios,
		// The live misconfigured roster (KD5/Task 3): RunContext.misconfigured
		// reaches every hook context — including the improver's — via the ledger
		// snapshot threaded in from the pipeline. `{}` when none was supplied.
		misconfigured: misconfigured ?? {},
		iteration,
		iterationDirectory,
		pass: iterationReport.pass,
	};

	const context = buildImprovementContext({
		projectRoot,
		config,
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
	const instructions =
		improverPrompt !== undefined && improverPrompt.length > 0
			? improverPrompt
			: DEFAULT_PROMPT;

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
		`# Iteration ${iteration} report`,
		JSON.stringify(context.report, null, 2),
		"",
		"# Skills referenced by the failing scenarios",
		`skill ids: ${context.skillIds.join(", ") || "(none)"}`,
		"",
		context.skillsBlob || "(no skill text available)",
	].join("\n");

	log.info(
		`improver starting: provider=${agent.provider} model=${agent.model} cwd=${skillsDir}`,
	);

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
