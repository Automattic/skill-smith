import type {
	Codex,
	CodexOptions,
	RunStreamedResult,
	ThreadOptions,
} from '@openai/codex-sdk';
import type { AgentDefinition, McpServerConfig } from '../config/types';
import type {
	InvokeParams,
	InvokeResult,
	JudgeCapabilities,
	Provider,
	TokenUsage,
} from './types';

/**
 * A single value in the Codex constructor `config`. Derived from the exported
 * `CodexOptions['config']` because the SDK does not export `CodexConfigValue`
 * itself; used to type the `mcp_servers` override (see `invoke`).
 */
type CodexConfigValue = NonNullable< CodexOptions[ 'config' ] >[ string ];

/**
 * Sandbox the `testing` role always runs in. The testing agent writes to and
 * runs commands in its workspace, so it gets `workspace-write` regardless of
 * any `capabilities` on the invocation.
 */
const TESTING_SANDBOX: ThreadOptions[ 'sandboxMode' ] = 'workspace-write';

/**
 * Sandbox the `judge` role runs in when no `capabilities` request live
 * execution. `read-only` keeps the default judge unable to mutate or run
 * commands in its workspace.
 */
const DEFAULT_JUDGE_SANDBOX: ThreadOptions[ 'sandboxMode' ] = 'read-only';

/**
 * Codex tool names that run shell commands. Their presence in
 * `capabilities.tools` means the judge needs to execute commands, which —
 * under `approvalPolicy: 'never'` — requires the `workspace-write` sandbox
 * (see {@link sandboxModeFor}). `Bash` mirrors the Claude Code naming a project
 * is most likely to configure.
 */
const COMMAND_RUNNING_TOOLS = [ 'Bash' ];

/**
 * Codex CLI config key under which MCP servers are declared. The `@openai/codex-sdk`
 * flattens the constructor `config` object into dotted `--config` overrides, so a
 * `mcp_servers.<name>` entry here reaches the CLI as a native MCP server.
 */
const MCP_SERVERS_CONFIG_KEY = 'mcp_servers';

/**
 * Judge thread settings translated from {@link JudgeCapabilities}. Mirrors the
 * slice of {@link ThreadOptions} the provider derives from a judge invocation's
 * capabilities.
 */
interface JudgeThreadSurface {
	/** Sandbox the judge thread runs in. */
	sandboxMode: ThreadOptions[ 'sandboxMode' ];
	/**
	 * Network access for the judge thread, when the capabilities (or, as a
	 * fallback, the agent key) decide it. Left unset to defer to the SDK
	 * default.
	 */
	networkAccessEnabled?: boolean;
	/** MCP servers to wire into the constructor config, keyed by server name. */
	mcpServers?: Record< string, McpServerConfig >;
}

/**
 * Decide whether a judge invocation needs the `workspace-write` sandbox.
 *
 * Under `approvalPolicy: 'never'`, the `read-only` sandbox blocks command
 * execution outright (see the R1 caveat on {@link createCodexProvider}). A judge
 * therefore needs `workspace-write` whenever it must run commands or mutate
 * files — namely when it may write (`allowWrite`), when its tool set includes a
 * command-running tool such as `Bash`, or when it has MCP servers (which run as
 * external processes). Absent all of those, the judge stays `read-only`.
 *
 * @param capabilities - The judge's capability overrides, when present.
 * @returns The sandbox mode the judge thread should run in.
 */
function sandboxModeFor(
	capabilities: JudgeCapabilities | undefined
): ThreadOptions[ 'sandboxMode' ] {
	if ( capabilities === undefined ) return DEFAULT_JUDGE_SANDBOX;
	const allowWrite = capabilities.allowWrite === true;
	const hasCommandTool = ( capabilities.tools ?? [] ).some( ( tool ) =>
		COMMAND_RUNNING_TOOLS.includes( tool )
	);
	const hasMcpServers =
		capabilities.mcpServers !== undefined &&
		Object.keys( capabilities.mcpServers ).length > 0;
	const needsLiveExecution = allowWrite || hasCommandTool || hasMcpServers;
	return needsLiveExecution ? 'workspace-write' : DEFAULT_JUDGE_SANDBOX;
}

