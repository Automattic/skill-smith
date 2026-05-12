import { promises as fs } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import type {
	Response,
	ResponseCreateParamsNonStreaming,
	ResponseFunctionToolCall,
	ResponseInputItem,
	ResponseOutputItem,
	Tool,
} from "openai/resources/responses/responses";
import type { AgentDefinition } from "../config/types";
import type { InvokeParams, InvokeResult, Provider } from "./types";

const EFFORT_VALUES = ["minimal", "low", "medium", "high", "xhigh"] as const;
const DEFAULT_MAX_TOOL_ITERATIONS = 25;
const MAX_TOOL_ITERATIONS_CEILING = 100;
const MAX_READ_BYTES = 48 * 1024;
const MAX_TOOL_OUTPUT_BYTES = 64 * 1024;
const MAX_LIST_ENTRIES = 200;
const MAX_LIST_DEPTH = 4;

type OpenAiClient = {
	responses: {
		create(params: ResponseCreateParamsNonStreaming): Promise<Response>;
	};
};
export type OpenAiClientFactory = () => OpenAiClient;

interface ToolContext {
	cwd: string;
	cwdReal: string;
}

type ToolResult = { ok: true; [key: string]: unknown } | { ok: false; error: string };

export function createOpenAiApiProvider(
	clientFactory: OpenAiClientFactory = () => new OpenAI(),
): Provider {
	return {
		id: "openai-api",
		async invoke(params: InvokeParams): Promise<InvokeResult> {
			let finalText = "";
			let toolUseCount = 0;
			let error: string | undefined;

			try {
				const client = clientFactory();
				if (params.role === "judge") {
					const response = await client.responses.create({
						model: params.agent.model,
						instructions: params.systemPrompt,
						input: params.prompt,
						store: false,
						...extraResponseOptions(params.agent, { allowWebSearch: true }),
					});
					error = firstError(error, validateResponse(response));
					finalText = response.output_text ?? "";
					toolUseCount = countHostedToolCalls(response.output);
				} else {
					const result = await invokeTesting(client, params);
					finalText = result.finalText;
					toolUseCount = result.toolUseCount;
					error = result.error;
				}
			} catch (err) {
				error = firstError(error, errorMessage(err));
			}

			const result: InvokeResult = { finalText, toolUseCount };
			if (error !== undefined) result.error = error;
			return result;
		},
	};
}

async function invokeTesting(
	client: OpenAiClient,
	params: InvokeParams,
): Promise<InvokeResult> {
	let finalText = "";
	let toolUseCount = 0;
	const maxIterations = maxToolIterations(params.agent);
	const input: ResponseInputItem[] = [
		{ role: "user", content: params.prompt, type: "message" },
	];
	const toolContext: ToolContext = {
		cwd: path.resolve(params.cwd),
		cwdReal: await fs.realpath(params.cwd),
	};
	let completedToolRounds = 0;

	while (true) {
		const response = await client.responses.create({
			model: params.agent.model,
			instructions: params.systemPrompt,
			input,
			store: false,
			include: ["reasoning.encrypted_content"],
			tools: localTools(),
			parallel_tool_calls: true,
			...extraResponseOptions(params.agent, { allowWebSearch: false }),
		});
		finalText = response.output_text ?? finalText;
		toolUseCount += countHostedToolCalls(response.output);
		const responseError = validateResponse(response);
		if (responseError !== undefined) {
			return { finalText, toolUseCount, error: responseError };
		}
		const functionCalls = functionToolCalls(response.output);

		if (functionCalls.length === 0) {
			if (finalText.length > 0) {
				return { finalText, toolUseCount };
			}
			return {
				finalText,
				toolUseCount,
				error: "OpenAI API response had no final text or function calls",
			};
		}

		input.push(...(response.output as ResponseInputItem[]));
		const outputs: ResponseInputItem[] = [];
		for (const call of functionCalls) {
			toolUseCount++;
			if (!isUsableCallId(call.call_id)) {
				return {
					finalText,
					toolUseCount,
					error: `OpenAI API function call "${call.name}" is missing a usable call_id`,
				};
			}
			outputs.push(await executeFunctionCall(call, toolContext));
		}
		input.push(...outputs);
		completedToolRounds++;
		if (completedToolRounds >= maxIterations) {
			return {
				finalText: "",
				toolUseCount,
				error: `OpenAI API tool loop reached maxToolIterations (${maxIterations})`,
			};
		}
	}
}

