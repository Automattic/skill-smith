import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
	ContentBlock,
	Message,
	MessageCreateParamsNonStreaming,
	StopReason,
} from "@anthropic-ai/sdk/resources/messages";
import type {
	CodexOptions,
	ThreadEvent,
	ThreadOptions,
} from "@openai/codex-sdk";
import type {
	Response,
	ResponseCreateParamsNonStreaming,
	ResponseFunctionToolCall,
	ResponseOutputItem,
} from "openai/resources/responses/responses";
import {
	createAnthropicApiProvider,
	type AnthropicClientFactory,
} from "../providers/anthropic-api";
import { type CodexCtor, createCodexProvider } from "../providers/codex";
import {
	createGeminiProvider,
	type GoogleGenAICtor,
} from "../providers/gemini";
import {
	createOpenAiApiProvider,
	type OpenAiClientFactory,
} from "../providers/openai-api";
import { getProvider, isProviderId } from "../providers/registry";
import type { InvokeParams } from "../providers/types";

test("getProvider returns the matching provider", () => {
	assert.equal(getProvider("mock").id, "mock");
	assert.equal(getProvider("claude-code").id, "claude-code");
	assert.equal(getProvider("anthropic-api").id, "anthropic-api");
});

test("getProvider throws on unknown id", () => {
	assert.throws(
		// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
		() => getProvider("bogus" as any),
		/unknown provider: "bogus"/,
	);
});

test("isProviderId is a type guard for known ids", () => {
	assert.equal(isProviderId("mock"), true);
	assert.equal(isProviderId("claude-code"), true);
	assert.equal(isProviderId("anthropic-api"), true);
	assert.equal(isProviderId("openai-api"), true);
	assert.equal(isProviderId("codex"), true);
	assert.equal(isProviderId("gemini"), true);
	assert.equal(isProviderId("bogus"), false);
});

test("openai-api provider is registered without constructing a client at import time", () => {
	assert.equal(getProvider("openai-api").id, "openai-api");
});

test("anthropic-api provider is registered without constructing a client at import time", () => {
	assert.equal(getProvider("anthropic-api").id, "anthropic-api");
});

interface FakeAnthropicOptions {
	responses?: Message[];
	captured?: MessageCreateParamsNonStreaming[];
	constructed?: Array<{ apiKey: string; timeoutMs?: number }>;
	throwOnCreate?: Error;
}

function makeFakeAnthropic(
	opts: FakeAnthropicOptions = {},
): AnthropicClientFactory {
	let index = 0;
	return (factoryOpts) => {
		opts.constructed?.push(factoryOpts);
		return {
			messages: {
				async create(call: MessageCreateParamsNonStreaming): Promise<Message> {
					opts.captured?.push(call);
					if (opts.throwOnCreate) throw opts.throwOnCreate;
					const response = opts.responses?.[index++];
					return response ?? anthropicMessage([anthropicText("done")]);
				},
			},
		};
	};
}

function anthropicMessage(
	content: ContentBlock[],
	stop_reason: StopReason = "end_turn",
): Message {
	return {
		id: "msg",
		container: null,
		content,
		model: "claude-test",
		role: "assistant",
		stop_reason,
		stop_sequence: null,
		type: "message",
		usage: {
			cache_creation: null,
			cache_creation_input_tokens: null,
			cache_read_input_tokens: null,
			inference_geo: null,
			input_tokens: 1,
			output_tokens: 1,
			server_tool_use: null,
			service_tier: null,
		},
	};
}

function anthropicText(text: string): ContentBlock {
	return { type: "text", text, citations: null };
}

function anthropicToolUse(
	id: string,
	name: string,
	input: Record<string, unknown>,
): ContentBlock {
	return {
		type: "tool_use",
		id,
		name,
		input,
		caller: { type: "direct" },
	};
}

function anthropicParams(overrides: Partial<InvokeParams> = {}): InvokeParams {
	const cwd =
		overrides.cwd ?? mkdtempSync(join(tmpdir(), "anthropic-api-test-"));
	return {
		agent: { id: "a", provider: "anthropic-api", model: "claude-test" },
		systemPrompt: "system prompt body",
		prompt: "user prompt",
		cwd,
		role: "testing",
		...overrides,
	};
}

async function withAnthropicApiKey<T>(fn: () => Promise<T>): Promise<T> {
	const previous = process.env.ANTHROPIC_API_KEY;
	process.env.ANTHROPIC_API_KEY = "test-key";
	try {
		return await fn();
	} finally {
		if (previous === undefined) {
			delete process.env.ANTHROPIC_API_KEY;
		} else {
			process.env.ANTHROPIC_API_KEY = previous;
		}
	}
}

test("anthropic-api missing API key returns an error and does not construct client", async () => {
	const previous = process.env.ANTHROPIC_API_KEY;
	delete process.env.ANTHROPIC_API_KEY;
	const constructed: Array<{ apiKey: string; timeoutMs?: number }> = [];
	const provider = createAnthropicApiProvider(
		makeFakeAnthropic({ constructed }),
	);
	try {
		const result = await provider.invoke(anthropicParams());

		assert.equal(result.finalText, "");
		assert.equal(result.toolUseCount, 0);
		assert.equal(result.error, "ANTHROPIC_API_KEY not set");
		assert.equal(constructed.length, 0);
	} finally {
		if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
	}
});

test("anthropic-api judge sends one Messages request with no tools", async () => {
	const captured: MessageCreateParamsNonStreaming[] = [];
	const provider = createAnthropicApiProvider(
		makeFakeAnthropic({
			captured,
			responses: [
				anthropicMessage([anthropicText("judge "), anthropicText("yaml")]),
			],
		}),
	);

	const result = await withAnthropicApiKey(() =>
		provider.invoke(
			anthropicParams({
				role: "judge",
				agent: {
					id: "a",
					provider: "anthropic-api",
					model: "claude-test",
					maxOutputTokens: 1234,
					temperature: 0.2,
					topP: 0.9,
					topK: 10,
					stopSequences: ["STOP"],
				},
			}),
		),
	);

	assert.equal(result.finalText, "judge yaml");
	assert.equal(result.toolUseCount, 0);
	assert.equal(result.error, undefined);
	assert.equal(captured.length, 1);
	assert.equal(captured[0]?.model, "claude-test");
	assert.equal(captured[0]?.max_tokens, 1234);
	assert.equal(captured[0]?.system, "system prompt body");
	assert.deepEqual(captured[0]?.messages, [
		{ role: "user", content: "user prompt" },
	]);
	assert.equal(captured[0]?.tools, undefined);
	assert.equal(captured[0]?.temperature, 0.2);
	assert.equal(captured[0]?.top_p, 0.9);
	assert.equal(captured[0]?.top_k, 10);
	assert.deepEqual(captured[0]?.stop_sequences, ["STOP"]);
});

test("anthropic-api treats stop_sequence as terminal success", async () => {
	const provider = createAnthropicApiProvider(
		makeFakeAnthropic({
			responses: [
				anthropicMessage([anthropicText("stopped")], "stop_sequence"),
			],
		}),
	);

	const result = await withAnthropicApiKey(() =>
		provider.invoke(anthropicParams({ role: "judge" })),
	);

	assert.equal(result.finalText, "stopped");
	assert.equal(result.error, undefined);
});

test("anthropic-api testing executes Write and returns final text", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "anthropic-api-test-"));
	const captured: MessageCreateParamsNonStreaming[] = [];
	const provider = createAnthropicApiProvider(
		makeFakeAnthropic({
			captured,
			responses: [
				anthropicMessage(
					[
						anthropicToolUse("toolu-1", "Write", {
							path: "answer.txt",
							content: "hello",
						}),
					],
					"tool_use",
				),
				anthropicMessage([anthropicText("done")]),
			],
		}),
	);

	const result = await withAnthropicApiKey(() =>
		provider.invoke(anthropicParams({ cwd })),
	);

	assert.equal(readFileSync(join(cwd, "answer.txt"), "utf8"), "hello");
	assert.equal(result.finalText, "done");
	assert.equal(result.toolUseCount, 1);
	assert.equal(result.error, undefined);
	assert.equal(captured.length, 2);
	assert.equal(captured[0]?.system, "system prompt body");
	assert.ok(Array.isArray(captured[0]?.tools));
	const secondMessages = captured[1]?.messages;
	assert.ok(Array.isArray(secondMessages));
	assert.equal(secondMessages.at(-2)?.role, "assistant");
	assert.equal(secondMessages.at(-1)?.role, "user");
	const toolResults = secondMessages.at(-1)?.content;
	assert.ok(Array.isArray(toolResults));
	assert.equal(toolResults[0]?.type, "tool_result");
	assert.equal(toolResults[0]?.tool_use_id, "toolu-1");
});

test("anthropic-api testing errors on empty terminal response", async () => {
	const provider = createAnthropicApiProvider(
		makeFakeAnthropic({ responses: [anthropicMessage([])] }),
	);

	const result = await withAnthropicApiKey(() =>
		provider.invoke(anthropicParams()),
	);

	assert.match(result.error ?? "", /no final text or tool calls/);
});