/**
 * Translate a judge invocation's role and capabilities into the Codex thread
 * surface the provider applies.
 *
 * The `testing` role is fixed to {@link TESTING_SANDBOX} and ignores
 * `capabilities`. The `judge` role defaults to {@link DEFAULT_JUDGE_SANDBOX} and
 * lets a project widen it: a capabilities set that needs live execution promotes
 * the sandbox to `workspace-write` (see {@link sandboxModeFor}),
 * `capabilities.network` sets `networkAccessEnabled`, and `capabilities.mcpServers`
 * are surfaced for wiring into the constructor config.
 *
 * @param role - The invocation role; only `judge` consults `capabilities`.
 * @param capabilities - The judge's capability overrides, when present.
 * @returns The sandbox, optional network flag, and optional MCP servers for the
 *   invocation.
 *
 * @example
 * // Read-only judge default:
 * judgeThreadSurfaceFor( 'judge', undefined );
 * // => { sandboxMode: 'read-only' }
 */
function judgeThreadSurfaceFor(
	role: InvokeParams[ 'role' ],
	capabilities: JudgeCapabilities | undefined
): JudgeThreadSurface {
	if ( role === 'testing' ) {
		return { sandboxMode: TESTING_SANDBOX };
	}

	const surface: JudgeThreadSurface = {
		sandboxMode: sandboxModeFor( capabilities ),
	};
	if ( typeof capabilities?.network === 'boolean' ) {
		surface.networkAccessEnabled = capabilities.network;
	}
	if (
		capabilities?.mcpServers !== undefined &&
		Object.keys( capabilities.mcpServers ).length > 0
	) {
		surface.mcpServers = capabilities.mcpServers;
	}
	return surface;
}

const DEVELOPER_INSTRUCTIONS =
	'Treat the clearly delimited Skillsmith instruction block in the user input as authoritative workflow and developer instructions for this run. Follow the user request after that block.';

const SYSTEM_PROMPT_BLOCK_START =
	'----- BEGIN SKILLSMITH INSTRUCTION BLOCK -----';
const SYSTEM_PROMPT_BLOCK_END = '----- END SKILLSMITH INSTRUCTION BLOCK -----';

const CODEX_ENV_KEYS = [ 'PATH', 'HOME', 'SHELL', 'USER', 'LOGNAME', 'TMPDIR' ];
const CODEX_ENV_PREFIXES = [ 'CODEX_' ];
const EFFORT_VALUES = [ 'minimal', 'low', 'medium', 'high', 'xhigh' ] as const;
const WEB_SEARCH_VALUES = [ 'disabled', 'cached', 'live' ] as const;

/**
 * Structural type for the `Codex` constructor. Matches the real export from
 * `@openai/codex-sdk` while letting tests inject a fake without spinning up
 * the CLI binary.
 */
export type CodexCtor = new (
	options?: CodexOptions
) => Pick< Codex, 'startThread' >;

/**
 * Build a Codex provider bound to a specific `Codex` constructor. Production
 * passes the real one; tests pass a fake.
 *
 * R1 caveat: this provider runs with `approvalPolicy: 'never'`, under which the
 * `read-only` sandbox blocks command execution entirely. A judge that must run
 * commands (a Bash/MCP capability, or `allowWrite`) therefore has to use
 * `workspace-write` — `read-only` would simply fail rather than run read-only.
 * The judge's no-modify guarantee then rests on the copied workspace it grades,
 * not on the Codex sandbox.
 */
