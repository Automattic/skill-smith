import type {
	Options,
	SDKMessage,
	SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
	InvokeParams,
	InvokeResult,
	Provider,
	Role,
	TokenUsage,
} from './types';

const TOOLS_BY_ROLE: Record< Role, string[] > = {
	testing: [ 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash' ],
	judge: [ 'Read' ],
};

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
				const stream = queryFn( {
					prompt: params.prompt,
					options: {
						model: params.agent.model,
						cwd: params.cwd,
						systemPrompt: params.systemPrompt,
						tools: TOOLS_BY_ROLE[ params.role ],
						permissionMode: 'bypassPermissions',
						allowDangerouslySkipPermissions: true,
						env: claudeCodeEnv( process.env ),
					},
				} );

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
