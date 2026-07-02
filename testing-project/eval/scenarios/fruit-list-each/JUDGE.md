Judge the produced work against the checks below, using both the produced source files and the live, running site. Pass only if every check, including the rubric check, is satisfied.

## Code checks

Verify in the produced source files:

- The `fruits` array is seeded server-side through the Interactivity API — either via `wp_interactivity_state()` (global state) or via `wp_interactivity_data_wp_context()` (local context). It must NOT be hand-encoded JSON in HTML attributes, and must NOT be a PHP-only variable that never enters Interactivity state/context. The initial value is the three strings "Apple", "Banana", "Cherry" in that order.
- The <ul> renders its items via the Interactivity API's `data-wp-each` directive iterating over the seeded fruits collection (e.g. `data-wp-each="state.fruits"` or `data-wp-each="context.fruits"`), with the per-item <li> defined inside a child `<template>` element — not a PHP `foreach` that emits static <li> tags
- The `<li>` inside the `<template>` binds its text via `data-wp-text` referencing the per-iteration context item (e.g. `data-wp-text="context.item"`), rather than echoing the value through PHP or assigning it from JS
- The three initial `<li>` elements are present in the server-rendered HTML produced by `data-wp-each`'s server-side hydration of the seeded fruits array, so the list is visible before JavaScript runs
- There is a named store action wired to the "Add Mango" button through `data-wp-on--click` (no manual `addEventListener` in view.js)
- The "Add Mango" action mutates the existing fruits array in place via `.push("Mango")` (or equivalent in-place mutation) rather than reassigning the fruits array to a new one, so `data-wp-each` reactivity picks up the new item

As a further code check, verify the produced code against the `wp-interactivity-api-best-practices` rubric.

## Behavior checks

Verify on the live, running site:

- The list initially shows exactly 3 items, in order: Apple, Banana, Cherry.
- Clicking the "Add Mango" button updates the list to 4 items, with "Mango" as the 4th item.
- Clicking the "Add Mango" button a second time updates the list to 5 items, with "Mango" as both the 4th and 5th items.
