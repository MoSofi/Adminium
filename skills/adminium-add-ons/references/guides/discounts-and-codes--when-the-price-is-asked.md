<!-- produced from apps/docs/src/content/docs/guides/apps/discounts-and-codes.md § When the price is asked; do not edit -->

# Discounts, codes and refunds worked out by Adminium: When the price is asked

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
