/**
 * Filesystem and shell tools exposed to Vercel-AI-SDK-backed providers.
 *
 * Every tool's `execute` callback is closed over `cwd` and refuses any path
 * that escapes that directory (a hard jail, not a prompt rule). `Bash` runs
 * with the harness's own privileges — no container, no sandbox. Acceptable
 * for the testing-project workspace; never wire this in front of arbitrary
 * untrusted code. For that, route through the `codex` provider, which has a
 * real sandbox.
 *
 * Tool names match `src/providers/claude-code.ts:5` exactly so that
 * `toolUseCount` semantics stay consistent across providers.
 *
 * Error handling: every `execute` throws on failure. The Vercel AI SDK
 * converts the thrown error into a `tool-error` content part on the next
 * step so the model can react (retry, give up, etc.). Do not catch and
 * return strings — that would look like success to the model.
 */
import { execSync } from 'node:child_process';
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import {
	dirname,
	isAbsolute,
	join,
	matchesGlob,
	relative,
	resolve,
	sep,
} from 'node:path';
import { type Tool, tool } from 'ai';
import { z } from 'zod';
import type { Role } from '../types';

const GLOB_RESULT_CAP = 500;
const GREP_LINE_CAP = 200;
const BASH_DEFAULT_TIMEOUT_MS = 60_000;
const BASH_MAX_BUFFER_BYTES = 10 << 20;

const SKIP_DIRECTORIES = new Set( [ '.git', 'node_modules' ] );

function resolveInside( cwd: string, p: string ): string {
	const abs = resolve( cwd, p );
	const rel = relative( cwd, abs );
	if ( rel === '' ) return abs;
	if ( rel.startsWith( '..' ) || isAbsolute( rel ) ) {
		throw new Error( `path escapes workspace: ${ p }` );
	}
	return abs;
}

function walk(
	cwd: string,
	visit: ( relPath: string, absPath: string, mtimeMs: number ) => boolean
): void {
	const stack: string[] = [ cwd ];
	while ( stack.length > 0 ) {
		const dir = stack.pop();
		if ( dir === undefined ) break;
		let entries: Array< {
			name: string;
			isDirectory(): boolean;
			isFile(): boolean;
		} >;
		try {
			entries = readdirSync( dir, {
				withFileTypes: true,
				encoding: 'utf8',
			} );
		} catch {
			continue;
		}
		for ( const entry of entries ) {
			const abs = join( dir, entry.name );
			if ( entry.isDirectory() ) {
				if ( SKIP_DIRECTORIES.has( entry.name ) ) continue;
				stack.push( abs );
				continue;
			}
			if ( ! entry.isFile() ) continue;
			let mtimeMs = 0;
			try {
				mtimeMs = statSync( abs ).mtimeMs;
			} catch {
				continue;
			}
			const rel = relative( cwd, abs ).split( sep ).join( '/' );
			const keepGoing = visit( rel, abs, mtimeMs );
			if ( ! keepGoing ) return;
		}
	}
}

export type FsToolSet = Record< string, Tool >;

