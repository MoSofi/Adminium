<!-- produced from apps/docs/src/content/docs/guides/apps/orders-with-lines.md § At the desk; do not edit -->

# An order with its lines: At the desk

Staff place the same order through the data API, and it runs the same way: `children` with the
record, a quote at `POST /api/v1/data/{connectionId}/{table}/dry-run`, `expect` (a save at another
total is refused `409` `PRICE_CHANGED`) and `clientKey` (a retry answers `200` with
`replayed: true`). A desk's retry key is its own: kept per user, in the column the app's public
entries keep a guest's in. A table with no such column refuses one. The desk is held to the same
`agrees`, `counts` and `sumMax` as a guest, but not to the menu's public reads: it may pick any
dish its role can read. See the
[REST API](https://docs.adminium.dev/reference/rest-api/).
