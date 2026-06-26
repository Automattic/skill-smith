You are grading a WordPress interactive block that loads a post from the REST API using a config-supplied URL and nonce. Decide whether it satisfies the requirements below, using both the produced source files and the live, running site.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, insert them on a published post, then open that post in the browser to run the live checks below.

## Scenario requirements

The block should render a "Load post" button and a paragraph that starts as "(no post loaded yet)". Confirm all of the following in the produced code:

- `render.php` publishes `restUrl` and `nonce` as plugin configuration (via `wp_interactivity_config()`) consumed by the view — not as per-instance state/context and not hard-coded in JS.
- `restUrl` is produced by `rest_url('wp/v2/posts/1')` and `nonce` by `wp_create_nonce('wp_rest')` on the server.
- The view reads both `restUrl` and `nonce` from that configuration (e.g. via `getConfig()`) rather than reconstructing the URL or embedding the nonce literal.
- The `fetch` call in `view.js` sets the `X-WP-Nonce` request header from the config-supplied nonce.
- The "Load post" button is wired with `data-wp-on--click` (or `data-wp-on-async--click`) to a named store action that performs the fetch.
- The fetch action is a generator function using `yield` for the `fetch` and `.json()` calls (not `async` / `await`).
- The paragraph's text is bound reactively with `data-wp-text` (or equivalent) to a single store/context property holding the title — not assigned via direct DOM writes from `view.js`.
- The server-rendered HTML for the paragraph contains the initial placeholder text "(no post loaded yet)" so the block reads correctly before JS runs.

## Live checks

Open the published post. Confirm the paragraph initially reads "(no post loaded yet)". Click the "Load post" button. The fetch must go to `/wp/v2/posts/1` carrying the nonce in the `X-WP-Nonce` header, and the paragraph must then show the fetched post title in place of the placeholder. (If the live REST call cannot complete in this environment, verify from the source that the request targets that endpoint, sends the config-supplied nonce header, and binds the resulting title reactively.)

# Rubrics

- wp-interactivity-api-best-practices
