import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentDefinition, SkillsmithConfig } from "../config/types";
import { getProvider } from "../providers/registry";
import type { RunLog } from "../util/run-log";
import type { ImprovementContext } from "./context";

const DEFAULT_GUIDELINES = `# Default executor guidelines

- Apply the proposal to the SKILL.md files in your cwd. Touch only the files named in the proposal.
- Make minimal edits — match the proposed text exactly, don't reformat or add commentary.
- Do not commit, do not push. Leave changes in the working tree for human review.
`;

export interface RunExecutorParams {
	projectRoot: string;
	config: SkillsmithConfig;
	agent: AgentDefinition;
	context: ImprovementContext;
	iteration: number;
	iterationDirectory: string;
	proposalPath: string;
	log: RunLog;
}

export interface ExecutorResult {
	skillsDiffPath: string;
	error?: string;
}

/**
 * Invoke the executor sub-agent. It runs with role=testing (Read,
 * Write, Edit, Bash) and cwd jailed to `paths.skills`, so any write
 * lands inside the skill tree. After it returns, the harness captures
 * `git diff` for the skills directory into
 * `${iterationDirectory}/skills.diff`. The diff lives in the working
 * tree so a human can review it before committing.
 */
export async function runExecutor(
	params: RunExecutorParams,
): Promise<ExecutorResult> {
	const {
		projectRoot,
		config,
		agent,
		context,
		iteration,
		iterationDirectory,
		proposalPath,
		log,
	} = params;

	const skillsDir = resolve(projectRoot, config.paths.skills);
	const guidelines = context.executorGuidelines ?? DEFAULT_GUIDELINES;
	const proposalText = readFileSync(proposalPath, "utf8");

	const systemPrompt = [
		"You are the executor sub-agent in the skillsmith self-improvement loop.",
		`Your working directory is the skills root: ${skillsDir}.`,
		"You have Read/Write/Edit/Glob/Grep/Bash tools. Use them to apply the proposal below.",
		"",
		guidelines,
		"",
		"# Recursion guard",
		"Do not invoke `skillsmith` or any wrapper that would re-enter the harness.",
	].join("\n");

	const userMessage = [
		`# Iteration ${iteration} proposal`,
		proposalText,
	].join("\n");

	log.info(
		`executor starting: provider=${agent.provider} model=${agent.model} cwd=${skillsDir}`,
	);

	const provider = getProvider(agent.provider);
	const result = await provider.invoke({
		agent,
		systemPrompt,
		prompt: userMessage,
		cwd: skillsDir,
		role: "testing",
	});

	if (result.error !== undefined) {
		log.info(`executor error: ${result.error}`);
	} else {
		log.info(`executor done: tool-uses=${result.toolUseCount}`);
	}

	const skillsDiffPath = join(iterationDirectory, "skills.diff");
	writeFileSync(skillsDiffPath, captureSkillsDiff(projectRoot, skillsDir));

	const out: ExecutorResult = { skillsDiffPath };
	if (result.error !== undefined) out.error = result.error;
	return out;
}

function captureSkillsDiff(projectRoot: string, skillsDir: string): string {
	try {
		const buf = execSync(`git diff -- "${skillsDir}"`, {
			cwd: projectRoot,
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
		});
		return buf;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return `# could not capture git diff: ${msg}\n`;
	}
}
