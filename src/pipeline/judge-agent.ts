import { relative } from 'node:path';
import type { AgentDefinition, Scenario } from '../config/types';
import { getProvider } from '../providers/registry';
import type { JudgeCapabilities, TokenUsage } from '../providers/types';
import { stripSkillsSection } from '../scenarios/enumerate';
import type { RunLog } from '../util/run-log';
import type { TestingAgentResult } from './agent-loop';
import { inlineWorkspaceFiles } from './workspace-snapshot';

export interface RunJudgeAgentParams {
	scenario: Scenario;
	judge: AgentDefinition;
	agentDirectory: string;
	/**
	 * The isolated copy the judge runs against (its `cwd`), so a judge that
	 * writes cannot mutate the canonical artifact. The caller copies the
	 * canonical workspace here before invoking the judge. The judge's `cwd`
	 * and the inlined file bodies both come from this path.
	 */
	judgeWorkspace: string;
	projectRoot: string;
	log: RunLog;
	testingResult: TestingAgentResult;
	/**
	 * The pre-built `# Judge library` prompt section for this pair,
	 * produced by `prepareJudgeLibrary` when the project configures
	 * `roles.judge.library` and the library holds files. Appended verbatim
	 * as the final system-prompt section; omitted when there is no library
	 * material.
	 */
	librarySection?: string;
}

/**
 * The outcome of one judge invocation.
 *
 * @property review - The judge's verdict payload the caller embeds under
 *   the per-agent report's `review` key: the parsed `{ pass, notes }`
 *   object on success, or an error-shaped payload on the
 *   dispatch-failed (`{ error, raw }`) and unparseable
 *   (`{ error: 'unparseable', raw }`) paths.
 * @property usage - The provider's normalized token accounting for this
 *   invocation, present iff the provider's `InvokeResult` carried
 *   `usage` — including on the unparseable path (usage is reported
 *   before the verdict is parsed). Absent when dispatch failed before a
 *   usage report.
 */
export interface RunJudgeAgentResult {
	review: unknown;
	usage?: TokenUsage;
}

/**
 * Run the judge sub-agent for one (scenario, agent) pair. The judge's
 * system prompt is the scenario's verbatim `judgeBrief`, followed by the
 * auto-supplied testing task (the scenario's `testingBrief` with its
 * `# Skills` section removed) under a `# Testing task` heading, the
 * `{ pass, notes }` output instruction (which carries the default decision
 * rule and the missing-material failure duty on every run), and — when the
 * caller passes one — the pre-built `# Judge library` section verbatim.
 * The judge verifies the produced artifact (and any live environment the
 * project stood up) using the project-configured judge capabilities,
 * running against an isolated copy of the workspace so it cannot mutate
 * the artifact of record.
 *
 * Returns a {@link RunJudgeAgentResult}: `review` is the verdict object
 * — `{ pass, notes }` on success, or an error-shaped payload on the
 * failure paths — and `usage` is the provider's token accounting when it
 * reported any. The judge emits a single JSON object. The caller
 * (`agent-loop.ts`) is the single writer of the per-agent `report.json`,
 * embedding `review` under the `review` key and `usage` under
 * `judging.tokenUsage`.
 */
