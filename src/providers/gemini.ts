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
import type {
	Content,
	FunctionCall,
	FunctionDeclaration,
	GenerateContentConfig,
	GenerateContentParameters,
	GenerateContentResponse,
	GoogleGenAIOptions,
	HttpOptions,
	Part,
	SafetySetting,
} from "@google/genai";
import type { AgentDefinition } from "../config/types";
import type { InvokeParams, InvokeResult, Provider } from "./types";

const MAX_TOOL_TURNS = 60;
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 30_000;
const DEFAULT_BASH_TIMEOUT_MS = 300 * 1000;
const MAX_BASH_TIMEOUT_MS = 600 * 1000;
const MAX_BASH_OUTPUT_BYTES = 64 * 1024;

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

// Best-effort regex for skillsmith recursion guard. Matches `skillsmith` as a
// whole word at the start of the command, or after a shell separator (`;`,
// `&&`, `||`, `|`, backtick, or `$(`). Intentionally over-eager — false
// positives are acceptable; the user can rephrase.
const SKILLSMITH_RECURSION_RE =
	/(^|[;&|`]|\$\()\s*skillsmith\b/;

// Per-model thinkingBudget ceilings.
const THINKING_BUDGET_CEILINGS: Record<string, number> = {
	"gemini-2.5-pro": 32768,
	"gemini-2.5-flash": 24576,
	"gemini-2.5-flash-lite": 8192,
};

// effort → thinkingBudget bucket map.
const EFFORT_TO_THINKING_BUDGET: Record<string, number> = {
	minimal: 0,
	low: 1024,
	medium: 4096,
	high: 16384,
	xhigh: 32768,
};

const EFFORT_VALUES = new Set(Object.keys(EFFORT_TO_THINKING_BUDGET));

/**
 * Minimal structural type for the slice of `GoogleGenAI` we use. Tests pass a
 * fake constructor that records args and returns a scripted `models`.
 */
export type GenAIModelsLike = {
	generateContent: (
		params: GenerateContentParameters,
	) => Promise<GenerateContentResponse>;
};
export type GoogleGenAILike = {
	readonly models: GenAIModelsLike;
};
export type GoogleGenAICtor = new (options: GoogleGenAIOptions) => GoogleGenAILike;

interface ToolExecResult {
	response: Record<string, unknown>;
}

/**
 * Build a Gemini provider bound to a specific `GoogleGenAI` constructor.
 * Production passes the real one; tests pass a fake.
 */
export function createGeminiProvider(GenAICtor: GoogleGenAICtor): Provider {
	return {
		id: "gemini",
		async invoke(params: InvokeParams): Promise<InvokeResult> {
			let finalText = "";
			let toolUseCount = 0;
			let error: string | undefined;

			try {
				const apiKey =
					process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
				if (apiKey === undefined || apiKey.length === 0) {
					return {
						finalText: "",
						toolUseCount: 0,
						error: "GEMINI_API_KEY (or GOOGLE_API_KEY) not set",
					};
				}

				const client = new GenAICtor({ apiKey });

				if (params.role === "judge") {
					const config = buildBaseConfig(params);
					const response = await callWithRetries(client, {
						model: params.agent.model,
						contents: [
							{ role: "user", parts: [{ text: params.prompt }] },
						],
						config,
					});
					const safetyError = checkSafetyFinish(response);
					if (safetyError !== undefined) {
						return {
							finalText: textFromResponse(response),
							toolUseCount: 0,
							error: safetyError,
						};
					}
					finalText = textFromResponse(response);
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

interface TestingLoopResult {
	finalText: string;
	toolUseCount: number;
	error?: string;
}

async function runTestingLoop(
	client: GoogleGenAILike,
	params: InvokeParams,
): Promise<TestingLoopResult> {
	const cwd = params.cwd;
	const conversation: Content[] = [
		{ role: "user", parts: [{ text: params.prompt }] },
	];
	const baseConfig: GenerateContentConfig = {
		...buildBaseConfig(params),
		tools: [{ functionDeclarations: TESTING_FUNCTION_DECLARATIONS }],
	};

	let finalText = "";
	let toolUseCount = 0;

	for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
		let response: GenerateContentResponse;
		try {
			response = await callWithRetries(client, {
				model: params.agent.model,
				contents: conversation,
				config: baseConfig,
			});
		} catch (err) {
			return {
				finalText,
				toolUseCount,
				error: errorMessage(err),
			};
		}

		const safetyError = checkSafetyFinish(response);
		if (safetyError !== undefined) {
			const partial = textFromResponse(response);
			if (partial.length > 0) finalText = partial;
			return { finalText, toolUseCount, error: safetyError };
		}

		const calls = collectFunctionCalls(response);
		const text = textFromResponse(response);

		if (calls.length === 0) {
			// Terminal text turn.
			if (text.length > 0) finalText = text;
			return { finalText, toolUseCount };
		}

		// Append the model's turn (full content) to the conversation so the next
		// turn can reference the function calls it just made.
		const modelContent = response.candidates?.[0]?.content;
		if (modelContent !== undefined) {
			conversation.push(modelContent);
		} else {
			// Fall back to a synthesized model turn carrying just the
			// functionCall parts.
			conversation.push({
				role: "model",
				parts: calls.map((call) => ({ functionCall: call })),
			});
		}
		if (text.length > 0) finalText = text;

		// Execute every functionCall part. Each one increments toolUseCount.
		const responseParts: Part[] = [];
		for (const call of calls) {
			toolUseCount++;
			const exec = await executeFunctionCall(call, cwd);
			responseParts.push({
				functionResponse: {
					name: call.name,
					response: exec.response,
				},
			});
		}

		// Boundary rule: after the 60th turn with functionCall parts, execute
		// those calls (counted above) but do NOT issue a 61st generateContent.
		if (turn === MAX_TOOL_TURNS - 1) {
			return {
				finalText,
				toolUseCount,
				error: "tool-loop ceiling reached",
			};
		}

		conversation.push({ role: "user", parts: responseParts });
	}

	// Defensive: should be unreachable since the loop returns inside.
	return {
		finalText,
		toolUseCount,
		error: "tool-loop ceiling reached",
	};
}

function buildBaseConfig(params: InvokeParams): GenerateContentConfig {
	const config: GenerateContentConfig = {
		systemInstruction: params.systemPrompt,
	};
	applyPassThroughKnobs(config, params.agent);
	return config;
}

function applyPassThroughKnobs(
	config: GenerateContentConfig,
	agent: AgentDefinition,
): void {
	if (
		typeof agent.temperature === "number" &&
		Number.isFinite(agent.temperature)
	) {
		config.temperature = agent.temperature;
	}
	if (typeof agent.topP === "number" && Number.isFinite(agent.topP)) {
		config.topP = agent.topP;
	}
	if (typeof agent.topK === "number" && Number.isFinite(agent.topK)) {
		config.topK = agent.topK;
	}
	if (
		typeof agent.maxOutputTokens === "number" &&
		Number.isFinite(agent.maxOutputTokens) &&
		agent.maxOutputTokens > 0
	) {
		config.maxOutputTokens = agent.maxOutputTokens;
	}
	const safety = sanitizeSafetySettings(agent.safetySettings);
	if (safety !== undefined) config.safetySettings = safety;

	const httpOptions = buildHttpOptions(agent.timeoutMs);
	if (httpOptions !== undefined) config.httpOptions = httpOptions;

	const thinkingBudget = resolveThinkingBudget(agent);
	if (thinkingBudget !== undefined) {
		config.thinkingConfig = { thinkingBudget };
	}
}

function buildHttpOptions(value: unknown): HttpOptions | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return { timeout: value };
}

function resolveThinkingBudget(agent: AgentDefinition): number | undefined {
	let requested: number | undefined;
	if (
		typeof agent.thinkingBudget === "number" &&
		Number.isFinite(agent.thinkingBudget)
	) {
		requested = agent.thinkingBudget;
	} else if (
		typeof agent.effort === "string" &&
		EFFORT_VALUES.has(agent.effort)
	) {
		requested = EFFORT_TO_THINKING_BUDGET[agent.effort];
	}
	if (requested === undefined) return undefined;

	const ceiling = THINKING_BUDGET_CEILINGS[agent.model];
	if (ceiling !== undefined && requested > ceiling) {
		emitGap("geminiThinkingBudgetClamped", {
			model: agent.model,
			requested,
			applied: ceiling,
		});
		return ceiling;
	}
	return requested;
}

function sanitizeSafetySettings(value: unknown): SafetySetting[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: SafetySetting[] = [];
	let anyDropped = false;
	for (const entry of value) {
		if (
			entry !== null &&
			typeof entry === "object" &&
			typeof (entry as { category?: unknown }).category === "string" &&
			typeof (entry as { threshold?: unknown }).threshold === "string"
		) {
			out.push(entry as SafetySetting);
		} else {
			anyDropped = true;
		}
	}
	if (anyDropped) {
		emitGap("geminiSafetySettings", {
			reason: "dropped malformed safety settings",
		});
	}
	return out.length > 0 ? out : undefined;
}

// =====================================================================
// Tool surface
// =====================================================================

const TESTING_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
	{
		name: "Read",
		description: "Read a UTF-8 text file from the workspace.",
		parametersJsonSchema: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
			additionalProperties: false,
		},
	},
	{
		name: "Write",
		description:
			"Write a UTF-8 text file in the workspace. Creates parent directories as needed. Refuses to write through symlinks.",
		parametersJsonSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
				content: { type: "string" },
			},
			required: ["path", "content"],
			additionalProperties: false,
		},
	},
	{
		name: "Edit",
		description:
			"Search and replace exactly one occurrence of `old` with `new` in a file. Errors if `old` appears 0 times or more than 1 time.",
		parametersJsonSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
				old: { type: "string" },
				new: { type: "string" },
			},
			required: ["path", "old", "new"],
			additionalProperties: false,
		},
	},
	{
		name: "Glob",
		description:
			"Glob-match files inside the workspace (e.g. `**/*.ts`). Returns relative paths.",
		parametersJsonSchema: {
			type: "object",
			properties: { pattern: { type: "string" } },
			required: ["pattern"],
			additionalProperties: false,
		},
	},
	{
		name: "Grep",
		description:
			"Search for a regex pattern in the workspace. Optional `path` to scope to a file or directory (relative).",
		parametersJsonSchema: {
			type: "object",
			properties: {
				pattern: { type: "string" },
				path: { type: "string" },
			},
			required: ["pattern"],
			additionalProperties: false,
		},
	},
	{
		name: "Bash",
		description:
			"Run a bash command via `bash -lc <command>` with `cwd` set to the workspace. Default timeout 300s, hard ceiling 600s. stdout/stderr each truncated to 64 KiB.",
		parametersJsonSchema: {
			type: "object",
			properties: {
				command: { type: "string" },
				timeoutMs: { type: "number" },
			},
			required: ["command"],
			additionalProperties: false,
		},
	},
];

async function executeFunctionCall(
	call: FunctionCall,
	cwd: string,
): Promise<ToolExecResult> {
	const name = call.name ?? "";
	const args = (call.args ?? {}) as Record<string, unknown>;

	try {
		switch (name) {
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
				return errResp(`unknown tool: ${name}`);
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
	if (!isReadArgs(args)) return errResp("invalid args: Read requires `path: string`");
	const resolved = resolveInsideWorkspace(cwd, args.path, { mustExist: true });
	if (resolved.error !== undefined) return errResp(resolved.error);
	const data = readFileSync(resolved.absPath, "utf8");
	return okResp({ content: data });
}

async function execWrite(
	args: Record<string, unknown>,
	cwd: string,
): Promise<ToolExecResult> {
	if (!isWriteArgs(args))
		return errResp("invalid args: Write requires `path: string`, `content: string`");
	const resolved = resolveInsideWorkspace(cwd, args.path, { mustExist: false });
	if (resolved.error !== undefined) return errResp(resolved.error);
	// Refuse to write through an existing symlink.
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
		// Containment-check each result so symlinks resolving outside cwd are
		// dropped.
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
	return okResp({ matches: hits });
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
			if (stdoutBuf.length < MAX_BASH_OUTPUT_BYTES) {
				const remaining = MAX_BASH_OUTPUT_BYTES - stdoutBuf.length;
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
			if (stderrBuf.length < MAX_BASH_OUTPUT_BYTES) {
				const remaining = MAX_BASH_OUTPUT_BYTES - stderrBuf.length;
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
			if (timedOut) {
				resolve(
					okResp({
						stdout,
						stderr,
						exitCode: null,
						signal: "SIGKILL",
						timedOut: true,
						timeoutMs: timeout,
					}),
				);
				return;
			}
			resolve(
				okResp({
					stdout,
					stderr,
					exitCode: code,
					signal,
					timedOut: false,
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
		if (ALLOWED_BASH_ENV_KEYS.has(key) || key.startsWith("LC_")) {
			out[key] = value;
		}
	}
	return out;
}

// =====================================================================
// Path containment
// =====================================================================

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
	const cwdAbs = path.resolve(cwd);
	const resolved = path.resolve(cwdAbs, requested);
	const rel = path.relative(cwdAbs, resolved);
	if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
		return { absPath: "", error: "path outside workspace" };
	}

	// Re-check via realpath: a symlink inside cwd that resolves outside is
	// also rejected.
	const cwdReal = safeRealpath(cwdAbs) ?? cwdAbs;
	if (existsSync(resolved)) {
		const real = safeRealpath(resolved);
		if (real === undefined) {
			return { absPath: "", error: "could not resolve path" };
		}
		if (!isInside(cwdReal, real)) {
			return { absPath: "", error: "path outside workspace" };
		}
		if (opts.mustExist) return { absPath: resolved };
		return { absPath: resolved };
	}

	if (opts.mustExist) {
		return { absPath: "", error: "file does not exist" };
	}

	// For mustExist=false, walk up until we find an existing parent and
	// realpath-check it so a symlinked parent escape is caught too.
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
				return { absPath: "", error: "path outside workspace" };
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

// =====================================================================
// Glob (very small implementation; mirrors `**/*.ext` style globs)
// =====================================================================

function globToRegExp(pattern: string): RegExp {
	let re = "";
	let i = 0;
	while (i < pattern.length) {
		const c = pattern[i];
		if (c === "*") {
			if (pattern[i + 1] === "*") {
				// `**` matches across path separators.
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
			let s: ReturnType<typeof statSync>;
			try {
				s = statSync(abs);
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

// =====================================================================
// Response helpers
// =====================================================================

function textFromResponse(response: GenerateContentResponse): string {
	const parts = response.candidates?.[0]?.content?.parts;
	if (!Array.isArray(parts)) return "";
	const out: string[] = [];
	for (const part of parts) {
		if (typeof part?.text === "string" && part.thought !== true) {
			out.push(part.text);
		}
	}
	return out.join("");
}

function collectFunctionCalls(
	response: GenerateContentResponse,
): FunctionCall[] {
	const parts = response.candidates?.[0]?.content?.parts;
	if (!Array.isArray(parts)) return [];
	const calls: FunctionCall[] = [];
	for (const part of parts) {
		if (part?.functionCall !== undefined && part.functionCall !== null) {
			calls.push(part.functionCall);
		}
	}
	return calls;
}

function checkSafetyFinish(
	response: GenerateContentResponse,
): string | undefined {
	const reason = response.candidates?.[0]?.finishReason;
	if (reason === "SAFETY" || reason === "PROHIBITED_CONTENT") {
		return `blocked by safety filter: ${reason}`;
	}
	return undefined;
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
	return { response: { ok: true, ...extra } };
}

function errResp(message: string): ToolExecResult {
	return { response: { ok: false, error: message } };
}

// =====================================================================
// Retry / backoff
// =====================================================================

interface RetryDecision {
	retry: boolean;
	delayMs?: number;
}

async function callWithRetries(
	client: GoogleGenAILike,
	params: GenerateContentParameters,
): Promise<GenerateContentResponse> {
	let lastErr: unknown;
	for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
		try {
			return await client.models.generateContent(params);
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
	// Exhausted retries on retryable errors.
	const status = extractStatus(lastErr);
	if (status === 429) {
		throw new Error(`gemini rate-limited: ${errorMessage(lastErr)}`);
	}
	throw normalizeApiError(lastErr);
}

function retryDecisionFor(err: unknown): RetryDecision {
	const status = extractStatus(err);
	if (status === undefined) {
		// Network or non-HTTP error → retry.
		return { retry: true };
	}
	if (status === 429) {
		return { retry: true, delayMs: extractRetryAfter(err) };
	}
	if (status >= 500 && status < 600) {
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
	// attempt is 1-based; produce exponential backoff with full jitter.
	// attempt 1 → ~1s, attempt 2 → ~2s, attempt 3 → ~4s, etc., capped at 30s.
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
		return new Error(`gemini rate-limited: ${message}`);
	}
	if (status !== undefined) {
		return new Error(`gemini ${status}: ${message}`);
	}
	if (err instanceof Error) return err;
	return new Error(message);
}

// =====================================================================
// Misc helpers
// =====================================================================

function emitGap(category: string, value: unknown): void {
	// Provider has no RunLog reference. Mirror RunLog.gap()'s observable
	// stderr format so existing tooling that scrapes `gap[...]` lines still
	// works.
	const rendered = typeof value === "string" ? value : JSON.stringify(value);
	process.stderr.write(`gap[${category}] ${rendered}\n`);
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

function firstError(
	current: string | undefined,
	next: string | undefined,
): string | undefined {
	return current ?? next;
}

