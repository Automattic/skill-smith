import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const MD_LINK_RE = /\[(?:[^\]]*?)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Matches each `=== <rel-path> ===` section header emitted by {@link loadRubric}. */
const SECTION_HEADER_RE = /^=== (.+?) ===$/gm;

/**
 * Load a rubric's full text: the flat `<id>.md` entry file plus every
 * md-linked file under the rubrics root, verbatim. Output is a single
 * concatenated blob with `=== <rel-path> ===` headers per file, where
 * `<rel-path>` is relative to `rubricsRoot`. Cycles and external/absolute
 * links are ignored.
 *
 * @param id          - Rubric id; the entry file is `<rubricsRoot>/<id>.md`.
 * @param rubricsRoot - Absolute path to the directory holding rubric files.
 * @returns The concatenated rubric content with per-file section headers.
 * @throws  When `<rubricsRoot>/<id>.md` does not exist.
 */
export function loadRubric( id: string, rubricsRoot: string ): string {
	const entry = resolve( rubricsRoot, `${ id }.md` );
	if ( ! existsSync( entry ) ) {
		throw new Error(
			`Rubric file not found for rubric "${ id }" at ${ entry }`
		);
	}

	const visited = new Set< string >();
	const sections: string[] = [];

	const queue: string[] = [ entry ];
	while ( queue.length > 0 ) {
		const file = queue.shift();
		if ( file === undefined ) break;
		if ( visited.has( file ) ) continue;
		visited.add( file );
		if ( ! existsSync( file ) ) continue;
		if ( ! statSync( file ).isFile() ) continue;

		const text = readFileSync( file, 'utf8' );
		const rel = relative( rubricsRoot, file );
		sections.push( `=== ${ rel } ===\n${ text }` );

		// Enqueue links — only those resolving inside rubricsRoot.
		for ( const match of text.matchAll( MD_LINK_RE ) ) {
			const href = match[ 1 ];
			if ( href === undefined ) continue;
			if ( isExternal( href ) ) continue;
			const linkPath = isAbsolute( href )
				? href
				: resolve( dirname( file ), href );
			const fragmentless = linkPath.split( '#' )[ 0 ];
			if ( fragmentless === undefined ) continue;
			if ( ! isInside( rubricsRoot, fragmentless ) ) continue;
			queue.push( fragmentless );
		}
	}

	return sections.join( '\n\n' );
}

/**
 * Load every top-level `*.md` rubric under `rubricsRoot` into a single blob,
 * suitable for injection into the judge system prompt.
 *
 * Each top-level `*.md` file is loaded via {@link loadRubric} — so its in-tree
 * md-linked companions are expanded for free — and wrapped under a
 * self-identifying `# Rubric: <id>` header, where `<id>` is the filename
 * without its `.md` extension (the string an author references). The rubric
 * file's own H1 travels verbatim inside the body via `loadRubric`'s
 * `=== <rel-path> ===\n<text>` output. Files are sorted by filename ascending
 * before loading so the assembled blob is stable regardless of filesystem
 * enumeration order, and a companion that is itself also a top-level `*.md`
 * file is emitted only once (deduped by resolved path). An unreadable rubric
 * file is skipped rather than aborting the load.
 *
 * The `# Grading rubrics` heading and the selection lead-in line are the
 * caller's responsibility; this returns only the per-rubric blocks joined by
 * blank lines.
 *
 * @param rubricsRoot - Absolute path to the directory holding rubric files.
 * @returns The concatenated, G1-wrapped rubric blocks, or `undefined` when
 *          `rubricsRoot` does not exist or contains no top-level `*.md` files.
 */
export function loadAllRubrics( rubricsRoot: string ): string | undefined {
	if ( ! existsSync( rubricsRoot ) ) return undefined;

	const ids = readdirSync( rubricsRoot, { withFileTypes: true } )
		.filter( ( entry ) => entry.isFile() && entry.name.endsWith( '.md' ) )
		.map( ( entry ) => entry.name.slice( 0, -'.md'.length ) )
		.sort( ( a, b ) => ( a < b ? -1 : a > b ? 1 : 0 ) );

	if ( ids.length === 0 ) return undefined;

	const emitted = new Set< string >();
	const blocks: string[] = [];

	for ( const id of ids ) {
		const entry = resolve( rubricsRoot, `${ id }.md` );
		// A companion pulled in by an earlier rubric's md-link expansion may
		// itself be a top-level file — dedupe by resolved path so it is not
		// emitted twice.
		if ( emitted.has( entry ) ) continue;

		let body: string;
		try {
			body = loadRubric( id, rubricsRoot );
		} catch {
			// One unreadable rubric must not abort the whole load; skip it.
			continue;
		}

		// Record every resolved path this block emitted (the entry plus any
		// expanded companions) so later top-level files can be deduped.
		for ( const match of body.matchAll( SECTION_HEADER_RE ) ) {
			const rel = match[ 1 ];
			if ( rel === undefined ) continue;
			emitted.add( resolve( rubricsRoot, rel ) );
		}

		blocks.push( `# Rubric: ${ id }\n${ body }` );
	}

	if ( blocks.length === 0 ) return undefined;

	return blocks.join( '\n\n' );
}

function isExternal( href: string ): boolean {
	return (
		/^[a-z][a-z0-9+.-]*:/i.test( href ) ||
		href.startsWith( '//' ) ||
		href.startsWith( '#' ) ||
		href.startsWith( 'mailto:' )
	);
}

function isInside( parent: string, child: string ): boolean {
	const rel = relative( parent, child );
	return rel.length > 0 && ! rel.startsWith( '..' ) && ! isAbsolute( rel );
}