test("anthropic-api testing errors on empty terminal response after partial text", async () => {
	const provider = createAnthropicApiProvider(
		makeFakeAnthropic({
			responses: [
				anthropicMessage(
					[
						anthropicText("partial"),
						anthropicToolUse("toolu-1", "Write", {
							path: "answer.txt",
							content: "hello",
						}),
					],
					"tool_use",
				),
				anthropicMessage([]),
			],
		}),
	);

	const result = await withAnthropicApiKey(() =>
		provider.invoke(anthropicParams()),
	);

	assert.equal(result.finalText, "partial");
	assert.match(result.error ?? "", /no final text or tool calls/);
});

test("anthropic-api testing executes and counts multiple same-turn tool uses", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "anthropic-api-test-"));
	const provider = createAnthropicApiProvider(
		makeFakeAnthropic({
			responses: [
				anthropicMessage(
					[
						anthropicToolUse("toolu-1", "Write", {
							path: "one.txt",
							content: "one",
						}),
						anthropicToolUse("toolu-2", "Write", {
							path: "two.txt",
							content: "two",
						}),
					],
					"tool_use",
				),
				anthropicMessage([anthropicText("done")]),
			],
		}),
	);

	const result = await withAnthropicApiKey(() =>
		provider.invoke(anthropicParams({ cwd })),
	);

	assert.equal(readFileSync(join(cwd, "one.txt"), "utf8"), "one");
	assert.equal(readFileSync(join(cwd, "two.txt"), "utf8"), "two");
	assert.equal(result.toolUseCount, 2);
	assert.equal(result.error, undefined);
});

test("anthropic-api testing returns malformed tool input as error tool_result", async () => {
	const captured: MessageCreateParamsNonStreaming[] = [];
	const provider = createAnthropicApiProvider(
		makeFakeAnthropic({
			captured,
			responses: [
				anthropicMessage(
					[anthropicToolUse("toolu-1", "Read", { path: 123 })],
					"tool_use",
				),
				anthropicMessage([anthropicText("recovered")]),
			],
		}),
	);

	const result = await withAnthropicApiKey(() =>
		provider.invoke(anthropicParams()),
	);

	assert.equal(result.finalText, "recovered");
	assert.equal(result.error, undefined);
	const toolResults = toolResultBlocks(captured, 1);
	assert.equal(toolResults[0]?.tool_use_id, "toolu-1");
	assert.equal(toolResults[0]?.is_error, true);
	assert.match(String(toolResults[0]?.content), /invalid args/);
});

test("anthropic-api testing blocks path escape, absolute path, and symlink-parent writes", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "anthropic-api-test-"));
	const outside = mkdtempSync(join(tmpdir(), "anthropic-outside-"));
	symlinkSync(outside, join(cwd, "link"), "dir");
	const captured: MessageCreateParamsNonStreaming[] = [];
	const provider = createAnthropicApiProvider(
		makeFakeAnthropic({
			captured,
			responses: [
				anthropicMessage(
					[
						anthropicToolUse("toolu-1", "Write", {
							path: "../escape.txt",
							content: "bad",
						}),
						anthropicToolUse("toolu-2", "Write", {
							path: join(outside, "absolute.txt"),
							content: "bad",
						}),
						anthropicToolUse("toolu-3", "Write", {
							path: "link/escape.txt",
							content: "bad",
						}),
					],
					"tool_use",
				),
				anthropicMessage([anthropicText("done")]),
			],
		}),
	);

	const result = await withAnthropicApiKey(() =>
		provider.invoke(anthropicParams({ cwd })),
	);

	assert.equal(result.error, undefined);
	assert.equal(existsSync(join(cwd, "..", "escape.txt")), false);
	assert.equal(existsSync(join(outside, "absolute.txt")), false);
	assert.equal(existsSync(join(outside, "escape.txt")), false);
	const toolResults = toolResultBlocks(captured, 1);
	assert.equal(toolResults.length, 3);
	assert.ok(toolResults.every((block) => block.is_error === true));
});

test("anthropic-api Grep and Glob do not traverse symlinked directories outside cwd", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "anthropic-api-test-"));
	const outside = mkdtempSync(join(tmpdir(), "anthropic-outside-"));
	writeFileSync(join(outside, "secret.txt"), "needle");
	symlinkSync(outside, join(cwd, "outside-link"), "dir");
	const captured: MessageCreateParamsNonStreaming[] = [];
	const provider = createAnthropicApiProvider(
		makeFakeAnthropic({
			captured,
			responses: [
				anthropicMessage(
					[
						anthropicToolUse("toolu-1", "Grep", { pattern: "needle" }),
						anthropicToolUse("toolu-2", "Glob", { pattern: "**/*.txt" }),
					],
					"tool_use",
				),
				anthropicMessage([anthropicText("done")]),
			],
		}),
	);

	const result = await withAnthropicApiKey(() =>
		provider.invoke(anthropicParams({ cwd })),
	);

	assert.equal(result.error, undefined);
	const toolResults = toolResultBlocks(captured, 1);
	assert.doesNotMatch(String(toolResults[0]?.content), /secret\.txt|needle/);
	assert.doesNotMatch(String(toolResults[1]?.content), /secret\.txt/);
});

test("anthropic-api Bash does not forward ANTHROPIC_API_KEY", async () => {
	const captured: MessageCreateParamsNonStreaming[] = [];
	const provider = createAnthropicApiProvider(
		makeFakeAnthropic({
			captured,
			responses: [
				anthropicMessage(
					[
						anthropicToolUse("toolu-1", "Bash", {
							command: "printf '%s' \"$" + '{ANTHROPIC_API_KEY:-missing}"',
						}),
					],
					"tool_use",
				),
				anthropicMessage([anthropicText("done")]),
			],
		}),
	);

	const result = await withAnthropicApiKey(() =>
		provider.invoke(anthropicParams()),
	);

	assert.equal(result.error, undefined);
	const toolResults = toolResultBlocks(captured, 1);
	assert.match(String(toolResults[0]?.content), /missing/);
	assert.doesNotMatch(String(toolResults[0]?.content), /test-key/);
});

test("anthropic-api maxToolIterations errors after executing attempted calls", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "anthropic-api-test-"));
	const provider = createAnthropicApiProvider(
		makeFakeAnthropic({
			responses: [
				anthropicMessage(
					[
						anthropicToolUse("toolu-1", "Write", {
							path: "one.txt",
							content: "one",
						}),
					],
					"tool_use",
				),
			],
		}),
	);

	const result = await withAnthropicApiKey(() =>
		provider.invoke(
			anthropicParams({
				cwd,
				agent: {
					id: "a",
					provider: "anthropic-api",
					model: "claude-test",
					maxToolIterations: 1,
				},
			}),
		),
	);

	assert.equal(readFileSync(join(cwd, "one.txt"), "utf8"), "one");
	assert.equal(result.toolUseCount, 1);
	assert.match(result.error ?? "", /maxToolIterations \(1\)/);
});

function toolResultBlocks(
	captured: MessageCreateParamsNonStreaming[],
	callIndex: number,
): Array<{ tool_use_id?: string; content?: unknown; is_error?: boolean }> {
	const messages = captured[callIndex]?.messages;
	assert.ok(Array.isArray(messages));
	const last = messages.at(-1);
	assert.equal(last?.role, "user");
	assert.ok(Array.isArray(last.content));
	return last.content as Array<{
		tool_use_id?: string;
		content?: unknown;
		is_error?: boolean;
	}>;
}

interface FakeOpenAiOptions {
	responses?: Response[];
	captured?: ResponseCreateParamsNonStreaming[];
	throwOnCreate?: Error;
}

function makeFakeOpenAi(opts: FakeOpenAiOptions = {}): OpenAiClientFactory {
	let index = 0;
	return () => ({
		responses: {
			async create(call: ResponseCreateParamsNonStreaming): Promise<Response> {
				opts.captured?.push(call);
				if (opts.throwOnCreate) throw opts.throwOnCreate;
				const response = opts.responses?.[index++];
				return response ?? openAiResponse({ output_text: "done" });
			},
		},
	});
}

function openAiResponse(overrides: Partial<Response> = {}): Response {
	return {
		id: "resp",
		created_at: 0,
		error: null,
		incomplete_details: null,
		instructions: null,
		metadata: null,
		model: "gpt-test",
		object: "response",
		output: [],
		output_text: "",
		parallel_tool_calls: true,
		status: "completed",
		store: false,
		temperature: null,
		text: { format: { type: "text" } },
		tool_choice: "auto",
		tools: [],
		top_p: null,
		truncation: "disabled",
		usage: null,
		...overrides,
	} as Response;
}

function functionCall(
	name: string,
	call_id: string,
	args: Record<string, unknown> | string,
): ResponseFunctionToolCall {
	return {
		type: "function_call",
		name,
		call_id,
		arguments: typeof args === "string" ? args : JSON.stringify(args),
	};
}

function openAiParams(overrides: Partial<InvokeParams> = {}): InvokeParams {
	const cwd = overrides.cwd ?? mkdtempSync(join(tmpdir(), "openai-api-test-"));
	return {
		agent: { id: "o", provider: "openai-api", model: "gpt-5.5" },
		systemPrompt: "system prompt body",
		prompt: "user prompt",
		cwd,
		role: "testing",
		...overrides,
	};
}

