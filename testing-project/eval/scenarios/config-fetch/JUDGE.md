You are grading a WordPress interactive block that loads a post from the REST API using a config-supplied URL and nonce. Decide whether it satisfies the task it was given, using both the produced source files and the live, running site.

Also grade the produced code against the WordPress Interactivity API best-practices rubric.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, insert them on a published post, then open that post in the browser to run the live checks below.

## What to check

- `render.php` publishes `restUrl` and `nonce` as plugin configuration (via `wp_interactivity_config()`) consumed by the view — not as per-instance state/context and not hard-coded in JS.
- `restUrl` is produced by `rest_url('wp/v2/posts/1')` and `nonce` by `wp_create_nonce('wp_rest')` on the server.
- The view reads both `restUrl` and `nonce` from that configuration (e.g. via `getConfig()`) rather than reconstructing the URL or embedding the nonce literal.
- The `fetch` call in `view.js` sets the `X-WP-Nonce` request header from the config-supplied nonce.

## Live checks

Open the published post. Confirm the paragraph initially reads "(no post loaded yet)". Click the "Load post" button. The fetch must go to `/wp/v2/posts/1` carrying the nonce in the `X-WP-Nonce` header, and the paragraph must then show the fetched post title in place of the placeholder. (If the live REST call cannot complete in this environment, verify from the source that the request targets that endpoint, sends the config-supplied nonce header, and binds the resulting title reactively.)
