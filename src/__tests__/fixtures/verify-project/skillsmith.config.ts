import { defineConfig } from '../../../index';

// Fixture for the verification gate. The judges always pass (the mock
// provider's default), but `afterAllScenarios` fails the first iteration
// — standing in for an e2e suite that breaks even though the artifact
// passed review. Iteration 2 verifies clean, so the loop converges.
export default defineConfig( {
	mode: 'self-improvement',
	agents: {
		tester: { provider: 'mock', model: 'mock' },
		grader: { provider: 'mock', model: 'mock' },
		improver: { provider: 'mock', model: 'mock' },
	},
	roles: {
		test: { agents: [ 'tester' ] },
		judge: 'grader',
		improver: 'improver',
	},
	paths: {
		base: './.skillsmith',
	},
	selfImprovement: {
		maxIterations: 3,
		scope: 'failed-scenarios',
	},
	hooks: {
		afterAllScenarios: ( { iteration } ) => {
			if ( iteration === 1 ) {
				return {
					failures: [
						{
							scenario: 'verify-scenario',
							details:
								'e2e suite failed even though the judge passed',
						},
					],
				};
			}
			return true;
		},
	},
} );
