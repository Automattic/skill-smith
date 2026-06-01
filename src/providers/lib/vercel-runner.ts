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
import { APICallError, generateText, type LanguageModel, stepCountIs } from "ai";
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
		// `totalUsage` is already aggregated across steps; every field is
		// `number | undefined`, so coalesce to 0. Vercel's `inputTokens` is
		// gross prompt size (cached + uncached), matching our normalized
		// `TokenUsage.inputTokens` definition.
		const inputTokens = result.totalUsage.inputTokens ?? 0;
		const cachedInputTokens = result.totalUsage.cachedInputTokens ?? 0;
		const outputTokens = result.totalUsage.outputTokens ?? 0;
		usage = {
			inputTokens,
			cachedInputTokens,
			outputTokens,
			totalTokens: inputTokens + outputTokens,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const status = httpStatusOf(err);
		// Prepend the exact leading `[HTTP <status>] ` form that
		// `classifyRuntimeError` (src/config/misconfig.ts) parses, so a 401/403/404
		// round-trips to a misconfiguration skip. When no status is readable the
		// message is left byte-for-byte unchanged — a transient or unknown error
		// must never be enriched into a false skip.
		error = status !== undefined ? `[HTTP ${status}] ${message}` : message;
	}

	const out: InvokeResult = { finalText, toolUseCount };
	if (error !== undefined) out.error = error;
	if (usage !== undefined) out.usage = usage;
	return out;
}

/**
 * Read the HTTP status off a thrown error, or `undefined` when none is present.
 * The Vercel AI SDK surfaces a rejected request as an `APICallError` carrying a
 * numeric `statusCode`; we prefer that via `APICallError.isInstance`. As a
 * defensive fallback we also accept a plain object that exposes a numeric
 * `statusCode` or `status`, so a status still surfaces if the SDK wraps the
 * error differently. Non-numeric or absent values yield `undefined`.
 */
function httpStatusOf(err: unknown): number | undefined {
	if (APICallError.isInstance(err) && typeof err.statusCode === "number") {
		return err.statusCode;
	}
	if (typeof err === "object" && err !== null) {
		const record = err as Record<string, unknown>;
		const candidate = record.statusCode ?? record.status;
		if (typeof candidate === "number") return candidate;
	}
	return undefined;
}

function extractProviderOptions(
	agent: InvokeParams["agent"],
): ProviderOptions | undefined {
	const raw = agent.providerOptions;
	if (raw && typeof raw === "object") return raw as ProviderOptions;
	return undefined;
}
