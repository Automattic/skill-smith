## Code checks

Verify in the produced source files:

- The per-instance counter value lives in local context (set via `data-wp-context` / `wp_interactivity_data_wp_context()`), not in global state via `wp_interactivity_state()`.
- Has a named increment store action that mutates the counter through `getContext()` (e.g. `const ctx = getContext(); ctx.counter += 1`), not via a shared/global state reference.
- Uses `data-wp-on--click` on the Increment button, wired to the increment action.
- Uses `data-wp-text` bound to the local context property (e.g. `context.counter`) to display the value, not a global state property.
- Server-rendered HTML seeds the initial counter value (0) inside each instance's per-instance context attribute so it is correct before hydration.

As a further code check, verify the produced code against `judge-library/rubrics/wp-interactivity-api-best-practices.md`.

## Behavior checks

Verify on the live, running site:

- Setup: insert two instances of the block into one published post.
- Both instances initially display the counter value 0.
- Clicking the first instance's "Increment" button twice updates the first instance's displayed value to 2 while the second instance stays unchanged at 0.
- Then clicking the second instance's "Increment" button once updates the second instance's displayed value to 1 while the first instance stays unchanged at 2.
