<!-- produced from apps/docs/src/content/docs/guides/apps/orders-with-lines.md § What a price was reduced by; do not edit -->

# An order with its lines: What a price was reduced by

Where an add-on lowers the price of the order's table (a [price rule](https://docs.adminium.dev/guides/apps/discounts-and-codes/)),
the quote and the save both answer which reductions applied, and a guest's codes are sent as one more
child list. From Adminium 0.3.19.

```json
{ "data": { "id": 41, "subtotal": "64.50", "discount": "20.00", "total": "48.06" },
  "applied": [
    { "line": "order_lines/1", "name": "Tote pair", "kind": "offer", "amount": "15.00", "typed": false },
    { "line": null, "name": "Autumn 5", "kind": "code", "amount": "5.00", "typed": true } ],
  "told": [],
  "payment": { "amount": "19.00", "due": "29.06" } }
```

`applied` is one entry per reduction, named in the reader's language; `told` says, beside a typed
code that was not needed, which offer did better; `payment` is what a payment whose amount Adminium
decided (a gift card, as far as it goes) took and what is still to pay. `PRICE_CHANGED` carries
`applied` too. A guest's own read of the order (`client.getPriced(ref, id)`) answers the same
`applied` from the rows that were kept.
