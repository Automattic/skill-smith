import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type {
	AgentDefinition,
	Scenario,
	SkillsmithConfig,
} from "../config/types";
import { getProvider } from "../providers/registry";
import { parseAgentJson } from "../util/parse-agent-json";
import type { RunLog } from "../util/run-log";
import type { TestingAgentResult } from "./agent-loop";

export interface RunJudgeAgentParams {
	scenario: Scenario;
	judge: AgentDefinition;
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
 * Returns the review object — `{ rubrics, acceptance }` on success, or
 * an error-shaped payload on the failure paths. The judge emits a
 * single JSON object (no YAML). The caller (`agent-loop.ts`) is the
 * single writer of the per-agent `report.json`, embedding this under
 * the `review` key.
 */
export async function runJudgeAgent(
	params: RunJudgeAgentParams,
): Promise<unknown> {
	const {
		scenario,
		judge,
		agentDirectory,
		agentWorkspace,
		projectRoot,
		config,
		log,
		testingResult,
	} = params;
	const scope = `judge:${scenario.name}@${relative(projectRoot, agentDirectory)}`;

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

	const parsed = parseAgentJson(result.finalText);
	if (parsed === undefined) {
		log.info(`${scope}: judge JSON unparseable, raw stored`);
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

	const rubricIdList = scenario.rubrics.map((id) => `  - ${id}`).join("\n");
	const jsonInstruction = [
		"# Output format",
		"You are grading an implementation against the rubrics above. Do not consult any skill documentation.",
		"Return a single JSON object with exactly these two top-level keys (siblings, not nested):",
		"  {",
		'    "rubrics": {',
		'      "<rubric-id>": { "pass": <bool>, "notes": "<string>" }',
		"    },",
		'    "acceptance": [',
		'      { "item": "<string>", "pass": <bool>, "notes": "<string>" }',
		"    ]",
		"  }",
		"`rubrics` is a record keyed by rubric id; `acceptance` is an array. They MUST be siblings at the top level — never nest `acceptance` inside `rubrics`.",
		"`rubrics` MUST contain exactly one entry per rubric file provided above, keyed by the file's id (the value after `# Rubric:`). Do NOT invent extra keys by splitting a rubric file along its `##` headings or bullet points; fold all sub-section findings for a rubric into that single entry's `notes`. `pass` is true only if every requirement in the rubric file is satisfied.",
		"The keys of `rubrics` MUST be exactly:",
		rubricIdList,
		'`notes` and `item` are JSON strings: escape literal newlines as \\n, double quotes as \\", and backslashes as \\\\. There is no YAML-style `|` block scalar in JSON.',
		"Strict JSON only: no trailing commas, no comments, no single-quoted strings.",
		"Do not output any prose or Markdown fences — only the JSON object.",
		"",
		"# Recursion guard",
		"Do not invoke `skillsmith` or any wrapper that would re-enter the harness.",
	].join("\n");

	const sections = [...rubricBlobs, acceptanceBlock, jsonInstruction];
	const rolePrompt = config.roles.judge.prompt;
	if (rolePrompt !== undefined && rolePrompt.length > 0) {
		sections.push(`# Role instructions\n${rolePrompt}`);
	}
	return sections.join("\n\n");
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
