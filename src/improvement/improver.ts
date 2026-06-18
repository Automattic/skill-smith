import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
import { readSkillsRoot } from "./read-skills-root";
import { runValidator } from "./validator";
import type { ValidatorFinding } from "./validator-verdict";

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
	/**
	 * The FULL enumerated scenario corpus (before any `--scenarios` filter),
	 * threaded to the validator so its breadth test is sound (§4.3). Distinct
	 * from `allScenarios`, which is the filtered run subset the improver edits.
	 */
	corpus: EnumeratedScenario[];
	/** Cap on validator revise rounds when a validator is configured (§8.2). */
	maxValidationRounds: number;
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
		agent,
		improverPrompt,
		iteration,
		iterationDirectory,
		iterationReport,
		allScenarios,
		corpus,
		maxValidationRounds,
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

	const improvementPath = join(iterationDirectory, "improvement.md");

	/**
	 * One improver pass. On round 0 (`findings === undefined`) the user
	 * message is byte-identical to the single pre-validator invoke and
	 * `improvement.md` is written. On a revise round (`findings !== undefined`)
	 * the validator's findings are appended to the USER message with each
	 * `span` verbatim (§2.0 rule 1) — so the improver can locate the offending
	 * substring — and the improver re-edits the skills in place WITHOUT
	 * rewriting `improvement.md` (§2.0 rule 2). `improvementPath` is the same
	 * round-0 path on every call.
	 */
	const invokeImprover = async (
		findings: ValidatorFinding[] | undefined,
	): Promise<{ improvementPath: string }> => {
		const userMessage = [
			`# Iteration ${iteration} report`,
			JSON.stringify(context.report, null, 2),
			"",
			"# Skills referenced by the failing scenarios",
			`skill ids: ${context.skillIds.join(", ") || "(none)"}`,
			"",
			context.skillsBlob || "(no skill text available)",
			...(findings !== undefined ? ["", renderFindings(findings)] : []),
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

		// `improvement.md` is the round-0 transcript and is written ONCE, on
		// the round-0 call (§2.0 rule 2 / §9.3). Revise rounds re-edit in place
		// and log but do not clobber it.
		if (findings === undefined) {
			const body =
				result.error !== undefined
					? `<!-- improver error: ${result.error} -->\n\n${result.finalText}`
					: result.finalText;
			writeFileSync(improvementPath, body);
		}

		if (result.error !== undefined) {
			log.info(`improver error: ${result.error}`);
		} else {
			log.info(`improver done: tool-uses=${result.toolUseCount}`);
		}

		return { improvementPath };
	};

	let result = await invokeImprover(undefined);

	if (config.roles.validator === undefined) {
		// No-validator path: round 0 already ran the single improver pass,
		// wrote improvement.md, and logged. Nothing else runs — this branch is
		// byte-identical to the pre-validator behavior (C4/AC4).
	} else {
		const validator = config.roles.validator;
		let round = 0; // counts REVISE rounds TAKEN
		while (true) {
			const after = readSkillsRoot(skillsDir);
			const outcome = await runValidator({
				skillsBlob: after,
				corpus,
				config,
				projectRoot,
				agent: validator.agent,
				validatorPrompt: validator.prompt,
				iterationDirectory,
				round,
				log,
			});
			// Approve OR fail-open → break (the validator never reverts).
			if (outcome.verdict !== "revise") break;
			// Cap check AFTER each validation, BEFORE the next improver invoke:
			// the terminal validation of the last un-revised edit always runs
			// (§2.1). On the cap we KEEP the last edit and warn — no revert (D2).
			if (round >= maxValidationRounds) {
				log.info("WARNING: validation cap reached without approval");
				break;
			}
			round++;
			result = await invokeImprover(outcome.findings);
		}
	}

	await tryHook(
		"afterImprove",
		`iteration:${iteration}`,
		config.hooks?.afterImprove,
		{ ...baseCtx, improvementPath: result.improvementPath },
		log,
	);

	return { improvementPath: result.improvementPath };
}

/**
 * Render the validator's findings as a `# Validator findings` section for the
 * improver's USER message. Each finding is listed as
 * `[<leak_type>] <span> — <why>; fix: <suggested_fix>` with the `span`
 * verbatim, so the improver can locate the offending substring (§2.0 rule 1).
 */
function renderFindings(findings: ValidatorFinding[]): string {
	return [
		"# Validator findings",
		...findings.map(
			(f) => `[${f.leak_type}] ${f.span} — ${f.why}; fix: ${f.suggested_fix}`,
		),
	].join("\n");
}
