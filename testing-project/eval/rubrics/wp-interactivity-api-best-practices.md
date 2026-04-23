# WordPress Interactivity API Best Practices

Evaluate the produced PHP and JavaScript against the official WordPress Interactivity API Coding Standards:
TO BE FILLED.

Flag in particular:

- Uses wp_interactivity_state() in PHP to initialize server-side state.
- Includes data-wp-interactive directive on the root element with a namespace.
- Namespace in store() matches the namespace in data-wp-interactive and directives.
- Uses viewScriptModule (not viewScript) in block.json.
- JavaScript imports from @wordpress/interactivity.
- block.json includes supports.interactivity set to true.
