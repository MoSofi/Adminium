<!-- produced from apps/docs/src/content/docs/guides/apps/discounts-and-codes.md § A code typed on an order; do not edit -->

# Discounts, codes and refunds worked out by Adminium: A code typed on an order

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
what the order would cost without it; see [the price check](https://docs.adminium.dev/guides/apps/orders-with-lines/#the-price-check).
