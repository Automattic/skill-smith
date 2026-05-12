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
import { type CodexCtor, createCodexProvider } from "../providers/codex";
import {
	createOpenAiApiProvider,
	type OpenAiClientFactory,
} from "../providers/openai-api";
import { getProvider, isProviderId } from "../providers/registry";
import type { InvokeParams } from "../providers/types";

test("getProvider returns the matching provider", () => {
	assert.equal(getProvider("mock").id, "mock");
	assert.equal(getProvider("claude-code").id, "claude-code");
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
	assert.equal(isProviderId("openai-api"), true);
	assert.equal(isProviderId("codex"), true);
	assert.equal(isProviderId("bogus"), false);
});

test("openai-api provider is registered without constructing a client at import time", () => {
	assert.equal(getProvider("openai-api").id, "openai-api");
});

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
