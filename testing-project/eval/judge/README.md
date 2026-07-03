# Judge environment manual

A live WordPress site is already running with the produced plugin built and activated. Judge the produced work against both the produced source files and this live, running site: read the source files, and use the site to verify the block's real behavior.

These environment variables are set for you:

- `$SKILLSMITH_PROJECT_ROOT` — the testing-project root, where the WP-CLI bridge lives.
- `$SKILLSMITH_WP_PORT` — the port the running site listens on.
- `$SKILLSMITH_PLUGIN_SLUG` — the slug of the activated plugin that contains the block.

## Running WP-CLI

Run WP-CLI inside the running site through the bridge script. Pass the WP-CLI arguments after the script path:

```
node "$SKILLSMITH_PROJECT_ROOT/eval/utils/judge-wp.mjs" <wp args>
```

For example, `node "$SKILLSMITH_PROJECT_ROOT/eval/utils/judge-wp.mjs" plugin list` lists the installed plugins.

## Publishing a post that renders the block

Discover the block name(s) by reading `$SKILLSMITH_PLUGIN_SLUG/build/blocks/*/block.json` (each file's `name` field is a registered block name, e.g. `skillsmith/counter`). Insert one self-closing block comment per discovered `name`.

Create a published post whose content is those block comment(s). The WP-CLI command form is:

```
wp post create --post_type=post --post_status=publish --post_title='...' --post_content='<!-- wp:NS/NAME /-->' --porcelain
```

Run it through the bridge by dropping the leading `wp`:

```
node "$SKILLSMITH_PROJECT_ROOT/eval/utils/judge-wp.mjs" post create --post_type=post --post_status=publish --post_title='Judge fixture' --post_content='<!-- wp:NS/NAME /-->' --porcelain
```

`--porcelain` makes WP-CLI print only the new post's numeric ID on stdout. Capture that ID.

## Loading the rendered post

With the captured post ID, the post renders at:

```
http://localhost:$SKILLSMITH_WP_PORT/?p=<id>
```

Load that URL to exercise the block live: confirm the server-rendered markup, then drive the interactive behavior in a real browser.