function findOpenAiFunctionTool(
	call: ResponseCreateParamsNonStreaming | undefined,
	name: string,
): Record<string, unknown> {
	assert.ok(call);
	const tools = call.tools;
	assert.ok(Array.isArray(tools));
	const found = tools.find((tool) => {
		if (tool === null || typeof tool !== "object") return false;
		return (tool as unknown as Record<string, unknown>).name === name;
	});
	assert.ok(found);
	return found as unknown as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
	assert.ok(
		value !== null && typeof value === "object" && !Array.isArray(value),
	);
	return value as Record<string, unknown>;
}

test("openai-api judge sends a single stored-off Responses request", async () => {
	const captured: ResponseCreateParamsNonStreaming[] = [];
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({
			captured,
			responses: [openAiResponse({ output_text: "judge yaml" })],
		}),
	);

	const result = await provider.invoke(openAiParams({ role: "judge" }));

	assert.equal(result.finalText, "judge yaml");
	assert.equal(result.toolUseCount, 0);
	assert.equal(result.error, undefined);
	assert.equal(captured.length, 1);
	assert.equal(captured[0]?.model, "gpt-5.5");
	assert.equal(captured[0]?.instructions, "system prompt body");
	assert.equal(captured[0]?.input, "user prompt");
	assert.equal(captured[0]?.store, false);
});

test("openai-api judge surfaces failed Responses status as error", async () => {
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({
			responses: [
				openAiResponse({
					status: "failed",
					error: { code: "server_error", message: "judge failed" },
					output_text: "partial judge",
				}),
			],
		}),
	);

	const result = await provider.invoke(openAiParams({ role: "judge" }));

	assert.equal(result.finalText, "partial judge");
	assert.equal(result.error, "judge failed");
});

test("openai-api judge surfaces incomplete Responses status as error", async () => {
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({
			responses: [
				openAiResponse({
					status: "incomplete",
					incomplete_details: { reason: "max_output_tokens" },
					output_text: "partial judge",
				}),
			],
		}),
	);

	const result = await provider.invoke(openAiParams({ role: "judge" }));

	assert.equal(result.finalText, "partial judge");
	assert.match(result.error ?? "", /incomplete: max_output_tokens/);
});

test("openai-api testing executes write_file and returns final text", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "openai-api-test-"));
	const captured: ResponseCreateParamsNonStreaming[] = [];
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({
			captured,
			responses: [
				openAiResponse({
					output: [
						functionCall("write_file", "call-1", {
							path: "answer.txt",
							content: "hello",
						}) as ResponseOutputItem,
					],
				}),
				openAiResponse({ output_text: "done" }),
			],
		}),
	);

	const result = await provider.invoke(openAiParams({ cwd }));

	assert.equal(readFileSync(join(cwd, "answer.txt"), "utf8"), "hello");
	assert.equal(result.finalText, "done");
	assert.equal(result.toolUseCount, 1);
	assert.equal(result.error, undefined);
	assert.equal(captured.length, 2);
	assert.equal(captured[0]?.instructions, "system prompt body");
	assert.equal(captured[1]?.instructions, "system prompt body");
	assert.deepEqual(captured[0]?.include, ["reasoning.encrypted_content"]);
	const secondInput = captured[1]?.input;
	assert.ok(Array.isArray(secondInput));
	assert.equal(
		secondInput.some((item) => item.type === "function_call"),
		true,
	);
	assert.equal(
		secondInput.some(
			(item) =>
				item.type === "function_call_output" && item.call_id === "call-1",
		),
		true,
	);
});

test("openai-api testing surfaces failed Responses status as error", async () => {
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({
			responses: [
				openAiResponse({
					status: "failed",
					error: { code: "server_error", message: "testing failed" },
					output_text: "partial testing",
				}),
			],
		}),
	);

	const result = await provider.invoke(openAiParams());

	assert.equal(result.finalText, "partial testing");
	assert.equal(result.error, "testing failed");
});

test("openai-api testing surfaces incomplete Responses status as error", async () => {
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({
			responses: [
				openAiResponse({
					status: "incomplete",
					incomplete_details: { reason: "content_filter" },
					output_text: "partial testing",
				}),
			],
		}),
	);

	const result = await provider.invoke(openAiParams());

	assert.equal(result.finalText, "partial testing");
	assert.match(result.error ?? "", /incomplete: content_filter/);
});

test("openai-api testing local tools use strict-compatible required nullable schemas", async () => {
	const captured: ResponseCreateParamsNonStreaming[] = [];
	const provider = createOpenAiApiProvider(makeFakeOpenAi({ captured }));

	await provider.invoke(openAiParams());

	const toolNames = [
		"list_files",
		"read_file",
		"write_file",
		"replace_file",
		"mkdir",
	];
	for (const name of toolNames) {
		const localTool = findOpenAiFunctionTool(captured[0], name);
		assert.equal(localTool.strict, true);
		const parameters = asRecord(localTool.parameters);
		const properties = asRecord(parameters.properties);
		assert.deepEqual(parameters.required, Object.keys(properties));
		assert.equal(parameters.additionalProperties, false);
	}

	const listFilesProperties = asRecord(
		asRecord(findOpenAiFunctionTool(captured[0], "list_files").parameters)
			.properties,
	);
	assert.deepEqual(asRecord(listFilesProperties.path).type, ["string", "null"]);

	const replaceFileProperties = asRecord(
		asRecord(findOpenAiFunctionTool(captured[0], "replace_file").parameters)
			.properties,
	);
	assert.deepEqual(asRecord(replaceFileProperties.replaceAll).type, [
		"boolean",
		"null",
	]);
});

test("openai-api executes multiple same-round calls before next request", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "openai-api-test-"));
	const captured: ResponseCreateParamsNonStreaming[] = [];
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({
			captured,
			responses: [
				openAiResponse({
					output: [
						functionCall("mkdir", "call-1", {
							path: "nested",
						}) as ResponseOutputItem,
						functionCall("write_file", "call-2", {
							path: "nested/a.txt",
							content: "a",
						}) as ResponseOutputItem,
					],
				}),
				openAiResponse({ output_text: "done" }),
			],
		}),
	);

	const result = await provider.invoke(openAiParams({ cwd }));

	assert.equal(result.toolUseCount, 2);
	assert.equal(readFileSync(join(cwd, "nested/a.txt"), "utf8"), "a");
	const secondInput = captured[1]?.input;
	assert.ok(Array.isArray(secondInput));
	assert.equal(
		secondInput.filter((item) => item.type === "function_call_output").length,
		2,
	);
});

test("openai-api supports multiple tool-call rounds and preserves reasoning items", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "openai-api-test-"));
	const reasoning = {
		type: "reasoning",
		id: "rsn",
		summary: [],
		encrypted_content: "encrypted",
	} as ResponseOutputItem;
	const captured: ResponseCreateParamsNonStreaming[] = [];
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({
			captured,
			responses: [
				openAiResponse({
					output: [
						reasoning,
						functionCall("write_file", "call-1", {
							path: "a.txt",
							content: "a",
						}) as ResponseOutputItem,
					],
				}),
				openAiResponse({
					output: [
						functionCall("replace_file", "call-2", {
							path: "a.txt",
							old: "a",
							replacement: "b",
						}) as ResponseOutputItem,
					],
				}),
				openAiResponse({ output_text: "done" }),
			],
		}),
	);

	const result = await provider.invoke(openAiParams({ cwd }));

	assert.equal(result.finalText, "done");
	assert.equal(result.toolUseCount, 2);
	assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "b");
	const secondInput = captured[1]?.input;
	assert.ok(Array.isArray(secondInput));
	assert.equal((secondInput as unknown[]).includes(reasoning), true);
});

test("openai-api returns malformed JSON and unknown tool errors to the model", async () => {
	const captured: ResponseCreateParamsNonStreaming[] = [];
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({
			captured,
			responses: [
				openAiResponse({
					output: [
						functionCall("read_file", "call-1", "{") as ResponseOutputItem,
						functionCall("nope", "call-2", {}) as ResponseOutputItem,
					],
				}),
				openAiResponse({ output_text: "done" }),
			],
		}),
	);

	const result = await provider.invoke(openAiParams());

	assert.equal(result.error, undefined);
	assert.equal(result.toolUseCount, 2);
	const secondInput = captured[1]?.input;
	assert.ok(Array.isArray(secondInput));
	const outputs = secondInput.filter(
		(item) => item.type === "function_call_output",
	);
	assert.match(String(outputs[0]?.output), /valid JSON/);
	assert.match(String(outputs[1]?.output), /unknown tool/);
});

test("openai-api fails provider run when call_id is missing", async () => {
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({
			responses: [
				openAiResponse({
					output: [
						functionCall("write_file", "", {
							path: "x.txt",
							content: "x",
						}) as ResponseOutputItem,
					],
				}),
			],
		}),
	);

	const result = await provider.invoke(openAiParams());

	assert.match(result.error ?? "", /call_id/);
	assert.equal(result.toolUseCount, 1);
});

