import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
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
	"Respond with a single YAML document and nothing else, in one of two shapes:",
	"- If the proposal is sound: `ack: true`",
	"- If it needs changes:",
	"    ack: false",
	"    revised: |",
	"      <the full revised proposal, in the same markdown format>",
	"Keep edits minimal. Do not invent new failures or scope. Do not invoke `skillsmith`.",
].join("\n");

export type ReviewerOutcome = "ack" | "revised" | "unparsable" | "malformed";

export interface InterpretedReview {
	/** The proposal body to hand downstream to the executor. */
	body: string;
	outcome: ReviewerOutcome;
}

/**
 * Interpret the reviewer's raw output against the original proposal.
 *
 * - `ack: true` → keep the original proposal verbatim.
 * - `ack: false` with a non-empty `revised` → use the revised text.
 * - `ack: false` without `revised` → malformed; keep the original
 *   (the reviewer objected but offered no replacement, so blanking the
 *   proposal would be worse than proceeding with the original).
 * - Unparsable YAML → treat the whole output as a free-form revision,
 *   matching the pre-envelope behaviour for non-conforming reviewers.
 */
export function interpretReviewerOutput(
	rawText: string,
	proposalText: string,
): InterpretedReview {
	const text = rawText.trim();
	let parsed: unknown;
	try {
		parsed = parseYaml(text);
	} catch {
		return { body: text, outcome: "unparsable" };
	}
	if (typeof parsed !== "object" || parsed === null || !("ack" in parsed)) {
		return { body: text, outcome: "unparsable" };
	}
	const env = parsed as { ack?: unknown; revised?: unknown };
	if (env.ack === true) {
		return { body: proposalText, outcome: "ack" };
	}
	if (typeof env.revised === "string" && env.revised.trim().length > 0) {
		return { body: env.revised, outcome: "revised" };
	}
	return { body: proposalText, outcome: "malformed" };
}

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

	const { body, outcome } = interpretReviewerOutput(
		result.finalText,
		proposalText,
	);
	writeFileSync(reviewedPath, body);
	log.info(`reviewer ${outcome}; wrote ${reviewedPath}`);
	return { reviewedProposalPath: reviewedPath };
}
