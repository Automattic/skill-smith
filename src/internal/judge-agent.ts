import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { AgentConfig, Scenario, SkillsmithConfig } from "../config/types";
import type { TestingAgentResult } from "./agent-loop";
import { normalizeAgentConfig } from "./agent-normalize";
import type { RunLog } from "./run-log";
import { logUnplumbedSettings, runSdkQuery } from "./sdk-query";

export interface RunJudgeAgentParams {
	scenario: Scenario;
	judgeConfig: AgentConfig;
	agentDirectory: string;
	agentWorkspace: string;
	projectRoot: string;
	config: SkillsmithConfig;
	log: RunLog;
	testingResult: TestingAgentResult;
}

/**
 * Run the judge sub-agent for one (scenario, agent) pair (V1, V10,
 * V13, V18, V22, V29, V30). The judge never sees the skill text.
 *
 * - System: rubric bodies + inline acceptance + a YAML-shape demand.
 * - User: workspace files concatenated with `=== <rel-path> ===`
 *   headers, plus `scenario.description`.
 * - Tools: `Read` only.
 *
 * Output → `${agentDirectory}judge-review.yaml`. Unparseable → write
 * raw + `error: "unparseable"` (V10).
 */
export async function runJudgeAgent(
	params: RunJudgeAgentParams,
): Promise<void> {
	const {
		scenario,
		judgeConfig,
		agentDirectory,
		agentWorkspace,
		projectRoot,
		config,
		log,
		testingResult,
	} = params;
	const scope = `judge:${scenario.name}@${relative(projectRoot, agentDirectory)}`;

	const judgeNorm = normalizeAgentConfig(judgeConfig);
	if (judgeNorm.entries.length === 0) {
		writeReview(agentDirectory, {
			error: "judge has no dispatchable entries",
			skipped: judgeNorm.skipped,
			emptyReason: judgeNorm.emptyReason,
		});
		log.info(`${scope}: no dispatchable judge entries`);
		return;
	}
	if (judgeNorm.entries.length > 1) {
		log.gap("multiJudge", {
			scope,
			used: judgeNorm.entries[0]?.alias,
			ignored: judgeNorm.entries.slice(1).map((e) => e.alias),
		});
	}
	const judgeEntry = judgeNorm.entries[0];
	if (judgeEntry === undefined) return;

	logUnplumbedSettings(judgeEntry.settings, scope, log);

	const systemPrompt = buildJudgeSystemPrompt(scenario, projectRoot, config);
	const userMsg = buildUserMessage(
		scenario,
		agentWorkspace,
		testingResult.filesWritten,
	);

	if (process.env.SKILLSMITH_DRY_RUN === "1") {
		writeReview(agentDirectory, {
			rubrics: Object.fromEntries(
				scenario.rubrics.map((id) => [id, { pass: true, notes: "dry run" }]),
			),
			acceptance: scenario.acceptance.map((item) => ({
				item,
				pass: true,
				notes: "dry run",
			})),
		});
		log.info(`${scope}: DRY_RUN verdict written`);
		return;
	}

	const sdk = await runSdkQuery({
		prompt: userMsg,
		systemPrompt,
		model: judgeEntry.settings.model,
		cwd: agentWorkspace,
		tools: ["Read"],
	});

	if (sdk.error !== undefined) {
		writeReview(agentDirectory, {
			error: `judge dispatch failed: ${sdk.error}`,
			raw: sdk.finalText,
		});
		log.info(`${scope}: dispatch failed — ${sdk.error}`);
		return;
	}

	const parsed = parseJudgeYaml(sdk.finalText);
	if (parsed === undefined) {
		writeReview(agentDirectory, { error: "unparseable", raw: sdk.finalText });
		log.info(`${scope}: judge YAML unparseable, raw stored`);
		return;
	}

	writeReview(agentDirectory, parsed);
	log.info(`${scope}: judge verdict written`);
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

function writeReview(agentDirectory: string, body: unknown): void {
	writeFileSync(join(agentDirectory, "judge-review.yaml"), stringifyYaml(body));
}