test("openai-api returns path safety failures as function outputs", async () => {
	const outside = mkdtempSync(join(tmpdir(), "openai-api-outside-"));
	const cwd = mkdtempSync(join(tmpdir(), "openai-api-test-"));
	symlinkSync(outside, join(cwd, "link"));
	const captured: ResponseCreateParamsNonStreaming[] = [];
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({
			captured,
			responses: [
				openAiResponse({
					output: [
						functionCall("write_file", "call-1", {
							path: "../escape.txt",
							content: "x",
						}) as ResponseOutputItem,
						functionCall("write_file", "call-2", {
							path: "/tmp/escape.txt",
							content: "x",
						}) as ResponseOutputItem,
						functionCall("write_file", "call-3", {
							path: "link/escape.txt",
							content: "x",
						}) as ResponseOutputItem,
					],
				}),
				openAiResponse({ output_text: "done" }),
			],
		}),
	);

	const result = await provider.invoke(openAiParams({ cwd }));

	assert.equal(result.error, undefined);
	assert.equal(result.toolUseCount, 3);
	assert.equal(existsSync(join(outside, "escape.txt")), false);
	const secondInput = captured[1]?.input;
	assert.ok(Array.isArray(secondInput));
	const joinedOutputs = secondInput
		.filter((item) => item.type === "function_call_output")
		.map((item) => String(item.output))
		.join("\n");
	assert.match(joinedOutputs, /escapes workspace/);
	assert.match(joinedOutputs, /absolute paths/);
	assert.match(joinedOutputs, /parent resolves outside workspace/);
});

test("openai-api maps valid options and skips invalid values", async () => {
	const captured: ResponseCreateParamsNonStreaming[] = [];
	const provider = createOpenAiApiProvider(makeFakeOpenAi({ captured }));

	await provider.invoke(
		openAiParams({
			role: "judge",
			agent: {
				id: "o",
				provider: "openai-api",
				model: "gpt-5.5",
				effort: "high",
				temperature: 0.2,
				maxOutputTokens: 1234,
				webSearch: "live",
			},
		}),
	);
	await provider.invoke(
		openAiParams({
			role: "judge",
			agent: {
				id: "o",
				provider: "openai-api",
				model: "gpt-5.5",
				effort: "ultra",
				temperature: Number.NaN,
				maxOutputTokens: -1,
				webSearch: "cached",
			},
		}),
	);

	assert.deepEqual(captured[0]?.reasoning, { effort: "high" });
	assert.equal(captured[0]?.temperature, 0.2);
	assert.equal(captured[0]?.max_output_tokens, 1234);
	assert.deepEqual(captured[0]?.tools, [{ type: "web_search_preview" }]);
	assert.equal(captured[1]?.reasoning, undefined);
	assert.equal(captured[1]?.temperature, undefined);
	assert.equal(captured[1]?.max_output_tokens, undefined);
	assert.equal(captured[1]?.tools, undefined);
});

test("openai-api enforces maxToolIterations after executing attempted calls", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "openai-api-test-"));
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({
			responses: [
				openAiResponse({
					output: [
						functionCall("write_file", "call-1", {
							path: "x.txt",
							content: "x",
						}) as ResponseOutputItem,
					],
				}),
			],
		}),
	);

	const result = await provider.invoke(
		openAiParams({
			cwd,
			agent: {
				id: "o",
				provider: "openai-api",
				model: "gpt-5.5",
				maxToolIterations: 1,
			},
		}),
	);

	assert.equal(readFileSync(join(cwd, "x.txt"), "utf8"), "x");
	assert.equal(result.toolUseCount, 1);
	assert.match(result.error ?? "", /maxToolIterations/);
});

test("openai-api surfaces API and setup failures as InvokeResult.error", async () => {
	const apiProvider = createOpenAiApiProvider(
		makeFakeOpenAi({ throwOnCreate: new Error("api boom") }),
	);
	const setupProvider = createOpenAiApiProvider(() => {
		throw new Error("setup boom");
	});

	assert.equal((await apiProvider.invoke(openAiParams())).error, "api boom");
	assert.equal(
		(await setupProvider.invoke(openAiParams())).error,
		"setup boom",
	);
});

test("openai-api returns an error for empty Responses output", async () => {
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({ responses: [openAiResponse()] }),
	);

	const result = await provider.invoke(openAiParams());

	assert.match(result.error ?? "", /no final text or function calls/);
});

test("openai-api replace_file rejects ambiguous replacements unless replaceAll is true", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "openai-api-test-"));
	writeFileSync(join(cwd, "a.txt"), "one one", "utf8");
	const captured: ResponseCreateParamsNonStreaming[] = [];
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({
			captured,
			responses: [
				openAiResponse({
					output: [
						functionCall("replace_file", "call-1", {
							path: "a.txt",
							old: "one",
							replacement: "two",
						}) as ResponseOutputItem,
						functionCall("replace_file", "call-2", {
							path: "a.txt",
							old: "one",
							replacement: "two",
							replaceAll: true,
						}) as ResponseOutputItem,
					],
				}),
				openAiResponse({ output_text: "done" }),
			],
		}),
	);

	const result = await provider.invoke(openAiParams({ cwd }));

	assert.equal(result.error, undefined);
	assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "two two");
	const secondInput = captured[1]?.input;
	assert.ok(Array.isArray(secondInput));
	const ambiguousOutput = secondInput.at(-2);
	assert.equal(ambiguousOutput?.type, "function_call_output");
	assert.match(String(ambiguousOutput.output), /more than once/);
});

test("openai-api treats nullable optional tool arguments as absent", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "openai-api-test-"));
	writeFileSync(join(cwd, "a.txt"), "one", "utf8");
	const captured: ResponseCreateParamsNonStreaming[] = [];
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({
			captured,
			responses: [
				openAiResponse({
					output: [
						functionCall("list_files", "call-1", {
							path: null,
						}) as ResponseOutputItem,
						functionCall("replace_file", "call-2", {
							path: "a.txt",
							old: "one",
							replacement: "two",
							replaceAll: null,
						}) as ResponseOutputItem,
					],
				}),
				openAiResponse({ output_text: "done" }),
			],
		}),
	);

	const result = await provider.invoke(openAiParams({ cwd }));

	assert.equal(result.error, undefined);
	assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "two");
	const secondInput = captured[1]?.input;
	assert.ok(Array.isArray(secondInput));
	const outputs = secondInput.filter(
		(item) => item.type === "function_call_output",
	);
	assert.match(String(outputs[0]?.output), /"entries"/);
	assert.match(String(outputs[1]?.output), /"replacements":1/);
});

test("openai-api caps read_file output returned to the model", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "openai-api-test-"));
	writeFileSync(join(cwd, "large.txt"), "x".repeat(70 * 1024), "utf8");
	const captured: ResponseCreateParamsNonStreaming[] = [];
	const provider = createOpenAiApiProvider(
		makeFakeOpenAi({
			captured,
			responses: [
				openAiResponse({
					output: [
						functionCall("read_file", "call-1", {
							path: "large.txt",
						}) as ResponseOutputItem,
					],
				}),
				openAiResponse({ output_text: "done" }),
			],
		}),
	);

	const result = await provider.invoke(openAiParams({ cwd }));

	assert.equal(result.error, undefined);
	const secondInput = captured[1]?.input;
	assert.ok(Array.isArray(secondInput));
	const output = secondInput.find(
		(item) => item.type === "function_call_output",
	);
	assert.ok(output?.type === "function_call_output");
	assert.ok(Buffer.byteLength(String(output.output)) <= 64 * 1024 + 256);
	assert.match(String(output.output), /truncated/);
});

interface CapturedCall {
	codexOpts?: CodexOptions;
	threadOpts?: ThreadOptions;
	prompt?: string;
}

interface FakeOptions {
	events?: ThreadEvent[];
	throwOnRunStreamed?: Error;
	throwAfterEvents?: Error;
	captured?: CapturedCall;
}

function makeFake(opts: FakeOptions = {}): CodexCtor {
	const events = opts.events ?? [];
	return class FakeCodex {
		constructor(public codexOpts: CodexOptions) {
			if (opts.captured) opts.captured.codexOpts = codexOpts;
		}
		startThread(threadOpts: ThreadOptions) {
			if (opts.captured) opts.captured.threadOpts = threadOpts;
			return {
				async runStreamed(prompt: string) {
					if (opts.captured) opts.captured.prompt = prompt;
					if (opts.throwOnRunStreamed) throw opts.throwOnRunStreamed;
					async function* generator(): AsyncGenerator<ThreadEvent> {
						for (const event of events) yield event;
						if (opts.throwAfterEvents) throw opts.throwAfterEvents;
					}
					return { events: generator() };
				},
			};
		}
		// biome-ignore lint/suspicious/noExplicitAny: fake stand-in for class shape
	} as any as CodexCtor;
}

function baseParams(overrides: Partial<InvokeParams> = {}): InvokeParams {
	const cwd = overrides.cwd ?? mkdtempSync(join(tmpdir(), "codex-test-"));
	return {
		agent: { id: "c", provider: "codex", model: "gpt-5.5" },
		systemPrompt: "system prompt body",
		prompt: "user prompt",
		cwd,
		role: "testing",
		...overrides,
	};
}

