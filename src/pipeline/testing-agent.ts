import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type {
	AgentDefinition,
	Scenario,
	SkillsmithConfig,
} from '../config/types';
import { getProvider } from '../providers/registry';
import { loadSkill } from '../scenarios/skill-loader';
import type { RunLog } from '../util/run-log';
import type { TestingAgentResult } from './agent-loop';

export interface RunTestingAgentParams {
	scenario: Scenario;
	agent: AgentDefinition;
	agentWorkspace: string;
	projectRoot: string;
	config: SkillsmithConfig;
	log: RunLog;
}

const TOOL_USE_WARNING_THRESHOLD = 50;

/**
 * Run the testing sub-agent for one (scenario, agent) pair. The system
 * prompt carries the skill blob, a snapshot of the workspace, a write
 * constraint, and a recursion guard. The user message is
 * `scenario.prompt` verbatim.
 */
export async function runTestingAgent(
	params: RunTestingAgentParams
): Promise< TestingAgentResult > {
	const { scenario, agent, agentWorkspace, projectRoot, config, log } =
		params;
	const scope = `scenario:${ scenario.name }/agent:${ agent.id }`;

	const skillsRoot = resolve( projectRoot, config.paths.skills );
	const skillBlob = scenario.skills
		.map( ( id ) => loadSkill( id, skillsRoot ) )
		.join( '\n\n' );

	const before = snapshotWorkspace( agentWorkspace );
	const workspaceContents = buildWorkspaceContents( agentWorkspace, before );

	const sections = [
		skillBlob,
		'',
		'# Workspace constraint',
		`Only write files under ${ agentWorkspace }. Do not read or modify any files outside this directory.`,
		'',
		'# Workspace contents',
		'These files already exist in your working directory before you start.',
		workspaceContents,
		'',
		'# Recursion guard',
		'You are running inside the skillsmith harness. Do not invoke `skillsmith` or any wrapper that would re-enter the harness.',
	];
	const rolePrompt = config.roles.test.prompt;
	if ( rolePrompt !== undefined && rolePrompt.length > 0 ) {
		sections.push( '', '# Role instructions', rolePrompt );
	}
	const systemPrompt = sections.join( '\n' );

	log.info(
		`testing-agent starting (${ scope }): provider=${ agent.provider } model=${ agent.model }`
	);

	const provider = getProvider( agent.provider );
	const result = await provider.invoke( {
		agent,
		systemPrompt,
		prompt: scenario.prompt,
		cwd: agentWorkspace,
		role: 'testing',
	} );

	if ( result.toolUseCount > TOOL_USE_WARNING_THRESHOLD ) {
		log.info(
			`tool-use warning (${ scope }): ${ result.toolUseCount } > ${ TOOL_USE_WARNING_THRESHOLD }`
		);
	}

	const filesWritten = diffSnapshots(
		before,
		snapshotWorkspace( agentWorkspace )
	);

	log.info(
		`testing-agent (${ scope }): tool-uses=${ result.toolUseCount } files-written=[${ filesWritten.join( ', ' ) }]${
			result.error ? ` error=${ result.error }` : ''
		}`
	);

	const out: TestingAgentResult = {
		finalText: result.finalText,
		toolUseCount: result.toolUseCount,
		filesWritten,
	};
	if ( result.error !== undefined ) out.error = result.error;
	if ( result.usage !== undefined ) out.usage = result.usage;
	return out;
}

interface FileEntry {
	mtimeMs: number;
	size: number;
}

function snapshotWorkspace( root: string ): Map< string, FileEntry > {
	const out = new Map< string, FileEntry >();
	walk( root, root, out );
	return out;
}

function walk(
	root: string,
	dir: string,
	out: Map< string, FileEntry >
): void {
	let entries: string[];
	try {
		entries = readdirSync( dir );
	} catch {
		return;
	}
	for ( const name of entries ) {
		const full = join( dir, name );
		let s: ReturnType< typeof statSync >;
		try {
			s = statSync( full );
		} catch {
			continue;
		}
		if ( s.isDirectory() ) {
			walk( root, full, out );
		} else if ( s.isFile() ) {
			const rel = relative( root, full );
			out.set( rel, { mtimeMs: s.mtimeMs, size: s.size } );
		}
	}
}

function buildWorkspaceContents(
	workspace: string,
	snapshot: Map< string, FileEntry >
): string {
	const sections: string[] = [];
	for ( const rel of [ ...snapshot.keys() ].sort() ) {
		const full = join( workspace, rel );
		let body: string;
		try {
			body = readFileSync( full, 'utf8' );
		} catch ( err ) {
			body = `<read error: ${ err instanceof Error ? err.message : String( err ) }>`;
		}
		sections.push( `=== ${ rel } ===\n${ body }` );
	}
	if ( sections.length === 0 ) return '(empty workspace)';
	return sections.join( '\n\n' );
}

function diffSnapshots(
	before: Map< string, FileEntry >,
	after: Map< string, FileEntry >
): string[] {
	const written: string[] = [];
	for ( const [ rel, post ] of after ) {
		const pre = before.get( rel );
		if (
			pre === undefined ||
			pre.mtimeMs !== post.mtimeMs ||
			pre.size !== post.size
		) {
			written.push( rel );
		}
	}
	return written.sort();
}
