import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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
 * an error-shaped payload on the failure paths. The judge emits a
 * single JSON object (no YAML); the parser then runs `normalizeReview`
 * (which lifts known shape drifts such as `acceptance` nested under
 * `rubrics`) and `validateReview` (which surfaces remaining misshape
 * as a `judge output malformed: …` error). The caller
 * (`agent-loop.ts`) is the single writer of the per-agent
 * `report.json`, embedding this under the `review` key.
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

	const parsed = parseJudgeJson(result.finalText);
	if (parsed === undefined) {
		log.info(`${scope}: judge JSON unparseable, raw stored`);
		return {
			error: "unparseable",
			raw: result.finalText,
		};
	}

	const normalized = normalizeReview(parsed);
	const validation = validateReview(normalized);
	if (validation !== undefined) {
		log.info(`${scope}: ${validation}`);
		return {
			error: validation,
			raw: result.finalText,
		};
	}

	log.info(`${scope}: judge verdict written`);
	return normalized;
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
		'`rubrics` is a record keyed by rubric id; `acceptance` is an array. They MUST be siblings at the top level — never nest `acceptance` inside `rubrics`.',
		'`notes` and `item` are JSON strings: escape literal newlines as \\n, double quotes as \\", and backslashes as \\\\. There is no YAML-style `|` block scalar in JSON.',
		"Strict JSON only: no trailing commas, no comments, no single-quoted strings.",
		"Do not output any prose or Markdown fences — only the JSON object.",
		"",
		"# Recursion guard",
		"Do not invoke `skillsmith` or any wrapper that would re-enter the harness.",
	].join("\n");

	return [...rubricBlobs, acceptanceBlock, jsonInstruction].join("\n\n");
}

function parseJudgeJson(finalText: string): object | undefined {
	const trimmed = finalText.trim();
	const fence = trimmed.match(/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/);
	const jsonText = fence?.[1] ?? trimmed;
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch {
		return undefined;
	}
	if (parsed === null || typeof parsed !== "object") return undefined;
	return parsed;
}

/**
 * Producer-side belt-and-suspenders salvage of known judge-output
 * shape drifts. Specifically: if `acceptance` is missing or empty at
 * the top level but appears nested under `rubrics` as an array, lift
 * it to the top level and delete the nested key. This is the salvage
 * for the historic `shared-state` regression where the judge
 * indented `acceptance:` one level too deep in YAML.
 *
 * Any future shape drift the producer learns to handle should be
 * added here, not to `classifyVerdict` in `src/reports/verdict.ts`.
 */
function normalizeReview(parsed: object): object {
	const v = parsed as Record<string, unknown>;
	const rubrics = v.rubrics;
	const topLevelAcceptance = v.acceptance;
	const nestedAcceptanceMissing =
		topLevelAcceptance === undefined ||
		(Array.isArray(topLevelAcceptance) && topLevelAcceptance.length === 0);
	if (
		nestedAcceptanceMissing &&
		rubrics !== null &&
		typeof rubrics === "object" &&
		!Array.isArray(rubrics)
	) {
		const r = rubrics as Record<string, unknown>;
		if (Array.isArray(r.acceptance)) {
			v.acceptance = r.acceptance;
			delete r.acceptance;
		}
	}
	return v;
}

/**
 * Producer-side shape validator. Returns an error diagnostic string
 * when the parsed/normalized judge output doesn't match the expected
 * contract; returns `undefined` when the shape is well-formed. The
 * caller turns the diagnostic into an `{ error, raw }` payload so the
 * FAIL row carries a useful message instead of masquerading as a
 * content failure.
 */
function validateReview(parsed: object): string | undefined {
	const v = parsed as Record<string, unknown>;

	// `skipped` / `error` payloads are well-formed alternative shapes;
	// they don't carry rubrics/acceptance and shouldn't be validated as such.
	if (typeof v.skipped === "string") return undefined;
	if (typeof v.error === "string") return undefined;

	const rubrics = v.rubrics;
	if (rubrics === null) {
		return "judge output malformed: rubrics is null";
	}
	if (rubrics !== undefined) {
		if (Array.isArray(rubrics) || typeof rubrics !== "object") {
			return "judge output malformed: rubrics must be a record";
		}
	}

	const acceptance = v.acceptance;
	if (acceptance !== undefined && !Array.isArray(acceptance)) {
		return "judge output malformed: acceptance must be an array";
	}
	if (Array.isArray(acceptance)) {
		for (const a of acceptance) {
			if (a === null || typeof a !== "object") {
				return "judge output malformed: acceptance entry missing pass";
			}
			if (!("pass" in (a as Record<string, unknown>))) {
				return "judge output malformed: acceptance entry missing pass";
			}
		}
	}

	return undefined;
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
