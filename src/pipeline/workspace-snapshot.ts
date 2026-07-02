import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';

/**
 * Metadata recorded for a single file in a workspace snapshot. Holds
 * only the values needed to detect a write without reading file
 * contents.
 */
export interface FileEntry {
	/** Last-modified time in milliseconds, from `fs.Stats.mtimeMs`. */
	mtimeMs: number;
	/** File size in bytes, from `fs.Stats.size`. */
	size: number;
}

/**
 * Recursively record metadata for every file under `root`. The returned
 * map is keyed by each file's path relative to `root`, with
 * `{ mtimeMs, size }` metadata only — file contents are never read.
 * Unreadable directories and unstattable entries are skipped, so a
 * missing or empty `root` yields an empty map rather than throwing.
 *
 * @param root - Absolute path of the workspace to snapshot.
 * @returns A map from relative path to its {@link FileEntry} metadata.
 */
export function snapshotWorkspace( root: string ): Map< string, FileEntry > {
	const out = new Map< string, FileEntry >();
	walk( root, root, out );
	return out;
}

/**
 * Depth-first helper that populates `out` with the metadata of every
 * file reachable from `dir`, keying each entry by its path relative to
 * `root`. Directories that cannot be read and entries that cannot be
 * stat'd are skipped silently.
 *
 * @param root - The snapshot root that relative keys are computed against.
 * @param dir - The directory currently being walked.
 * @param out - The accumulator map to populate in place.
 */
function walk(
	root: string,
	dir: string,
	out: Map< string, FileEntry >
): void {
	let entries: string[];
	try {
		entries = readdirSync( dir );
	} catch {
		return;
	}
	for ( const name of entries ) {
		const full = join( dir, name );
		let s: ReturnType< typeof statSync >;
		try {
			s = statSync( full );
		} catch {
			continue;
		}
		if ( s.isDirectory() ) {
			walk( root, full, out );
		} else if ( s.isFile() ) {
			const rel = relative( root, full );
			out.set( rel, { mtimeMs: s.mtimeMs, size: s.size } );
		}
	}
}

/**
 * Compare two workspace snapshots and return the relative paths of every
 * file that was added or modified between `before` and `after`. A file
 * counts as written when it is absent from `before`, or when its
 * `mtimeMs` or `size` differs. Deletions are not reported. The result is
 * sorted lexicographically.
 *
 * @param before - Snapshot taken before the workspace was touched.
 * @param after - Snapshot taken after the workspace was touched.
 * @returns The sorted relative paths of added or modified files.
 */
export function diffSnapshots(
	before: Map< string, FileEntry >,
	after: Map< string, FileEntry >
): string[] {
	const written: string[] = [];
	for ( const [ rel, post ] of after ) {
		const pre = before.get( rel );
		if (
			pre === undefined ||
			pre.mtimeMs !== post.mtimeMs ||
			pre.size !== post.size
		) {
			written.push( rel );
		}
	}
	return written.sort();
}

/**
 * Rendering options for {@link inlineWorkspaceFiles}, letting each caller
 * keep its exact prompt shape while sharing one block builder.
 */
export interface InlineWorkspaceFilesOptions {
	/** String the per-file blocks are joined with, e.g. `'\n'` or `'\n\n'`. */
	separator: string;
	/** Text returned verbatim when no file produces a block. */
	emptyFallback: string;
	/**
	 * When `true`, paths that do not exist on disk are skipped silently.
	 * When `false`, every path is read, so a vanished file surfaces as a
	 * block whose body is the `<read error: …>` placeholder.
	 */
	skipMissing: boolean;
}

/**
 * Inline workspace files into prompt text: each relative path becomes a
 * `=== <rel> ===\n<body>` block with the file's contents read from
 * `workspace`, and the blocks are joined with `options.separator` in the
 * order given. A file that exists but cannot be read keeps its block with
 * a `<read error: <message>>` body. When no block is produced — an empty
 * path list, or every path skipped — `options.emptyFallback` is returned
 * instead.
 *
 * @param workspace - Absolute workspace path the relative paths resolve
 *   against.
 * @param relPaths - Workspace-relative file paths to inline, in output
 *   order.
 * @param options - Separator, empty fallback, and missing-file handling.
 * @returns The joined blocks, or `options.emptyFallback` when there are
 *   none.
 *
 * @example
 * inlineWorkspaceFiles( '/ws', [ 'a.txt' ], {
 * 	separator: '\n\n',
 * 	emptyFallback: '(empty workspace)',
 * 	skipMissing: false,
 * } );
 * // => '=== a.txt ===\n<contents of /ws/a.txt>'
 */
export function inlineWorkspaceFiles(
	workspace: string,
	relPaths: string[],
	options: InlineWorkspaceFilesOptions
): string {
	const sections: string[] = [];
	for ( const rel of relPaths ) {
		const full = join( workspace, rel );
		if ( options.skipMissing && ! existsSync( full ) ) continue;
		let body: string;
		try {
			body = readFileSync( full, 'utf8' );
		} catch ( err ) {
			body = `<read error: ${ err instanceof Error ? err.message : String( err ) }>`;
		}
		sections.push( `=== ${ rel } ===\n${ body }` );
	}
	if ( sections.length === 0 ) return options.emptyFallback;
	return sections.join( options.separator );
}

/**
 * Recursively copy the canonical workspace to an isolated sibling
 * directory so the judge can run against its own copy without touching
 * the original. The destination's parent directory is created if it does
 * not already exist, and an empty source produces an empty destination
 * directory rather than an error. The source is never modified.
 *
 * @param canonicalWorkspace - Absolute path of the workspace to copy from.
 * @param judgeWorkspace - Absolute path of the isolated copy to create.
 */
export function copyWorkspaceForJudge(
	canonicalWorkspace: string,
	judgeWorkspace: string
): void {
	mkdirSync( dirname( judgeWorkspace ), { recursive: true } );
	cpSync( canonicalWorkspace, judgeWorkspace, { recursive: true } );
}
