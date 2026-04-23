# Project

You are developing a WordPress plugin. Write all code under `testing-project/eval/testing-plugin/`; do not edit anything else in the repository.

## Plugin layout

    testing-plugin/
    ├── index.php                       # auto-registers every src/blocks/*/ that has a block.json
    └── src/
        └── blocks/
            └── testing-block/
                └── block.json

Edit `index.php` for plugin-level wiring. Add or modify files under `src/blocks/testing-block/` for block code. Keep the block's `name` field in `block.json` set to `testing-plugin/testing-block`; the site references it by that slug.

The plugin runs without a build step, so write sources WordPress can execute directly (no JSX, no bundlers).