export async function runJudgeAgent(
	params: RunJudgeAgentParams
): Promise< RunJudgeAgentResult > {
	const {
		scenario,
		judge,
		agentDirectory,
		judgeWorkspace,
		projectRoot,
		log,
		testingResult,
		librarySection,
	} = params;
	const scope = `judge:${ scenario.name }@${ relative( projectRoot, agentDirectory ) }`;

	const task = stripSkillsSection( scenario.testingBrief );
	const systemPrompt = buildJudgeSystemPrompt(
		scenario,
		task,
		librarySection
	);
	const userMsg = buildUserMessage(
		judgeWorkspace,
		testingResult.filesWritten
	);

	log.info(
		`${ scope }: judge starting provider=${ judge.provider } model=${ judge.model } task=supplied library=${
			librarySection === undefined ? 'none' : 'supplied'
		}`
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
		// Dispatch failed before any usage report, so no usage is carried:
		// `judging.tokenUsage` stays absent on this path.
		log.info( `${ scope }: dispatch failed — ${ result.error }` );
		return {
			review: {
				error: `judge dispatch failed: ${ result.error }`,
				raw: result.finalText,
			},
		};
	}

	const parsed = parseJudgeJson( result.finalText );
	if ( parsed === undefined ) {
		// The provider reported usage before the verdict was parsed, so
		// `usage` flows through even though the verdict itself is an error
		// payload.
		log.info( `${ scope }: judge JSON unparseable, raw stored` );
		return {
			review: {
				error: 'unparseable',
				raw: result.finalText,
			},
			usage: result.usage,
		};
	}

	log.info( `${ scope }: judge verdict written` );
	return { review: parsed, usage: result.usage };
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
 * followed by the auto-supplied testing task under a `# Testing task` heading,
 * the output instruction, and — when supplied — the pre-built `# Judge library`
 * section verbatim as the final section. This is a pure string joiner: it
 * performs no filesystem access. The caller strips the task's `# Skills`
 * section and builds the library section, then passes both in as strings.
 *
 * The `# Testing task` section is always present (the task is auto-supplied on
 * every judge run) and is placed immediately after `judgeBrief` and before the
 * output instruction. The output instruction is always present and carries,
 * beyond the strict-JSON `{ pass, notes }` shape:
 *   - the default decision rule with an explicit override clause — a brief
 *     stating its own decision rule wins; otherwise every check the brief
 *     asks for must be satisfied for a pass;
 *   - the missing-material failure duty — grading material the brief
 *     references that was not supplied or cannot be read fails the verdict,
 *     with the missing item named in `notes`. The duty is phrased against
 *     supplied grading material so it holds identically whether the library
 *     is mounted, inlined, or not configured at all.
 *
 * @param scenario       - The scenario whose `judgeBrief` is the prompt body.
 * @param task           - The auto-supplied testing task, already stripped of
 *   its `# Skills` section by the caller. Inlined verbatim under a
 *   `# Testing task` heading on every run.
 * @param librarySection - The complete `# Judge library` section text
 *   (heading included) to append verbatim as the final section. When
 *   `undefined` or empty, no library section is added.
 * @returns The full judge system prompt.
 */
export function buildJudgeSystemPrompt(
	scenario: Scenario,
	task: string,
	librarySection?: string
): string {
	const outputInstruction = [
		'# Output format',
		'Return a single JSON object with exactly these two keys:',
		'  { "pass": <bool>, "notes": "<string>" }',
		'`notes` is a JSON string: escape literal newlines as \\n, double quotes as \\", and backslashes as \\\\.',
		'Strict JSON only: no trailing commas, no comments, no single-quoted strings.',
		'Output only the JSON object — no prose, no Markdown fences, nothing before or after it.',
		'',
		'Decision rule: unless the brief states its own decision rule, return',
		'`"pass": true` only if every check the brief asks for — including any',
		'rubric check — is satisfied; otherwise return `"pass": false`.',
		'If the brief references grading material that was not supplied or cannot',
		'be read, return `"pass": false` and name the missing item in `notes`.',
		'',
		'# Recursion guard',
		'Do not invoke `skillsmith` or any wrapper that would re-enter the harness.',
	].join( '\n' );

	const sections = [
		scenario.judgeBrief,
		`# Testing task\n${ task }`,
		outputInstruction,
	];
	if ( librarySection !== undefined && librarySection.length > 0 ) {
		sections.push( librarySection );
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
 * block (the `=== (no files written) ===` fallback when none). Files that
 * no longer exist in the copy are skipped. Inlining from the judge copy
 * keeps "what the judge reads == what it verifies"; unreadable files are
 * surfaced with a read-error placeholder.
 *
 * @param workspace - The judge-copy workspace path the files are read from.
 * @param filesWritten - Workspace-relative paths the testing agent wrote.
 * @returns The assembled user message.
 */
export function buildUserMessage(
	workspace: string,
	filesWritten: string[]
): string {
	return inlineWorkspaceFiles( workspace, filesWritten, {
		separator: '\n',
		emptyFallback: '=== (no files written) ===',
		skipMissing: true,
	} );
}
