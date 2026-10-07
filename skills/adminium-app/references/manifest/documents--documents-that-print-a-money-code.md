<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Documents — Documents that print a money code; do not edit -->

# Manifest spec: Documents — Documents that print a money code

### Documents that print a money code

A money code is a code worth something to whoever holds it, a gift card's: a `code` column of
which another column of the same table keeps the last four. A document that prints one, from its
own row, a row it links to or the rows listed under it, is drawn when it is asked for and kept
nowhere: no row in the documents register, no stored file, and it cannot be drawn again from the
register. Whoever made the code prints it from the page that made it, once, with the ticket the
create answered (see the `once` block in the [REST API](https://docs.adminium.dev/reference/rest-api/)).

A signed-in person reaches the documents of their own rows through a [public entry's
`documents`](https://docs.adminium.dev/reference/manifest/#public-access).