async function executeFunctionCall(
	call: ResponseFunctionToolCall,
	context: ToolContext,
): Promise<ResponseInputItem> {
	let output: ToolResult;
	try {
		const parsed = parseJsonObject(call.arguments);
		output = await runLocalTool(call.name, parsed, context);
	} catch (err) {
		output = { ok: false, error: errorMessage(err) };
	}
	return {
		type: "function_call_output",
		call_id: call.call_id,
		output: cappedJson(output),
	};
}

async function runLocalTool(
	name: string,
	args: Record<string, unknown>,
	context: ToolContext,
): Promise<ToolResult> {
	switch (name) {
		case "list_files":
			return listFiles(context, optionalString(args.path, "path") ?? ".");
		case "read_file":
			return readFile(context, requiredString(args.path, "path"));
		case "write_file":
			return writeFile(
				context,
				requiredString(args.path, "path"),
				requiredString(args.content, "content"),
			);
		case "replace_file":
			return replaceFile(
				context,
				requiredString(args.path, "path"),
				requiredString(args.old, "old"),
				requiredString(args.replacement, "replacement"),
				optionalBoolean(args.replaceAll, "replaceAll") ?? false,
			);
		case "mkdir":
			return mkdir(context, requiredString(args.path, "path"));
		default:
			return { ok: false, error: `unknown tool: ${name}` };
	}
}

async function listFiles(
	context: ToolContext,
	requestPath: string,
): Promise<ToolResult> {
	const dir = await resolveWorkspacePath(context, requestPath, {
		allowMissing: false,
	});
	const stat = await fs.stat(dir);
	if (!stat.isDirectory()) return { ok: false, error: `${requestPath} is not a directory` };

	const entries: string[] = [];
	async function walk(current: string, depth: number): Promise<void> {
		if (entries.length >= MAX_LIST_ENTRIES || depth > MAX_LIST_DEPTH) return;
		const dirents = await fs.readdir(current, { withFileTypes: true });
		dirents.sort((a, b) => a.name.localeCompare(b.name));
		for (const dirent of dirents) {
			if (entries.length >= MAX_LIST_ENTRIES) break;
			const fullPath = path.join(current, dirent.name);
			const relativePath = path.relative(context.cwd, fullPath);
			entries.push(dirent.isDirectory() ? `${relativePath}/` : relativePath);
			if (dirent.isDirectory()) await walk(fullPath, depth + 1);
		}
	}
	await walk(dir, 1);
	return { ok: true, entries, truncated: entries.length >= MAX_LIST_ENTRIES };
}

async function readFile(
	context: ToolContext,
	requestPath: string,
): Promise<ToolResult> {
	const file = await resolveWorkspacePath(context, requestPath, {
		allowMissing: false,
	});
	const stat = await fs.stat(file);
	if (!stat.isFile()) return { ok: false, error: `${requestPath} is not a file` };
	const data = await fs.readFile(file);
	const truncated = data.byteLength > MAX_READ_BYTES;
	const body = data.subarray(0, MAX_READ_BYTES).toString("utf8");
	return {
		ok: true,
		path: requestPath,
		content: body,
		truncated,
		bytesRead: Math.min(data.byteLength, MAX_READ_BYTES),
		totalBytes: data.byteLength,
	};
}

async function writeFile(
	context: ToolContext,
	requestPath: string,
	content: string,
): Promise<ToolResult> {
	const file = await resolveWorkspacePath(context, requestPath, {
		allowMissing: true,
	});
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, content, "utf8");
	return { ok: true, path: requestPath, bytesWritten: Buffer.byteLength(content) };
}

