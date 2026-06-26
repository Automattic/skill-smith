import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Paths, Scenario } from '../config/types';

/** Filename of the testing brief that, together with {@link JUDGE_BRIEF_FILE}, marks a directory as a scenario. */
const TESTING_BRIEF_FILE = 'TESTING-AGENT.md';
/** Filename of the judge brief that, together with {@link TESTING_BRIEF_FILE}, marks a directory as a scenario. */
const JUDGE_BRIEF_FILE = 'JUDGE.md';

/** Matches a heading line, capturing its depth (`#` run) and trailing text. */
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
/** Matches the heading text of the `# Skills` section (case-insensitive). */
const SKILLS_HEADING_RE = /^Skills$/i;
/** Matches a list item, capturing its content. */
const LIST_ITEM_RE = /^\s*[-*]\s+(.+?)\s*$/;
/** Matches a Markdown link, capturing its link text. */
const SKILL_LINK_RE = /^\[([^\]]*)\]\([^)]*\)$/;

/**
 * Extract skill ids from the `# Skills` section of a testing brief.
 *
 * The first heading whose text is exactly `Skills` (case-insensitive, any
 * heading depth) opens the section. Lines are collected until the next
 * heading of the same-or-shallower depth, or end of input; deeper
 * sub-headings stay inside the section. Within the collected block, only
 * Markdown list items contribute ids — each is unwrapped from surrounding
 * backticks and from a `[id](...)` link, then trimmed. Prose and blank
 * lines are ignored.
 *
 * @param testingBrief - Raw brief text. `\r\n` and `\r` line endings are
 *   normalized before matching.
 * @returns The ordered skill ids, `[]` when the section exists but holds no
 *   list items, or `undefined` when the brief has no `# Skills` heading.
 *
 * @example
 * parseSkillsSection( '# Skills\n- wp-interactivity-api' );
 * // => [ 'wp-interactivity-api' ]
 * @example
 * parseSkillsSection( '# Overview\n' ); // => undefined (absent)
 */
export function parseSkillsSection(
	testingBrief: string
): string[] | undefined {
	const lines = testingBrief.replace( /\r\n?/g, '\n' ).split( '\n' );

	let depth: number | undefined;
	let start = -1;
	for ( let i = 0; i < lines.length; i++ ) {
		const heading = HEADING_RE.exec( lines[ i ] ?? '' );
		if ( heading && SKILLS_HEADING_RE.test( heading[ 2 ] ?? '' ) ) {
			depth = heading[ 1 ]?.length;
			start = i + 1;
			break;
		}
	}

	if ( depth === undefined ) return undefined;

	const ids: string[] = [];
	for ( let i = start; i < lines.length; i++ ) {
		const line = lines[ i ] ?? '';
		const heading = HEADING_RE.exec( line );
		if ( heading && ( heading[ 1 ]?.length ?? 0 ) <= depth ) break;

		const item = LIST_ITEM_RE.exec( line );
		if ( item ) ids.push( normalizeSkillId( item[ 1 ] ?? '' ) );
	}

	return ids;
}

/** Strip surrounding backticks and unwrap a Markdown link to a bare id. */
function normalizeSkillId( raw: string ): string {
	let id = raw.trim();
	if ( id.startsWith( '`' ) && id.endsWith( '`' ) && id.length >= 2 ) {
		id = id.slice( 1, -1 ).trim();
	}
	const link = SKILL_LINK_RE.exec( id );
	if ( link ) id = ( link[ 1 ] ?? '' ).trim();
	return id;
}

/**
 * Scenario record produced by filesystem enumeration before run selection.
 *
 * Every discovered scenario directory yields exactly one of these — including
 * directories that fail enumeration validation, which carry an {@link error}
 * and a minimal stub {@link scenario}. Errored entries survive selection so
 * they can be reported as skipped rather than silently dropped.
 */
export interface EnumeratedScenario {
	/**
	 * Parsed scenario definition. For a valid scenario this holds both briefs
	 * read verbatim and the skills parsed from `# Skills`. For an errored
	 * scenario this is a stub carrying whatever briefs were readable (or empty
	 * strings), `name` equal to {@link id}, and an empty `skills` list.
	 */
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
	/** Enumeration-time validation error, if the scenario cannot run as-is. */
	error?: string;
}

