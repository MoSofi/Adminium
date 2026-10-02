<!-- produced from apps/docs/src/content/docs/guides/apps/orders-with-lines.md § What a guest is told; do not edit -->

# An order with its lines: What a guest is told

| Code | Status | When |
|---|---|---|
| `PUBLIC_WRITE_REFUSED` | 400 | A row or value was refused. `child`, `index` and `path` name the row (`path` is its whole place, such as `["order_items", 1, "order_item_modifiers", 0]`); `column` and `reason` name the value, where the guest may be told. A list the entry does not offer, or with too many or too few rows, names the list with `reason` `not-offered`, `too-many` or `too-few`. |
| `PUBLIC_SOLD_OUT` | 409 | A line takes from a limit that is full: a dish's portions, a ticket type. `child`, `index`, `path` and `column` name the line and the column the limit counts by. |
| `PUBLIC_SLOT_FULL` | 409 | The order's time slot is full. |
| `PUBLIC_NO_ROOM` | 409 | A stay's room type has no room on a night; `night` names it. |
| `PUBLIC_SLOT_BUSY` | 409 | Another write held the same places at that instant. Nothing was written. Send the same save again, with the same retry key. |
| `PUBLIC_PRICE_CHANGED` | 409 | The total is not the one expected; `total` and `lines` say what it came to. Nothing was written. |
| `PUBLIC_LIMIT_REACHED` | 409 | A cap on a stranger's order is spent ([below](https://docs.adminium.dev/guides/apps/orders-with-lines/#limits-on-a-strangers-order)). |
| `PUBLIC_PROOF_REQUIRED` | 403 | The human check is missing, wrong or used. |
| `PUBLIC_SWITCHED_OFF` | 403 | Online orders are switched off, and this is not a retry of an order already made. |

The public client reads these for you: `error.refused` (`child`, `index`, `path`, `column`,
`reason`, `group`), `error.soldOut` (`child`, `index`, `path`, `column`), `error.priceChanged`
(`total`, `lines`), and `error.isTransient`, which is true for `PUBLIC_SLOT_BUSY`. Each getter is
`null` on any other code. Every code is listed in the [errors reference](https://docs.adminium.dev/reference/errors/).
