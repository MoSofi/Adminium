---
title: Discounts, codes and refunds worked out by Adminium
description: How a table's price rule has an add-on lower an order's price inside the save, what a guest and a desk are told, how a code typed on an order is found and refused, how uses are recorded once, what a return gives back, and what the owner can switch.
---

From Adminium 0.3.19.

An add-on can keep **offers**: ten percent off this week, a second tote free, a code a customer
types, a voucher, a pack of ten visits. An app does not work any of that out itself. It says, with a
**price rule** on its order table, where a line's price and quantity are and where a reduction is to
be written — and whenever a save changes what an order costs, Adminium asks the add-on which
reductions apply, checks the answer, and writes them in the same transaction as the row itself. The
order's own totals are then worked out from what was written.

The fields are in the [manifest reference](/reference/manifest/#a-price-an-add-on-lowers); this page
is how they behave.

## A price rule

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

## When the price is asked

In every save that changes what the price rests on: a line added, changed or taken away; a code
typed or taken off; a reduction given by hand; the customer named. One question per order per save,
after the save's rows are written and before its totals. A save that touches none of that (a
kitchen status, a note) asks nothing.

A quote (`dry-run`) asks the same question on a transaction it rolls back, so a guest is shown the
price they will pay. Writes of many rows at once — a bulk edit, an undo, a form's child rows on an
edit, an import that changes stored rows — are refused for a row that would move a price
(`POSTING_REFUSED`, reason `one-at-a-time`): such a row is saved on its own.

Once an order reaches a state named in `frozen`, its price stands. A save that would change what it
rests on is refused (`ADJUST_REFUSED`, reason `frozen`).

## Who is buying

Offers for a known customer — a first order, a members' group, one use each — are judged only for
a customer whose identity was **proved**: a guest signed in through a verified session of that very
customer, or staff naming the customer at the desk. An address somebody typed into a checkout is
never looked up to decide a price, so what a stranger is told does not depend on whose address they
typed. A guest who types a code kept for one use each is told to sign in. Two addresses are two
customers: a second address gets a second use.

## A code typed on an order

A code is a row of the rule's `codes` table with the text as typed. Adminium finds it in the
add-on's own tables — a discount code, or a voucher by its routing word (`VC-…`) or its bare
scanned code — and fills the link. A code that does not stand refuses the save, on the field it was
typed into.

A guest is told one of four things: the code is not valid (`unknown` — also said for a code that
ran out, ended or was switched off, so the answer never says which codes exist), it needs a larger
order (`needs-minimum`, with the amount), it is not for anything on the order
(`not-for-these-items`), or it needs them to sign in (`needs-sign-in`). Only `unknown` counts as a
wrong guess. A desk is told the plain reason.

On a public create the code rows are sent **with the order**, as one of its child lists.

A save that sends `expect` and whose code ran out since the quote is answered `PRICE_CHANGED` with
what the order would cost without it; see [the price check](/guides/apps/orders-with-lines/#the-price-check).

## What a save says

Every save and quote in which a price was asked says which reductions applied:

```json
{ "applied": [
    { "line": "order_lines/1", "name": "Tote pair", "kind": "offer", "amount": "15.00", "typed": false },
    { "line": null, "name": "Autumn 5", "kind": "code", "amount": "5.00", "typed": true } ] }
```

One entry per reduction, in the reader's language. A reduction on one line names the line (by its
place in what was sent, or `<table>:<key>` at the desk); one spread over several is one entry with
their sum. A voucher carries `codeLast4`. No reply carries an add-on's ids, a whole code, or the
reason staff wrote beside a reduction by hand.

A guest who reads their own order again (`GET /public/records/:ref/:id`) is told the same, from the
rows that were kept — through an entry they prove the order is theirs by, and that shows the
order's reduction. A create sent twice with the same retry key answers as the first did.

## Uses are recorded once

A code with fifty uses must not be used fifty-one times, and an order must not use one twice. The
rule names a [posting](/guides/apps/postings/) into the add-on (`"uses": "<posting id>"`); in the
save in which that posting fires — the order is placed, or paid — the add-on says which uses the
order has and they are recorded under a lock, with the order.

After that, what the order used is closed. A code cannot be added, changed or taken off, nor the
reduction by hand or the customer changed (`POSTING_REFUSED`, reason `receipt-open`); a line added
later is priced under the offers the order already has, and a budget counts the reduction as it
stood. To change a code on a placed order, cancel it — the rule's `reverse` gives the uses back —
and make a new one.

## A reduction by hand

Staff take a percent or an amount off, or give the whole order away (`comp`), in the columns
`order.staff` names. Adminium reads the most the giver's roles allow from the add-on's own table
and refuses more (`ADJUST_REFUSED`, reason `over-ceiling`, with `max`). Somebody else's reduction
stays when another person saves the order; it is changed or removed only by somebody who could have
given it.

## What a return gives back

Name the table of refunds in `refunds`, with the lines a refund returns. In the save that makes a
refund row, Adminium prices the order again **without what was returned**, under the offers it had,
and decides the row's `amount` and `tax`: what the order cost, less what it would cost now, less
what earlier refunds gave back — never more than was paid in, and never more to a payment than it
took.

One mug back from a discounted order gives back what the order is now smaller by. One tote of a
two-for-one pair gives back nothing: the pair is gone and the tote kept is paid in full. A refund
is never "the returned thing's share".

A refund stands once made: it is not moved to another order or payment, and not deleted, while the
rule runs. The quote of a refund (`dry-run` of the refund row) answers the decided `amount` and
`tax` and a `refund` block: what was left to give back and what each payment may still be given.

## When the add-on cannot be asked

| The add-on is… | A save that would ask the price |
|---|---|
| not installed, or not connected to this app | saves at the order's own price; only a typed code is refused |
| switched off for the rule by the owner | the same: nothing is asked, only a typed code is refused |
| connected but switched off for the app, being updated, or its code cannot be loaded | refused (`POSTING_REFUSED`, reason `add-on-unavailable`), an order with no code included |

Money fails closed: an order is never saved at a price nobody worked out. The owner's switch is the
way through.

## What the owner can change

An owner switches an app's price rule off and on (`PATCH /connections/:id/tables/:table/adjust/switch`);
an app update leaves the switch be. For a table of their own they store a rule themselves
(`PUT …/adjust`), and may ask Adminium to add what the rule needs — the reduction columns, a line's
amount, the order's subtotal, net and total, the table of typed codes — with `make`, after a
`dryRun` that says what would be added. `GET /add-ons/:key/adjusts` lists every table whose price an
add-on lowers. All of it is in the [REST API reference](/reference/rest-api/).

## Trying an offer before it is on

`POST /data/:connectionId/:table/try` prices a **saved** order with other codes in place of its
own, as a guest or as a signed-in customer, and with an offer that is not saved yet — and writes
nothing. Asked to `explain`, it answers a reason for every offer that did not apply. It is what an
add-on's own "try it" pane calls; no price is ever made up on a page.
