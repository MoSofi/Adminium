<!-- produced from apps/docs/src/content/docs/reference/errors.md § Public API codes — Out of stock, and a refused card; do not edit -->

# Error codes: Public API codes — Out of stock, and a refused card

### Out of stock, and a refused card

A guest's save that reaches a [posting](https://docs.adminium.dev/guides/apps/postings/) hears two refusals by name, both
`409`:

| Code | When | `params` |
|---|---|---|
| `PUBLIC_OUT_OF_STOCK` | a ledger of stock refused: there is not enough left | `child`?, `index`?, `path`? (which line of a create with child rows) and `left`? — how many are left, only when the add-on's owner chose to show it and fewer than that are left |
| `PUBLIC_CARD_REFUSED` | a ledger of value refused: a gift card or voucher cannot pay this | `reason: "not-valid"`, always: whether the code is unknown, used up, expired or somebody else's is never said |

A refused card counts as a wrong guess of a typed code, on a count of its own: a page that tries
codes is slowed down like any other. Every other reason a ledger has (`one-at-a-time`,
`add-on-unavailable`, a fault of the add-on) reaches a guest as the plain
[refused write](https://docs.adminium.dev/reference/errors/#a-refused-write), with no reason. A dry run answers the same two in
`postings[]`: `{ "ledger", "state": "refused", "reason": "out-of-stock" | "not-valid" }`.
