## Code checks

Verify in the produced source files:

- The literal text "Hello from iAPI" is emitted by `render.php` (server-rendered output), not injected client-side from `view.js`.
- The `console.log("iapi-ready")` call lives inside an init callback registered on the store (e.g. `store("<namespace>", { callbacks: { <name>() { console.log("iapi-ready"); } } })`) — not as a top-level statement in `view.js`, not inside a `data-wp-on--*` handler, and not inside a `data-wp-watch` callback.
- The wrapper element rendered by `render.php` carries `data-wp-init="callbacks.<name>"` referencing that init callback so the runtime invokes it on hydration.

As a further code check, verify the produced code against `judge-library/rubrics/wp-interactivity-api-best-practices.md`.

## Behavior checks

Verify on the live, running site:

- The page displays the text "Hello from iAPI".
- Once the block hydrates, an "iapi-ready" message appears in the browser's console-message log (hydration is asynchronous — the observation may need a moment).
- The block wrapper carries a non-empty `data-wp-interactive` attribute.
