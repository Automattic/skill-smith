import { spawn } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type {
	ContentBlock,
	ContentBlockParam,
	Message,
	MessageCreateParamsNonStreaming,
	MessageParam,
	Tool,
	ToolResultBlockParam,
	ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { AgentDefinition } from "../config/types";
import type { InvokeParams, InvokeResult, Provider } from "./types";

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 30_000;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MAX_TOOL_ITERATIONS = 25;
const MAX_TOOL_ITERATIONS_CEILING = 100;
const DEFAULT_BASH_TIMEOUT_MS = 300 * 1000;
const MAX_BASH_TIMEOUT_MS = 600 * 1000;
const MAX_TOOL_OUTPUT_BYTES = 64 * 1024;
const MAX_READ_BYTES = 48 * 1024;

const ALLOWED_BASH_ENV_KEYS = new Set([
	"PATH",
	"HOME",
	"SHELL",
	"USER",
	"LOGNAME",
	"TMPDIR",
	"LANG",
]);
const FORBIDDEN_BASH_ENV_KEYS = new Set([
	"GEMINI_API_KEY",
	"GOOGLE_API_KEY",
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
]);

const SKILLSMITH_RECURSION_RE = /(^|[;&|`]|\$\()\s*skillsmith\b/;

export type AnthropicClientLike = {
	messages: {
		create(params: MessageCreateParamsNonStreaming): Promise<Message>;
	};
};

export type AnthropicClientFactory = (opts: {
	apiKey: string;
	timeoutMs?: number;
}) => AnthropicClientLike;

interface ToolExecResult {
	ok: boolean;
	response: Record<string, unknown>;
}

export function createAnthropicApiProvider(
	clientFactory: AnthropicClientFactory = ({ apiKey, timeoutMs }) =>
		new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 0 }),
): Provider {
	return {
		id: "anthropic-api",
		async invoke(params: InvokeParams): Promise<InvokeResult> {
			let finalText = "";
			let toolUseCount = 0;
			let error: string | undefined;

			try {
				const apiKey = process.env.ANTHROPIC_API_KEY;
				if (apiKey === undefined || apiKey.length === 0) {
					return {
						finalText: "",
						toolUseCount: 0,
						error: "ANTHROPIC_API_KEY not set",
					};
				}

				const client = clientFactory({
					apiKey,
					timeoutMs: positiveNumber(params.agent.timeoutMs),
				});

				if (params.role === "judge") {
					const response = await callWithRetries(client, {
						model: params.agent.model,
						max_tokens: maxOutputTokens(params.agent),
						system: params.systemPrompt,
						messages: [{ role: "user", content: params.prompt }],
						...extraAnthropicOptions(params.agent),
					});
					finalText = textFromContent(response.content);
					error = terminalStopError(response, "judge");
					toolUseCount = 0;
				} else {
					const result = await runTestingLoop(client, params);
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

async function runTestingLoop(
	client: AnthropicClientLike,
	params: InvokeParams,
): Promise<InvokeResult> {
	const cwd = params.cwd;
	const messages: MessageParam[] = [{ role: "user", content: params.prompt }];
	const maxIterations = maxToolIterations(params.agent);
	let finalText = "";
	let toolUseCount = 0;

	for (let turn = 0; turn < maxIterations; turn++) {
		let response: Message;
		try {
			response = await callWithRetries(client, {
				model: params.agent.model,
				max_tokens: maxOutputTokens(params.agent),
				system: params.systemPrompt,
				messages,
				tools: TESTING_TOOLS,
				...extraAnthropicOptions(params.agent),
			});
		} catch (err) {
			return { finalText, toolUseCount, error: errorMessage(err) };
		}

		const text = textFromContent(response.content);
		if (text.length > 0) finalText = text;

		const toolUses = collectToolUses(response.content);
		if (toolUses.length === 0) {
			const stopError = terminalStopError(response, "testing");
			if (stopError !== undefined) {
				return { finalText, toolUseCount, error: stopError };
			}
			if (text.length > 0) {
				return { finalText, toolUseCount };
			}
			return {
				finalText,
				toolUseCount,
				error: "Anthropic API response had no final text or tool calls",
			};
		}

		if (response.stop_reason !== "tool_use") {
			return {
				finalText,
				toolUseCount,
				error: stopReasonError(response, "testing"),
			};
		}

		messages.push({
			role: "assistant",
			content: response.content as ContentBlockParam[],
		});

		const results: ToolResultBlockParam[] = [];
		for (const toolUse of toolUses) {
			toolUseCount++;
			const exec = await executeToolUse(toolUse, cwd);
			results.push({
				type: "tool_result",
				tool_use_id: toolUse.id,
				content: cappedJson(exec.response),
				is_error: !exec.ok,
			});
		}
		messages.push({ role: "user", content: results });
	}

	return {
		finalText,
		toolUseCount,
		error: `Anthropic API tool loop reached maxToolIterations (${maxIterations})`,
	};
}

function extraAnthropicOptions(
	agent: AgentDefinition,
): Partial<MessageCreateParamsNonStreaming> {
	const out: Partial<MessageCreateParamsNonStreaming> = {};
	if (
		typeof agent.temperature === "number" &&
		Number.isFinite(agent.temperature)
	) {
		out.temperature = agent.temperature;
	}
	if (typeof agent.topP === "number" && Number.isFinite(agent.topP)) {
		out.top_p = agent.topP;
	}
	if (
		typeof agent.topK === "number" &&
		Number.isFinite(agent.topK) &&
		agent.topK > 0
	) {
		out.top_k = Math.floor(agent.topK);
	}
	if (
		Array.isArray(agent.stopSequences) &&
		agent.stopSequences.every((value) => typeof value === "string")
	) {
		out.stop_sequences = agent.stopSequences;
	}
	return out;
}

function maxOutputTokens(agent: AgentDefinition): number {
	if (
		typeof agent.maxOutputTokens === "number" &&
		Number.isFinite(agent.maxOutputTokens) &&
		agent.maxOutputTokens > 0
	) {
		return Math.floor(agent.maxOutputTokens);
	}
	return DEFAULT_MAX_TOKENS;
}

function maxToolIterations(agent: AgentDefinition): number {
	if (
		typeof agent.maxToolIterations === "number" &&
		Number.isFinite(agent.maxToolIterations) &&
		agent.maxToolIterations > 0
	) {
		return Math.min(
			Math.floor(agent.maxToolIterations),
			MAX_TOOL_ITERATIONS_CEILING,
		);
	}
	return DEFAULT_MAX_TOOL_ITERATIONS;
}

function positiveNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return value;
}

const TESTING_TOOLS: Tool[] = [
	tool(
		"Read",
		"Read a UTF-8 text file from the workspace.",
		{
			path: { type: "string" },
		},
		["path"],
	),
	tool(
		"Write",
		"Write a UTF-8 text file in the workspace. Creates parent directories as needed. Refuses to write through symlinks.",
		{
			path: { type: "string" },
			content: { type: "string" },
		},
		["path", "content"],
	),
	tool(
		"Edit",
		"Search and replace exactly one occurrence of `old` with `new` in a file. Errors if `old` appears 0 times or more than 1 time.",
		{
			path: { type: "string" },
			old: { type: "string" },
			new: { type: "string" },
		},
		["path", "old", "new"],
	),
	tool(
		"Glob",
		"Glob-match files inside the workspace (e.g. `**/*.ts`). Returns relative paths.",
		{ pattern: { type: "string" } },
		["pattern"],
	),
	tool(
		"Grep",
		"Search for a regex pattern in the workspace. Optional `path` scopes to a file or directory.",
		{
			pattern: { type: "string" },
			path: { type: "string" },
		},
		["pattern"],
	),
	tool(
		"Bash",
		"Run a bash command via `bash -lc <command>` with `cwd` set to the workspace. Default timeout 300s, hard ceiling 600s.",
		{
			command: { type: "string" },
			timeoutMs: { type: "number" },
		},
		["command"],
	),
];

function tool(
	name: string,
	description: string,
	properties: Record<string, unknown>,
	required: string[],
): Tool {
	return {
		name,
		description,
		input_schema: {
			type: "object",
			properties,
			required,
			additionalProperties: false,
		},
	};
}

async function executeToolUse(
	toolUse: ToolUseBlock,
	cwd: string,
): Promise<ToolExecResult> {
	const args =
		toolUse.input !== null &&
		typeof toolUse.input === "object" &&
		!Array.isArray(toolUse.input)
			? (toolUse.input as Record<string, unknown>)
			: {};

	try {
		switch (toolUse.name) {
			case "Read":
				return await execRead(args, cwd);
			case "Write":
				return await execWrite(args, cwd);
			case "Edit":
				return await execEdit(args, cwd);
			case "Glob":
				return await execGlob(args, cwd);
			case "Grep":
				return await execGrep(args, cwd);
			case "Bash":
				return await execBash(args, cwd);
			default:
				return errResp(`unknown tool: ${toolUse.name}`);
		}
	} catch (err) {
		return errResp(errorMessage(err));
	}
}

type ReadArgs = Record<string, unknown> & { path: string };
function isReadArgs(args: Record<string, unknown>): args is ReadArgs {
	return typeof args.path === "string";
}

type WriteArgs = Record<string, unknown> & { path: string; content: string };
function isWriteArgs(args: Record<string, unknown>): args is WriteArgs {
	return typeof args.path === "string" && typeof args.content === "string";
}

type EditArgs = Record<string, unknown> & {
	path: string;
	old: string;
	new: string;
};
function isEditArgs(args: Record<string, unknown>): args is EditArgs {
	return (
		typeof args.path === "string" &&
		typeof args.old === "string" &&
		typeof args.new === "string"
	);
}

type GlobArgs = Record<string, unknown> & { pattern: string };
function isGlobArgs(args: Record<string, unknown>): args is GlobArgs {
	return typeof args.pattern === "string";
}

type GrepArgs = Record<string, unknown> & {
	pattern: string;
	path?: string;
};
function isGrepArgs(args: Record<string, unknown>): args is GrepArgs {
	if (typeof args.pattern !== "string") return false;
	if (args.path !== undefined && typeof args.path !== "string") return false;
	return true;
}

type BashArgs = Record<string, unknown> & {
	command: string;
	timeoutMs?: number;
};
function isBashArgs(args: Record<string, unknown>): args is BashArgs {
	if (typeof args.command !== "string") return false;
	if (args.timeoutMs !== undefined && typeof args.timeoutMs !== "number") {
		return false;
	}
	return true;
}

async function execRead(
	args: Record<string, unknown>,
	cwd: string,
): Promise<ToolExecResult> {
	if (!isReadArgs(args))
		return errResp("invalid args: Read requires `path: string`");
	const resolved = resolveInsideWorkspace(cwd, args.path, { mustExist: true });
	if (resolved.error !== undefined) return errResp(resolved.error);
	const data = readFileSync(resolved.absPath);
	return okResp({
		content: data.subarray(0, MAX_READ_BYTES).toString("utf8"),
		truncated: data.byteLength > MAX_READ_BYTES,
		bytesRead: Math.min(data.byteLength, MAX_READ_BYTES),
		totalBytes: data.byteLength,
	});
}

async function execWrite(
	args: Record<string, unknown>,
	cwd: string,
): Promise<ToolExecResult> {
	if (!isWriteArgs(args))
		return errResp(
			"invalid args: Write requires `path: string`, `content: string`",
		);
	const resolved = resolveInsideWorkspace(cwd, args.path, { mustExist: false });
	if (resolved.error !== undefined) return errResp(resolved.error);
	if (existsSync(resolved.absPath)) {
		try {
			const lst = lstatSync(resolved.absPath);
			if (lst.isSymbolicLink()) {
				return errResp("refusing to write through a symlink");
			}
		} catch {
			// fall through
		}
	}
	mkdirSync(path.dirname(resolved.absPath), { recursive: true });
	writeFileSync(resolved.absPath, args.content, "utf8");
	return okResp({ written: true, bytes: Buffer.byteLength(args.content) });
}

async function execEdit(
	args: Record<string, unknown>,
	cwd: string,
): Promise<ToolExecResult> {
	if (!isEditArgs(args))
		return errResp(
			"invalid args: Edit requires `path: string`, `old: string`, `new: string`",
		);
	const resolved = resolveInsideWorkspace(cwd, args.path, { mustExist: true });
	if (resolved.error !== undefined) return errResp(resolved.error);
	const before = readFileSync(resolved.absPath, "utf8");
	const occurrences = countOccurrences(before, args.old);
	if (occurrences === 0) {
		return errResp("`old` not found in file");
	}
	if (occurrences > 1) {
		return errResp(`\`old\` appears ${occurrences} times; must be unique`);
	}
	const after = before.replace(args.old, args.new);
	writeFileSync(resolved.absPath, after, "utf8");
	return okResp({ replacements: 1 });
}

async function execGlob(
	args: Record<string, unknown>,
	cwd: string,
): Promise<ToolExecResult> {
	if (!isGlobArgs(args))
		return errResp("invalid args: Glob requires `pattern: string`");
	const matches: string[] = [];
	const re = globToRegExp(args.pattern);
	const cwdReal = safeRealpath(cwd) ?? cwd;
	walk(cwd, cwd, (rel, abs) => {
		if (!re.test(rel)) return;
		const real = safeRealpath(abs);
		if (real === undefined) return;
		if (!isInside(cwdReal, real)) return;
		matches.push(rel);
	});
	matches.sort();
	return okResp({ matches });
}

async function execGrep(
	args: Record<string, unknown>,
	cwd: string,
): Promise<ToolExecResult> {
	if (!isGrepArgs(args))
		return errResp("invalid args: Grep requires `pattern: string`");
	let target = cwd;
	if (args.path !== undefined) {
		const resolved = resolveInsideWorkspace(cwd, args.path, {
			mustExist: true,
		});
		if (resolved.error !== undefined) return errResp(resolved.error);
		target = resolved.absPath;
	}
	let re: RegExp;
	try {
		re = new RegExp(args.pattern);
	} catch (err) {
		return errResp(`invalid regex: ${errorMessage(err)}`);
	}
	const hits: { path: string; line: number; text: string }[] = [];
	const targetStat = statSync(target);
	if (targetStat.isFile()) {
		grepFile(target, cwd, re, hits);
	} else {
		walk(target, cwd, (_rel, abs) => {
			grepFile(abs, cwd, re, hits);
		});
	}
	return okResp({ matches: hits.slice(0, 200), truncated: hits.length > 200 });
}

function grepFile(
	abs: string,
	cwd: string,
	re: RegExp,
	hits: { path: string; line: number; text: string }[],
): void {
	let body: string;
	try {
		body = readFileSync(abs, "utf8");
	} catch {
		return;
	}
	const lines = body.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (re.test(line)) {
			hits.push({
				path: path.relative(cwd, abs),
				line: i + 1,
				text: line,
			});
		}
	}
}

async function execBash(
	args: Record<string, unknown>,
	cwd: string,
): Promise<ToolExecResult> {
	if (!isBashArgs(args))
		return errResp("invalid args: Bash requires `command: string`");
	if (SKILLSMITH_RECURSION_RE.test(args.command)) {
		return errResp(
			"recursion guard: command may not invoke `skillsmith` (would re-enter the harness)",
		);
	}
	const requested = args.timeoutMs;
	const timeout =
		typeof requested === "number" && Number.isFinite(requested) && requested > 0
			? Math.min(requested, MAX_BASH_TIMEOUT_MS)
			: DEFAULT_BASH_TIMEOUT_MS;

	const env = bashEnv(process.env);
	return await new Promise<ToolExecResult>((resolve) => {
		const child = spawn("bash", ["-lc", args.command], { cwd, env });
		let stdoutBuf = Buffer.alloc(0);
		let stderrBuf = Buffer.alloc(0);
		let stdoutTrunc = false;
		let stderrTrunc = false;
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeout);

		child.stdout?.on("data", (chunk: Buffer) => {
			if (stdoutBuf.length < MAX_TOOL_OUTPUT_BYTES) {
				const remaining = MAX_TOOL_OUTPUT_BYTES - stdoutBuf.length;
				if (chunk.length <= remaining) {
					stdoutBuf = Buffer.concat([stdoutBuf, chunk]);
				} else {
					stdoutBuf = Buffer.concat([stdoutBuf, chunk.subarray(0, remaining)]);
					stdoutTrunc = true;
				}
			} else {
				stdoutTrunc = true;
			}
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			if (stderrBuf.length < MAX_TOOL_OUTPUT_BYTES) {
				const remaining = MAX_TOOL_OUTPUT_BYTES - stderrBuf.length;
				if (chunk.length <= remaining) {
					stderrBuf = Buffer.concat([stderrBuf, chunk]);
				} else {
					stderrBuf = Buffer.concat([stderrBuf, chunk.subarray(0, remaining)]);
					stderrTrunc = true;
				}
			} else {
				stderrTrunc = true;
			}
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve(errResp(`spawn failed: ${err.message}`));
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			const stdout = decodeWithSentinel(stdoutBuf, stdoutTrunc);
			const stderr = decodeWithSentinel(stderrBuf, stderrTrunc);
			resolve(
				okResp({
					stdout,
					stderr,
					exitCode: timedOut ? null : code,
					signal: timedOut ? "SIGKILL" : signal,
					timedOut,
					timeoutMs: timedOut ? timeout : undefined,
				}),
			);
		});
	});
}

function decodeWithSentinel(buf: Buffer, truncated: boolean): string {
	const text = buf.toString("utf8");
	if (truncated) return `${text}\n[truncated]`;
	return text;
}

function bashEnv(env: NodeJS.ProcessEnv): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) continue;
		if (FORBIDDEN_BASH_ENV_KEYS.has(key)) continue;
		if (key.startsWith("CODEX_")) continue;
		if (ALLOWED_BASH_ENV_KEYS.has(key) || key.startsWith("LC_")) {
			out[key] = value;
		}
	}
	return out;
}

interface PathResolution {
	absPath: string;
	error?: string;
}

function resolveInsideWorkspace(
	cwd: string,
	requested: string,
	opts: { mustExist: boolean },
): PathResolution {
	if (typeof requested !== "string" || requested.length === 0) {
		return { absPath: "", error: "path must be a non-empty string" };
	}
	if (path.isAbsolute(requested)) {
		return { absPath: "", error: "absolute paths are not allowed" };
	}
	const cwdAbs = path.resolve(cwd);
	const resolved = path.resolve(cwdAbs, requested);
	const rel = path.relative(cwdAbs, resolved);
	if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
		return { absPath: "", error: "path escapes workspace" };
	}

	const cwdReal = safeRealpath(cwdAbs) ?? cwdAbs;
	if (existsSync(resolved)) {
		const real = safeRealpath(resolved);
		if (real === undefined) {
			return { absPath: "", error: "could not resolve path" };
		}
		if (!isInside(cwdReal, real)) {
			return { absPath: "", error: "path resolves outside workspace" };
		}
		return { absPath: resolved };
	}

	if (opts.mustExist) {
		return { absPath: "", error: "file does not exist" };
	}

	let current = resolved;
	while (current.length > 0) {
		const parent = path.dirname(current);
		if (parent === current) break;
		if (existsSync(parent)) {
			const parentReal = safeRealpath(parent);
			if (parentReal === undefined) {
				return { absPath: "", error: "could not resolve parent path" };
			}
			if (!isInside(cwdReal, parentReal)) {
				return { absPath: "", error: "path parent resolves outside workspace" };
			}
			break;
		}
		current = parent;
	}
	return { absPath: resolved };
}

function isInside(root: string, candidate: string): boolean {
	const rel = path.relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function safeRealpath(p: string): string | undefined {
	try {
		return realpathSync(p);
	} catch {
		return undefined;
	}
}

function globToRegExp(pattern: string): RegExp {
	let re = "";
	let i = 0;
	while (i < pattern.length) {
		const c = pattern[i];
		if (c === "*") {
			if (pattern[i + 1] === "*") {
				if (pattern[i + 2] === "/") {
					re += "(?:.*\\/)?";
					i += 3;
					continue;
				}
				re += ".*";
				i += 2;
				continue;
			}
			re += "[^/]*";
			i++;
			continue;
		}
		if (c === "?") {
			re += "[^/]";
			i++;
			continue;
		}
		if (
			c === "." ||
			c === "+" ||
			c === "(" ||
			c === ")" ||
			c === "|" ||
			c === "^" ||
			c === "$" ||
			c === "{" ||
			c === "}" ||
			c === "[" ||
			c === "]" ||
			c === "\\"
		) {
			re += `\\${c}`;
			i++;
			continue;
		}
		if (c === "/") {
			re += "\\/";
			i++;
			continue;
		}
		re += c;
		i++;
	}
	return new RegExp(`^${re}$`);
}

function walk(
	root: string,
	cwd: string,
	visit: (rel: string, abs: string) => void,
): void {
	const stack: string[] = [root];
	while (stack.length > 0) {
		const dir = stack.pop();
		if (dir === undefined) continue;
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const name of entries) {
			const abs = path.join(dir, name);
			let s: ReturnType<typeof lstatSync>;
			try {
				s = lstatSync(abs);
			} catch {
				continue;
			}
			const rel = path.relative(cwd, abs);
			if (s.isDirectory()) {
				stack.push(abs);
			} else if (s.isFile()) {
				visit(rel, abs);
			}
		}
	}
}

function textFromContent(content: ContentBlock[] | undefined): string {
	if (!Array.isArray(content)) return "";
	const out: string[] = [];
	for (const block of content) {
		if (block.type === "text") out.push(block.text);
	}
	return out.join("");
}

function collectToolUses(content: ContentBlock[] | undefined): ToolUseBlock[] {
	if (!Array.isArray(content)) return [];
	return content.filter(
		(block): block is ToolUseBlock => block.type === "tool_use",
	);
}

function terminalStopError(
	response: Message,
	role: string,
): string | undefined {
	if (
		response.stop_reason === "end_turn" ||
		response.stop_reason === "stop_sequence"
	) {
		return undefined;
	}
	return stopReasonError(response, role);
}

function stopReasonError(response: Message, role: string): string {
	const reason = response.stop_reason ?? "unknown";
	if (reason === "max_tokens") {
		const suffix =
			collectToolUses(response.content).length > 0
				? "; raise maxOutputTokens if the response ended during tool use"
				: "";
		return `Anthropic API ${role} response stopped because max_tokens was reached${suffix}`;
	}
	return `Anthropic API ${role} response stopped with stop_reason: ${reason}`;
}

function countOccurrences(haystack: string, needle: string): number {
	if (needle.length === 0) return 0;
	let count = 0;
	let i = 0;
	while (true) {
		const next = haystack.indexOf(needle, i);
		if (next === -1) break;
		count++;
		i = next + needle.length;
	}
	return count;
}

function okResp(extra: Record<string, unknown>): ToolExecResult {
	return { ok: true, response: { ok: true, ...extra } };
}

function errResp(message: string): ToolExecResult {
	return { ok: false, response: { ok: false, error: message } };
}

function cappedJson(value: Record<string, unknown>): string {
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

interface RetryDecision {
	retry: boolean;
	delayMs?: number;
}

async function callWithRetries(
	client: AnthropicClientLike,
	params: MessageCreateParamsNonStreaming,
): Promise<Message> {
	let lastErr: unknown;
	for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
		try {
			return await client.messages.create(params);
		} catch (err) {
			lastErr = err;
			if (attempt === MAX_RETRY_ATTEMPTS) break;
			const decision = retryDecisionFor(err);
			if (!decision.retry) {
				throw normalizeApiError(err);
			}
			const sleep = decision.delayMs ?? backoffMs(attempt);
			await delay(sleep);
		}
	}
	const status = extractStatus(lastErr);
	if (status === 429) {
		throw new Error(`anthropic rate-limited: ${errorMessage(lastErr)}`);
	}
	throw normalizeApiError(lastErr);
}

function retryDecisionFor(err: unknown): RetryDecision {
	const status = extractStatus(err);
	if (status === undefined) {
		return { retry: true };
	}
	if (status === 429) {
		return { retry: true, delayMs: extractRetryAfter(err) };
	}
	if (status === 529 || (status >= 500 && status < 600)) {
		return { retry: true };
	}
	return { retry: false };
}

function extractStatus(err: unknown): number | undefined {
	if (err === null || typeof err !== "object") return undefined;
	const candidate = (err as { status?: unknown }).status;
	if (typeof candidate === "number") return candidate;
	return undefined;
}

function extractRetryAfter(err: unknown): number | undefined {
	if (err === null || typeof err !== "object") return undefined;
	const headers = (err as { headers?: unknown }).headers;
	if (headers === undefined || headers === null) return undefined;
	let raw: unknown;
	if (typeof (headers as { get?: unknown }).get === "function") {
		try {
			raw = (headers as { get: (name: string) => unknown }).get("retry-after");
		} catch {
			raw = undefined;
		}
	} else if (typeof headers === "object") {
		raw =
			(headers as Record<string, unknown>)["retry-after"] ??
			(headers as Record<string, unknown>)["Retry-After"];
	}
	if (typeof raw !== "string") return undefined;
	const seconds = Number(raw);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.min(seconds * 1000, RETRY_CAP_MS);
	}
	const date = Date.parse(raw);
	if (!Number.isNaN(date)) {
		const ms = date - Date.now();
		if (ms > 0) return Math.min(ms, RETRY_CAP_MS);
	}
	return undefined;
}

function backoffMs(attempt: number): number {
	const expo = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS);
	return Math.floor(Math.random() * expo);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeApiError(err: unknown): Error {
	const status = extractStatus(err);
	const message = errorMessage(err);
	if (status === 429) {
		return new Error(`anthropic rate-limited: ${message}`);
	}
	if (status !== undefined) {
		return new Error(`anthropic ${status}: ${message}`);
	}
	if (err instanceof Error) return err;
	return new Error(message);
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
