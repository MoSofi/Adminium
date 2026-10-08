---
title: Offers shapes
description: The four parts an app spells out on its own tables to work with the Offers & gift cards add-on — an order that takes discounts, a payment by gift card, a line that sells a gift card, a line that sells a voucher — with the columns each needs.
---

From Adminium 0.3.19, add-ons 1.0.9.

An app that builds on [Offers & gift cards](/guides/add-ons/offers/) does not import anything from
it. The app writes, on its own tables and under its own column names, the rules below. Each group
of rules is a **shape**. The add-on's manifest lists the four shapes, and its source has a check,
`shapeFit`, that an app runs in its own tests to hold its tables to them.

A column named here is a column the app must have under a name of its choosing; the rule names the
app's own column. "Adminium writes it" means the app never sends a value for it.

## `discountable@1` — an order whose price may be lowered

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
voucher names it (`paidBy`), where the same table also carries the two sale shapes below. Each sale
shape says so itself (`inAdjust` on its `lines` part), so Adminium Designer writes the two words
into the price rule whichever shape it adds first; by hand, write them on the rule's line.

## `card-payment@1` — a payment a gift card makes

Two tables: the **order** (its `due`: what is still to pay) and its **payments**.

| Column | What it is |
|---|---|
| link to the order | which order the payment is for |
| `card_code` | what was typed or scanned |
| `card_id` | the gift card found by that code (a `lookup` over Offers' cards). Adminium writes it |
| `card_last4` | the card's last four characters, kept beside the payment for a receipt |
| `amount` | what the card paid: never more than is due, never more than the card holds. Adminium writes it |
| `card_balance_after` | what the card holds afterwards. Adminium writes it |
| `voided_at` | set when the payment is taken back: the card gets what it paid, less anything already refunded |

One posting with the action `spend`, when the payment row is created, undone when `voided_at` is
set. A table that holds cash payments beside card payments names which rows are the card's with
`only` — otherwise every rule of the posting is applied to the cash rows too.

A refund to the card is a posting of its own with the action `refund`, on the app's refunds table:
it names the payment row and the amount, and is refused above what that payment took.

## `card-sale@1` — a line that sells or tops up a gift card

| Column | What it is |
|---|---|
| link to the order | the order whose payment makes the card active |
| `gift_card_id` | the card the line loads (an inactive card made for the sale, or a card being topped up) |
| `load_amount` | how much goes on it |

One posting with the action `issue`, when the order is paid; undone when it is cancelled, taking
back no more than the card still holds. A gift card cannot pay for a gift card: a table that
carries `card-payment@1` refuses a card payment on an order with such a line.

## `voucher-sale@1` — a line that sells a voucher or a pack

| Column | What it is |
|---|---|
| link to the order | the order whose payment makes the voucher usable |
| `voucher_id` | the voucher or pack the line sells (made waiting for its sale) |
| `amount` | what it was sold for: a pack's uses each carry their share of it |
| `tax_later` | yes where tax is charged when the voucher is used, not when it is sold |

One posting with the action `sell`, when the order is paid; undone when it is cancelled, unless the
voucher has been used since.

## Checking the fit

The four shapes are in the add-on's manifest (`addOn.shapes`) and, one file each, in its source
(`packages/offers/src/shapes/` in the add-ons repository), beside the check that reads them
(`src/testing/fit.ts`, the function `shapeFit`). An app copies the shape files it adopts and that
one file into its own repository, and calls it in its own tests with its manifest, which of its
tables stands for which part, and the shapes:

```ts
const pairings = [
  { table: 'orders', shape: 'discountable@1', part: 'order' },
  { table: 'order_lines', shape: 'discountable@1', part: 'lines' },
  { table: 'order_codes', shape: 'discountable@1', part: 'codes' },
];
expect(shapeFit(manifest, pairings, [discountable])).toEqual([]);
```

It answers a list of what does not fit: a column that is missing or of another type, a rule that
names the wrong column, a posting that fires at another point. An empty list is a fit. Because the
files are copied, an app's tests do not need the add-on installed.
