/**
 * A function that, when called, releases a previously acquired
 * {@link SerialMutex} lock so the next waiter may proceed. Calling it more
 * than once is a no-op after the first release.
 */
export type Release = () => void;

/**
 * A size-1 async lock that serializes critical sections. Backed by a
 * single chained promise: each {@link SerialMutex.acquire} call waits on
 * the previous holder's release before resolving, so at most one section
 * runs at a time and waiters are served in FIFO order. A holder that
 * throws still releases the lock when its `release()` runs in a `finally`,
 * so a failure in one section never wedges the rest.
 *
 * Used to serialize the judge bracket across the pipeline's scenario and
 * agent fan-outs when `roles.judge.concurrency` is `'serial'`, preventing
 * concurrent judge phases (e.g. a cross-scenario `wp-env start` race).
 *
 * @example
 * const mutex = new SerialMutex();
 * const release = await mutex.acquire();
 * try {
 *   // ...critical section: only one runs at a time...
 * } finally {
 *   release();
 * }
 */
export class SerialMutex {
	/**
	 * The tail of the lock chain: a promise that resolves when the current
	 * holder releases. Each `acquire` awaits the existing tail and installs
	 * a fresh one whose resolver becomes the new holder's `release`.
	 */
	private tail: Promise< void > = Promise.resolve();

	/**
	 * Acquire the lock, resolving once any earlier holder has released. The
	 * returned {@link Release} must be called (ideally in a `finally`) to
	 * hand the lock to the next waiter.
	 *
	 * @returns A promise for the release function granting exclusive access.
	 */
	acquire(): Promise< Release > {
		const previous = this.tail;
		let release!: Release;
		this.tail = new Promise< void >( ( resolve ) => {
			let released = false;
			release = () => {
				if ( released ) return;
				released = true;
				resolve();
			};
		} );
		return previous.then( () => release );
	}
}
