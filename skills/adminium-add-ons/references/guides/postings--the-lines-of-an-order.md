<!-- produced from apps/docs/src/content/docs/guides/apps/postings.md § The lines of an order; do not edit -->

# Rows that post into an add-on's ledger: The lines of an order

Most orders sell several things. The rule then sits on the **lines'** table and names the link to
the order with `via`:

```json
{
  "ref": "order_lines",
  "postings": [
    {
      "id": "stock",
      "into": { "addOn": "inventory", "ledger": "stock", "action": "use" },
      "via": "order_id",
      "reserve": { "on": { "create": true } },
      "post": { "on": { "to": ["picked_up"] } },
      "reverse": { "on": { "to": ["cancelled"], "from": ["placed", "ready"] } },
      "map": { "what": "item_id", "quantity": "quantity" },
      "heldUntil": { "parent": "hold_until" },
      "unlessSet": "voided_at"
    }
  ]
}
```

Under `via`, a point is judged on the **order**: when the order moves to `picked_up`, every line
is handed to the add-on in one call. Two points are the line's own: `{ "create": true }` (a line
is held as it is added) and a column point marked `"own": true` (a payment voided by its own
`voided_at`).

- A line added to an order whose other lines are already held is held in the same save. One whose
  order has already been picked up is taken in the same save.
- `unlessSet` leaves a line out of every call while that column is filled: a voided line of a till
  ticket hands nothing over.
- `only` hands over only the lines that match: `{ "column": "method", "eq": "gift_card" }` on a
  table of payments, so a cash payment is never a card's.
- `{ "parent": "hold_until" }` reads a column of the order rather than of the line.

Two tables of lines under one parent give their rules different ids.
