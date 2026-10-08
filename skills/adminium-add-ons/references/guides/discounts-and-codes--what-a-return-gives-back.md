<!-- produced from apps/docs/src/content/docs/guides/apps/discounts-and-codes.md § What a return gives back; do not edit -->

# Discounts, codes and refunds worked out by Adminium: What a return gives back

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
