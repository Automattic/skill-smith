## Code checks

Verify in the produced source files:

- `render.php` publishes `restUrl` and `nonce` as plugin configuration (via `wp_interactivity_config()`) consumed by the view — not as per-instance state/context and not hard-coded in JS
- `restUrl` is produced by `rest_url('wp/v2/posts/1')` and `nonce` by `wp_create_nonce('wp_rest')` on the server
- The view reads both `restUrl` and `nonce` from that configuration (e.g. via `getConfig()`) rather than reconstructing the URL or embedding the nonce literal
- The `fetch` call in `view.js` is wired to set the `X-WP-Nonce` request header from the config-supplied nonce
- The "Load post" button is wired with `data-wp-on--click` (or `data-wp-on-async--click`) to a named store action that performs the fetch
- The store action that performs the fetch is a generator function using `yield` for the `fetch` and `.json()` calls (not `async`/`await`)
- The paragraph's text is bound reactively with `data-wp-text` (or equivalent directive) to a single store/context property that holds the title — not assigned via direct DOM writes from `view.js`
- The server-rendered HTML for the paragraph contains the initial placeholder text "(no post loaded yet)" so the block reads correctly before JS runs

As a further code check, verify the produced code against `judge-library/rubrics/wp-interactivity-api-best-practices.md`.

## Behavior checks

Verify on the live, running site:

- Setup: using the WP-CLI bridge, look up the post with ID 1 and note its title — that is the text the block must render.
- Clicking the "Load post" button triggers a request to `/wp-json/wp/v2/posts/1` (check the browser's network-request log).
- After the click, the block displays that post's title.
- The click-triggered request to `/wp-json/wp/v2/posts/1` carries a non-empty `X-WP-Nonce` header (check the request in the browser's network-request log); if the available tooling does not expose request headers, fall back to the code check above that `view.js` sets the `X-WP-Nonce` header from the config-supplied nonce.
