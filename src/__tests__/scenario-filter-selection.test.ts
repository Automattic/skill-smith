import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Scenario } from '../config/types';
import type { EnumeratedScenario } from '../scenarios/enumerate';
import {
	normalizeScenarioFilters,
	selectScenariosByFilters,
} from '../scenarios/selection';
import { UserFacingError } from '../util/errors';

function enumerated( id: string ): EnumeratedScenario {
	const scenario: Scenario = {
		name: id,
		skills: [],
		testingBrief: '',
		judgeBrief: '',
	};
	return { id, scenario };
}

function ids( scenarios: EnumeratedScenario[] ): string[] {
	return scenarios.map( ( scenario ) => scenario.id );
}

test( 'normalizes harmless spelling variations and de-dupes filters', () => {
	assert.deepEqual(
		normalizeScenarioFilters( [ 'counter', './counter', 'counter/' ] ),
		[ 'counter' ]
	);
	assert.deepEqual( normalizeScenarioFilters( [ 'foo//bar', 'foo\\bar' ] ), [
		'foo/bar',
	] );
	assert.deepEqual( normalizeScenarioFilters( [ '.', './' ] ), [ '.' ] );
} );

test( 'rejects empty and unsafe filters before matching', () => {
	assert.throws(
		() => normalizeScenarioFilters( [ '   ' ] ),
		( error: unknown ) =>
			error instanceof UserFacingError &&
			error.message === 'Scenario IDs must not be empty.'
	);

	for ( const unsafe of [
		'/counter',
		'C:\\repo\\counter',
		'\\counter',
		'\\\\server\\share\\counter',
		'//server/share/counter',
		'counter/../other',
		'counter\\..\\other',
	] ) {
		assert.throws(
			() => normalizeScenarioFilters( [ unsafe ] ),
			( error: unknown ) =>
				error instanceof UserFacingError &&
				error.message.includes(
					`Invalid scenario filter: ${ unsafe }`
				) &&
				error.message.includes(
					'relative to config.paths.scenarios'
				) &&
				error.message.includes( 'absolute paths' ) &&
				error.message.includes( 'UNC paths' ) &&
				error.message.includes( "'..' segments" ),
			unsafe
		);
	}
} );

test( 'selects root, exact ids, and segment-aware folders in deterministic id order', () => {
	const scenarios = [
		enumerated( 'blocks/zebra' ),
		enumerated( 'my-blocks/counter' ),
		enumerated( 'blocks/button' ),
		enumerated( 'blocks-old/counter' ),
		enumerated( 'blocks/counter' ),
	];

	assert.deepEqual( ids( selectScenariosByFilters( scenarios, [ '.' ] ) ), [
		'blocks-old/counter',
		'blocks/button',
		'blocks/counter',
		'blocks/zebra',
		'my-blocks/counter',
	] );
	assert.deepEqual(
		ids( selectScenariosByFilters( scenarios, [ 'blocks' ] ) ),
		[ 'blocks/button', 'blocks/counter', 'blocks/zebra' ]
	);
} );

test( 'selects both nested sibling leaf scenarios with distinct ids', () => {
	const scenarios = [
		enumerated( 'blocks/counter' ),
		enumerated( 'blocks-old/counter' ),
	];

	assert.deepEqual( ids( selectScenariosByFilters( scenarios, undefined ) ), [
		'blocks-old/counter',
		'blocks/counter',
	] );
} );

test( 'preserves first matching filter order while de-duping overlapping selections', () => {
	const scenarios = [
		enumerated( 'blocks/zebra' ),
		enumerated( 'other/alpha' ),
		enumerated( 'blocks/button' ),
		enumerated( 'blocks/counter' ),
	];

	assert.deepEqual(
		ids(
			selectScenariosByFilters( scenarios, [
				'blocks/counter',
				'blocks',
				'other',
			] )
		),
		[ 'blocks/counter', 'blocks/button', 'blocks/zebra', 'other/alpha' ]
	);
} );

test( 'unknown filters list available ids', () => {
	const scenarios = [
		enumerated( 'counter' ),
		enumerated( 'blocks/button' ),
	];

	assert.throws(
		() => selectScenariosByFilters( scenarios, [ 'Counter' ] ),
		( error: unknown ) =>
			error instanceof UserFacingError &&
			error.message ===
				'Unknown scenario: Counter\n\nAvailable scenarios:\n- blocks/button\n- counter\n\nPass a scenario ID or parent folder relative to config.paths.scenarios.'
	);

	assert.throws(
		() => selectScenariosByFilters( scenarios, [ 'missing', 'absent' ] ),
		( error: unknown ) =>
			error instanceof UserFacingError &&
			error.message.startsWith( 'Unknown scenarios: missing, absent' )
	);
} );
