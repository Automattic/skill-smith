import type {
	Codex,
	CodexOptions,
	RunStreamedResult,
	ThreadOptions,
} from '@openai/codex-sdk';
import type { AgentDefinition } from '../config/types';
import type {
	InvokeParams,
	InvokeResult,
	Provider,
	Role,
	TokenUsage,
} from './types';

const SANDBOX_BY_ROLE: Record< Role, ThreadOptions[ 'sandboxMode' ] > = {
	testing: 'workspace-write',
	judge: 'read-only',
};

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
				const codex = new CodexCtor( {
					apiKey: process.env.OPENAI_API_KEY,
					env: codexEnv( process.env ),
					config: {
						project_root_markers: [],
						project_doc_max_bytes: 0,
						developer_instructions: DEVELOPER_INSTRUCTIONS,
					},
				} );

				const thread = codex.startThread( {
					model: params.agent.model,
					sandboxMode: SANDBOX_BY_ROLE[ params.role ],
					workingDirectory: params.cwd,
					skipGitRepoCheck: true,
					approvalPolicy: 'never',
					...extraThreadOptions( params.agent ),
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
