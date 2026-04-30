import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type {
	AgentSettings,
	Scenario,
	SkillsmithConfig,
} from "../config/types";
import type { TestingAgentResult } from "./agent-loop";
import type { AgentAlias } from "./agent-normalize";
import type { RunLog } from "./run-log";
import { logUnplumbedSettings, runSdkQuery } from "./sdk-query";
import { loadSkill } from "./skill-loader";

export interface RunTestingAgentParams {
	scenario: Scenario;
	settings: AgentSettings;
	alias: AgentAlias;
	agentWorkspace: string;
	projectRoot: string;
	config: SkillsmithConfig;
	log: RunLog;
}

const TOOL_USE_WARNING_THRESHOLD = 50;

/**
 * Run the testing sub-agent for one (scenario, alias) pair (V2, V17,
 * V19, V20, V22). The system context is the skill blob (V28) plus a
 * workspace constraint and a recursion-decline note. The user message
 * is `scenario.prompt` verbatim.
 *
 * Returns the final assistant text, the count of tool uses, and the
 * list of files added/modified in `agentWorkspace`.
 */
export async function runTestingAgent(
	params: RunTestingAgentParams,
): Promise<TestingAgentResult> {
	const {
		scenario,
		settings,
		alias,
		agentWorkspace,
		projectRoot,
		config,
		log,
	} = params;
	const scope = `scenario:${scenario.name}/agent:${alias}`;

	logUnplumbedSettings(settings, scope, log);

	const skillsRoot = resolve(projectRoot, config.paths.skills);
	const skillBlob = scenario.skills
		.map((id) => loadSkill(id, skillsRoot))
		.join("\n\n");

	const systemPrompt = [
		skillBlob,
		"",
		"# Workspace constraint",
		`Only write files under ${agentWorkspace}. Do not read or modify any files outside this directory.`,
		"",
		"# Recursion guard",
		"You are running inside the skillsmith harness. Do not invoke `skillsmith` or any wrapper that would re-enter the harness.",
	].join("\n");

	const before = snapshotWorkspace(agentWorkspace);

	if (process.env.SKILLSMITH_DRY_RUN === "1") {
		writeFileSync(
			join(agentWorkspace, "dry-run.txt"),
			`dry run for ${alias}\n`,
		);
		const filesWritten = diffSnapshots(
			before,
			snapshotWorkspace(agentWorkspace),
		);
		log.info(
			`testing-agent (${scope}): DRY_RUN files-written=[${filesWritten.join(", ")}]`,
		);
		return { finalText: "dry run", toolUseCount: 0, filesWritten };
	}

	const sdk = await runSdkQuery({
		prompt: scenario.prompt,
		systemPrompt,
		model: settings.model,
		cwd: agentWorkspace,
		tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
	});

	if (sdk.toolUseCount > TOOL_USE_WARNING_THRESHOLD) {
		log.info(
			`tool-use warning (${scope}): ${sdk.toolUseCount} > ${TOOL_USE_WARNING_THRESHOLD}`,
		);
	}

	const filesWritten = diffSnapshots(before, snapshotWorkspace(agentWorkspace));

	log.info(
		`testing-agent (${scope}): tool-uses=${sdk.toolUseCount} files-written=[${filesWritten.join(", ")}]${
			sdk.error ? ` error=${sdk.error}` : ""
		}`,
	);

	const result: TestingAgentResult = {
		finalText: sdk.finalText,
		toolUseCount: sdk.toolUseCount,
		filesWritten,
	};
	if (sdk.error !== undefined) result.error = sdk.error;
	return result;
}

interface FileEntry {
	mtimeMs: number;
	size: number;
}

function snapshotWorkspace(root: string): Map<string, FileEntry> {
	const out = new Map<string, FileEntry>();
	walk(root, root, out);
	return out;
}

function walk(root: string, dir: string, out: Map<string, FileEntry>): void {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of entries) {
		const full = join(dir, name);
		let s: ReturnType<typeof statSync>;
		try {
			s = statSync(full);
		} catch {
			continue;
		}
		if (s.isDirectory()) {
			walk(root, full, out);
		} else if (s.isFile()) {
			const rel = relative(root, full);
			out.set(rel, { mtimeMs: s.mtimeMs, size: s.size });
		}
	}
}

function diffSnapshots(
	before: Map<string, FileEntry>,
	after: Map<string, FileEntry>,
): string[] {
	const written: string[] = [];
	for (const [rel, post] of after) {
		const pre = before.get(rel);
		if (
			pre === undefined ||
			pre.mtimeMs !== post.mtimeMs ||
			pre.size !== post.size
		) {
			written.push(rel);
		}
	}
	return written.sort();
}
