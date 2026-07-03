# Workspace instructions

A WordPress plugin scaffold lives in your workspace. Implement the requested work inside this scaffold — keep the plugin as-is (do not create a new plugin and do not rename the plugin slug).

A starter block ships inside the plugin scaffold and is registered name-agnostically by the plugin's `index.php`, which globs the built block directories. Name, structure, replace, or add block(s) however the task needs; the starter block's name is a non-binding placeholder you are free to change.

The root element rendered by `render.php` must apply `<?php echo get_block_wrapper_attributes(); ?>` so WordPress emits the standard block class and any block-supports attributes on the wrapper. Adding your own `class="..."` attribute alongside the helper is fine; replacing the helper with a hand-written class is not.
