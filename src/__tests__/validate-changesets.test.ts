import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	type Err,
	validateChangesetFile,
} from '../../scripts/validate-changesets';

/**
 * Absolute path to `scripts/validate-changesets.ts`, computed via
 * `fileURLToPath(new URL(..., import.meta.url))` so the CLI smoke test can
 * spawn the script with a `cwd` set to a tmpdir without breaking resolution.
 */
const VALIDATOR_PATH = fileURLToPath(
	new URL( '../../scripts/validate-changesets.ts', import.meta.url )
);

/**
 * Absolute `file://` URL of the project-installed `tsx` ESM loader entry.
 *
 * The plan specifies the CLI smoke test runs `node --import tsx <validator>`
 * with `cwd` set to a tmpdir. Node's ESM resolver looks up bare-specifier
 * `--import` arguments relative to the spawn `cwd`, so the literal string
 * `"tsx"` cannot resolve from a tmpdir that has no `node_modules/`. Passing
 * the absolute `file://` URL of `tsx/dist/loader.mjs` loads the same module
 * — the project-installed `tsx` ESM loader entry resolved via the package's
 * `"."` export — without depending on cwd-relative resolution. The
 * runtime contract (validator runs under tsx, reads `package.json` and
 * `.changeset/` from the spawn `cwd`, prints `.changeset/<file>:<n>: <msg>`
 * to stderr on failure) is preserved bit-for-bit.
 */
const TSX_LOADER_URL = new URL(
	'../../node_modules/tsx/dist/loader.mjs',
	import.meta.url
).href;

const PKG_NAME = '@automattic/skillsmith';

/**
 * Seed a temporary directory with a stub `package.json` and a `.changeset/`
 * directory populated with the provided files, then return the absolute path
 * of the directory. The seeded `package.json` always names the package
 * `@automattic/skillsmith` at version `0.1.0` so the spawned validator picks
 * up the same identity the unit tests use.
 *
 * @param changesets - Map of filename (e.g. `"foo.md"`) to file body.
 * @returns Absolute path of the freshly-created tmpdir.
 */
function setupTmpDir( changesets: Record< string, string > ): string {
	const dir = mkdtempSync(
		path.join( tmpdir(), 'validate-changesets-smoke-' )
	);
	writeFileSync(
		path.join( dir, 'package.json' ),
		JSON.stringify( { name: PKG_NAME, version: '0.1.0' } )
	);
	mkdirSync( path.join( dir, '.changeset' ) );
	for ( const [ name, body ] of Object.entries( changesets ) ) {
		writeFileSync( path.join( dir, '.changeset', name ), body );
	}
	return dir;
}

test( 'B1: passes a valid minor changeset', () => {
	const raw = '---\n"@automattic/skillsmith": minor\n---\n\nAdd a feature.\n';
	const errors: Err[] = validateChangesetFile(
		'test.md',
		raw,
		PKG_NAME,
		'0.1.0'
	);
	assert.deepEqual( errors, [] );
} );

test( 'B2: passes the canonical empty changeset (with trailing newline)', () => {
	const raw = '---\n---\n';
	const errors = validateChangesetFile( 'test.md', raw, PKG_NAME, '0.1.0' );
	assert.deepEqual( errors, [] );
} );

test( 'B2: passes the canonical empty changeset (no trailing newline)', () => {
	const raw = '---\n---';
	const errors = validateChangesetFile( 'test.md', raw, PKG_NAME, '0.1.0' );
	assert.deepEqual( errors, [] );
} );

test( 'B3: fails when the closing fence is missing', () => {
	const raw = '---\n"@automattic/skillsmith": minor\n';
	const errors = validateChangesetFile( 'test.md', raw, PKG_NAME, '0.1.0' );
	assert.ok( errors.length > 0, 'expected at least one error' );
	assert.ok(
		errors.some( ( e ) =>
			e.msg.includes( 'missing or unterminated front matter' )
		),
		`expected an error mentioning 'missing or unterminated front matter'; got ${ JSON.stringify( errors ) }`
	);
} );

test( 'B4: fails on an invalid bump value', () => {
	const raw = '---\n"@automattic/skillsmith": superminor\n---\n\nBody.\n';
	const errors = validateChangesetFile( 'test.md', raw, PKG_NAME, '0.1.0' );
	assert.ok(
		errors.some( ( e ) => e.msg.includes( 'invalid bump "superminor"' ) ),
		`expected an error mentioning 'invalid bump "superminor"'; got ${ JSON.stringify( errors ) }`
	);
} );

