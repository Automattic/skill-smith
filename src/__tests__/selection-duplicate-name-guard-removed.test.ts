import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Scenario } from '../config/types';
import type { EnumeratedScenario } from '../scenarios/enumerate';
import * as selection from '../scenarios/selection';
import { selectScenariosByFilters } from '../scenarios/selection';

function enumerated( id: string ): EnumeratedScenario {
	const scenario: Scenario = {
		name: id,
		skills: [],
		testingBrief: '',
		judgeBrief: '',
	};
	return { id, dirName: id, scenario };
}

test( 'selection no longer exports the duplicate-name guard', () => {
	assert.equal(
		'validateConfiguredScenarioNamesAreUnique' in selection,
		false
	);
} );

test( 'sibling scenarios with distinct ids both select with no duplicate-name path', () => {
	const scenarios = [
		enumerated( 'blocks/counter' ),
		enumerated( 'blocks-old/counter' ),
	];

	const selected = selectScenariosByFilters( scenarios, undefined ).map(
		( scenario ) => scenario.id
	);

	assert.deepEqual( selected, [ 'blocks-old/counter', 'blocks/counter' ] );
} );
