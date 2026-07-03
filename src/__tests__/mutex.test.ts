import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SerialMutex } from '../util/mutex';

/**
 * Resolve on the next macrotask so interleaving is observable: a task
 * that yields here gives every other already-scheduled task a chance to
 * run before it continues.
 */
function tick(): Promise< void > {
	return new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
}

test( 'SerialMutex runs critical sections one at a time even when started concurrently', async () => {
	const mutex = new SerialMutex();
	const events: string[] = [];

	async function section( id: string ): Promise< void > {
		const release = await mutex.acquire();
		try {
			events.push( `enter:${ id }` );
			// Yield twice inside the lock: if the mutex did not serialize,
			// another section's `enter` would interleave between these.
			await tick();
			await tick();
			events.push( `exit:${ id }` );
		} finally {
			release();
		}
	}

	// Fire all three "concurrently" — they all start before any finishes.
	await Promise.all( [ section( 'a' ), section( 'b' ), section( 'c' ) ] );

	// Each enter is immediately followed by its own exit: no interleaving.
	assert.deepEqual( events, [
		'enter:a',
		'exit:a',
		'enter:b',
		'exit:b',
		'enter:c',
		'exit:c',
	] );
} );

test( 'SerialMutex grants the lock in FIFO order of acquisition', async () => {
	const mutex = new SerialMutex();
	const order: number[] = [];

	const tasks = [ 0, 1, 2, 3 ].map( ( n ) =>
		( async () => {
			const release = await mutex.acquire();
			order.push( n );
			await tick();
			release();
		} )()
	);
	await Promise.all( tasks );

	assert.deepEqual(
		order,
		[ 0, 1, 2, 3 ],
		'waiters are served in the order they called acquire()'
	);
} );

test( 'SerialMutex releases the lock so later waiters proceed even when an earlier holder throws', async () => {
	const mutex = new SerialMutex();
	const events: string[] = [];

	const failing = ( async () => {
		const release = await mutex.acquire();
		try {
			events.push( 'enter:failing' );
			throw new Error( 'boom' );
		} finally {
			release();
		}
	} )();

	const following = ( async () => {
		const release = await mutex.acquire();
		try {
			events.push( 'enter:following' );
		} finally {
			release();
		}
	} )();

	await assert.rejects( failing, /boom/ );
	await following;

	assert.deepEqual(
		events,
		[ 'enter:failing', 'enter:following' ],
		'a thrown critical section still releases the lock for the next waiter'
	);
} );
