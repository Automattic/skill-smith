import path from 'node:path';
import type { EnumeratedScenario } from './enumerate';
import { UserFacingError } from '../util/errors';

/**
 * Normalize a user-provided scenario filter into the canonical spelling used
 * for scenario IDs.
 *
 * The returned value uses `/` separators, has redundant separators and `.`
 * path segments removed, and never contains a trailing slash unless the filter
 * addresses the scenario root as `.`. Unsafe absolute, UNC, or parent-directory
 * filters throw a user-facing error before any scenario matching occurs.
 *
 * @param rawFilter - Scenario ID or scenario parent folder filter supplied by a user.
 * @returns Canonical scenario filter suitable for exact or folder matching.
 *
 * @example
 * normalizeScenarioFilter("./blocks//counter/");
 * // "blocks/counter"
 */
export function normalizeScenarioFilter( rawFilter: string ): string {
	const trimmed = rawFilter.trim();
	if ( trimmed.length === 0 ) {
		throw new UserFacingError( 'Scenario IDs must not be empty.' );
	}

	if ( isUnsafeScenarioFilter( trimmed ) ) {
		throw new UserFacingError(
			`Invalid scenario filter: ${ trimmed }\n\nScenario filters must be relative to config.paths.scenarios and must not be absolute paths, UNC paths, or contain '..' segments.`
		);
	}

	const segments = trimmed
		.replace( /\\/g, '/' )
		.split( '/' )
		.filter( ( segment ) => segment.length > 0 && segment !== '.' );

	return segments.length === 0 ? '.' : segments.join( '/' );
}

/**
 * Normalize and de-duplicate scenario filters while preserving the first
 * occurrence of each effective filter.
 *
 * @param rawFilters - User-provided scenario ID or parent folder filters.
 * @returns Canonical filters in first occurrence order.
 *
 * @example
 * normalizeScenarioFilters(["counter", "./counter", "counter/"]);
 * // ["counter"]
 */
export function normalizeScenarioFilters( rawFilters: string[] ): string[] {
	const filters: string[] = [];
	const seen = new Set< string >();
	for ( const rawFilter of rawFilters ) {
		const filter = normalizeScenarioFilter( rawFilter );
		if ( ! seen.has( filter ) ) {
			seen.add( filter );
			filters.push( filter );
		}
	}
	return filters;
}

/**
 * Select enumerated scenarios using already-normalized scenario ID and folder
 * filters.
 *
 * This helper performs matching and unknown-filter detection only. Callers that
 * need to validate other run-wide invariants before matching can normalize raw
 * user filters with `normalizeScenarioFilters`, perform those validations, then
 * call this helper. Scenarios are considered in deterministic ID order for each
 * filter. Filters are processed in user order, and each scenario is emitted only
 * for the first filter that matches it. Unknown filters fail before any
 * selection is returned. If no filters are supplied, all scenarios are returned
 * in deterministic ID order.
 *
 * @param scenarios - Enumerated scenarios available for a run.
 * @param filters - Canonical filters produced by `normalizeScenarioFilters`.
 * @returns Selected scenarios in shared deterministic order.
 */
export function selectScenariosByNormalizedFilters(
	scenarios: EnumeratedScenario[],
	filters: string[]
): EnumeratedScenario[] {
	const sortedScenarios = [ ...scenarios ].sort( compareScenarioIds );
	if ( filters.length === 0 ) return sortedScenarios;

	const availableIds = sortedScenarios.map( ( scenario ) => scenario.id );
	const unknown = filters.filter(
		( filter ) =>
			! availableIds.some( ( id ) => matchesScenarioFilter( filter, id ) )
	);

	if ( unknown.length > 0 ) {
		throw new UserFacingError(
			formatUnknownFiltersMessage( unknown, availableIds )
		);
	}

	const selected: EnumeratedScenario[] = [];
	const emitted = new Set< string >();
	for ( const filter of filters ) {
		for ( const scenario of sortedScenarios ) {
			if ( emitted.has( scenario.id ) ) continue;
			if ( ! matchesScenarioFilter( filter, scenario.id ) ) continue;
			emitted.add( scenario.id );
			selected.push( scenario );
		}
	}

	return selected;
}

/**
 * Determine whether a normalized scenario filter matches a normalized scenario
 * ID by exact ID, root, or segment-aware parent folder.
 *
 * @param filter - Canonical filter produced by `normalizeScenarioFilter`.
 * @param id - Canonical scenario ID relative to `config.paths.scenarios`.
 * @returns Whether the filter selects the scenario ID.
 *
 * @example
 * matchesScenarioFilter("blocks", "blocks/counter");
 * // true
 */
export function matchesScenarioFilter( filter: string, id: string ): boolean {
	return filter === '.' || id === filter || id.startsWith( `${ filter }/` );
}

/**
 * Select enumerated scenarios using the shared scenario ID and folder filter
 * semantics.
 *
 * Scenarios are considered in deterministic ID order for each filter. Filters
 * are processed in user order, and each scenario is emitted only for the first
 * filter that matches it. Unknown filters fail before any selection is returned.
 * If no filters are supplied, all scenarios are returned in deterministic ID
 * order.
 *
 * @param scenarios - Enumerated scenarios available for a run.
 * @param rawFilters - Optional user-provided scenario ID or parent folder filters.
 * @returns Selected scenarios in shared deterministic order.
 */
export function selectScenariosByFilters(
	scenarios: EnumeratedScenario[],
	rawFilters: string[] | undefined
): EnumeratedScenario[] {
	return selectScenariosByNormalizedFilters(
		scenarios,
		normalizeScenarioFilters( rawFilters ?? [] )
	);
}

/**
 * Validate that scenario names are unique across all discovered scenarios.
 *
 * @param scenarios - Enumerated scenarios to validate before filtering or running.
 * @throws UserFacingError when two or more scenarios share a name.
 */
export function validateConfiguredScenarioNamesAreUnique(
	scenarios: EnumeratedScenario[]
): void {
	const idsByName = new Map< string, string[] >();
	for ( const scenario of scenarios ) {
		const ids = idsByName.get( scenario.scenario.name ) ?? [];
		ids.push( scenario.id );
		idsByName.set( scenario.scenario.name, ids );
	}

	for ( const [ name, ids ] of [ ...idsByName.entries() ].sort(
		( [ a ], [ b ] ) => a.localeCompare( b )
	) ) {
		if ( ids.length < 2 ) continue;
		const conflicts = ids
			.sort()
			.map( ( id ) => `- ${ id }` )
			.join( '\n' );
		throw new UserFacingError(
			`Duplicate scenario.name "${ name }" configured by:\n${ conflicts }`
		);
	}
}

function isUnsafeScenarioFilter( trimmed: string ): boolean {
	if ( trimmed.startsWith( '/' ) || trimmed.startsWith( '//' ) ) return true;
	if ( path.win32.isAbsolute( trimmed ) ) return true;
	return trimmed.replace( /\\/g, '/' ).split( '/' ).includes( '..' );
}

function compareScenarioIds(
	a: EnumeratedScenario,
	b: EnumeratedScenario
): number {
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function formatUnknownFiltersMessage(
	unknown: string[],
	availableIds: string[]
): string {
	const label =
		unknown.length === 1
			? `Unknown scenario: ${ unknown[ 0 ] }`
			: `Unknown scenarios: ${ unknown.join( ', ' ) }`;
	const available = availableIds.map( ( id ) => `- ${ id }` ).join( '\n' );
	return `${ label }\n\nAvailable scenarios:\n${ available }\n\nPass a scenario ID or parent folder relative to config.paths.scenarios.`;
}
