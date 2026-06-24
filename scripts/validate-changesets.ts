import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * One validation error emitted by {@link validateChangesetFile}.
 *
 * @property file - Changeset filename (without the `.changeset/` prefix), used
 *   by the CLI to render `.changeset/<file>:<line>: <msg>` lines on stderr.
 * @property line - Logical line number inside the changeset where the error
 *   was detected. Canonical values are `1` for a fence/structural error, `2`
 *   for a front-matter error, and `4` for a body error. The exact integers
 *   are stable contract so the stderr `:<n>:` separator always emits a
 *   non-empty positive integer.
 * @property msg - Human-readable error message. Substrings of this field are
 *   the assertion surface for the unit tests.
 */
export type Err = { file: string; line: number; msg: string };

/**
 * Bump types accepted in the front-matter map. `"none"` is required so the
 * starter changeset shipped by this bootstrap PR (and any future
 * "no-version-bump" entry) is valid; `changesets/action` at v1.4.0+ uses
 * `releases.length > 0` to detect non-empty changesets, so a `none`-bump
 * entry still triggers the Version Packages PR.
 */
const VALID = new Set( [ 'patch', 'minor', 'major', 'none' ] );

/**
 * Regex that splits a changeset into its front-matter and body sections.
 *
 * Anchored to `^---\r?\n` so the opening fence must be the very first line;
 * the closing fence is matched lazily so the body — which may itself contain
 * the literal `---` substring — is not consumed. The trailing
 * `(?:\r?\n)?---\r?\n?` permits both LF and CRLF line endings and tolerates
 * the absence of a trailing newline after the closing fence.
 *
 * Captures: `[1]` is the raw front matter (possibly empty); `[2]` is the
 * body (possibly empty).
 */
const FENCE_RE = /^---\r?\n([\s\S]*?)(?:\r?\n)?---\r?\n?([\s\S]*)$/;

/**
 * Validate one changeset file's contents.
 *
 * Pure function: no I/O, no `process.exit`. Returns the accumulated list of
 * errors. The caller is responsible for printing them and choosing an exit
 * code. The function is the unit-test contract; the CLI entry below merely
 * wires it to the filesystem.
 *
 * @param file - Changeset filename (without the `.changeset/` prefix); used
 *   only to populate `Err.file`.
 * @param raw - File contents as read from disk.
 * @param pkgName - Expected package name in the front-matter map (e.g.
 *   `"@automattic/skillsmith"`).
 * @param version - Current package version from `package.json`. If this
 *   starts with `"0."`, the pre-1.0 guard rejects `"major"` bumps.
 * @returns Array of {@link Err}; empty if the file is valid.
 *
 * @example
 *   validateChangesetFile("x.md", "---\n---\n", "@automattic/skillsmith", "0.1.0")
 *   // => []
 *
 * @example
 *   validateChangesetFile(
 *     "x.md",
 *     '---\n"@automattic/skillsmith": major\n---\n\nbody\n',
 *     "@automattic/skillsmith",
 *     "0.1.0",
 *   )
 *   // => [{ file: "x.md", line: 2, msg: "'major' is forbidden while pre-1.0 ..." }]
 */
export function validateChangesetFile(
	file: string,
	raw: string,
	pkgName: string,
	version: string
): Err[] {
	const errs: Err[] = [];
	const preRelease = String( version ).startsWith( '0.' );

	const match = raw.match( FENCE_RE );
	if ( ! match ) {
		errs.push( {
			file,
			line: 1,
			msg: "missing or unterminated front matter (expected two '---' fences)",
		} );
		return errs;
	}

	const fmRaw = match[ 1 ] ?? '';
	const body = match[ 2 ] ?? '';

	// R-shape-2: the canonical empty form `---\n---\n` is the documented
	// contributor escape hatch and must pass.
	if ( fmRaw.trim() === '' && body.trim() === '' ) {
		return errs;
	}

	// R-shape-3: a changeset with front matter MUST have a non-empty body.
	if ( body.trim() === '' ) {
		errs.push( {
			file,
			line: 4,
			msg: 'empty body (changeset has front matter but no summary)',
		} );
	}

	let fm: unknown;
	try {
		fm = parseYaml( fmRaw );
	} catch ( e ) {
		errs.push( {
			file,
			line: 2,
			msg: `YAML parse error: ${ ( e as Error ).message }`,
		} );
		return errs;
	}

	if ( fm === null || typeof fm !== 'object' ) {
		errs.push( {
			file,
			line: 2,
			msg: 'front matter must be a YAML mapping of package name to bump',
		} );
		return errs;
	}

	for ( const [ name, bump ] of Object.entries(
		fm as Record< string, unknown >
	) ) {
		if ( name !== pkgName ) {
			errs.push( {
				file,
				line: 2,
				msg: `unknown package "${ name }" (expected "${ pkgName }")`,
			} );
		}
		if ( typeof bump !== 'string' || ! VALID.has( bump ) ) {
			errs.push( {
				file,
				line: 2,
				msg: `invalid bump "${ String( bump ) }" (expected one of patch, minor, major, none)`,
			} );
		} else if ( preRelease && bump === 'major' ) {
			errs.push( {
				file,
				line: 2,
				msg: `'major' is forbidden while pre-1.0 (version=${ version }). Use 'minor' with a 'BREAKING:' prefix; see CONTRIBUTING.md#pre-10-policy.`,
			} );
		}
	}

	return errs;
}

/**
 * CLI entry point. Reads `package.json` from the current working directory,
 * enumerates every `.md` file in `./.changeset/` (excluding `README.md`),
 * runs {@link validateChangesetFile} on each, and prints any errors to
 * stderr as `\`.changeset/<file>:<line>: <msg>\\n\`` lines.
 *
 * @returns Process exit code: `0` if every changeset is valid, `1` if at
 *   least one error was emitted. Never throws on validation errors — only
 *   on filesystem/JSON failures the caller is expected to surface.
 */
export function main(): number {
	const pkg = JSON.parse( readFileSync( 'package.json', 'utf8' ) ) as {
		name: string;
		version: string;
	};
	const files = readdirSync( '.changeset' ).filter(
		( n ) => n.endsWith( '.md' ) && n !== 'README.md'
	);
	const errors: Err[] = [];
	for ( const f of files ) {
		const raw = readFileSync( `.changeset/${ f }`, 'utf8' );
		errors.push(
			...validateChangesetFile( f, raw, pkg.name, pkg.version )
		);
	}
	if ( errors.length === 0 ) {
		return 0;
	}
	for ( const e of errors ) {
		process.stderr.write(
			`.changeset/${ e.file }:${ e.line }: ${ e.msg }\n`
		);
	}
	return 1;
}

if ( import.meta.url === pathToFileURL( process.argv[ 1 ] ?? '' ).href ) {
	process.exit( main() );
}
