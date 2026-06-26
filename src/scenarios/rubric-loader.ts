import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const MD_LINK_RE = /\[(?:[^\]]*?)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

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
