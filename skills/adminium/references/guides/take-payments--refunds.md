<!-- produced from apps/docs/src/content/docs/guides/take-payments.md § Refunds; do not edit -->

# Take payments: Refunds

Someone with **Give refunds** opens **Refund…** from a payment on the Payment panel, or from
Activity:

1. The amount (at most what is still refundable), a reason and an optional note.
2. One sentence that says what will happen. It cannot be undone. **Refund**.

The panel then shows the refund as requested, and as done when the service confirms it, with who
asked for it and why ("By Ana Ruiz · Duplicate") to people who may see payments or give refunds;
others who can read the record see the refund without them. A refund the service refuses says why. The amount refunded opens the balance again. The old pay link is not
revived; **Copy pay link** makes a new one. The record's status changes only through the
"refunded in full" value you mapped.

A refund made in the Stripe or PayPal dashboard is recorded too, as made at the service, and
flagged in Activity so you can check it.

In an app that keeps refunds as rows of its own (a ticket shop's refund list), the app writes the
row and Adminium sends the money and marks the row as asked, on its way, done or not sent. Each mark
counts as a change of the row: the app's own rules and emails follow it, so a "Refund sent" email
goes out once when the refund is done.
