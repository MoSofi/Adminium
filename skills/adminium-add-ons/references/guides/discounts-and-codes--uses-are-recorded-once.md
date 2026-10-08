<!-- produced from apps/docs/src/content/docs/guides/apps/discounts-and-codes.md § Uses are recorded once; do not edit -->

# Discounts, codes and refunds worked out by Adminium: Uses are recorded once

A code with fifty uses must not be used fifty-one times, and an order must not use one twice. The
rule names a [posting](https://docs.adminium.dev/guides/apps/postings/) into the add-on (`"uses": "<posting id>"`); in the
save in which that posting fires — the order is placed, or paid — the add-on says which uses the
order has and they are recorded under a lock, with the order.

After that, what the order used is closed. A code cannot be added, changed or taken off, nor the
reduction by hand or the customer changed (`POSTING_REFUSED`, reason `receipt-open`); a line added
later is priced under the offers the order already has, and a budget counts the reduction as it
stood. To change a code on a placed order, cancel it — the rule's `reverse` gives the uses back —
and make a new one.
