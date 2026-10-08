<!-- produced from apps/docs/src/content/docs/guides/apps/discounts-and-codes.md; do not edit -->

# Discounts, codes and refunds worked out by Adminium

From Adminium 0.3.19.

An add-on can keep **offers**: ten percent off this week, a second tote free, a code a customer
types, a voucher, a pack of ten visits. An app does not work any of that out itself. It says, with a
**price rule** on its order table, where a line's price and quantity are and where a reduction is to
be written — and whenever a save changes what an order costs, Adminium asks the add-on which
reductions apply, checks the answer, and writes them in the same transaction as the row itself. The
order's own totals are then worked out from what was written.

The fields are in the [manifest reference](https://docs.adminium.dev/reference/manifest/#a-price-an-add-on-lowers); this page
is how they behave.
