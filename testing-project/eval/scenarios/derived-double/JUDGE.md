## Code checks

Verify in the produced source files:

- The counter is the only mutable numeric field in state/context, and the client-side store exposes the doubled value as a derived getter (computed from the counter on read) — not as a separately stored mutable field. Seeding the doubled value alongside the counter in `wp_interactivity_state()` for server-side rendering is acceptable (this is the static-derived-state pattern); the test is that the client store has only one mutable field plus a `double` getter, and that no action ever writes to `double`.
- Has a named increment action that mutates only the counter (e.g. `state.counter++` or the context equivalent); it never assigns to the doubled field.
- Uses `data-wp-on--click` on the increment button wired to the increment action.
- The doubled value in the directive expression references the derived getter directly (e.g. `state.double`), not an inline arithmetic expression like `state.counter * 2` or a duplicated stored field.
- Server-rendered HTML includes the initial values (1 for the counter and 2 for the doubled value) so both read correctly before JavaScript hydrates.

As a further code check, verify the produced code against `judge-library/rubrics/wp-interactivity-api-best-practices.md`.

## Behavior checks

Verify on the live, running site:

- The block initially displays the counter value 1 and the doubled value 2.
- Clicking the "Increment" button updates the displayed values to 2 and 4.
- Clicking it a second time updates the displayed values to 3 and 6.
- Clicking it twice more updates the displayed values to 5 and 10, with the displayed pair remaining the counter and its exact double after every click.