test("codex provider returns finalText from agent_message", async () => {
	const fake = makeFake({
		events: [
			{
				type: "item.completed",
				item: { id: "1", type: "agent_message", text: "hello" },
			},
			{
				type: "turn.completed",
				usage: {
					input_tokens: 0,
					cached_input_tokens: 0,
					output_tokens: 0,
					reasoning_output_tokens: 0,
				},
			},
		],
	});
	const provider = createCodexProvider(fake);
	const result = await provider.invoke(baseParams());
	assert.equal(result.finalText, "hello");
	assert.equal(result.toolUseCount, 0);
	assert.equal(result.error, undefined);
});

test("codex provider counts tool-use items", async () => {
	const fake = makeFake({
		events: [
			{
				type: "item.completed",
				item: {
					id: "1",
					type: "command_execution",
					command: "ls",
					aggregated_output: "",
					status: "completed",
				},
			},
			{
				type: "item.completed",
				item: {
					id: "2",
					type: "command_execution",
					command: "pwd",
					aggregated_output: "",
					status: "completed",
				},
			},
			{
				type: "item.completed",
				item: {
					id: "3",
					type: "file_change",
					changes: [{ path: "foo.txt", kind: "add" }],
					status: "completed",
				},
			},
			{
				type: "item.completed",
				item: { id: "4", type: "agent_message", text: "done" },
			},
		],
	});
	const provider = createCodexProvider(fake);
	const result = await provider.invoke(baseParams());
	assert.equal(result.toolUseCount, 3);
	assert.equal(result.finalText, "done");
});

test("codex provider surfaces turn.failed as error", async () => {
	const fake = makeFake({
		events: [{ type: "turn.failed", error: { message: "boom" } }],
	});
	const provider = createCodexProvider(fake);
	const result = await provider.invoke(baseParams());
	assert.equal(result.error, "boom");
	assert.equal(result.finalText, "");
});

test("codex provider surfaces completed error item as error", async () => {
	const fake = makeFake({
		events: [
			{
				type: "item.completed",
				item: { id: "1", type: "error", message: "item boom" },
			},
		],
	});
	const provider = createCodexProvider(fake);
	const result = await provider.invoke(baseParams());
	assert.equal(result.error, "item boom");
	assert.equal(result.finalText, "");
});

test("codex provider preserves first stream error", async () => {
	const fake = makeFake({
		events: [{ type: "turn.failed", error: { message: "first boom" } }],
		throwAfterEvents: new Error("later boom"),
	});
	const provider = createCodexProvider(fake);
	const result = await provider.invoke(baseParams());
	assert.equal(result.error, "first boom");
	assert.equal(result.finalText, "");
});

test("codex provider catches thrown errors", async () => {
	const fake = makeFake({ throwOnRunStreamed: new Error("nope") });
	const provider = createCodexProvider(fake);
	const result = await provider.invoke(baseParams());
	assert.equal(result.error, "nope");
	assert.equal(result.finalText, "");
});

test("codex provider passes constructor and testing thread options", async () => {
	const priorApiKey = process.env.OPENAI_API_KEY;
	process.env.OPENAI_API_KEY = "test-openai-key";
	const captured: CapturedCall = {};
	const fake = makeFake({ captured });
	const provider = createCodexProvider(fake);
	const cwd = mkdtempSync(join(tmpdir(), "codex-test-"));

	try {
		await provider.invoke(
			baseParams({
				cwd,
				agent: {
					id: "c",
					provider: "codex",
					model: "gpt-5.5",
					effort: "high",
					network: true,
					webSearch: "live",
				},
				role: "testing",
			}),
		);
	} finally {
		if (priorApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = priorApiKey;
		}
	}

	assert.equal(captured.codexOpts?.apiKey, "test-openai-key");
	assert.deepEqual(captured.codexOpts?.config, {
		project_root_markers: [],
		project_doc_max_bytes: 0,
		developer_instructions:
			"Treat the clearly delimited Skillsmith instruction block in the user input as authoritative workflow and developer instructions for this run. Follow the user request after that block.",
	});
	assert.equal(captured.codexOpts?.env?.OPENAI_API_KEY, undefined);
	assert.notEqual(
		captured.codexOpts?.config?.developer_instructions,
		"system prompt body",
	);
	const developerInstructions =
		captured.codexOpts?.config?.developer_instructions;
	if (typeof developerInstructions !== "string") {
		assert.fail("developer_instructions must be a string");
	}
	assert.ok(developerInstructions.length < 256);
	assert.equal(captured.threadOpts?.model, "gpt-5.5");
	assert.equal(captured.threadOpts?.workingDirectory, cwd);
	assert.equal(captured.threadOpts?.skipGitRepoCheck, true);
	assert.equal(captured.threadOpts?.approvalPolicy, "never");
	assert.equal(captured.threadOpts?.sandboxMode, "workspace-write");
	assert.equal(captured.threadOpts?.modelReasoningEffort, "high");
	assert.equal(captured.threadOpts?.networkAccessEnabled, true);
	assert.equal(captured.threadOpts?.webSearchMode, "live");
	assert.match(
		captured.prompt ?? "",
		/----- BEGIN SKILLSMITH INSTRUCTION BLOCK -----\nsystem prompt body\n----- END SKILLSMITH INSTRUCTION BLOCK -----\n\nuser prompt/,
	);
});

