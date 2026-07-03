## Code checks

Verify in the produced source files:

- Counter value lives in global state seeded via `wp_interactivity_state()` (not in `data-wp-context` / `wp_interactivity_data_wp_context()`), so it is shared across instances rather than per-instance
- Initial global state for the counter is seeded to 0 on the server
- Every rendered instance uses the same `data-wp-interactive` namespace string, and that namespace matches the one passed to `store()`
- The displayed value is bound with `data-wp-text` referencing the global state property (e.g. `state.counter`), not a context property
- Has a named increment action wired via `data-wp-on--click` on the Increment button
- The increment action mutates the shared `state.*` counter property (not a `context.*` property)

As a further code check, verify the produced code against `judge-library/rubrics/wp-interactivity-api-best-practices.md`.

## Behavior checks

Verify on the live, running site:

- Setup: insert two instances of the block into one published post.
- Both instances initially display the counter value 0.
- Clicking the first instance's "Increment" button updates both displayed values to 1, clicking the second instance's button updates both to 2, and clicking the first instance's button again updates both to 3 — every click updates both displays in lockstep, whichever instance's button is clicked.
