import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { JudgeCapabilities } from '../providers/types';
import {
	copyWorkspaceForJudge,
	inlineWorkspaceFiles,
	snapshotWorkspace,
} from './workspace-snapshot';

/**
 * Name of the per-pair library copy created inside the judge workspace,
 * and the prefix every prompt-facing library path carries
 * (`judge-library/<rel>`).
 */
const JUDGE_LIBRARY_DIR = 'judge-library';

/**
 * Lead-in that opens the mounted-mode manifest: it names the
 * `judge-library/` directory in the judge's working directory and
 * introduces the sorted file list that follows.
 */
const MANIFEST_LEAD_IN = [
	`The ${ JUDGE_LIBRARY_DIR }/ directory in your working directory holds`,
	"this project's judge library — reference material supplied for",
	'grading. It contains the following files:',
].join( '\n' );

/**
 * Lead-in that opens the inline-mode block list: because the judge has
 * no file-reading tool, every library file body is inlined into the
 * prompt, each under a `=== judge-library/<rel> ===` label.
 */
const INLINE_LEAD_IN = [
	"This project's judge library — reference material supplied for",
	'grading — is inlined below, each file under its',
	`=== ${ JUDGE_LIBRARY_DIR }/<path> === label.`,
].join( '\n' );

/**
 * The selection instruction closing the library section: only the
 * library items the scenario's brief names may be applied; everything
 * else is reference-only material that must not sway the verdict.
 */
const SELECTION_INSTRUCTION = [
	"Apply ONLY the library items this scenario's brief names; the rest",
	'is reference-only material and must not affect the verdict.',
].join( '\n' );

/**
 * The prompt section produced for a non-empty judge library, plus the
 * supply mode it was built for.
 */
export type JudgeLibrarySection = {
	/**
	 * The complete `# Judge library` prompt section, heading included,
	 * ready to be appended verbatim to the judge system prompt.
	 */
	text: string;
	/**
	 * How the library reaches the judge: `'mounted'` announces the
	 * on-disk copy via a sorted manifest of `judge-library/<rel>` paths;
	 * `'inline'` embeds every file body in the section because the judge
	 * has no file-reading tool. The on-disk copy exists in both modes.
	 */
	mode: 'mounted' | 'inline';
};

/**
 * Inputs for {@link prepareJudgeLibrary}, describing where the library
 * lives, where the judge runs, and what the judge is allowed to do.
 */
export interface PrepareJudgeLibraryOptions {
	/** Absolute project root that `libraryPath` resolves against. */
	projectRoot: string;
	/**
	 * The configured judge-library directory (`roles.judge.library`), as
	 * a project-relative path.
	 */
	libraryPath: string;
	/**
	 * Absolute path of the judge's working directory. The library is
	 * copied to a `judge-library/` entry directly inside it.
	 */
	judgeWorkspace: string;
	/**
	 * The judge's capability descriptor. Its `tools` array decides the
	 * supply mode: an explicit array containing neither `'Read'` nor
	 * `'Bash'` (including `[]`) marks the judge tool-less and selects
	 * inline mode; any other shape — `tools` unset, or an array carrying
	 * either file-capable tool — selects mounted mode.
	 */
	capabilities: JudgeCapabilities;
}

/**
 * Prepare the judge library for one (scenario, agent) pair: copy the
 * configured library directory into the judge workspace and build the
 * `# Judge library` prompt section that announces it.
 *
 * The disk contract is mode-independent. For a non-empty library, the
 * whole directory (`README.md` included — a faithful mirror) is copied
 * to `<judgeWorkspace>/judge-library/` in both supply modes, guarded by
 * a collision check: a pre-existing top-level `judge-library` entry in
 * the workspace throws rather than silently merging. The mode shapes
 * only the section text.
 *
 * The returned section carries, in order: the `# Judge library`
 * heading; the library's `README.md` body inlined verbatim as the
 * environment manual (omitted when the file is absent); the sorted
 * manifest of `judge-library/<rel>` paths (mounted mode) or every file
 * body as a `judge-library/<rel>`-labelled block (inline mode, where
 * the README body therefore appears twice); and the selection
 * instruction restricting the verdict to brief-named items.
 *
 * @param opts - Library location, judge workspace, and capabilities.
 * @returns The prompt section and its mode, or `undefined` when the
 *   resolved library contains no files at all — no section is emitted
 *   and no copy is made.
 * @throws When the judge workspace already contains a top-level
 *   `judge-library` entry, or when the copy itself fails.
 */
