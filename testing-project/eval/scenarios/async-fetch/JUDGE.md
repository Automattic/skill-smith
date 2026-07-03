## Code checks

Verify in the produced source files:

- Has a named store action wired to the "Fetch joke" button via `data-wp-on--click`.
- The fetch action is a generator function (`function*` / `*name()`) that uses `yield` for both the `fetch(...)` call and the `.json()` parsing (no `async` / `await`).
- The action requests the exact URL string `https://jsonplaceholder.example/joke` from source code.
- The `joke` field from the parsed JSON is written into store state or local context after the `yield` resolves; the displayed paragraph is bound reactively (e.g. `data-wp-text`) to that state/context value rather than being mutated via direct DOM writes (`innerText`, `textContent`, `innerHTML`).
- Server-rendered HTML for the paragraph reflects the initial empty value (the joke state/context is seeded empty on the server via `wp_interactivity_state()` or `wp_interactivity_data_wp_context()`).

As a further code check, verify the produced code against `judge-library/rubrics/wp-interactivity-api-best-practices.md`.

## Behavior checks

Verify on the live, running site:

- Before any click, the paragraph beneath the "Fetch joke" button is empty — no joke text is shown.
- Clicking the "Fetch joke" button triggers exactly one request, to exactly `https://jsonplaceholder.example/joke` (check the browser's network-request log).
- The fetched joke itself cannot be observed rendering live — `jsonplaceholder.example` does not resolve and the response cannot be mocked in this environment — so for the joke-display outcome fall back to the code checks above covering the display wiring (the reactive binding of the `joke` value and the write into state/context after the fetch resolves), rather than failing the block for the missing live render.
