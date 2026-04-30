import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSettings } from "../config/types";
import type { RunLog } from "./run-log";

/**
 * Settings keys other than `model` are not yet plumbed to the SDK
 * (V27). Log them under `gaps.unplumbedSettings` so users can see what
 * the harness ignored.
 */
export function logUnplumbedSettings(
	settings: AgentSettings,
	scope: string,
	log: RunLog,
): void {
	const extras = Object.keys(settings).filter((k) => k !== "model");
	if (extras.length > 0) {
		log.gap("unplumbedSettings", { scope, keys: extras });
	}
}

export interface SdkQueryParams {
	prompt: string;
	systemPrompt: string;
	model: string;
	cwd: string;
	tools: string[];
}

export interface SdkQueryResult {
	finalText: string;
	toolUseCount: number;
	error?: string;
}

/**
 * Run one `query()` against `@anthropic-ai/claude-agent-sdk`, drain the
 * stream, return the final assistant text plus a tool-use count. Both
 * the testing and judge sub-agents go through this — they only differ
 * in prompt, system, tool set, and post-processing.
 */
export async function runSdkQuery(
	params: SdkQueryParams,
): Promise<SdkQueryResult> {
	let finalText = "";
	let toolUseCount = 0;
	let error: string | undefined;

	try {
		const stream = query({
			prompt: params.prompt,
			options: {
				model: params.model,
				cwd: params.cwd,
				systemPrompt: params.systemPrompt,
				tools: params.tools,
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
				if (message.subtype === "success") finalText = message.result;
				else error = `result.${message.subtype}`;
			}
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}

	const result: SdkQueryResult = { finalText, toolUseCount };
	if (error !== undefined) result.error = error;
	return result;
}
