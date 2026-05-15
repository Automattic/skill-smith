import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDefinition } from "../config/types";
import { getProvider } from "../providers/registry";
import type { RunLog } from "../util/run-log";
import type { ImprovementContext } from "./context";

const DEFAULT_GUIDELINES = `# Default proposer guidelines

- Propose the minimum change to the listed SKILL.md files that addresses the failures.
- Prefer additive edits over rewrites.
- Keep each file concise — every line should earn its place.
- Touch only the skills named below.
- Output: a markdown document that, for each file to edit, gives a short rationale and the exact replacement (or insertion) the executor should apply.
`;

export interface RunProposerParams {
	projectRoot: string;
	agent: AgentDefinition;
	context: ImprovementContext;
	iteration: number;
	iterationDirectory: string;
	log: RunLog;
}

export interface ProposerResult {
	proposalPath: string;
	error?: string;
}

/**
 * Invoke the proposer sub-agent on the failures from iteration N and
 * write its full output to `${iterationDirectory}/proposal.md`. The
 * proposer runs read-only (role=judge); the executor is what actually
 * applies the edits.
 */
export async function runProposer(
	params: RunProposerParams,
): Promise<ProposerResult> {
	const { projectRoot, agent, context, iteration, iterationDirectory, log } =
		params;

	const guidelines = context.proposerGuidelines ?? DEFAULT_GUIDELINES;

	const systemPrompt = [
		"You are the proposer sub-agent in the skillsmith self-improvement loop.",
		"Your output is consumed by an executor agent that will mechanically apply your edits to the SKILL.md files.",
		"",
		guidelines,
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
		"",
		"# Task",
		"Write a markdown proposal that:",
		"- Lists each file to edit (use relative paths under the skills root).",
		"- Gives a one-line rationale per file.",
		"- For each edit, supplies the exact old text and the exact new text. Use fenced blocks.",
		"Keep the diff minimal. Do not propose changes outside the listed skills.",
	].join("\n");

	log.info(
		`proposer starting: provider=${agent.provider} model=${agent.model}`,
	);

	const provider = getProvider(agent.provider);
	const result = await provider.invoke({
		agent,
		systemPrompt,
		prompt: userMessage,
		cwd: projectRoot,
		role: "judge",
	});

	const proposalPath = join(iterationDirectory, "proposal.md");
	const body =
		result.error !== undefined
			? `<!-- proposer error: ${result.error} -->\n\n${result.finalText}`
			: result.finalText;
	writeFileSync(proposalPath, body);

	if (result.error !== undefined) {
		log.info(`proposer error: ${result.error}`);
		return { proposalPath, error: result.error };
	}
	log.info(`proposer wrote ${proposalPath}`);
	return { proposalPath };
}