/**
 * Walk `paths.scenarios` recursively and discover scenarios by the two-file
 * model: a directory is a scenario iff it contains both a testing brief
 * (`TESTING-AGENT.md`) and a judge brief (`JUDGE.md`). Both briefs are read
 * verbatim, and the testing brief's `# Skills` section is parsed and validated
 * against `paths.skills/`.
 *
 * A directory with neither brief is not a scenario; enumeration keeps walking
 * its children so grouping folders may nest scenarios. A directory with exactly
 * one of the two briefs is an errored scenario whose `error` names the missing
 * file.
 *
 * Enumeration never throws. Validation problems (a missing brief, an absent
 * `# Skills` section, or unresolved skill references) are reported as a
 * per-scenario `error` string; valid scenarios alongside an errored one are
 * still returned. Results are sorted by {@link EnumeratedScenario.id}.
 *
 * @param paths - Resolved config paths; `scenarios` and `skills` are joined
 *   under `projectRoot`.
 * @param projectRoot - Absolute root the paths resolve against.
 * @returns Every discovered scenario, errored or not, sorted by `id`.
 */
export function enumerateScenarios(
	paths: Paths,
	projectRoot: string
): EnumeratedScenario[] {
	const scenariosRoot = join( projectRoot, paths.scenarios );
	const skillsRoot = join( projectRoot, paths.skills );

	const out: EnumeratedScenario[] = [];

	if ( ! existsSync( scenariosRoot ) ) return out;

	function visit( dir: string, segments: string[] ): void {
		const id = segments.join( '/' );
		const testingPath = join( dir, TESTING_BRIEF_FILE );
		const judgePath = join( dir, JUDGE_BRIEF_FILE );
		const hasTesting = existsSync( testingPath );
		const hasJudge = existsSync( judgePath );

		if ( hasTesting || hasJudge ) {
			const testingBrief = hasTesting
				? readFileSync( testingPath, 'utf8' )
				: '';
			const judgeBrief = hasJudge
				? readFileSync( judgePath, 'utf8' )
				: '';

			if ( hasTesting && hasJudge ) {
				out.push( scenarioFromBriefs( id, testingBrief, judgeBrief, skillsRoot ) );
			} else {
				const missingFile = hasTesting
					? JUDGE_BRIEF_FILE
					: TESTING_BRIEF_FILE;
				out.push( {
					scenario: stubScenario( id, testingBrief, judgeBrief ),
					id,
					dirName: id,
					error: `missing required file: ${ missingFile }`,
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

/**
 * Build an {@link EnumeratedScenario} from a scenario directory that has both
 * briefs. Parses `# Skills` from the testing brief and validates each id
 * against `<skillsRoot>/<id>/SKILL.md`, concatenating a missing-section and any
 * unresolved-reference problems into a single `error` string.
 *
 * @param id - Normalized scenario id (slash-joined path segments).
 * @param testingBrief - Raw testing brief contents.
 * @param judgeBrief - Raw judge brief contents.
 * @param skillsRoot - Absolute path skill references resolve against.
 * @returns A runnable scenario, or one carrying a validation `error`.
 */
function scenarioFromBriefs(
	id: string,
	testingBrief: string,
	judgeBrief: string,
	skillsRoot: string
): EnumeratedScenario {
	const parsedSkills = parseSkillsSection( testingBrief );
	const skills = parsedSkills ?? [];

	const problems: string[] = [];
	if ( parsedSkills === undefined ) {
		problems.push(
			`missing required # Skills section in ${ TESTING_BRIEF_FILE }`
		);
	}

	const missing = skills.filter(
		( skill ) => ! existsSync( join( skillsRoot, skill, 'SKILL.md' ) )
	);
	if ( missing.length > 0 ) {
		problems.push(
			`unresolved reference: ${ missing
				.map( ( skill ) => `skill "${ skill }"` )
				.join( ', ' ) }`
		);
	}

	const scenario: Scenario = {
		name: id,
		skills,
		testingBrief,
		judgeBrief,
	};

	if ( problems.length === 0 ) {
		return { scenario, id, dirName: id };
	}
	return { scenario, id, dirName: id, error: problems.join( '; ' ) };
}

/**
 * Build a minimal stub scenario for a directory that failed enumeration. Its
 * `name` equals the scenario id, `skills` is empty, and the briefs hold
 * whatever was readable (empty strings for a missing file).
 *
 * @param id - Normalized scenario id used as the stub `name`.
 * @param testingBrief - Readable testing brief, or `''` when absent.
 * @param judgeBrief - Readable judge brief, or `''` when absent.
 * @returns A stub {@link Scenario} safe to carry through selection.
 */
function stubScenario(
	id: string,
	testingBrief: string,
	judgeBrief: string
): Scenario {
	return {
		name: id,
		skills: [],
		testingBrief,
		judgeBrief,
	};
}