export function prepareJudgeLibrary(
	opts: PrepareJudgeLibraryOptions
): JudgeLibrarySection | undefined {
	const libraryRoot = resolve( opts.projectRoot, opts.libraryPath );
	if ( snapshotWorkspace( libraryRoot ).size === 0 ) return undefined;

	const destination = join( opts.judgeWorkspace, JUDGE_LIBRARY_DIR );
	if ( existsSync( destination ) ) {
		throw new Error(
			`cannot copy the judge library: the judge workspace already contains a top-level '${ JUDGE_LIBRARY_DIR }' entry (${ destination })`
		);
	}
	copyWorkspaceForJudge( libraryRoot, destination );

	const relPaths = [ ...snapshotWorkspace( destination ).keys() ]
		.map( ( rel ) => rel.split( sep ).join( '/' ) )
		.sort();

	const mode = isToolLess( opts.capabilities ) ? 'inline' : 'mounted';
	const sections = [ '# Judge library' ];
	const readme = join( destination, 'README.md' );
	if ( existsSync( readme ) ) {
		sections.push( readFileSync( readme, 'utf8' ) );
	}
	sections.push(
		mode === 'mounted'
			? buildManifest( relPaths )
			: buildInlineBodies( opts.judgeWorkspace, relPaths )
	);
	sections.push( SELECTION_INSTRUCTION );
	return { text: sections.join( '\n\n' ), mode };
}

/**
 * Decide whether the judge is tool-less: `capabilities.tools` is an
 * explicit array containing neither `'Read'` nor `'Bash'` — the two
 * file-capable tool names — including the empty array. An unset `tools`
 * is never tool-less, because provider defaults always include file
 * reading.
 *
 * @param capabilities - The judge's capability descriptor.
 * @returns `true` when the judge cannot read files from disk.
 */
function isToolLess( capabilities: JudgeCapabilities ): boolean {
	const { tools } = capabilities;
	if ( ! Array.isArray( tools ) ) return false;
	return ! tools.includes( 'Read' ) && ! tools.includes( 'Bash' );
}

/**
 * Build the mounted-mode manifest: the fixed lead-in naming
 * `judge-library/` in the judge's working directory, followed by one
 * `judge-library/<rel>` line per library file, in the sorted order
 * given.
 *
 * @param relPaths - Sorted `/`-joined paths relative to the library root.
 * @returns The manifest text.
 */
function buildManifest( relPaths: string[] ): string {
	return [
		MANIFEST_LEAD_IN,
		...relPaths.map( ( rel ) => `${ JUDGE_LIBRARY_DIR }/${ rel }` ),
	].join( '\n' );
}

/**
 * Build the inline-mode block list for a tool-less judge: the inline
 * lead-in followed by every library file's body under a
 * `=== judge-library/<rel> ===` label, read from the per-pair copy so
 * the prompt matches what is on disk.
 *
 * @param judgeWorkspace - The judge workspace holding the library copy.
 * @param relPaths - Sorted `/`-joined paths relative to the library root.
 * @returns The lead-in plus the labelled file bodies.
 */
function buildInlineBodies(
	judgeWorkspace: string,
	relPaths: string[]
): string {
	const blocks = inlineWorkspaceFiles(
		judgeWorkspace,
		relPaths.map( ( rel ) => `${ JUDGE_LIBRARY_DIR }/${ rel }` ),
		{ separator: '\n\n', emptyFallback: '', skipMissing: false }
	);
	return `${ INLINE_LEAD_IN }\n\n${ blocks }`;
}
