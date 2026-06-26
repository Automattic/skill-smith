You are grading a WordPress interactive block that renders a fruit list server-side via `data-wp-each` with an "Add Mango" button that appends. Decide whether it satisfies the requirements below, using both the produced source files and the live, running site.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, insert them on a published post, then open that post in the browser to run the live checks below.

## Scenario requirements

The list should already contain "Apple", "Banana", "Cherry" on load, with an "Add Mango" button below it. Confirm all of the following in the produced code:

- The `fruits` array is seeded server-side through the Interactivity API — either via `wp_interactivity_state()` (global state) or via `wp_interactivity_data_wp_context()` (local context). It must NOT be hand-encoded JSON in HTML attributes, and must NOT be a PHP-only variable that never enters Interactivity state/context. The initial value is the three strings "Apple", "Banana", "Cherry" in that order.
- The `<ul>` renders its items via `data-wp-each` iterating the seeded fruits collection (e.g. `data-wp-each="state.fruits"` or `data-wp-each="context.fruits"`), with the per-item `<li>` defined inside a child `<template>` element — not a PHP `foreach` that emits static `<li>` tags.
- The `<li>` inside the `<template>` binds its text via `data-wp-text` referencing the per-iteration context item (e.g. `data-wp-text="context.item"`), rather than echoing the value through PHP or assigning it from JS.
- The three initial `<li>` elements are present in the server-rendered HTML produced by `data-wp-each`'s server-side hydration of the seeded fruits array, so the list is visible before JavaScript runs.
- A named store action is wired to the "Add Mango" button through `data-wp-on--click` (no manual `addEventListener` in view.js).
- The "Add Mango" action mutates the existing fruits array in place via `.push("Mango")` (or equivalent in-place mutation) rather than reassigning the array, so `data-wp-each` reactivity picks up the new item.

## Live checks

Open the published post. Confirm the list shows exactly three items in order: "Apple", "Banana", "Cherry". Click "Add Mango": a fourth `<li>` reading "Mango" must appear at the end of the list. Click "Add Mango" again: a fifth `<li>` reading "Mango" must appear, leaving the earlier items unchanged.

# Rubrics

- wp-interactivity-api-best-practices
