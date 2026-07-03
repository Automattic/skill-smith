I want an interactive block for WordPress that displays a paginated list
of my most recent posts.

On every page, show the 3 most recent published posts, newest first, with
each post's title rendered as a link to the post.

Below the list, show "Previous" and "Next" controls for paging through
older/newer posts. On page 1 the "Previous" control must not be present
in the page's accessibility tree, and on the last page the "Next"
control must not be present in the page's accessibility tree — for
both controls this is required server-side, i.e. on the HTML that
ships from PHP before JavaScript hydrates, not only after hydration.

When a visitor clicks Next or Previous, the post list should swap to the
new page in place — no full browser reload, no flash of a blank page —
and the URL should update to reflect the new page. Use `pg` as the query
parameter name (e.g. `?pg=2`); please do NOT use `paged`, because that
clashes with WordPress's main-query pagination.

One more thing: if a visitor has JavaScript disabled, the pagination
controls should still work as normal links. So the Next/Previous controls
need to be real `<a href="...">` anchors pointing at the corresponding
`?pg=<n>` URL — the in-place swap is a progressive enhancement on top of
links that already work on their own.

# Skills

- wp-interactivity-api