test("codex provider passes only allowlisted env to constructor", async () => {
	const priorEnv = {
		CODEX_HOME: process.env.CODEX_HOME,
		HOME: process.env.HOME,
		OPENAI_API_KEY: process.env.OPENAI_API_KEY,
		SKILLSMITH_SECRET: process.env.SKILLSMITH_SECRET,
	};
	process.env.CODEX_HOME = "/tmp/test-codex-home";
	process.env.HOME = "/tmp/test-home";
	process.env.OPENAI_API_KEY = "test-openai-key";
	process.env.SKILLSMITH_SECRET = "do-not-forward";
	const captured: CapturedCall = {};
	const fake = makeFake({ captured });
	const provider = createCodexProvider(fake);

	try {
		await provider.invoke(baseParams());
	} finally {
		for (const [key, value] of Object.entries(priorEnv)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}

	assert.equal(captured.codexOpts?.apiKey, "test-openai-key");
	assert.equal(captured.codexOpts?.env?.CODEX_HOME, "/tmp/test-codex-home");
	assert.equal(captured.codexOpts?.env?.HOME, "/tmp/test-home");
	assert.equal(captured.codexOpts?.env?.OPENAI_API_KEY, undefined);
	assert.equal(captured.codexOpts?.env?.SKILLSMITH_SECRET, undefined);
});

test("codex provider skips invalid codex option values", async () => {
	const captured: CapturedCall = {};
	const fake = makeFake({ captured });
	const provider = createCodexProvider(fake);

	await provider.invoke(
		baseParams({
			agent: {
				id: "c",
				provider: "codex",
				model: "gpt-5.5",
				effort: "ultra",
				network: "true",
				webSearch: "always",
			},
		}),
	);

	assert.equal(captured.threadOpts?.modelReasoningEffort, undefined);
	assert.equal(captured.threadOpts?.networkAccessEnabled, undefined);
	assert.equal(captured.threadOpts?.webSearchMode, undefined);
});

test("codex provider maps judge role to read-only sandbox", async () => {
	const captured: CapturedCall = {};
	const fake = makeFake({ captured });
	const provider = createCodexProvider(fake);

	await provider.invoke(baseParams({ role: "judge" }));

	assert.equal(captured.threadOpts?.sandboxMode, "read-only");
});

test("codex provider keeps large system prompts out of constructor config", async () => {
	const largeSystemPrompt = `system-start\n${"x".repeat(256 * 1024)}\nsystem-end`;
	const captured: CapturedCall = {};
	const fake = makeFake({ captured });
	const provider = createCodexProvider(fake);

	await provider.invoke(
		baseParams({
			systemPrompt: largeSystemPrompt,
			prompt: "small user prompt",
		}),
	);

	const capturedConfig = JSON.stringify(captured.codexOpts?.config);
	assert.equal(capturedConfig.includes(largeSystemPrompt), false);
	assert.notEqual(
		captured.codexOpts?.config?.developer_instructions,
		largeSystemPrompt,
	);
	const developerInstructions =
		captured.codexOpts?.config?.developer_instructions;
	if (typeof developerInstructions !== "string") {
		assert.fail("developer_instructions must be a string");
	}
	assert.ok(developerInstructions.length < 256);
	assert.ok(captured.prompt?.includes(largeSystemPrompt));
	assert.ok(captured.prompt?.includes("small user prompt"));
});

// =====================================================================
// Gemini provider tests
// =====================================================================

interface FakeGenAIScripted {
	output?:
		| {
				text?: string;
				calls?: Array<{ name: string; args: Record<string, unknown> }>;
		  }
		| {
				error: {
					status: number;
					message: string;
					headers?: Record<string, string>;
				};
		  }
		| { throw: Error }
		| { finishReason: string; text?: string };
}

interface FakeGenAICaptured {
	apiKey?: string;
	calls: unknown[];
	attempts: number;
	ctorCalls: number;
}

interface MakeFakeGenAIOpts {
	responses?: FakeGenAIScripted[];
	captured: FakeGenAICaptured;
	throwOnCtor?: Error;
	infiniteFunctionCall?: { name: string; args: Record<string, unknown> }[];
}

function makeFakeGenAI(opts: MakeFakeGenAIOpts): GoogleGenAICtor {
	const responses = opts.responses ?? [];
	let index = 0;
	class FakeGoogleGenAI {
		readonly models = {
			// biome-ignore lint/suspicious/noExplicitAny: fake stand-in
			generateContent: async (params: unknown): Promise<any> => {
				opts.captured.calls.push(params);
				opts.captured.attempts++;
				let scripted: FakeGenAIScripted | undefined;
				if (opts.infiniteFunctionCall !== undefined) {
					scripted = {
						output: { calls: opts.infiniteFunctionCall },
					};
				} else {
					scripted = responses[index++];
				}
				if (scripted === undefined) {
					return synthesizeResponse({ text: "" });
				}
				const out = scripted.output;
				if (out === undefined) return synthesizeResponse({ text: "" });
				if ("throw" in out) throw out.throw;
				if ("error" in out) {
					const e = new Error(out.error.message) as Error & {
						status?: number;
						headers?: Record<string, string>;
					};
					e.status = out.error.status;
					if (out.error.headers !== undefined) e.headers = out.error.headers;
					throw e;
				}
				if ("finishReason" in out) {
					return synthesizeResponse({
						text: out.text ?? "",
						finishReason: out.finishReason,
					});
				}
				return synthesizeResponse({
					text: out.text,
					calls: out.calls,
				});
			},
		};
		constructor(options: { apiKey?: string }) {
			opts.captured.ctorCalls++;
			opts.captured.apiKey = options.apiKey;
			if (opts.throwOnCtor !== undefined) throw opts.throwOnCtor;
		}
	}
	return FakeGoogleGenAI as unknown as GoogleGenAICtor;
}

function synthesizeResponse(payload: {
	text?: string;
	calls?: Array<{ name: string; args: Record<string, unknown> }>;
	finishReason?: string;
}): unknown {
	const parts: Array<{ text?: string; functionCall?: unknown }> = [];
	if (payload.calls !== undefined) {
		for (const c of payload.calls) {
			parts.push({ functionCall: { name: c.name, args: c.args } });
		}
	}
	if (payload.text !== undefined && payload.text.length > 0) {
		parts.push({ text: payload.text });
	}
	return {
		candidates: [
			{
				content: { role: "model", parts },
				finishReason: payload.finishReason ?? "STOP",
			},
		],
	};
}

function makeCapturedGenAI(): FakeGenAICaptured {
	return { calls: [], attempts: 0, ctorCalls: 0 };
}

function geminiParams(overrides: Partial<InvokeParams> = {}): InvokeParams {
	const cwd = overrides.cwd ?? mkdtempSync(join(tmpdir(), "gemini-test-"));
	return {
		agent: { id: "g", provider: "gemini", model: "gemini-2.5-flash" },
		systemPrompt: "system prompt body",
		prompt: "user prompt",
		cwd,
		role: "testing",
		...overrides,
	};
}

function withGeminiEnv<T>(
	envOverrides: Record<string, string | undefined>,
	fn: () => Promise<T>,
): Promise<T> {
	const KEYS = ["GEMINI_API_KEY", "GOOGLE_API_KEY"];
	const prior: Record<string, string | undefined> = {};
	for (const key of KEYS) prior[key] = process.env[key];
	for (const key of KEYS) {
		if (key in envOverrides) {
			const v = envOverrides[key];
			if (v === undefined) delete process.env[key];
			else process.env[key] = v;
		}
	}
	return (async () => {
		try {
			return await fn();
		} finally {
			for (const key of KEYS) {
				if (prior[key] === undefined) delete process.env[key];
				else process.env[key] = prior[key];
			}
		}
	})();
}

test("getProvider('gemini').id === 'gemini'", () => {
	assert.equal(getProvider("gemini").id, "gemini");
});

test("gemini judge round-trip returns text and zero tool uses", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [{ output: { text: "judge yaml" } }],
	});
	const provider = createGeminiProvider(fake);

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k1" }, () =>
		provider.invoke(geminiParams({ role: "judge" })),
	);

	assert.equal(result.finalText, "judge yaml");
	assert.equal(result.toolUseCount, 0);
	assert.equal(result.error, undefined);
	assert.equal(captured.ctorCalls, 1);
	assert.equal(captured.apiKey, "k1");
	assert.equal(captured.calls.length, 1);
	const call = captured.calls[0] as {
		model: string;
		contents: Array<{ role: string; parts: Array<{ text?: string }> }>;
		config?: { systemInstruction?: string; tools?: unknown[] };
	};
	assert.equal(call.model, "gemini-2.5-flash");
	// Judge has no tools.
	assert.equal(call.config?.tools, undefined);
	// systemInstruction placement.
	assert.equal(call.config?.systemInstruction, "system prompt body");
	// User prompt body matches verbatim.
	assert.equal(call.contents[0]?.parts[0]?.text, "user prompt");
});

test("gemini testing round-trip with one Write call writes file under cwd", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [
			{
				output: {
					calls: [
						{
							name: "Write",
							args: { path: "answer.txt", content: "hello" },
						},
					],
				},
			},
			{ output: { text: "done" } },
		],
	});
	const provider = createGeminiProvider(fake);
	const cwd = mkdtempSync(join(tmpdir(), "gemini-test-"));

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ cwd })),
	);

	assert.equal(result.error, undefined);
	assert.equal(readFileSync(join(cwd, "answer.txt"), "utf8"), "hello");
	assert.equal(result.toolUseCount, 1);
	assert.equal(result.finalText, "done");
});

test("gemini testing counts each functionCall part separately", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [
			{
				output: {
					calls: [
						{ name: "Write", args: { path: "a.txt", content: "a" } },
						{ name: "Write", args: { path: "b.txt", content: "b" } },
					],
				},
			},
			{
				output: {
					calls: [{ name: "Write", args: { path: "c.txt", content: "c" } }],
				},
			},
			{ output: { text: "done" } },
		],
	});
	const provider = createGeminiProvider(fake);
	const cwd = mkdtempSync(join(tmpdir(), "gemini-test-"));

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ cwd })),
	);

	assert.equal(result.error, undefined);
	assert.equal(result.toolUseCount, 3);
	assert.equal(readFileSync(join(cwd, "c.txt"), "utf8"), "c");
});

test("gemini testing rejects path containment escape via `../`", async () => {
	const outside = mkdtempSync(join(tmpdir(), "gemini-outside-"));
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [
			{
				output: {
					calls: [
						{
							name: "Write",
							args: { path: "../escape.txt", content: "x" },
						},
					],
				},
			},
			{ output: { text: "done" } },
		],
	});
	const provider = createGeminiProvider(fake);
	const cwd = mkdtempSync(join(tmpdir(), "gemini-test-"));

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ cwd })),
	);

	assert.equal(result.error, undefined);
	assert.equal(result.finalText, "done");
	assert.equal(existsSync(join(outside, "escape.txt")), false);
	// Verify the model received an error functionResponse.
	const second = captured.calls[1] as {
		contents: Array<{
			role: string;
			parts: Array<{
				functionResponse?: { response?: Record<string, unknown> };
			}>;
		}>;
	};
	const lastTurn = second.contents.at(-1);
	const fr = lastTurn?.parts[0]?.functionResponse?.response;
	assert.equal(fr?.ok, false);
	assert.match(String(fr?.error), /outside workspace/);
});

test("gemini testing defeats sibling-prefix bypass", async () => {
	const baseDir = mkdtempSync(join(tmpdir(), "gemini-sibling-"));
	const cwd = join(baseDir, "work");
	const evil = join(baseDir, "work-evil");
	const fs = await import("node:fs");
	fs.mkdirSync(cwd, { recursive: true });
	fs.mkdirSync(evil, { recursive: true });

	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [
			{
				output: {
					calls: [
						{
							name: "Write",
							args: {
								path: "../work-evil/foo.txt",
								content: "x",
							},
						},
					],
				},
			},
			{ output: { text: "done" } },
		],
	});
	const provider = createGeminiProvider(fake);

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ cwd })),
	);

	assert.equal(result.error, undefined);
	assert.equal(existsSync(join(evil, "foo.txt")), false);
});

test("gemini testing rejects symlink-escape via realpath check", async () => {
	const outside = mkdtempSync(join(tmpdir(), "gemini-outside-"));
	writeFileSync(join(outside, "secret.txt"), "secret");
	const cwd = mkdtempSync(join(tmpdir(), "gemini-test-"));
	symlinkSync(outside, join(cwd, "link"));

	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [
			{
				output: {
					calls: [{ name: "Read", args: { path: "link/secret.txt" } }],
				},
			},
			{ output: { text: "done" } },
		],
	});
	const provider = createGeminiProvider(fake);

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ cwd })),
	);

	assert.equal(result.error, undefined);
	const second = captured.calls[1] as {
		contents: Array<{
			role: string;
			parts: Array<{
				functionResponse?: { response?: Record<string, unknown> };
			}>;
		}>;
	};
	const fr = second.contents.at(-1)?.parts[0]?.functionResponse?.response;
	assert.equal(fr?.ok, false);
	assert.match(String(fr?.error), /outside workspace/);
});

