You are grading a WordPress interactive block whose button fetches a joke from a remote endpoint via a generator action. Decide whether it satisfies the requirements below, using both the produced source files and the live, running site.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, insert them on a published post, then open that post in the browser to run the live checks below.

## Scenario requirements

The block should render a "Fetch joke" button and an initially empty paragraph. Confirm all of the following in the produced code:

- A named store action is wired to the "Fetch joke" button via `data-wp-on--click`.
- The fetch action is a generator function (`function*` / `*name()`) that uses `yield` for both the `fetch(...)` call and the `.json()` parsing — no `async` / `await`.
- The action requests the exact URL string `https://jsonplaceholder.example/joke` in the source.
- The `joke` field from the parsed JSON is written into store state or local context only after the `yield` resolves; the paragraph is bound reactively (e.g. `data-wp-text`) to that value rather than mutated via direct DOM writes (`innerText`, `textContent`, `innerHTML`).
- The server-rendered HTML for the paragraph reflects the initial empty value (the joke state/context is seeded empty on the server via `wp_interactivity_state()` or `wp_interactivity_data_wp_context()`).

## Live checks

Open the published post. Before clicking anything, confirm the paragraph beneath the button is empty (no joke text). Click the "Fetch joke" button. After the request resolves, the paragraph must show the fetched joke string. (In the live environment the endpoint may be mocked or unreachable; if the network call cannot complete, judge the wiring from the source — the action must target the stub URL, parse the JSON, and bind the result reactively.)

# Rubrics

- wp-interactivity-api-best-practices
