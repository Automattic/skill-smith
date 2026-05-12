import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
	CodexOptions,
	ThreadEvent,
	ThreadOptions,
} from "@openai/codex-sdk";
import { type CodexCtor, createCodexProvider } from "../providers/codex";
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
	assert.equal(isProviderId("anthropic-api"), true);
	assert.equal(isProviderId("codex"), true);
	assert.equal(isProviderId("bogus"), false);
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
