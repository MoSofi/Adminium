<!-- produced from apps/docs/src/content/docs/guides/take-payments.md § What the customer sees; do not edit -->

# Take payments: What the customer sees

The pay page shows the shop's name, logo and contact, the invoice or record number, the amount due
and the due date, and the lines when you switched them on. It never shows the customer's name,
address or email, or their past payments: links get forwarded. A partly paid record says only how
much is already paid.

The customer chooses a way to pay and goes to the Stripe or PayPal page. When they come back, the
page says whether the payment arrived. A payment the bank still has to confirm, such as a SEPA
Direct Debit, says so and asks them not to pay again.

The pay page speaks the customer's language. It is in the eight languages Adminium speaks. The
Stripe page does not offer Arabic.

### From an app's own screens

An app whose payables you switched on may show **Pay now** on its own customer screens (an order,
a quote, a booking). Its **Pay now** opens the same pay page, and the pay page's **Back to …**
returns the customer to the app's screen. There the app asks Adminium how the payment stands and
says it in its own words: still being checked, paid, the bank confirming it, didn't finish, or the
time to pay ran out. The app is told that one word and nothing else of the payment: no amount, no
service and no card. While the app is switched off in Payments, its screens read as they always
did.