test("gemini judge sends no tools in config", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [{ output: { text: "ok" } }],
	});
	const provider = createGeminiProvider(fake);

	await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ role: "judge" })),
	);

	const call = captured.calls[0] as { config?: { tools?: unknown } };
	assert.ok(
		call.config?.tools === undefined ||
			(Array.isArray(call.config.tools) && call.config.tools.length === 0),
	);
});

test("gemini forwards pass-through knobs onto config", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [{ output: { text: "ok" } }],
	});
	const provider = createGeminiProvider(fake);

	await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(
			geminiParams({
				role: "judge",
				agent: {
					id: "g",
					provider: "gemini",
					model: "gemini-2.5-pro",
					temperature: 0.4,
					topP: 0.8,
					topK: 40,
					maxOutputTokens: 2048,
					thinkingBudget: 8192,
					safetySettings: [
						{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
					],
				},
			}),
		),
	);

	const call = captured.calls[0] as {
		config?: {
			temperature?: number;
			topP?: number;
			topK?: number;
			maxOutputTokens?: number;
			thinkingConfig?: { thinkingBudget?: number };
			safetySettings?: Array<{ category?: string; threshold?: string }>;
		};
	};
	assert.equal(call.config?.temperature, 0.4);
	assert.equal(call.config?.topP, 0.8);
	assert.equal(call.config?.topK, 40);
	assert.equal(call.config?.maxOutputTokens, 2048);
	assert.equal(call.config?.thinkingConfig?.thinkingBudget, 8192);
	assert.equal(
		call.config?.safetySettings?.[0]?.category,
		"HARM_CATEGORY_HARASSMENT",
	);
});

test("gemini effort string maps to thinkingBudget bucket", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [{ output: { text: "ok" } }, { output: { text: "ok" } }],
	});
	const provider = createGeminiProvider(fake);

	await withGeminiEnv({ GEMINI_API_KEY: "k" }, async () => {
		// effort: "high" with gemini-2.5-pro (ceiling 32768) → 16384.
		await provider.invoke(
			geminiParams({
				role: "judge",
				agent: {
					id: "g",
					provider: "gemini",
					model: "gemini-2.5-pro",
					effort: "high",
				},
			}),
		);
		// Explicit thinkingBudget wins over effort.
		await provider.invoke(
			geminiParams({
				role: "judge",
				agent: {
					id: "g",
					provider: "gemini",
					model: "gemini-2.5-pro",
					effort: "high",
					thinkingBudget: 1024,
				},
			}),
		);
	});

	const c0 = captured.calls[0] as {
		config?: { thinkingConfig?: { thinkingBudget?: number } };
	};
	const c1 = captured.calls[1] as {
		config?: { thinkingConfig?: { thinkingBudget?: number } };
	};
	assert.equal(c0.config?.thinkingConfig?.thinkingBudget, 16384);
	assert.equal(c1.config?.thinkingConfig?.thinkingBudget, 1024);
});

test("gemini per-model thinkingBudget clamp emits gap log", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [{ output: { text: "ok" } }],
	});
	const provider = createGeminiProvider(fake);

	const stderrChunks: string[] = [];
	const origWrite = process.stderr.write.bind(process.stderr);
	process.stderr.write = ((chunk: unknown) => {
		stderrChunks.push(String(chunk));
		return true;
	}) as typeof process.stderr.write;

	try {
		await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
			provider.invoke(
				geminiParams({
					role: "judge",
					agent: {
						id: "g",
						provider: "gemini",
						model: "gemini-2.5-flash",
						thinkingBudget: 30000,
					},
				}),
			),
		);
	} finally {
		process.stderr.write = origWrite;
	}

	const call = captured.calls[0] as {
		config?: { thinkingConfig?: { thinkingBudget?: number } };
	};
	assert.equal(call.config?.thinkingConfig?.thinkingBudget, 24576);
	const gapLine = stderrChunks.join("");
	assert.match(gapLine, /gap\[geminiThinkingBudgetClamped\]/);
	assert.match(gapLine, /"requested":30000/);
	assert.match(gapLine, /"applied":24576/);
});

test("gemini Edit zero-match returns error functionResponse and leaves file unchanged", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "gemini-test-"));
	writeFileSync(join(cwd, "a.txt"), "hello\n");
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [
			{
				output: {
					calls: [
						{
							name: "Edit",
							args: { path: "a.txt", old: "absent", new: "x" },
						},
					],
				},
			},
			{ output: { text: "done" } },
		],
	});
	const provider = createGeminiProvider(fake);

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ cwd })),
	);

	assert.equal(result.error, undefined);
	assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "hello\n");
	const second = captured.calls[1] as {
		contents: Array<{
			role: string;
			parts: Array<{
				functionResponse?: { response?: Record<string, unknown> };
			}>;
		}>;
	};
	const fr = second.contents.at(-1)?.parts[0]?.functionResponse?.response;
	assert.equal(fr?.ok, false);
	assert.match(String(fr?.error), /not found/);
});

test("gemini Edit multi-match returns error functionResponse and leaves file unchanged", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "gemini-test-"));
	writeFileSync(join(cwd, "a.txt"), "x x");
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [
			{
				output: {
					calls: [
						{
							name: "Edit",
							args: { path: "a.txt", old: "x", new: "y" },
						},
					],
				},
			},
			{ output: { text: "done" } },
		],
	});
	const provider = createGeminiProvider(fake);

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ cwd })),
	);

	assert.equal(result.error, undefined);
	assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "x x");
	const second = captured.calls[1] as {
		contents: Array<{
			role: string;
			parts: Array<{
				functionResponse?: { response?: Record<string, unknown> };
			}>;
		}>;
	};
	const fr = second.contents.at(-1)?.parts[0]?.functionResponse?.response;
	assert.equal(fr?.ok, false);
	assert.match(String(fr?.error), /unique|appears/);
});

test("gemini drops invalid pass-through knob types silently", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [{ output: { text: "ok" } }],
	});
	const provider = createGeminiProvider(fake);

	await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(
			geminiParams({
				role: "judge",
				agent: {
					id: "g",
					provider: "gemini",
					model: "gemini-2.5-flash",
					temperature: "warm",
					topP: Number.NaN,
					maxOutputTokens: -1,
				},
			}),
		),
	);

	const call = captured.calls[0] as {
		config?: { temperature?: number; topP?: number; maxOutputTokens?: number };
	};
	assert.equal(call.config?.temperature, undefined);
	assert.equal(call.config?.topP, undefined);
	assert.equal(call.config?.maxOutputTokens, undefined);
});

test("gemini missing API key returns error without instantiating SDK", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [{ output: { text: "ok" } }],
	});
	const provider = createGeminiProvider(fake);

	const result = await withGeminiEnv(
		{ GEMINI_API_KEY: undefined, GOOGLE_API_KEY: undefined },
		() => provider.invoke(geminiParams({ role: "judge" })),
	);

	assert.equal(result.finalText, "");
	assert.equal(result.toolUseCount, 0);
	assert.match(
		result.error ?? "",
		/GEMINI_API_KEY \(or GOOGLE_API_KEY\) not set/,
	);
	assert.equal(captured.ctorCalls, 0);
	assert.equal(captured.attempts, 0);
});

test("gemini API key precedence: GEMINI_API_KEY wins over GOOGLE_API_KEY", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [{ output: { text: "ok" } }],
	});
	const provider = createGeminiProvider(fake);

	await withGeminiEnv(
		{ GEMINI_API_KEY: "primary", GOOGLE_API_KEY: "fallback" },
		() => provider.invoke(geminiParams({ role: "judge" })),
	);

	assert.equal(captured.apiKey, "primary");
});

test("gemini falls back to GOOGLE_API_KEY when GEMINI_API_KEY is unset", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [{ output: { text: "ok" } }],
	});
	const provider = createGeminiProvider(fake);

	await withGeminiEnv(
		{ GEMINI_API_KEY: undefined, GOOGLE_API_KEY: "fallback" },
		() => provider.invoke(geminiParams({ role: "judge" })),
	);

	assert.equal(captured.apiKey, "fallback");
});

test("gemini systemPrompt lands on systemInstruction (never concatenated)", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [{ output: { text: "ok" } }],
	});
	const provider = createGeminiProvider(fake);

	await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(
			geminiParams({
				role: "judge",
				systemPrompt: "SYS_BLOB_HERE",
				prompt: "USER_PROMPT_HERE",
			}),
		),
	);

	const call = captured.calls[0] as {
		config?: { systemInstruction?: string };
		contents: Array<{ parts: Array<{ text?: string }> }>;
	};
	assert.equal(call.config?.systemInstruction, "SYS_BLOB_HERE");
	const userText = call.contents[0]?.parts[0]?.text ?? "";
	assert.equal(userText, "USER_PROMPT_HERE");
	assert.equal(userText.includes("SYS_BLOB_HERE"), false);
});

