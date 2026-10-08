<!-- produced from apps/docs/src/content/docs/guides/apps/discounts-and-codes.md § A reduction by hand; do not edit -->

# Discounts, codes and refunds worked out by Adminium: A reduction by hand

Staff take a percent or an amount off, or give the whole order away (`comp`), in the columns
`order.staff` names. Adminium reads the most the giver's roles allow from the add-on's own table
and refuses more (`ADJUST_REFUSED`, reason `over-ceiling`, with `max`). Somebody else's reduction
stays when another person saves the order; it is changed or removed only by somebody who could have
given it.
