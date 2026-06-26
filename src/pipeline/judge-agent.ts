import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type {
	AgentDefinition,
	Scenario,
	SkillsmithConfig,
} from '../config/types';
import { getProvider } from '../providers/registry';
import type { JudgeCapabilities } from '../providers/types';
import type { RunLog } from '../util/run-log';
import type { TestingAgentResult } from './agent-loop';

export interface RunJudgeAgentParams {
	scenario: Scenario;
	judge: AgentDefinition;
	agentDirectory: string;
	/**
	 * The canonical workspace the testing agent produced. The judge must
	 * never run against this; it is kept for logging and parity with the
	 * agent loop's bookkeeping.
	 */
	agentWorkspace: string;
	/**
	 * The isolated copy the judge runs against (its `cwd`), so a judge that
	 * writes cannot mutate the canonical artifact. The caller copies
	 * `agentWorkspace` here before invoking the judge. The judge's `cwd` and
	 * the inlined file bodies both come from this path.
	 */
	judgeWorkspace: string;
	projectRoot: string;
	config: SkillsmithConfig;
	log: RunLog;
	testingResult: TestingAgentResult;
}

/**
 * Run the judge sub-agent for one (scenario, agent) pair. The judge's
 * system prompt is the scenario's verbatim `judgeBrief` plus a minimal
 * `{ pass, notes }` output instruction; it verifies the produced
 * artifact (and any live environment the project stood up) using the
 * project-configured judge capabilities, running against an isolated
 * copy of the workspace so it cannot mutate the artifact of record.
 *
 * Returns the verdict object — `{ pass, notes }` on success, or an
 * error-shaped payload on the failure paths. The judge emits a single
 * JSON object. The caller (`agent-loop.ts`) is the single writer of the
 * per-agent `report.json`, embedding this under the `review` key.
 */
export async function runJudgeAgent(
	params: RunJudgeAgentParams
): Promise< unknown > {
	const {
		scenario,
		judge,
		agentDirectory,
		judgeWorkspace,
		projectRoot,
		config,
		log,
		testingResult,
	} = params;
	const scope = `judge:${ scenario.name }@${ relative( projectRoot, agentDirectory ) }`;

	const systemPrompt = buildJudgeSystemPrompt( scenario, config );
	const userMsg = buildUserMessage(
		scenario,
		judgeWorkspace,
		testingResult.filesWritten
	);

	log.info(
		`${ scope }: judge starting provider=${ judge.provider } model=${ judge.model }`
	);

	const provider = getProvider( judge.provider );
	const result = await provider.invoke( {
		agent: judge,
		systemPrompt,
		prompt: userMsg,
		cwd: judgeWorkspace,
		role: 'judge',
		capabilities: judgeCapabilities( judge ),
	} );

	if ( result.error !== undefined ) {
		log.info( `${ scope }: dispatch failed — ${ result.error }` );
		return {
			error: `judge dispatch failed: ${ result.error }`,
			raw: result.finalText,
		};
	}

	const parsed = parseJudgeJson( result.finalText );
	if ( parsed === undefined ) {
		log.info( `${ scope }: judge JSON unparseable, raw stored` );
		return {
			error: 'unparseable',
			raw: result.finalText,
		};
	}

	log.info( `${ scope }: judge verdict written` );
	return parsed;
}

/**
 * Assemble the judge's {@link JudgeCapabilities} from the passthrough keys
 * the project set on the judge agent definition. Only the four typed
 * capability keys (`tools`, `mcpServers`, `allowWrite`, `network`) are
 * lifted; an omitted key is left unset so the provider keeps its default
 * for that capability (the read-only default when none are set).
 *
 * @param judge - The normalized judge agent definition.
 * @returns The capability descriptor passed on the judge `invoke` call.
 */
export function judgeCapabilities( judge: AgentDefinition ): JudgeCapabilities {
	const capabilities: JudgeCapabilities = {};
	if ( Array.isArray( judge.tools ) ) {
		capabilities.tools = judge.tools as string[];
	}
	if (
		typeof judge.mcpServers === 'object' &&
		judge.mcpServers !== null
	) {
		capabilities.mcpServers =
			judge.mcpServers as JudgeCapabilities[ 'mcpServers' ];
	}
	if ( typeof judge.allowWrite === 'boolean' ) {
		capabilities.allowWrite = judge.allowWrite;
	}
	if ( typeof judge.network === 'boolean' ) {
		capabilities.network = judge.network;
	}
	return capabilities;
}

/**
 * Build the judge's system prompt: the scenario's verbatim `judgeBrief`,
 * a minimal instruction to emit exactly `{ "pass": <bool>, "notes":
 * "<string>" }` as a single JSON object, and — when set — the
 * `roles.judge.prompt` under a `# Role instructions` heading. The judge
 * grades against this brief and the live artifact; no rubric or
 * acceptance scaffolding is assembled.
 *
 * @param scenario - The scenario whose `judgeBrief` is the prompt body.
 * @param config - The resolved config; its `roles.judge.prompt` is
 *   appended when present.
 * @returns The full judge system prompt.
 */
