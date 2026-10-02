<!-- produced from apps/docs/src/content/docs/guides/apps/orders-with-lines.md; do not edit -->

# An order with its lines

A guest ordering lunch for pickup does not make one row. They make an **order**, two or three
**lines** (two burgers, one fries), and on each line the **options** they picked (cheese, no
onion, large). The kitchen must see all of it or none of it: an order that arrives without its
lines, or a line without its options, is worse than no order.

An app's create entry can therefore carry the rows that belong to the created row, two levels
down, in **one write**. Adminium checks every row, works out every price, takes every place a
limit counts, and commits the whole order or refuses the whole order. The same entry can also
answer a **quote** first (every figure, nothing kept), refuse a save whose total is not the one
the guest was shown, and answer a retried save with the order the first try already made.

This page follows a pickup kitchen. Tickets for a show and a hotel stay with its extras work the
same way; each has a short section [at the end](https://docs.adminium.dev/guides/apps/orders-with-lines/#tickets-for-a-show). The fields are in the
manifest reference, under [a create with its child rows](https://docs.adminium.dev/reference/manifest/#a-create-with-its-child-rows)
and [dry runs, price checks and retries](https://docs.adminium.dev/reference/manifest/#dry-runs-price-checks-and-retries).
