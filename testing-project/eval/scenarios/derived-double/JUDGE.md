You are grading a WordPress interactive block that shows a counter and its doubled value computed via a derived getter. Decide whether it satisfies the task it was given, using both the produced source files and the live, running site.

Also grade the produced code against the WordPress Interactivity API best-practices rubric.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, insert them on a published post, then open that post in the browser to run the live checks below.

## What to check

- The counter is the only mutable numeric field in state/context, and the client-side store exposes the doubled value as a derived getter (computed from the counter on read) — not as a separately stored mutable field. Seeding the doubled value alongside the counter in `wp_interactivity_state()` for server-side rendering is acceptable (the static-derived-state pattern); the test is that the client store has only one mutable field plus a `double` getter, and that no action ever writes to `double`.
- There is a named increment action that mutates only the counter (e.g. `state.counter++` or the context equivalent); it never assigns to the doubled field.
- The doubled value in the directive expression references the derived getter directly (e.g. `state.double`), not an inline arithmetic expression like `state.counter * 2` or a duplicated stored field.

## Live checks

Open the published post. Confirm the block initially shows 1 and 2. Click "Increment" once; the two numbers must become 2 and 4. Click it again; they must become 3 and 6. The doubled value must stay exactly twice the counter on every click.
