import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const MD_LINK_RE = /\[(?:[^\]]*?)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * Load a skill's full text: SKILL.md plus every md-linked file under
 * the skill directory, verbatim. Output is a single concatenated blob
 * with `=== <skill-id>/<rel-path> ===` headers per file. Cycles and
 * external/absolute links are ignored.
 */
export function loadSkill( skillId: string, skillsRoot: string ): string {
	const skillDir = resolve( skillsRoot, skillId );
	const entry = resolve( skillDir, 'SKILL.md' );
	if ( ! existsSync( entry ) ) {
		throw new Error(
			`SKILL.md not found for skill "${ skillId }" at ${ entry }`
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
		const rel = relative( skillsRoot, file );
		sections.push( `=== ${ rel } ===\n${ text }` );

		// Enqueue links — only those resolving inside skillDir.
		for ( const match of text.matchAll( MD_LINK_RE ) ) {
			const href = match[ 1 ];
			if ( href === undefined ) continue;
			if ( isExternal( href ) ) continue;
			const linkPath = isAbsolute( href )
				? href
				: resolve( dirname( file ), href );
			const fragmentless = linkPath.split( '#' )[ 0 ];
			if ( fragmentless === undefined ) continue;
			if ( ! isInside( skillDir, fragmentless ) ) continue;
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
