<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § Discounts, codes and gift cards on an order; do not edit -->

# Building on an add-on: Discounts, codes and gift cards on an order

Offers & gift cards (`offers`) keeps offers, discount codes, vouchers and gift cards in its own
tables, with a ledger, `value`. Its four shapes are not built as new tables: each is **added to
tables your app already has**. Nothing says `builtOn`; the rule on your table names the add-on, and
the install checks the rule against it. A till with `tickets`, `ticket_lines` and `payments` takes
all four.

**An order that takes discounts and codes** (`discountable@1`). The ticket gets `subtotal`,
`discount`, `net` and the four columns of a reduction given by hand; each line a `discount`; and a
new table keeps the codes typed on a ticket. The ticket's table carries the price rule and the
posting that counts what was used:

```json title="manifest/tables/tickets.json (the part that is new)"
{
  "adjust": {
    "by": { "addOn": "offers" },
    "lines": [{ "table": "ticket_lines", "via": "ticket_id", "price": "line_total",
                "discount": "discount", "what": [{ "column": "item_id", "as": "item" }],
                "excludes": { "column": "gift_card_id", "set": true },
                "paidBy": { "column": "voucher_id" } }],
    "order": { "discount": "discount",
               "staff": { "kind": "discount_kind", "value": "discount_value",
                          "reason": "discount_reason", "by": "discount_by" } },
    "codes": { "table": "ticket_codes", "via": "ticket_id", "typed": "typed",
               "code": "code_id", "voucher": "voucher_id", "removed": "removed_at" },
    "uses": "uses"
  },
  "postings": [
    { "id": "uses", "into": { "addOn": "offers", "ledger": "value", "action": "redeem" },
      "post": { "on": { "to": ["paid"] } },
      "reverse": { "on": { "to": ["void"], "from": ["paid"] } },
      "map": { "reason": "discount_reason" } }
  ]
}
```

- `price` is the line's own total (its price times its quantity), a column your table has.
- `what` names your own link to the thing sold; an offer for one item, category or tag reads it.
- `excludes` and `paidBy` are for a till that also sells cards and vouchers on the same lines: a
  line that loads a gift card takes no reduction, and a line that sells a voucher takes none and
  counts for no minimum. Leave them out where the lines sell neither.
- Adminium writes every `discount`, `discount_by`, and the two links of a typed code. A page lets
  staff type a code by adding a row to `ticket_codes`.

**A line that sells or tops up a gift card** (`card-sale@1`) and **one that sells a voucher**
(`voucher-sale@1`) are a posting each on the lines, read through the ticket:

```json title="manifest/tables/ticket_lines.json (the part that is new)"
"postings": [
  { "id": "card-load", "into": { "addOn": "offers", "ledger": "value", "action": "issue" },
    "via": "ticket_id",
    "post": { "on": { "to": ["paid"] } }, "reverse": { "on": { "to": ["void"], "from": ["paid"] } },
    "map": { "card": "gift_card_id", "amount": "load_amount" } }
]
```

**A payment a gift card makes** (`card-payment@1`) is a posting on the payments: the card is found
by the code typed, pays no more than is due and no more than it holds, and gets it back when the
payment is voided.

```json title="manifest/tables/payments.json (the part that is new)"
"postings": [
  { "id": "card", "into": { "addOn": "offers", "ledger": "value", "action": "spend" },
    "via": "ticket_id",
    "post": { "on": { "create": true } },
    "reverse": { "on": { "column": "voided_at", "set": true, "own": true } },
    "map": { "card": "card_id", "due": { "parent": "due" }, "amount": "amount",
             "balance_after": "card_balance_after" } }
]
```

`due` is the ticket's column that says what is still to pay. A payments table that also holds cash
names which rows are a card's with `only`.

**Check the fit.** Every column each shape needs, and what Adminium writes into it, is in
[The Offers shapes](https://docs.adminium.dev/reference/offers-shapes/), with a check an app runs in its own tests
(`shapeFit`). What the price rule does on a save, a quote and a return is in
[Discounts and codes](https://docs.adminium.dev/guides/apps/discounts-and-codes/).

In Adminium Designer, `build_on_shape` adds each shape to the tables you name for its parts.