export function buildJudgeSystemPrompt(
	scenario: Scenario,
	config: SkillsmithConfig
): string {
	const outputInstruction = [
		'# Output format',
		'Return a single JSON object with exactly these two keys:',
		'  { "pass": <bool>, "notes": "<string>" }',
		'`notes` is a JSON string: escape literal newlines as \\n, double quotes as \\", and backslashes as \\\\.',
		'Strict JSON only: no trailing commas, no comments, no single-quoted strings.',
		'Output only the JSON object — no prose, no Markdown fences, nothing before or after it.',
		'',
		'# Recursion guard',
		'Do not invoke `skillsmith` or any wrapper that would re-enter the harness.',
	].join( '\n' );

	const sections = [ scenario.judgeBrief, outputInstruction ];
	const rolePrompt = config.roles.judge.prompt;
	if ( rolePrompt !== undefined && rolePrompt.length > 0 ) {
		sections.push( `# Role instructions\n${ rolePrompt }` );
	}
	return sections.join( '\n\n' );
}

/**
 * Parse the judge's final text into its verdict object. The strict parse
 * (with fenced-block unwrapping) runs first; on failure, a lenient
 * fallback extracts the last balanced `{...}` object in the text and
 * parses that, recovering a verdict the judge wrapped in prose. Returns
 * `undefined` only when neither path yields a JSON object — the caller
 * then degrades to `{ error: 'unparseable', raw }`.
 *
 * @param finalText - The judge's raw final text.
 * @returns The parsed verdict object, or `undefined` when unparseable.
 */
export function parseJudgeJson( finalText: string ): object | undefined {
	const trimmed = finalText.trim();
	const fence = trimmed.match( /^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/ );
	const jsonText = fence?.[ 1 ] ?? trimmed;
	const strict = tryParseObject( jsonText );
	if ( strict !== undefined ) return strict;

	const lastObject = extractLastBalancedObject( finalText );
	if ( lastObject !== undefined ) {
		const lenient = tryParseObject( lastObject );
		if ( lenient !== undefined ) return lenient;
	}
	return undefined;
}

/**
 * Parse `text` as JSON and return it only when it is a non-null object.
 * Returns `undefined` on any parse error or non-object value.
 */
function tryParseObject( text: string ): object | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse( text );
	} catch {
		return undefined;
	}
	if ( parsed === null || typeof parsed !== 'object' ) return undefined;
	return parsed;
}

/**
 * Scan `text` for the last brace-balanced `{...}` span and return it. The
 * scan walks from each `}` backward to its matching `{` (depth-counting),
 * so a trailing verdict object is recovered even when earlier `{...}`
 * fragments appear in surrounding prose. Returns `undefined` when no
 * balanced object is present.
 */
function extractLastBalancedObject( text: string ): string | undefined {
	const close = text.lastIndexOf( '}' );
	if ( close === -1 ) return undefined;
	let depth = 0;
	for ( let i = close; i >= 0; i-- ) {
		const ch = text[ i ];
		if ( ch === '}' ) depth++;
		else if ( ch === '{' ) {
			depth--;
			if ( depth === 0 ) return text.slice( i, close + 1 );
		}
	}
	return undefined;
}

/**
 * Build the judge's user message: each file the testing agent produced,
 * inlined from the judge-copy `workspace` as a `=== <rel> ===\n<body>`
 * block (the `=== (no files written) ===` fallback when none). Inlining
 * from the judge copy keeps "what the judge reads == what it verifies";
 * unreadable files are surfaced with a read-error placeholder.
 *
 * @param _scenario - The scenario under evaluation. Unused: the judge
 *   sees only the produced artifact, never the scenario fields.
 * @param workspace - The judge-copy workspace path the files are read from.
 * @param filesWritten - Workspace-relative paths the testing agent wrote.
 * @returns The assembled user message.
 */
export function buildUserMessage(
	_scenario: Scenario,
	workspace: string,
	filesWritten: string[]
): string {
	const sections: string[] = [];
	for ( const rel of filesWritten ) {
		const full = join( workspace, rel );
		if ( ! existsSync( full ) ) continue;
		let body: string;
		try {
			body = readFileSync( full, 'utf8' );
		} catch ( err ) {
			body = `<read error: ${ err instanceof Error ? err.message : String( err ) }>`;
		}
		sections.push( `=== ${ rel } ===\n${ body }` );
	}
	if ( sections.length === 0 ) sections.push( '=== (no files written) ===' );
	return sections.join( '\n' );
}
