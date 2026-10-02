<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § Limits — Parent limits; do not edit -->

# Booking rules and limits: Limits — Parent limits

### Parent limits

A box office sells each ticket type up to its own capacity, only inside its sales window, at most
`max_per_order` of a type to one order, and never more than the hall holds across all of a show's
types. See [Parent limits](https://docs.adminium.dev/reference/manifest/#parent-limits).

```json
"capacity": {
  "kind": "parent",
  "via": "ticket_type_id",
  "size": { "column": "capacity" },
  "countWhere": [
    { "column": "status", "values": ["valid", "returned", "checked_in"] },
    { "column": "status", "values": ["held", "paid"], "via": "order_id" }
  ],
  "window": { "opens": "sales_start", "closes": "sales_end" },
  "perWrite": { "max": { "column": "max_per_order" }, "within": "order_id" },
  "also": [{ "via": "event_id", "size": { "via": "hall_id", "column": "capacity" } }],
  "lockBy": "event_id",
  "hold": { "column": "held_until", "states": ["held"], "via": "order_id" },
  "reserved": { "states": ["returned"] }
}
```

| Field | Rule |
|---|---|
| `via` | The foreign key to the row that holds the limit. A row whose `via` is empty is left out of this rule. |
| `size` | The limit: a number, a setting, or a numeric column of the row `via` points at. An empty column means no limit. |
| `amount` | How much a row takes: an `int` column of the row or a number. Absent, one. |
| `window` | Two `timestamptz` columns of the pointed-at row. A guest buys only between them. An empty one is no bound. Staff are not held to it. |
| `perWrite` | At most `max` of one pool per row of `within`, such as six tickets an order. `max` takes the same forms as `size`. |
| `also` | Up to two wider pools the same rows take from. `size` is a number, a setting, a column of the wider row, or `{ "via", "column" }` one hop further (the event's hall). |
| `day` | A `timestamptz` of the row, or `{ "column", "via" }` of its owner. Only rows of the same venue day count together. |
| `lockBy` | The column whose value names the lock: `via`, or a wider pool's key that the table copies from the `via` row. Absent, one lock for the whole rule. |

A kitchen's portions of a dish for today are a parent limit that counts by day. The number
written on the dish holds only on the day it is written for; on any other day there is no limit.

```json
"capacity": {
  "kind": "parent",
  "via": "menu_item_id",
  "size": { "column": "portions", "onDay": "portions_on" },
  "amount": "qty",
  "countWhere": { "column": "status", "values": ["held", "placed", "ready", "collected"], "via": "order_id" },
  "day": { "column": "pickup_at", "via": "order_id" },
  "hold": { "column": "held_until", "states": ["held"], "via": "order_id" }
}
```

The row `via` points at must exist, or the write is refused `out-of-range`. A guest outside the
sales window is refused `not-on-sale`. More than `perWrite` allows is refused `too-many`.
