import { defineConfig } from '../../../index';

export default defineConfig( {
	mode: 'test-only',
	agents: {
		haiku: { provider: 'mock', model: 'claude-haiku-4-5-20251001' },
		sonnet: { provider: 'mock', model: 'claude-sonnet-4-6' },
		opus: { provider: 'mock', model: 'claude-opus-4-7' },
	},
	roles: {
		test: { agents: [ 'haiku', 'sonnet' ] },
		judge: 'opus',
		improver: 'opus',
	},
	paths: {
		base: './.skillsmith',
	},
	hooks: {
		afterAllScenarios: ( { scenarios } ) => {
			const [ scenario ] = scenarios;
			if ( scenario === undefined ) {
				throw new Error( 'expected one run scenario' );
			}
			if ( scenario.id !== 'hello' ) {
				throw new Error( `expected scenario.id, got ${ scenario.id }` );
			}
			if ( scenario.dirName !== scenario.id ) {
				throw new Error(
					'expected scenario.dirName to match scenario.id'
				);
			}
			// The public RunScenario hook surface is exactly { id, dirName,
			// scenario }. It must not leak the enumeration-only `nameSource`
			// flag.
			const keys = Object.keys( scenario ).sort();
			if ( keys.join( ',' ) !== 'dirName,id,scenario' ) {
				throw new Error(
					`RunScenario must expose only id, dirName, scenario; got ${ keys.join(
						', '
					) }`
				);
			}
			if ( 'nameSource' in scenario ) {
				throw new Error( 'RunScenario must not expose nameSource' );
			}
			// The scenario record carries the two-file model fields and must
			// not carry the removed Scenario fields.
			for ( const removed of [
				'description',
				'prompt',
				'acceptance',
				'rubrics',
			] ) {
				if ( removed in scenario.scenario ) {
					throw new Error(
						`Scenario must not carry the removed field "${ removed }"`
					);
				}
			}
		},
	},
} );
