You are grading a WordPress interactive block whose button fetches a joke from a remote endpoint via a generator action. Decide whether it satisfies the task it was given, using both the produced source files and the live, running site.

Also grade the produced code against the WordPress Interactivity API best-practices rubric.

## Environment

A live WordPress site is running with the produced plugin built. Activate the `$SKILLSMITH_PLUGIN_SLUG` plugin, discover the block name(s) it produced, insert them on a published post, then open that post in the browser to run the live checks below.

## Live checks

Open the published post. Before clicking anything, confirm the paragraph beneath the button is empty (no joke text). Click the "Fetch joke" button. After the request resolves, the paragraph must show the fetched joke string. (In the live environment the endpoint may be mocked or unreachable; if the network call cannot complete, judge the wiring from the source — the action must target the stub URL, parse the JSON, and bind the result reactively.)
