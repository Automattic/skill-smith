import { query } from "@anthropic-ai/claude-agent-sdk";
import type { InvokeParams, InvokeResult, Provider } from "./types";

export const claudeCodeProvider: Provider = {
	id: "claude-code",
	async invoke(params: InvokeParams): Promise<InvokeResult> {
		let finalText = "";
		let toolUseCount = 0;
		let error: string | undefined;

		try {
			const stream = query({
				prompt: params.prompt,
				options: {
					model: params.agent.model,
					cwd: params.cwd,
					systemPrompt: params.systemPrompt,
					tools: [...params.tools],
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

		const result: InvokeResult = { finalText, toolUseCount };
		if (error !== undefined) result.error = error;
		return result;
	},
};
