<!-- produced from apps/docs/src/content/docs/guides/apps/orders-with-lines.md § The price check; do not edit -->

# An order with its lines: The price check

The guest saw 34.10. Between the quote and the save, the kitchen raised the price of fries. The
guest must not pay a price they did not see.

With `"expect": "total"` on the entry, the save may send the total the guest was shown:

```json
{ "expect": { "total": "34.10" } }
```

Adminium writes the whole order, works out the total, and compares it at the column's own places.
If it is different, nothing is written, and the save is refused `409` `PUBLIC_PRICE_CHANGED`, with
`params.total` (the figure it came to) and `params.lines` (every row below it, shaped like the
reply's `children`). The page shows the new price and asks again. The same retry key can be sent
with the new total, since nothing was made.

The column named must be a money column that Adminium works out, and the entry must show it in
`select`. A save that sends `expect` to an entry that checks no price is refused `400`
`PUBLIC_WRITE_REFUSED`. A change to a row can carry `expect` too, on an entry that changes rows.
