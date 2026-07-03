/**
 * Shared fixture builders for the scenario-enumeration tests: a throwaway
 * project root with `scenarios/` and `skills/` directories, plus writers for
 * resolvable skills and two-file scenarios.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Paths } from '../../config/types';

/**
 * Paths pointing at the `scenarios/` and `skills/` roots that
 * {@link makeProject} lays out under the project root.
 */
export const TEST_PATHS: Paths = {
	base: '.',
	scenarios: 'scenarios',
	skills: 'skills',
};

/**
 * Create a temporary project root holding an empty `scenarios/` directory and
 * one resolvable skill (`counter`).
 *
 * Callers own cleanup: remove the returned directory with
 * `rmSync( root, { recursive: true, force: true } )` when the test ends.
 *
 * @return Absolute path of the new project root.
 */
export function makeProject(): string {
	const root = mkdtempSync( join( tmpdir(), 'skillsmith-scenarios-' ) );
	mkdirSync( join( root, 'scenarios' ), { recursive: true } );
	writeSkill( root, 'counter' );
	return root;
}

/**
 * Register a resolvable skill id under the project's skills root by writing a
 * minimal `SKILL.md` for it.
 *
 * @param root Project root created by {@link makeProject}.
 * @param id   Skill id; slashes become nested directories.
 */
export function writeSkill( root: string, id: string ): void {
	const dir = join( root, 'skills', ...id.split( '/' ) );
	mkdirSync( dir, { recursive: true } );
	writeFileSync( join( dir, 'SKILL.md' ), `# ${ id }\n` );
}

/**
 * Write a two-file scenario (`TESTING-AGENT.md` + `JUDGE.md`) at the given id
 * path under the project's scenarios root.
 *
 * @param root                 Project root created by {@link makeProject}.
 * @param id                   Scenario id; slashes become nested directories.
 * @param options              Optional content overrides.
 * @param options.skills       Skill ids listed in the generated testing
 *                             brief's `# Skills` section; defaults to
 *                             `[ 'counter' ]`. Ignored when `testingBrief`
 *                             is given.
 * @param options.testingBrief Full `TESTING-AGENT.md` content, written
 *                             verbatim instead of the generated brief.
 * @param options.judgeBrief   Full `JUDGE.md` content; defaults to a one-line
 *                             pass instruction.
 */
export function writeScenario(
	root: string,
	id: string,
	options: {
		skills?: string[];
		testingBrief?: string;
		judgeBrief?: string;
	} = {}
): void {
	const scenarioDir = join( root, 'scenarios', ...id.split( '/' ) );
	mkdirSync( scenarioDir, { recursive: true } );
	const skills = options.skills ?? [ 'counter' ];
	const testingBrief =
		options.testingBrief ??
		[
			'Run the scenario.',
			'',
			'# Skills',
			'',
			...skills.map( ( skill ) => `- ${ skill }` ),
			'',
		].join( '\n' );
	writeFileSync( join( scenarioDir, 'TESTING-AGENT.md' ), testingBrief );
	writeFileSync(
		join( scenarioDir, 'JUDGE.md' ),
		options.judgeBrief ?? 'Pass when the scenario succeeds.\n'
	);
}
