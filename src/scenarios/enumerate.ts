import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Paths, Scenario } from '../config/types';

/**
 * Provenance for an enumerated scenario's `scenario.name` value.
 * Configured names come from a valid `scenario.yaml`; synthetic names are
 * generated from the scenario id when the file cannot provide a valid name.
 */
export type EnumeratedScenarioNameSource = 'configured' | 'synthetic';

/**
 * Scenario record produced by filesystem enumeration before run selection.
 */
export interface EnumeratedScenario {
	/** Parsed scenario definition, or a minimal placeholder for invalid YAML. */
	scenario: Scenario;
	/**
	 * Stable scenario directory identifier, relative to `paths.scenarios` and
	 * normalized to use `/` separators. Nested scenarios include their parent
	 * folders, for example `blocks/counter`.
	 *
	 * @example "counter"
	 * @example "blocks/counter"
	 */
	id: string;
	/** Compatibility alias for `id`. This value must always equal `id`. */
	dirName: string;
	/** Indicates whether `scenario.name` came from YAML or from the scenario id. */
	nameSource: EnumeratedScenarioNameSource;
	/** Enumeration-time validation error, if the scenario cannot run as-is. */
	error?: string;
}

/**
 * Walk `paths.scenarios` recursively, parse every discovered `scenario.yaml`,
 * and validate that `skills[*]` and `rubrics[*]` references resolve under
 * `paths.skills/` and `paths.rubrics/` respectively.
 *
 * Bad refs or malformed YAML → fail that scenario with an `error`,
 * others continue.
 */
export function enumerateScenarios(
	paths: Paths,
	projectRoot: string
): EnumeratedScenario[] {
	const scenariosRoot = join( projectRoot, paths.scenarios );
	const skillsRoot = join( projectRoot, paths.skills );
	const rubricsRoot = join( projectRoot, paths.rubrics );

	const out: EnumeratedScenario[] = [];

	if ( ! existsSync( scenariosRoot ) ) return out;

	function visit( dir: string, segments: string[] ): void {
		const id = segments.join( '/' );
		const yamlPath = join( dir, 'scenario.yaml' );

		if ( existsSync( yamlPath ) ) {
			let parsed: unknown;
			try {
				parsed = parseYaml( readFileSync( yamlPath, 'utf8' ) );
			} catch ( err ) {
				const msg = err instanceof Error ? err.message : String( err );
				out.push( {
					scenario: stubScenario( id ),
					id,
					dirName: id,
					nameSource: 'synthetic',
					error: `scenario.yaml parse error: ${ msg }`,
				} );
				visitChildren( dir, segments );
				return;
			}

			if ( ! isScenarioShape( parsed ) ) {
				out.push( {
					scenario: stubScenario( id ),
					id,
					dirName: id,
					nameSource: 'synthetic',
					error: 'scenario.yaml malformed: expected name/description/skills/prompt/acceptance/rubrics',
				} );
				visitChildren( dir, segments );
				return;
			}

			const scenario = parsed;
			const missing: string[] = [];
			for ( const id of scenario.skills ) {
				if ( ! existsSync( join( skillsRoot, id, 'SKILL.md' ) ) ) {
					missing.push( `skill "${ id }"` );
				}
			}
			for ( const id of scenario.rubrics ) {
				if ( ! existsSync( join( rubricsRoot, `${ id }.md` ) ) ) {
					missing.push( `rubric "${ id }"` );
				}
			}

			if ( missing.length > 0 ) {
				out.push( {
					scenario,
					id,
					dirName: id,
					nameSource: 'configured',
					error: `unresolved reference: ${ missing.join( ', ' ) }`,
				} );
			} else {
				out.push( {
					scenario,
					id,
					dirName: id,
					nameSource: 'configured',
				} );
			}
		}

		visitChildren( dir, segments );
	}

	function visitChildren( dir: string, segments: string[] ): void {
		for ( const entry of readdirSync( dir, { withFileTypes: true } ) ) {
			if ( ! entry.isDirectory() ) continue;
			visit( join( dir, entry.name ), [ ...segments, entry.name ] );
		}
	}

	visitChildren( scenariosRoot, [] );

	return out.sort( ( a, b ) => ( a.id < b.id ? -1 : a.id > b.id ? 1 : 0 ) );
}

function stubScenario( dirName: string ): Scenario {
	return {
		name: dirName,
		description: '',
		skills: [],
		prompt: '',
		acceptance: [],
		rubrics: [],
	};
}

function isScenarioShape( raw: unknown ): raw is Scenario {
	if ( raw === null || typeof raw !== 'object' ) return false;
	const r = raw as Record< string, unknown >;
	return (
		typeof r.name === 'string' &&
		r.name.length > 0 &&
		typeof r.description === 'string' &&
		Array.isArray( r.skills ) &&
		r.skills.every( ( s ) => typeof s === 'string' ) &&
		typeof r.prompt === 'string' &&
		Array.isArray( r.acceptance ) &&
		r.acceptance.every( ( s ) => typeof s === 'string' ) &&
		Array.isArray( r.rubrics ) &&
		r.rubrics.every( ( s ) => typeof s === 'string' )
	);
}