test("gemini SDK throw (non-retryable plain Error) returns error after one attempt", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		// Plain Error has no `status` → currently retried as "network-ish".
		// To test no-retry behavior, use a 4xx error.
		responses: [
			{
				output: {
					error: { status: 400, message: "bad request" },
				},
			},
		],
	});
	const provider = createGeminiProvider(fake);

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ role: "judge" })),
	);

	assert.equal(result.finalText, "");
	assert.match(result.error ?? "", /400|bad request/);
	assert.equal(captured.attempts, 1);
});

test("gemini constructor throw is caught and surfaced as error", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		throwOnCtor: new Error("ctor boom"),
	});
	const provider = createGeminiProvider(fake);

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ role: "judge" })),
	);

	assert.equal(result.finalText, "");
	assert.equal(result.error, "ctor boom");
});

test("gemini retries on 429 then succeeds", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [
			{ output: { error: { status: 429, message: "slow down" } } },
			{ output: { text: "after retry" } },
		],
	});
	const provider = createGeminiProvider(fake);

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ role: "judge" })),
	);

	assert.equal(result.error, undefined);
	assert.equal(result.finalText, "after retry");
	assert.equal(captured.attempts, 2);
});

test("gemini does not retry on 401", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [{ output: { error: { status: 401, message: "unauth" } } }],
	});
	const provider = createGeminiProvider(fake);

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ role: "judge" })),
	);

	assert.match(result.error ?? "", /401|unauth/);
	assert.equal(captured.attempts, 1);
});

test("gemini exhausts 5 retries on persistent 429", {
	timeout: 60000,
}, async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [
			{ output: { error: { status: 429, message: "rl1" } } },
			{ output: { error: { status: 429, message: "rl2" } } },
			{ output: { error: { status: 429, message: "rl3" } } },
			{ output: { error: { status: 429, message: "rl4" } } },
			{ output: { error: { status: 429, message: "rl5" } } },
		],
	});
	const provider = createGeminiProvider(fake);

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(
			geminiParams({
				role: "judge",
				agent: {
					id: "g",
					provider: "gemini",
					model: "gemini-2.5-flash",
				},
			}),
		),
	);

	assert.match(result.error ?? "", /rate-limited/);
	assert.equal(captured.attempts, 5);
});

test("gemini SAFETY finishReason becomes error, no retry", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [{ output: { finishReason: "SAFETY", text: "partial" } }],
	});
	const provider = createGeminiProvider(fake);

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ role: "judge" })),
	);

	assert.match(result.error ?? "", /safety/i);
	assert.equal(result.finalText, "partial");
	assert.equal(captured.attempts, 1);
});

test("gemini tool-loop ceiling: 60-turn cap is hit and execution still counts", {
	timeout: 60000,
}, async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		// infiniteFunctionCall causes every turn to return one functionCall.
		infiniteFunctionCall: [
			{ name: "Write", args: { path: "spam.txt", content: "x" } },
		],
	});
	const provider = createGeminiProvider(fake);
	const cwd = mkdtempSync(join(tmpdir(), "gemini-test-"));

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ cwd })),
	);

	assert.equal(result.error, "tool-loop ceiling reached");
	assert.equal(result.toolUseCount, 60);
	// 60 generateContent calls — the boundary rule says NO 61st call.
	assert.equal(captured.attempts, 60);
});

test("gemini tool-loop ceiling: parallel calls per turn → toolUseCount may exceed 60", {
	timeout: 60000,
}, async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		infiniteFunctionCall: [
			{ name: "Write", args: { path: "spam-a.txt", content: "x" } },
			{ name: "Write", args: { path: "spam-b.txt", content: "y" } },
		],
	});
	const provider = createGeminiProvider(fake);
	const cwd = mkdtempSync(join(tmpdir(), "gemini-test-"));

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ cwd })),
	);

	assert.equal(result.error, "tool-loop ceiling reached");
	assert.ok(
		result.toolUseCount >= 60,
		`expected >=60, got ${result.toolUseCount}`,
	);
});

test("gemini Bash respects timeoutMs", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [
			{
				output: {
					calls: [
						{ name: "Bash", args: { command: "sleep 5", timeoutMs: 100 } },
					],
				},
			},
			{ output: { text: "done" } },
		],
	});
	const provider = createGeminiProvider(fake);
	const cwd = mkdtempSync(join(tmpdir(), "gemini-test-"));

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ cwd })),
	);

	assert.equal(result.error, undefined);
	const second = captured.calls[1] as {
		contents: Array<{
			role: string;
			parts: Array<{
				functionResponse?: { response?: Record<string, unknown> };
			}>;
		}>;
	};
	const fr = second.contents.at(-1)?.parts[0]?.functionResponse?.response;
	assert.equal(fr?.ok, true);
	assert.equal(fr?.timedOut, true);
});

test("gemini Bash does not leak API keys into child env", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [
			{
				output: {
					calls: [
						{
							name: "Bash",
							args: {
								command:
									// biome-ignore lint/suspicious/noTemplateCurlyInString: bash parameter expansion
									"echo G:${GEMINI_API_KEY:-missing} O:${OPENAI_API_KEY:-missing} A:${ANTHROPIC_API_KEY:-missing} GG:${GOOGLE_API_KEY:-missing}",
							},
						},
					],
				},
			},
			{ output: { text: "done" } },
		],
	});
	const provider = createGeminiProvider(fake);
	const cwd = mkdtempSync(join(tmpdir(), "gemini-test-"));

	const priorEnv = {
		GEMINI_API_KEY: process.env.GEMINI_API_KEY,
		GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
		OPENAI_API_KEY: process.env.OPENAI_API_KEY,
		ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
	};
	process.env.GEMINI_API_KEY = "leak1";
	process.env.GOOGLE_API_KEY = "leak2";
	process.env.OPENAI_API_KEY = "leak3";
	process.env.ANTHROPIC_API_KEY = "leak4";

	let result: Awaited<ReturnType<typeof provider.invoke>>;
	try {
		result = await provider.invoke(geminiParams({ cwd }));
	} finally {
		for (const [key, value] of Object.entries(priorEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}

	assert.equal(result.error, undefined);
	const second = captured.calls[1] as {
		contents: Array<{
			role: string;
			parts: Array<{
				functionResponse?: { response?: Record<string, unknown> };
			}>;
		}>;
	};
	const fr = second.contents.at(-1)?.parts[0]?.functionResponse?.response;
	const stdout = String(fr?.stdout ?? "");
	assert.match(stdout, /G:missing/);
	assert.match(stdout, /O:missing/);
	assert.match(stdout, /A:missing/);
	assert.match(stdout, /GG:missing/);
	// Most importantly: real key values do not appear anywhere.
	assert.equal(stdout.includes("leak1"), false);
	assert.equal(stdout.includes("leak2"), false);
	assert.equal(stdout.includes("leak3"), false);
	assert.equal(stdout.includes("leak4"), false);
});

test("gemini Bash recursion guard rejects self-invocation", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [
			{
				output: {
					calls: [
						{
							name: "Bash",
							args: { command: "skillsmith --help" },
						},
					],
				},
			},
			{ output: { text: "done" } },
		],
	});
	const provider = createGeminiProvider(fake);
	const cwd = mkdtempSync(join(tmpdir(), "gemini-test-"));

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ cwd })),
	);

	assert.equal(result.error, undefined);
	const second = captured.calls[1] as {
		contents: Array<{
			role: string;
			parts: Array<{
				functionResponse?: { response?: Record<string, unknown> };
			}>;
		}>;
	};
	const fr = second.contents.at(-1)?.parts[0]?.functionResponse?.response;
	assert.equal(fr?.ok, false);
	assert.match(String(fr?.error), /recursion guard/);
	// And spawn was not attempted (no stdout/stderr fields).
	assert.equal(fr?.stdout, undefined);
});

test("gemini Bash truncates stdout > 64 KiB with [truncated] sentinel", async () => {
	const captured = makeCapturedGenAI();
	const fake = makeFakeGenAI({
		captured,
		responses: [
			{
				output: {
					calls: [
						{
							name: "Bash",
							// Print 80 KiB of `x` to stdout.
							args: {
								command:
									"node -e \"process.stdout.write('x'.repeat(80*1024))\"",
							},
						},
					],
				},
			},
			{ output: { text: "done" } },
		],
	});
	const provider = createGeminiProvider(fake);
	const cwd = mkdtempSync(join(tmpdir(), "gemini-test-"));

	const result = await withGeminiEnv({ GEMINI_API_KEY: "k" }, () =>
		provider.invoke(geminiParams({ cwd })),
	);

	assert.equal(result.error, undefined);
	const second = captured.calls[1] as {
		contents: Array<{
			role: string;
			parts: Array<{
				functionResponse?: { response?: Record<string, unknown> };
			}>;
		}>;
	};
	const fr = second.contents.at(-1)?.parts[0]?.functionResponse?.response;
	const stdout = String(fr?.stdout ?? "");
	assert.match(stdout, /\[truncated\]/);
	// Stdout body before sentinel ≤ 64 KiB.
	const before = stdout.replace(/\n\[truncated\]$/, "");
	assert.ok(Buffer.byteLength(before) <= 64 * 1024);
});