export function fsTools( cwd: string, role: Role ): FsToolSet {
	const Read = tool( {
		description:
			'Read a UTF-8 text file inside the workspace. Path is relative to the workspace root.',
		inputSchema: z.object( {
			path: z.string().describe( 'Path relative to the workspace root.' ),
		} ),
		execute: ( { path } ) => {
			const abs = resolveInside( cwd, path );
			return readFileSync( abs, 'utf8' );
		},
	} );

	const Write = tool( {
		description:
			'Write a UTF-8 text file inside the workspace, creating parent directories as needed. Overwrites existing files.',
		inputSchema: z.object( {
			path: z.string().describe( 'Path relative to the workspace root.' ),
			contents: z.string().describe( 'Full file contents to write.' ),
		} ),
		execute: ( { path, contents } ) => {
			const abs = resolveInside( cwd, path );
			mkdirSync( dirname( abs ), { recursive: true } );
			writeFileSync( abs, contents, 'utf8' );
			return 'ok';
		},
	} );

	const Edit = tool( {
		description:
			'Replace the first occurrence of `old` with `new` in a file. The match must be exact and unique; otherwise the call errors and you should retry with a more specific `old` snippet.',
		inputSchema: z.object( {
			path: z.string().describe( 'Path relative to the workspace root.' ),
			old: z.string().describe( 'Exact text to find.' ),
			new: z.string().describe( 'Replacement text.' ),
		} ),
		execute: ( { path, old, new: replacement } ) => {
			if ( old === replacement ) {
				throw new Error( 'no-op edit: old and new are identical' );
			}
			const abs = resolveInside( cwd, path );
			const original = readFileSync( abs, 'utf8' );
			const first = original.indexOf( old );
			if ( first === -1 ) {
				throw new Error( `Edit: pattern not found in ${ path }` );
			}
			const second = original.indexOf( old, first + old.length );
			if ( second !== -1 ) {
				throw new Error(
					`Edit: pattern is ambiguous in ${ path } (found at multiple offsets). Provide a longer, unique snippet for "old".`
				);
			}
			const next =
				original.slice( 0, first ) +
				replacement +
				original.slice( first + old.length );
			writeFileSync( abs, next, 'utf8' );
			return 'ok';
		},
	} );

	const Glob = tool( {
		description: `Find files matching a glob pattern (e.g. "**/*.ts"). Returns up to ${ GLOB_RESULT_CAP } relative paths sorted by mtime descending.`,
		inputSchema: z.object( {
			pattern: z
				.string()
				.describe( 'Glob pattern (e.g. "src/**/*.ts").' ),
		} ),
		execute: ( { pattern } ) => {
			const hits: Array< { rel: string; mtimeMs: number } > = [];
			let truncated = false;
			walk( cwd, ( rel, _abs, mtimeMs ) => {
				if ( ! matchesGlob( rel, pattern ) ) return true;
				hits.push( { rel, mtimeMs } );
				if ( hits.length > GLOB_RESULT_CAP ) {
					truncated = true;
					return false;
				}
				return true;
			} );
			hits.sort( ( a, b ) => b.mtimeMs - a.mtimeMs );
			const capped = hits
				.slice( 0, GLOB_RESULT_CAP )
				.map( ( h ) => h.rel );
			if ( truncated ) {
				capped.push(
					`... (result truncated at ${ GLOB_RESULT_CAP }; refine the pattern)`
				);
			}
			return capped.join( '\n' );
		},
	} );

	const Grep = tool( {
		description: `Search for a regex pattern across files in the workspace. Returns "path:line:content" lines, capped at ${ GREP_LINE_CAP }. Optionally filter the file set with a glob.`,
		inputSchema: z.object( {
			pattern: z
				.string()
				.describe( 'Regular expression (uses multiline flag).' ),
			glob: z
				.string()
				.optional()
				.describe( 'Optional glob pattern to limit the file set.' ),
		} ),
		execute: ( { pattern, glob } ) => {
			const regex = new RegExp( pattern, 'm' );
			const lines: string[] = [];
			let truncated = false;
			walk( cwd, ( rel, abs ) => {
				if ( glob && ! matchesGlob( rel, glob ) ) return true;
				let body: string;
				try {
					body = readFileSync( abs, 'utf8' );
				} catch {
					return true;
				}
				const fileLines = body.split( '\n' );
				for ( let i = 0; i < fileLines.length; i++ ) {
					const line = fileLines[ i ] ?? '';
					if ( regex.test( line ) ) {
						lines.push( `${ rel }:${ i + 1 }:${ line }` );
						if ( lines.length >= GREP_LINE_CAP ) {
							truncated = true;
							return false;
						}
					}
				}
				return true;
			} );
			if ( truncated ) {
				lines.push(
					`... (result truncated at ${ GREP_LINE_CAP }; refine the pattern)`
				);
			}
			return lines.join( '\n' );
		},
	} );

	const Bash = tool( {
		description:
			'Run a shell command in the workspace. Returns combined stdout+stderr. Non-zero exit or timeout throws.',
		inputSchema: z.object( {
			command: z.string().describe( 'Shell command to execute.' ),
			timeoutMs: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					`Timeout in milliseconds. Defaults to ${ BASH_DEFAULT_TIMEOUT_MS }.`
				),
		} ),
		execute: ( { command, timeoutMs } ) => {
			try {
				const out = execSync( command, {
					cwd,
					timeout: timeoutMs ?? BASH_DEFAULT_TIMEOUT_MS,
					encoding: 'utf8',
					maxBuffer: BASH_MAX_BUFFER_BYTES,
					stdio: [ 'ignore', 'pipe', 'pipe' ],
				} );
				return out;
			} catch ( err ) {
				const e = err as NodeJS.ErrnoException & {
					stdout?: Buffer | string;
					stderr?: Buffer | string;
					status?: number | null;
					signal?: string | null;
				};
				const stdout =
					typeof e.stdout === 'string'
						? e.stdout
						: ( e.stdout?.toString( 'utf8' ) ?? '' );
				const stderr =
					typeof e.stderr === 'string'
						? e.stderr
						: ( e.stderr?.toString( 'utf8' ) ?? '' );
				const combined = `${ stdout }${ stderr }`;
				const detail =
					e.signal != null
						? `signal=${ e.signal }`
						: e.status != null
							? `exit=${ e.status }`
							: e.message;
				throw new Error(
					`Bash failed (${ detail }): ${ combined.length > 0 ? combined : e.message }`
				);
			}
		},
	} );

	if ( role === 'judge' ) return { Read };
	return { Read, Write, Edit, Glob, Grep, Bash };
}
