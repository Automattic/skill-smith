import type {
	Options,
	SDKMessage,
	SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { McpServerConfig } from '../config/types';
import type {
	InvokeParams,
	InvokeResult,
	JudgeCapabilities,
	Provider,
	TokenUsage,
} from './types';

/**
 * Tools the `testing` role always receives. The testing agent writes to and
 * runs commands in its workspace, so it gets the full read/write/shell surface
 * regardless of any `capabilities` on the invocation.
 */
const TESTING_TOOLS = [ 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash' ];

/**
 * Tools the `judge` role receives when no `capabilities.tools` is configured.
 * A bare read tool keeps the default judge strictly read-only.
 */
const DEFAULT_JUDGE_TOOLS = [ 'Read' ];

/**
 * Tools removed from the judge's context when it is not allowed to write. Kept
 * out of `tools` *and* listed in `disallowedTools` so a project that names them
 * in `capabilities.tools` without setting `allowWrite` still cannot mutate its
 * workspace.
 */
const WRITE_TOOLS = [ 'Write', 'Edit' ];

/**
 * SDK tool surface translated from an {@link InvokeParams} role and
 * capabilities. Mirrors the slice of the Claude Code SDK `Options` the provider
 * sets to scope what an invocation may do.
 */
interface ToolSurface {
	/** Tool names made available to the agent. */
	tools: string[];
	/** Tool names removed from the agent's context, when any. */
	disallowedTools?: string[];
	/** MCP servers made available to the agent, keyed by server name. */
	mcpServers?: Record< string, McpServerConfig >;
}

/**
 * Translate a Claude Code invocation's role and project-configured capabilities
 * into the SDK tool surface the provider passes to `query`.
 *
 * The `testing` role is fixed to {@link TESTING_TOOLS} and ignores
 * `capabilities`. The `judge` role defaults to a read-only surface
 * ({@link DEFAULT_JUDGE_TOOLS}, with {@link WRITE_TOOLS} disallowed) and lets a
 * project widen it via `capabilities`: `tools` selects the allowed tools and
 * `mcpServers` adds MCP servers. Unless `capabilities.allowWrite` is exactly
 * `true`, {@link WRITE_TOOLS} are stripped from `tools` and placed in
 * `disallowedTools`, so a judge cannot write even if asked to.
 *
 * @param role - The invocation role; only `judge` consults `capabilities`.
 * @param capabilities - The judge's capability overrides, when present.
 * @returns The `tools`, optional `disallowedTools`, and optional `mcpServers`
 *   to pass into the SDK `query` options.
 *
 * @example
 * // Read-only judge default:
 * toolSurfaceFor( 'judge', undefined );
 * // => { tools: [ 'Read' ], disallowedTools: [ 'Write', 'Edit' ] }
 */
function toolSurfaceFor(
	role: InvokeParams[ 'role' ],
	capabilities: JudgeCapabilities | undefined
): ToolSurface {
	if ( role === 'testing' ) {
		return { tools: [ ...TESTING_TOOLS ] };
	}

	const allowWrite = capabilities?.allowWrite === true;
	const requestedTools = capabilities?.tools ?? DEFAULT_JUDGE_TOOLS;
	const tools = allowWrite
		? [ ...requestedTools ]
		: requestedTools.filter( ( tool ) => ! WRITE_TOOLS.includes( tool ) );

	const surface: ToolSurface = { tools };
	if ( ! allowWrite ) surface.disallowedTools = [ ...WRITE_TOOLS ];
	if ( capabilities?.mcpServers )
		surface.mcpServers = capabilities.mcpServers;
	return surface;
}

/**
 * Environment-variable names stripped from the child process the Claude Code
 * SDK spawns. Removing these forces the underlying CLI onto its subscription
 * (OAuth) credentials rather than silently falling back to API-key billing.
 */
const CLAUDE_CODE_SCRUBBED_ENV_KEYS = [
	'ANTHROPIC_API_KEY',
	'ANTHROPIC_AUTH_TOKEN',
];

/**
 * Build the environment passed to the Claude Code SDK with the API-key
 * credentials removed. Returns a fresh copy; the input object is never mutated.
 *
 * @param env - The environment to derive the scrubbed copy from, typically
 *   `process.env`.
 * @returns A new object containing every key of `env` except those in
 *   {@link CLAUDE_CODE_SCRUBBED_ENV_KEYS}.
 */
function claudeCodeEnv( env: NodeJS.ProcessEnv ): NodeJS.ProcessEnv {
	const out = { ...env };
	for ( const key of CLAUDE_CODE_SCRUBBED_ENV_KEYS ) delete out[ key ];
	return out;
}

/**
 * Injection seam for the Claude Code SDK `query` function, narrowed to the
 * slice of its signature the provider consumes. Production wires in the real
 * `query`; tests pass a fake that yields a canned message stream without
 * spawning the CLI.
 *
 * @param args - Query arguments.
 * @param args.prompt - The prompt to run, either a string or an async iterable
 *   of user messages.
 * @param args.options - Optional SDK options, including the scrubbed `env`.
 * @returns An async iterable of SDK messages produced by the run.
 */
export type QueryFn = ( args: {
	prompt: string | AsyncIterable< SDKUserMessage >;
	options?: Options;
} ) => AsyncIterable< SDKMessage >;

/**
 * Build a Claude Code provider bound to a specific `query` implementation.
 * Production passes the real SDK `query`; tests pass a fake.
 *
 * @param queryFn - The query implementation the provider's `invoke` drives.
 * @returns A {@link Provider} with `id` `"claude-code"`.
 */
export function createClaudeCodeProvider( queryFn: QueryFn ): Provider {
	return {
		id: 'claude-code',
		async invoke( params: InvokeParams ): Promise< InvokeResult > {
			let finalText = '';
			let toolUseCount = 0;
			let error: string | undefined;
			let usage: TokenUsage | undefined;

			try {
				const surface = toolSurfaceFor(
					params.role,
					params.capabilities
				);
				const options: Options = {
					model: params.agent.model,
					cwd: params.cwd,
					systemPrompt: params.systemPrompt,
					tools: surface.tools,
					permissionMode: 'bypassPermissions',
					allowDangerouslySkipPermissions: true,
					env: claudeCodeEnv( process.env ),
				};
				if ( surface.disallowedTools )
					options.disallowedTools = surface.disallowedTools;
				if ( surface.mcpServers )
					options.mcpServers = surface.mcpServers;

				const stream = queryFn( { prompt: params.prompt, options } );

				for await ( const message of stream ) {
					if ( message.type === 'assistant' ) {
						for ( const block of message.message.content ?? [] ) {
							if ( block.type === 'tool_use' ) toolUseCount++;
							if ( block.type === 'text' ) finalText = block.text;
						}
					} else if ( message.type === 'result' ) {
						if ( message.subtype === 'success' )
							finalText = message.result;
						else error = `result.${ message.subtype }`;
						// Exactly one result message per query carries usage.
						// The Anthropic SDK splits input four ways; the gross
						// prompt size billed is input_tokens (uncached new) +
						// cache_creation_input_tokens + cache_read_input_tokens.
						// Without folding cache reads in, the figure under-reports
						// real usage by ~100x for agent runs that re-use a large
						// system prompt across tool turns.
						const newInputTokens = message.usage.input_tokens;
						const cacheCreationTokens =
							message.usage.cache_creation_input_tokens;
						const cacheReadTokens =
							message.usage.cache_read_input_tokens;
						const inputTokens =
							newInputTokens +
							cacheCreationTokens +
							cacheReadTokens;
						const outputTokens = message.usage.output_tokens;
						usage = {
							inputTokens,
							cachedInputTokens: cacheReadTokens,
							outputTokens,
							totalTokens: inputTokens + outputTokens,
						};
					}
				}
			} catch ( err ) {
				error = err instanceof Error ? err.message : String( err );
			}

			const result: InvokeResult = { finalText, toolUseCount };
			if ( error !== undefined ) result.error = error;
			if ( usage !== undefined ) result.usage = usage;
			return result;
		},
	};
}
