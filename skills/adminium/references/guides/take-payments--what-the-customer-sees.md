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

Switching an app on or off changes more than its screens, when the app says so in its manifest
(Adminium 0.3.62 and later):

- **What a customer can make.** An app that asks for payment up front (a hotel set to "ask guests to
  pay now") takes a booking that waits for its payment while it can take payments online, and books
  as it always did while it cannot — whatever the customer's browser sends. Nobody gets the rooms
  unpaid by calling the app's public address directly.
- **Which emails go.** An app may send one email while it takes payments online ("Pay for your
  order") and another while it does not ("We'll send an invoice"), each with its own subject and
  preview line. A mail that only makes sense with payments on is not sent while they are off.
- **What waits for money on its way.** An order whose customer is paying is not moved to "pay when
  you pick up instead" while the bank is still confirming the payment; the customer is told to
  wait.
