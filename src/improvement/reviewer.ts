import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDefinition } from "../config/types";
import { getProvider } from "../providers/registry";
import type { RunLog } from "../util/run-log";
import type { ImprovementContext } from "./context";

export interface RunReviewerParams {
	projectRoot: string;
	agent: AgentDefinition;
	context: ImprovementContext;
	iteration: number;
	iterationDirectory: string;
	proposalPath: string;
	log: RunLog;
}

export interface ReviewerResult {
	reviewedProposalPath: string;
	error?: string;
}

const SYSTEM_PROMPT = [
	"You are the reviewer sub-agent in the skillsmith self-improvement loop.",
	"You receive a proposal authored by the proposer and the failure context that prompted it.",
	"Your job:",
	'- If the proposal is sound, return the proposal verbatim, prefixed with a single line "ACK".',
	"- If it has problems, return a revised proposal in the same markdown format. Keep edits minimal.",
	"Do not invent new failures or scope. Do not invoke `skillsmith`.",
].join("\n");

/**
 * Invoke the reviewer sub-agent against the proposer's output. Writes
 * `${iterationDirectory}/proposal.reviewed.md`. If the reviewer ACKs,
 * the file mirrors the original proposal so downstream consumers can
 * always read a single canonical path.
 */
export async function runReviewer(
	params: RunReviewerParams,
): Promise<ReviewerResult> {
	const {
		projectRoot,
		agent,
		context,
		iteration,
		iterationDirectory,
		proposalPath,
		log,
	} = params;

	const proposalText = readFileSync(proposalPath, "utf8");

	const userMessage = [
		`# Iteration ${iteration} failures`,
		context.failureSummary,
		"",
		"# Proposal under review",
		proposalText,
	].join("\n");

	log.info(
		`reviewer starting: provider=${agent.provider} model=${agent.model}`,
	);

	const provider = getProvider(agent.provider);
	const result = await provider.invoke({
		agent,
		systemPrompt: SYSTEM_PROMPT,
		prompt: userMessage,
		cwd: projectRoot,
		role: "judge",
	});

	const reviewedPath = join(iterationDirectory, "proposal.reviewed.md");
	if (result.error !== undefined) {
		writeFileSync(
			reviewedPath,
			`<!-- reviewer error: ${result.error} — falling back to original proposal -->\n\n${proposalText}`,
		);
		log.info(`reviewer error: ${result.error}; using original proposal`);
		return { reviewedProposalPath: reviewedPath, error: result.error };
	}

	const text = result.finalText.trim();
	const body = text.startsWith("ACK") ? proposalText : result.finalText;
	writeFileSync(reviewedPath, body);
	log.info(
		text.startsWith("ACK")
			? `reviewer ACK'd; wrote ${reviewedPath}`
			: `reviewer revised; wrote ${reviewedPath}`,
	);
	return { reviewedProposalPath: reviewedPath };
}
