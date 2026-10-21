<!-- produced from apps/docs/src/content/docs/guides/take-payments.md § When a payment arrives; do not edit -->

# Take payments: When a payment arrives

The service tells Adminium through the webhook, and Adminium also asks the service itself when a
customer comes back. If a webhook goes missing, a safety check finds the payment: every 15 minutes
while a payment is open, every hour while a bank is still confirming one.

The payment is written once, whichever of these finds it first. It is written with the person
**Online payment (Stripe)** or **Online payment (PayPal)** as the one who recorded it. When the
record is paid in full, its status is set as you mapped it. For a live payment, a receipt email
goes to the customer when the record has a customer email.

If the payment cannot be written (the amount differs from what is due, the invoice was voided, the
row is gone), nothing is refunded by itself. **Activity** shows it, the people who set up payments
are told, and a person decides. Usually that means a refund.

Every night Adminium checks the live payments of the last 30 days. If one's row is gone, voided, or
for another amount, it is flagged in Activity. This check never writes anything.
