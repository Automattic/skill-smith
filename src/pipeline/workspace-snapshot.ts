import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
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
