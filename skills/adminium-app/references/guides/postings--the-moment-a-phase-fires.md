<!-- produced from apps/docs/src/content/docs/guides/apps/postings.md § The moment a phase fires; do not edit -->

# Rows that post into an add-on's ledger: The moment a phase fires

| A point | Fires |
|---|---|
| `{ "create": true }` | when the row is created |
| `{ "to": ["placed"] }` | when the row moves into one of these states, or is created in one |
| `{ "to": ["cancelled"], "from": ["placed", "ready"] }` | only when it moves there from one of those states |
| `{ "column": "status", "in": ["seen"] }` | when a plain column takes one of these values (a table with no [states](https://docs.adminium.dev/reference/manifest/#states)) |
| `{ "column": "voided_at", "set": true }` | when a column that was empty is filled |

A change that crosses no point posts nothing and costs nothing: the row is saved as ever.

`from` is how an app says a give-back is no longer possible. An order whose stock goes back when
it is cancelled from `placed` or `ready`, and not once the kitchen is `preparing` it, leaves
`preparing` out of `from`.
