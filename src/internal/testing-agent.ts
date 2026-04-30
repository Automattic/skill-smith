import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
	AgentSettings,
	Scenario,
	SkillsmithConfig,
} from "../config/types";
import type { TestingAgentResult } from "./agent-loop";
import type { AgentAlias } from "./agent-normalize";
import type { RunLog } from "./run-log";
import { mapSettings } from "./sdk-passthrough";
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

const TESTING_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"];
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

	const sdkOpts = mapSettings(settings);
	if (Object.keys(sdkOpts.unplumbed).length > 0) {
		log.gap("unplumbedSettings", { scope, settings: sdkOpts.unplumbed });
	}

	const skillsRoot = resolve(projectRoot, config.paths.skills);
	const skillSections = scenario.skills.map((id) => loadSkill(id, skillsRoot));
	const skillBlob = skillSections.join("\n\n");

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

	let toolUseCount = 0;
	let finalText = "";
	let errorMsg: string | undefined;

	try {
		const stream = query({
			prompt: scenario.prompt,
			options: {
				model: sdkOpts.model,
				cwd: agentWorkspace,
				systemPrompt,
				tools: TESTING_TOOLS,
				permissionMode: "bypassPermissions",
				allowDangerouslySkipPermissions: true,
			},
		});

		for await (const message of stream) {
			if (message.type === "assistant") {
				for (const block of message.message.content ?? []) {
					if (block.type === "tool_use") toolUseCount++;
					if (block.type === "text") finalText = block.text;
				}
			} else if (message.type === "result") {
				if (message.subtype === "success") {
					finalText = message.result;
				} else {
					errorMsg = `result.${message.subtype}`;
				}
			}
		}
	} catch (err) {
		errorMsg = err instanceof Error ? err.message : String(err);
	}

	if (toolUseCount > TOOL_USE_WARNING_THRESHOLD) {
		log.info(
			`tool-use warning (${scope}): ${toolUseCount} > ${TOOL_USE_WARNING_THRESHOLD}`,
		);
	}

	const after = snapshotWorkspace(agentWorkspace);
	const filesWritten = diffSnapshots(before, after);

	log.info(
		`testing-agent (${scope}): tool-uses=${toolUseCount} files-written=[${filesWritten.join(", ")}]${
			errorMsg ? ` error=${errorMsg}` : ""
		}`,
	);

	const result: TestingAgentResult = { finalText, toolUseCount, filesWritten };
	if (errorMsg !== undefined) result.error = errorMsg;
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
		if (pre === undefined) {
			written.push(rel);
		} else if (pre.mtimeMs !== post.mtimeMs || pre.size !== post.size) {
			written.push(rel);
		}
	}
	return written.sort();
}
