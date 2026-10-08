<!-- produced from apps/docs/src/content/docs/guides/apps/discounts-and-codes.md § A price rule; do not edit -->

# Discounts, codes and refunds worked out by Adminium: A price rule

```json
{
  "ref": "orders",
  "adjust": {
    "by": { "addOn": "offers" },
    "lines": [
      {
        "table": "order_lines", "via": "order_id",
        "price": "unit_price", "quantity": "qty", "discount": "discount",
        "what": [{ "column": "item_id", "as": "item" }, { "column": "category_id", "as": "category" }],
        "unlessSet": "voided_at"
      }
    ],
    "order": {
      "discount": "discount",
      "customer": { "link": "customer_id", "address": "email", "proved": "customer_proved" },
      "staff": { "kind": "staff_kind", "value": "staff_value", "reason": "staff_reason", "by": "staff_by" }
    },
    "codes": { "table": "order_codes", "via": "order_id", "typed": "typed", "code": "code_id", "voucher": "voucher_id", "removed": "removed_at" },
    "frozen": { "to": ["paid"] },
    "expect": "total"
  }
}
```

A reduction is always **beside** an amount, never inside it. The shape that works:

```
line:   amount   = price × quantity      (before any reduction)
order:  subtotal = total of the lines' amount
        discount = what Adminium wrote
        net      = subtotal − discount
        tax      = round(net × rate ÷ 100)
        total    = net + tax
```

Tax is taken on the order's net, once, so a reduction split over three lines never costs or gains a
cent of tax.

The columns the rule names for a reduction, for who gave one by hand, for whether the customer was
proved, and the links a typed code fills, are **Adminium's to write**. No form, no public entry and
no import of a changed row sets them.
