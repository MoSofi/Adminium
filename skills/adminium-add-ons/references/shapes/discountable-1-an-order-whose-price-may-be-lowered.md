<!-- produced from apps/docs/src/content/docs/reference/offers-shapes.md § `discountable@1` — an order whose price may be lowered; do not edit -->

# Offers shapes: `discountable@1` — an order whose price may be lowered

Three tables: the **order**, its **lines**, and the **codes** typed on it.

| Table | Column | What it is |
|---|---|---|
| order | `subtotal` | the sum of its lines' amounts (a rollup) |
| order | `discount` | the order's reduction: the sum of its lines'. Adminium writes it |
| order | `net` | `subtotal − discount` (a formula) |
| order | `discount_kind`, `discount_value`, `discount_reason`, `discount_by` | a reduction staff give by hand: percent or amount, how much, a link to an Offers reason, and who gave it (Adminium writes the last) |
| order | a state, or a column that is set | when the order is paid, and when it is cancelled |
| lines | link to the order, `amount`, `discount` | the line's price times its quantity; its reduction. Adminium writes `discount` |
| lines | `item` | what the line sells: a link to the app's own item, and optionally its category, its type, a tag |
| codes | link to the order, `typed` | what the customer typed |
| codes | `code_id`, `voucher_id` | links to the Offers code or voucher it turned out to be. Adminium writes them |
| codes | `removed_at` | set when the customer takes a code off again |

The order's table carries the `adjust` rule, which names these columns, and one posting into the
ledger `offers` / `value` with the action `redeem`: what was used is counted when the order is
paid and given back when it is cancelled.

```json
{
  "adjust": {
    "by": { "addOn": "offers" },
    "lines": [{ "table": "lines", "via": "order_id", "price": "amount", "discount": "discount",
                "what": [{ "column": "item", "as": "item" }] }],
    "order": { "discount": "discount",
               "staff": { "kind": "discount_kind", "value": "discount_value",
                          "reason": "discount_reason", "by": "discount_by" } },
    "codes": { "table": "codes", "via": "order_id", "typed": "typed",
               "code": "code_id", "voucher": "voucher_id", "removed": "removed_at" },
    "uses": "uses"
  },
  "postings": [{
    "id": "uses",
    "into": { "addOn": "offers", "ledger": "value", "action": "redeem" },
    "post": { "on": { "column": "paid_at", "set": true } },
    "reverse": { "on": { "column": "cancelled_at", "set": true } },
    "map": { "reason": "discount_reason" }
  }]
}
```

A line that loads a gift card is left out of every reduction (`excludes`), and a line that sells a
voucher names it (`paidBy`), where the same table also carries the two sale shapes below.
