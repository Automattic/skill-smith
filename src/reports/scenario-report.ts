import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { isDirectorySafe } from '../util/fs';
import { classifyVerdict } from './verdict';

export interface AggregateScenarioReportParams {
	scenarioDirectory: string;
	scenarioName: string;
	scenarioError?: string;
}

/**
 * One agent's row inside `<scenario>/report.json`. We keep the
 * `testing` block (duration / token usage) and the judge's `review`
 * block verbatim — the full rubrics/acceptance output the agent loop
 * wrote. A missing or unparseable per-agent report is reported as an
 * error string instead of an object.
 */
export interface ScenarioAgentEntry {
	testing?: unknown;
	review?: unknown;
	error?: string;
}

export interface ScenarioReport {
	scenario: string;
	pass: boolean;
	agents: Record< string, ScenarioAgentEntry >;
	error?: string;
}

/**
 * Aggregate `${scenarioDirectory}/<agent>/report.json` into
 * `${scenarioDirectory}/report.json`. The scenario passes only when
 * every agent's review is `{ pass: true }`. Missing report →
 * `error: "missing agent report"` for that agent and a failing
 * scenario. Each agent report carries a `testing` block and a
 * `review` block verbatim.
 */
export function aggregateScenarioReport(
	params: AggregateScenarioReportParams
): ScenarioReport {
	const { scenarioDirectory, scenarioName, scenarioError } = params;

	const agents: Record< string, ScenarioAgentEntry > = {};

	if ( isDirectorySafe( scenarioDirectory ) ) {
		for ( const entry of readdirSync( scenarioDirectory ) ) {
			const full = join( scenarioDirectory, entry );
			if ( ! isDirectorySafe( full ) ) continue;
			const reportPath = join( full, 'report.json' );
			if ( ! existsSync( reportPath ) ) {
				agents[ entry ] = { error: 'missing agent report' };
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse( readFileSync( reportPath, 'utf8' ) );
			} catch ( err ) {
				const msg = err instanceof Error ? err.message : String( err );
				agents[ entry ] = {
					error: `agent report unparseable: ${ msg }`,
				};
				continue;
			}
			if ( parsed === null || typeof parsed !== 'object' ) {
				agents[ entry ] = { error: 'agent report empty' };
				continue;
			}
			const body = parsed as Record< string, unknown >;
			const out: ScenarioAgentEntry = {};
			if ( body.testing !== undefined ) out.testing = body.testing;
			if ( body.review !== undefined ) out.review = body.review;
			agents[ entry ] = out;
		}
	}

	const agentsList = Object.values( agents );
	const allPass =
		scenarioError === undefined &&
		agentsList.length > 0 &&
		agentsList.every( ( entry ) => {
			if ( entry.error !== undefined ) return false;
			if ( entry.review === null || typeof entry.review !== 'object' ) {
				return false;
			}
			return classifyVerdict( entry.review ).kind === 'PASS';
		} );

	const body: ScenarioReport = {
		scenario: scenarioName,
		pass: allPass,
		agents,
	};
	if ( scenarioError !== undefined ) body.error = scenarioError;

	mkdirSync( scenarioDirectory, { recursive: true } );
	const target = join( scenarioDirectory, 'report.json' );
	writeFileSync( target, `${ JSON.stringify( body, null, 2 ) }\n` );
	return body;
}
