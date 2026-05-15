import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
	AgentDefinition,
	Scenario,
	SkillsmithConfig,
} from "../config/types";
import { getProvider } from "../providers/registry";
import type { RunLog } from "../util/run-log";
import type { TestingAgentResult } from "./agent-loop";

export interface RunJudgeAgentParams {
	scenario: Scenario;
	judges: AgentDefinition[];
	agentDirectory: string;
	agentWorkspace: string;
	projectRoot: string;
	config: SkillsmithConfig;
	log: RunLog;
	testingResult: TestingAgentResult;
}

/**
 * Run the judge sub-agent for one (scenario, agent) pair. The judge
 * never sees the skill text — only the rubrics, the inline acceptance
 * items, and the files the testing agent produced.
 *
 * If `judges` has more than one entry the harness uses the first and
 * logs a `multiJudge` gap; cross-judge aggregation is not yet defined.
 *
 * Returns the review object — `{ rubrics, acceptance }` on success, or
 * an error-shaped payload on the failure paths. The caller
 * (`agent-loop.ts`) is the single writer of the per-agent
 * `report.yaml`, embedding this under the `review` key.
 */
export async function runJudgeAgent(
	params: RunJudgeAgentParams,
): Promise<unknown> {
	const {
		scenario,
		judges,
		agentDirectory,
		agentWorkspace,
		projectRoot,
		config,
		log,
		testingResult,
	} = params;
	const scope = `judge:${scenario.name}@${relative(projectRoot, agentDirectory)}`;

	const judge = judges[0];
	if (judge === undefined) {
		log.info(`${scope}: no judge configured`);
		return { error: "no judge configured" };
	}
	if (judges.length > 1) {
		log.gap("multiJudge", {
			scope,
			used: judge.id,
			ignored: judges.slice(1).map((j) => j.id),
		});
	}

	const systemPrompt = buildJudgeSystemPrompt(scenario, projectRoot, config);
	const userMsg = buildUserMessage(
		scenario,
		agentWorkspace,
		testingResult.filesWritten,
	);

	log.info(
		`${scope}: judge starting provider=${judge.provider} model=${judge.model}`,
	);

	const provider = getProvider(judge.provider);
	const result = await provider.invoke({
		agent: judge,
		systemPrompt,
		prompt: userMsg,
		cwd: agentWorkspace,
		role: "judge",
	});

	if (result.error !== undefined) {
		log.info(`${scope}: dispatch failed — ${result.error}`);
		return {
			error: `judge dispatch failed: ${result.error}`,
			raw: result.finalText,
		};
	}

	const parsed = parseJudgeYaml(result.finalText);
	if (parsed === undefined) {
		log.info(`${scope}: judge YAML unparseable, raw stored`);
		return {
			error: "unparseable",
			raw: result.finalText,
		};
	}

	log.info(`${scope}: judge verdict written`);
	return parsed;
}

function buildJudgeSystemPrompt(
	scenario: Scenario,
	projectRoot: string,
	config: SkillsmithConfig,
): string {
	const rubricsRoot = resolve(projectRoot, config.paths.rubrics);
	const rubricBlobs = scenario.rubrics.map((id) => {
		const path = join(rubricsRoot, `${id}.md`);
		const body = existsSync(path) ? readFileSync(path, "utf8") : "TO BE FILLED";
		return `# Rubric: ${id}\n${body}`;
	});

	const acceptanceBlock = [
		"# Scenario acceptance",
		"Evaluate whether the produced code satisfies each item below.",
		...scenario.acceptance.map((item) => `- ${item}`),
	].join("\n");

	const yamlInstruction = [
		"# Output format",
		"You are grading an implementation against the rubrics above. Do not consult any skill documentation.",
		"Return a YAML document with these top-level keys:",
		"  rubrics: { <rubric-id>: { pass: <bool>, notes: <string> } }",
		"  acceptance: [{ item: <string>, pass: <bool>, notes: <string> }]",
		"Do not output anything else.",
		"",
		"# Recursion guard",
		"Do not invoke `skillsmith` or any wrapper that would re-enter the harness.",
	].join("\n");

	return [...rubricBlobs, acceptanceBlock, yamlInstruction].join("\n\n");
}

function parseJudgeYaml(finalText: string): object | undefined {
	const trimmed = finalText.trim();
	const fence = trimmed.match(/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/);
	const yamlText = fence?.[1] ?? trimmed;
	let parsed: unknown;
	try {
		parsed = parseYaml(yamlText);
	} catch {
		return undefined;
	}
	if (parsed === null || typeof parsed !== "object") return undefined;
	return parsed;
}

function buildUserMessage(
	scenario: Scenario,
	workspace: string,
	filesWritten: string[],
): string {
	const sections: string[] = [];
	for (const rel of filesWritten) {
		const full = join(workspace, rel);
		if (!existsSync(full)) continue;
		let body: string;
		try {
			body = readFileSync(full, "utf8");
		} catch (err) {
			body = `<read error: ${err instanceof Error ? err.message : String(err)}>`;
		}
		sections.push(`=== ${rel} ===\n${body}`);
	}
	if (sections.length === 0) sections.push("=== (no files written) ===");
	sections.push("\n--\n", scenario.description);
	return sections.join("\n");
}
