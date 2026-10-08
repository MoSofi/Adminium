<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Discounts, codes and gift cards from the Offers add-on; do not edit -->

# A manifest, task by task: Discounts, codes and gift cards from the Offers add-on

Offers, discount codes, vouchers and gift cards are kept by the Offers add-on (`offers`). The app
builds no code or card table: its own order gets a few columns and one rule, `adjust`, and Adminium
asks the add-on the price inside every save.

```json title="manifest/tables/orders.json (the part that is new)"
{
  "adjust": {
    "by": { "addOn": "offers" },
    "lines": [{ "table": "order_lines", "via": "order_id", "price": "amount",
                "discount": "discount", "what": [{ "column": "item_id", "as": "item" }] }],
    "order": { "discount": "discount" },
    "codes": { "table": "order_codes", "via": "order_id", "typed": "typed",
               "code": "code_id", "voucher": "voucher_id", "removed": "removed_at" },
    "uses": "uses"
  },
  "postings": [
    { "id": "uses", "into": { "addOn": "offers", "ledger": "value", "action": "redeem" },
      "post": { "on": { "to": ["paid"] } },
      "reverse": { "on": { "to": ["cancelled"], "from": ["paid"] } }, "map": {} }
  ]
}
```

- The order needs `subtotal`, `discount` and `net`; each line an `amount` and a `discount`; and
  `order_codes` is a table of the app: the link to the order, `typed`, and two links into
  `offers.codes` and `offers.vouchers`. Adminium writes every `discount` and both links.
- `manifest/add-ons.json` requires `offers`; `manifest/app.json`: `minAdminiumVersion` is `0.3.19`
  or later.
- A payment a gift card makes, and a line that sells a card or a voucher, are a `postings` rule
  each on the app's own payments and lines.

Nothing says `builtOn`: the four shapes (`discountable@1`, `card-payment@1`, `card-sale@1`,
`voucher-sale@1`) are added to tables the app already has. In Adminium Designer the tool
`build_on_shape` writes all of it, given the app's table for each part. By hand:
[Discounts, codes and gift cards on an order](https://docs.adminium.dev/guides/building-on-an-add-on/#discounts-codes-and-gift-cards-on-an-order).