export function createCodexProvider( CodexCtor: CodexCtor ): Provider {
	return {
		id: 'codex',
		async invoke( params: InvokeParams ): Promise< InvokeResult > {
			let finalText = '';
			let toolUseCount = 0;
			let error: string | undefined;
			// Codex emits one `turn.completed` per call to `runStreamed`,
			// carrying cumulative usage across all internal tool-use round
			// trips within that turn. We follow the SDK's own `run()` helper
			// and keep the last value seen rather than summing — defensive
			// in case the binary ever fires more than one in a single turn.
			let inputTokens = 0;
			let cachedInputTokens = 0;
			let outputTokens = 0;
			let sawUsage = false;

			try {
				const surface = judgeThreadSurfaceFor(
					params.role,
					params.capabilities
				);
				const config: CodexOptions[ 'config' ] = {
					project_root_markers: [],
					project_doc_max_bytes: 0,
					developer_instructions: DEVELOPER_INSTRUCTIONS,
				};
				// Codex has no typed `mcpServers`; the judge's MCP servers are
				// wired as `mcp_servers.<name>` config overrides the SDK flattens
				// into the CLI's `--config` TOML. The `McpServerConfig` shape
				// (string/string[]/Record<string,string> fields) is a structural
				// `CodexConfigObject`, but its optional named fields don't satisfy
				// the open index signature without a cast.
				if ( surface.mcpServers ) {
					config[ MCP_SERVERS_CONFIG_KEY ] =
						surface.mcpServers as unknown as CodexConfigValue;
				}

				const codex = new CodexCtor( {
					apiKey: process.env.OPENAI_API_KEY,
					env: codexEnv( process.env ),
					config,
				} );

				const thread = codex.startThread( {
					model: params.agent.model,
					sandboxMode: surface.sandboxMode,
					workingDirectory: params.cwd,
					skipGitRepoCheck: true,
					approvalPolicy: 'never',
					...extraThreadOptions( params.agent ),
					// The judge's `capabilities.network` overrides the agent key
					// so a project can decide network access on the judge call.
					...( surface.networkAccessEnabled !== undefined && {
						networkAccessEnabled: surface.networkAccessEnabled,
					} ),
				} );

				const stream: RunStreamedResult = await thread.runStreamed(
					composedPrompt( params.systemPrompt, params.prompt )
				);
				for await ( const event of stream.events ) {
					switch ( event.type ) {
						case 'item.completed':
							switch ( event.item.type ) {
								case 'agent_message':
									finalText = event.item.text;
									break;
								case 'command_execution':
								case 'file_change':
								case 'mcp_tool_call':
								case 'web_search':
									toolUseCount++;
									break;
								case 'reasoning':
								case 'todo_list':
									break;
								case 'error':
									error = firstError(
										error,
										event.item.message
									);
									break;
							}
							break;
						case 'turn.completed':
							// `input_tokens` is gross prompt size (includes
							// `cached_input_tokens`); see codex-sdk
							// dist/index.d.ts:119-128. Matches the harness's
							// normalized `inputTokens` definition.
							inputTokens = event.usage.input_tokens;
							cachedInputTokens = event.usage.cached_input_tokens;
							outputTokens = event.usage.output_tokens;
							sawUsage = true;
							break;
						case 'turn.failed':
							error = firstError(
								error,
								event.error?.message ?? 'turn.failed'
							);
							break;
						case 'error':
							error = firstError(
								error,
								event.message ?? 'codex error'
							);
							break;
					}
				}
			} catch ( err ) {
				error = firstError(
					error,
					err instanceof Error ? err.message : String( err )
				);
			}

			const result: InvokeResult = { finalText, toolUseCount };
			if ( error !== undefined ) result.error = error;
			if ( sawUsage ) {
				const usage: TokenUsage = {
					inputTokens,
					cachedInputTokens,
					outputTokens,
					totalTokens: inputTokens + outputTokens,
				};
				result.usage = usage;
			}
			return result;
		},
	};
}

function composedPrompt( systemPrompt: string, userPrompt: string ): string {
	return [
		SYSTEM_PROMPT_BLOCK_START,
		systemPrompt,
		SYSTEM_PROMPT_BLOCK_END,
		'',
		userPrompt,
	].join( '\n' );
}

function extraThreadOptions(
	agent: AgentDefinition
): Partial< ThreadOptions > {
	const out: Partial< ThreadOptions > = {};
	if ( isEffort( agent.effort ) ) {
		out.modelReasoningEffort = agent.effort;
	}
	if ( typeof agent.network === 'boolean' ) {
		out.networkAccessEnabled = agent.network;
	}
	if ( isWebSearch( agent.webSearch ) ) {
		out.webSearchMode = agent.webSearch;
	}
	return out;
}

function codexEnv( env: NodeJS.ProcessEnv ): Record< string, string > {
	const out: Record< string, string > = {};
	for ( const [ key, value ] of Object.entries( env ) ) {
		if (
			value !== undefined &&
			( CODEX_ENV_KEYS.includes( key ) ||
				CODEX_ENV_PREFIXES.some( ( prefix ) =>
					key.startsWith( prefix )
				) )
		) {
			out[ key ] = value;
		}
	}
	return out;
}

function isEffort(
	value: unknown
): value is ThreadOptions[ 'modelReasoningEffort' ] {
	return (
		typeof value === 'string' &&
		EFFORT_VALUES.includes( value as ( typeof EFFORT_VALUES )[ number ] )
	);
}

function isWebSearch(
	value: unknown
): value is ThreadOptions[ 'webSearchMode' ] {
	return (
		typeof value === 'string' &&
		WEB_SEARCH_VALUES.includes(
			value as ( typeof WEB_SEARCH_VALUES )[ number ]
		)
	);
}

function firstError(
	current: string | undefined,
	next: string | undefined
): string | undefined {
	return current ?? next;
}
