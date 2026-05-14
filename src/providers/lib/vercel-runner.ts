/**
 * Shared runner for Vercel-AI-SDK-backed providers (`anthropic-api`,
 * `openai-api`, `gemini-api`). Drives `generateText` with the cwd-scoped
 * filesystem tools and maps the result back to the harness's
 * `InvokeResult` shape.
 *
 * `stepCountIs(MAX_STEPS)` is the hard cap on model turns inside this
 * runner. Each step may emit multiple tool calls in parallel; the
 * pipeline's `TOOL_USE_WARNING_THRESHOLD` (see
 * `src/pipeline/testing-agent.ts:22`) is a separate soft warning on the
 * cumulative tool-use count. Do not change one ceiling without
 * considering the other.
 *
 * The runner does not retry — the Vercel SDK already retries 429/5xx
 * internally. Any unrecovered error returns with `error` populated; the
 * pipeline knows how to handle that.
 */
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { generateText, type LanguageModel, stepCountIs } from "ai";
import type { InvokeParams, InvokeResult, TokenUsage } from "../types";
import { fsTools } from "./fs-tools";

const MAX_STEPS = 25;

export async function runVercel(
	params: InvokeParams,
	model: LanguageModel,
): Promise<InvokeResult> {
	const tools = fsTools(params.cwd, params.role);

	let finalText = "";
	let toolUseCount = 0;
	let error: string | undefined;
	let usage: TokenUsage | undefined;

	try {
		const result = await generateText({
			model,
			system: params.systemPrompt,
			prompt: params.prompt,
			tools,
			stopWhen: stepCountIs(MAX_STEPS),
			providerOptions: extractProviderOptions(params.agent),
		});

		finalText = result.text;
		toolUseCount = result.steps.reduce(
			(n, step) => n + step.toolCalls.length,
			0,
		);
		// `totalUsage` is already aggregated across steps; `inputTokens` /
		// `outputTokens` are `number | undefined`, so coalesce to 0.
		const inputTokens = result.totalUsage.inputTokens ?? 0;
		const outputTokens = result.totalUsage.outputTokens ?? 0;
		usage = {
			inputTokens,
			outputTokens,
			totalTokens: inputTokens + outputTokens,
		};
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}

	const out: InvokeResult = { finalText, toolUseCount };
	if (error !== undefined) out.error = error;
	if (usage !== undefined) out.usage = usage;
	return out;
}

function extractProviderOptions(
	agent: InvokeParams["agent"],
): ProviderOptions | undefined {
	const raw = agent.providerOptions;
	if (raw && typeof raw === "object") return raw as ProviderOptions;
	return undefined;
}
