import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
	InvokeParams,
	InvokeResult,
	Provider,
	Role,
	TokenUsage,
} from "./types";

const TOOLS_BY_ROLE: Record<Role, string[]> = {
	testing: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
	judge: ["Read"],
};

export const claudeCodeProvider: Provider = {
	id: "claude-code",
	async invoke(params: InvokeParams): Promise<InvokeResult> {
		let finalText = "";
		let toolUseCount = 0;
		let error: string | undefined;
		let usage: TokenUsage | undefined;

		try {
			const stream = query({
				prompt: params.prompt,
				options: {
					model: params.agent.model,
					cwd: params.cwd,
					systemPrompt: params.systemPrompt,
					tools: TOOLS_BY_ROLE[params.role],
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
					// Exactly one result message per query carries usage.
					const inputTokens = message.usage.input_tokens;
					const outputTokens = message.usage.output_tokens;
					usage = {
						inputTokens,
						outputTokens,
						totalTokens: inputTokens + outputTokens,
					};
				}
			}
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}

		const result: InvokeResult = { finalText, toolUseCount };
		if (error !== undefined) result.error = error;
		if (usage !== undefined) result.usage = usage;
		return result;
	},
};