test( 'B5: fails on a wrong package name', () => {
	const raw = '---\nsome-other-package: minor\n---\n\nBody.\n';
	const errors = validateChangesetFile( 'test.md', raw, PKG_NAME, '0.1.0' );
	const matched = errors.find(
		( e ) =>
			e.msg.includes( 'unknown package "some-other-package"' ) &&
			e.msg.includes( 'expected "@automattic/skillsmith"' )
	);
	assert.ok(
		matched,
		`expected an error mentioning both 'unknown package "some-other-package"' and 'expected "@automattic/skillsmith"'; got ${ JSON.stringify( errors ) }`
	);
} );

test( 'B6: fails on empty body with non-empty front matter', () => {
	const raw = '---\n"@automattic/skillsmith": minor\n---\n\n\n';
	const errors = validateChangesetFile( 'test.md', raw, PKG_NAME, '0.1.0' );
	assert.ok(
		errors.some( ( e ) => e.msg.includes( 'empty body' ) ),
		`expected an error mentioning 'empty body'; got ${ JSON.stringify( errors ) }`
	);
} );

test( 'B7: fails on major bump while pre-1.0', () => {
	const raw =
		'---\n"@automattic/skillsmith": major\n---\n\nBreaking change.\n';
	const errors = validateChangesetFile( 'test.md', raw, PKG_NAME, '0.1.0' );
	const matched = errors.find(
		( e ) =>
			e.msg.includes( "'major' is forbidden while pre-1.0" ) &&
			e.msg.includes( 'CONTRIBUTING.md#pre-10-policy' )
	);
	assert.ok(
		matched,
		`expected an error mentioning both "'major' is forbidden while pre-1.0" and 'CONTRIBUTING.md#pre-10-policy'; got ${ JSON.stringify( errors ) }`
	);
} );

test( 'B7: allows major bump at 1.0.0 (pre-1.0 guard does not fire)', () => {
	const raw =
		'---\n"@automattic/skillsmith": major\n---\n\nBreaking change.\n';
	const errors = validateChangesetFile( 'test.md', raw, PKG_NAME, '1.0.0' );
	assert.deepEqual( errors, [] );
} );

test( 'CRLF: tolerates \\r\\n line endings on a valid changeset', () => {
	const raw =
		'---\r\n"@automattic/skillsmith": minor\r\n---\r\n\r\nAdd thing.\r\n';
	const errors = validateChangesetFile( 'test.md', raw, PKG_NAME, '0.1.0' );
	assert.deepEqual( errors, [] );
} );

test( "B8 CLI smoke (failing): exit 1 + stderr matches '.changeset/<file>:<n>: invalid bump'", () => {
	const tmpDir = setupTmpDir( {
		'good.md': '---\n"@automattic/skillsmith": patch\n---\n\nFix bug.\n',
		'bad.md': '---\n"@automattic/skillsmith": superminor\n---\n\nBody.\n',
	} );
	const result = spawnSync(
		process.execPath,
		[ '--import', TSX_LOADER_URL, VALIDATOR_PATH ],
		{ cwd: tmpDir, encoding: 'utf8' }
	);
	assert.equal(
		result.status,
		1,
		`expected exit 1; stderr=${ result.stderr }`
	);
	assert.match(
		result.stderr.toString(),
		/\.changeset\/[^:]+:\d+: invalid bump/,
		`expected stderr to match '.changeset/<file>:<n>: invalid bump'; got ${ result.stderr }`
	);
	assert.equal(
		result.stdout.toString(),
		'',
		`stdout must be empty; got ${ result.stdout }`
	);
} );

test( 'B8 CLI smoke (passing): exit 0 + empty stderr', () => {
	const tmpDir = setupTmpDir( {
		'good.md': '---\n"@automattic/skillsmith": patch\n---\n\nFix bug.\n',
	} );
	const result = spawnSync(
		process.execPath,
		[ '--import', TSX_LOADER_URL, VALIDATOR_PATH ],
		{ cwd: tmpDir, encoding: 'utf8' }
	);
	assert.equal(
		result.status,
		0,
		`expected exit 0; stderr=${ result.stderr }`
	);
	assert.equal(
		result.stderr.toString(),
		'',
		`stderr must be empty on success; got ${ result.stderr }`
	);
} );