async function replaceFile(
	context: ToolContext,
	requestPath: string,
	oldText: string,
	replacement: string,
	replaceAll: boolean,
): Promise<ToolResult> {
	if (oldText.length === 0) return { ok: false, error: "old must not be empty" };
	const file = await resolveWorkspacePath(context, requestPath, {
		allowMissing: false,
	});
	const content = await fs.readFile(file, "utf8");
	const matches = content.split(oldText).length - 1;
	if (matches === 0) return { ok: false, error: "old text was not found" };
	if (matches > 1 && !replaceAll) {
		return {
			ok: false,
			error: "old text appears more than once; pass replaceAll: true to replace all matches",
		};
	}
	const next = replaceAll
		? content.split(oldText).join(replacement)
		: content.replace(oldText, replacement);
	await fs.writeFile(file, next, "utf8");
	return { ok: true, path: requestPath, replacements: replaceAll ? matches : 1 };
}

async function mkdir(
	context: ToolContext,
	requestPath: string,
): Promise<ToolResult> {
	const dir = await resolveWorkspacePath(context, requestPath, {
		allowMissing: true,
	});
	await fs.mkdir(dir, { recursive: true });
	return { ok: true, path: requestPath };
}

async function resolveWorkspacePath(
	context: ToolContext,
	requestPath: string,
	opts: { allowMissing: boolean },
): Promise<string> {
	if (requestPath.length === 0) throw new Error("path must not be empty");
	if (path.isAbsolute(requestPath)) throw new Error("absolute paths are not allowed");
	const resolved = path.resolve(context.cwd, requestPath);
	if (!isInside(context.cwd, resolved)) {
		throw new Error(`path escapes workspace: ${requestPath}`);
	}

	if (!opts.allowMissing) {
		const real = await fs.realpath(resolved);
		if (!isInside(context.cwdReal, real)) {
			throw new Error(`path resolves outside workspace: ${requestPath}`);
		}
		return resolved;
	}

	const existingParent = await nearestExistingParent(resolved, context.cwd);
	const parentReal = await fs.realpath(existingParent);
	if (!isInside(context.cwdReal, parentReal)) {
		throw new Error(`path parent resolves outside workspace: ${requestPath}`);
	}
	return resolved;
}

async function nearestExistingParent(target: string, cwd: string): Promise<string> {
	let current = target;
	while (isInside(cwd, current)) {
		try {
			await fs.access(current);
			return current;
		} catch {
			const parent = path.dirname(current);
			if (parent === current) break;
			current = parent;
		}
	}
	return cwd;
}

