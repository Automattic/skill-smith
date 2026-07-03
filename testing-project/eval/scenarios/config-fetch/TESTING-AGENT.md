I want an interactive block for WordPress that loads a post from the
REST API on demand. Here is what it should do:

1. Render a "Load post" button and a paragraph that initially shows
   "(no post loaded yet)".
2. When the button is clicked, fetch the post with ID 1 from the
   WordPress REST API and show its title in the paragraph instead of
   the placeholder.

A few constraints from our setup:

- The REST URL and a CSRF nonce should be computed on the server with
  `rest_url('wp/v2/posts/1')` and `wp_create_nonce('wp_rest')`, and
  handed to the front-end as plugin configuration values (the same
  values would be reused by other blocks on the page, so they are not
  per-instance state). The client must read them from that
  configuration rather than hard-coding the URL or recomputing it.
- The fetch request must send the nonce in the `X-WP-Nonce` header so
  the REST API accepts it.

# Skills

- wp-interactivity-api
