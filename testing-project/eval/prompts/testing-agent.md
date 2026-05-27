# Workspace instructions

A WordPress plugin scaffold lives in your workspace. Implement the requested work inside this scaffold — do not create a new plugin or rename the existing one.

A block named `skillsmith/testing-block` lives in `src/blocks/testing-block/` inside the plugin scaffold and is registered in the plugin's `index.php`. Implement the block as needed for the task, but do not change the block name or registration mechanism.

The root element rendered by `render.php` must apply `<?php echo get_block_wrapper_attributes(); ?>` so WordPress emits the standard block class (`wp-block-skillsmith-testing-block`) and any block-supports attributes on the wrapper. Adding your own `class="..."` attribute alongside the helper is fine; replacing the helper with a hand-written class is not.