function isInside(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function functionToolCalls(
	output: ResponseOutputItem[] | undefined,
): ResponseFunctionToolCall[] {
	return (output ?? []).filter(
		(item): item is ResponseFunctionToolCall => item.type === "function_call",
	);
}

function countHostedToolCalls(output: ResponseOutputItem[] | undefined): number {
	return (output ?? []).filter((item) => item.type === "web_search_call").length;
}

function validateResponse(response: Response): string | undefined {
	if (response.status === "completed") return undefined;
	if (response.status === "incomplete") {
		const reason = response.incomplete_details?.reason;
		return reason === undefined || reason === null
			? "OpenAI API response was incomplete"
			: `OpenAI API response was incomplete: ${reason}`;
	}
	return (
		response.error?.message ??
		`OpenAI API response did not complete successfully: status ${response.status}`
	);
}

function extraResponseOptions(
	agent: AgentDefinition,
	opts: { allowWebSearch: boolean },
): Partial<ResponseCreateParamsNonStreaming> {
	const out: Partial<ResponseCreateParamsNonStreaming> = {};
	if (isEffort(agent.effort)) {
		out.reasoning = { effort: agent.effort };
	}
	if (typeof agent.temperature === "number" && Number.isFinite(agent.temperature)) {
		out.temperature = agent.temperature;
	}
	if (
		typeof agent.maxOutputTokens === "number" &&
		Number.isFinite(agent.maxOutputTokens) &&
		agent.maxOutputTokens > 0
	) {
		out.max_output_tokens = agent.maxOutputTokens;
	}
	if (opts.allowWebSearch && agent.webSearch === "live") {
		out.tools = [{ type: "web_search_preview" }];
	}
	return out;
}

function maxToolIterations(agent: AgentDefinition): number {
	if (
		typeof agent.maxToolIterations === "number" &&
		Number.isFinite(agent.maxToolIterations) &&
		agent.maxToolIterations > 0
	) {
		return Math.min(Math.floor(agent.maxToolIterations), MAX_TOOL_ITERATIONS_CEILING);
	}
	return DEFAULT_MAX_TOOL_ITERATIONS;
}

function localTools(): Tool[] {
	return [
		tool("list_files", "List files below a relative directory in the workspace.", {
			path: { type: ["string", "null"] },
		}),
		tool("read_file", "Read a UTF-8 text file from the workspace.", {
			path: { type: "string" },
		}),
		tool("write_file", "Write a UTF-8 text file in the workspace.", {
			path: { type: "string" },
			content: { type: "string" },
		}),
		tool("replace_file", "Replace text in a UTF-8 text file in the workspace.", {
			path: { type: "string" },
			old: { type: "string" },
			replacement: { type: "string" },
			replaceAll: { type: ["boolean", "null"] },
		}),
		tool("mkdir", "Create a directory in the workspace.", {
			path: { type: "string" },
		}),
	];
}

function tool(
	name: string,
	description: string,
	properties: Record<string, unknown>,
): Tool {
	return {
		type: "function",
		name,
		description,
		strict: true,
		parameters: {
			type: "object",
			properties,
			required: Object.keys(properties),
			additionalProperties: false,
		},
	};
}

function parseJsonObject(raw: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("function arguments were not valid JSON");
	}
	if (
		parsed === null ||
		typeof parsed !== "object" ||
		Array.isArray(parsed)
	) {
		throw new Error("function arguments must be a JSON object");
	}
	return parsed as Record<string, unknown>;
}

function requiredString(value: unknown, key: string): string {
	if (typeof value !== "string") throw new Error(`${key} must be a string`);
	return value;
}

function optionalString(value: unknown, key: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new Error(`${key} must be a string`);
	return value;
}

function optionalBoolean(value: unknown, key: string): boolean | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
	return value;
}

function cappedJson(value: ToolResult): string {
	return capToolOutput(JSON.stringify(value));
}

function capToolOutput(value: string): string {
	const bytes = Buffer.byteLength(value);
	if (bytes <= MAX_TOOL_OUTPUT_BYTES) return value;
	const source = Buffer.from(value);
	let budget = MAX_TOOL_OUTPUT_BYTES - 512;
	while (budget > 0) {
		const output = source.subarray(0, budget).toString("utf8");
		const capped = JSON.stringify({
			ok: false,
			error: "tool output exceeded maximum size and was truncated",
			output,
			truncated: true,
			originalBytes: bytes,
		});
		if (Buffer.byteLength(capped) <= MAX_TOOL_OUTPUT_BYTES) return capped;
		budget -= 512;
	}
	return JSON.stringify({
		ok: false,
		error: "tool output exceeded maximum size and was truncated",
		truncated: true,
		originalBytes: bytes,
	});
}

function isEffort(
	value: unknown,
): value is NonNullable<ResponseCreateParamsNonStreaming["reasoning"]>["effort"] {
	return (
		typeof value === "string" &&
		EFFORT_VALUES.includes(value as (typeof EFFORT_VALUES)[number])
	);
}

function isUsableCallId(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function firstError(
	current: string | undefined,
	next: string | undefined,
): string | undefined {
	return current ?? next;
}
