Create an interactive block for WordPress that fetches a joke from a remote
endpoint when the user clicks a button.

Requirements:
1. Render a button labeled "Fetch joke" and an empty paragraph beneath it.
2. When the button is clicked, fetch JSON from
   `https://jsonplaceholder.example/joke` (a stub URL — the test intercepts
   and mocks the response).
3. After the response comes back, show the response's `joke` string inside
   that paragraph.

The paragraph should start empty and only fill in once the fetched joke is
available.

# Skills

- wp-interactivity-api
