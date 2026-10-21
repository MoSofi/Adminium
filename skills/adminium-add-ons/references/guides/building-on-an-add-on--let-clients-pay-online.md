<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § Let clients pay online; do not edit -->

# Building on an add-on: Let clients pay online

`invoice@1` takes the payments a person records after the money has arrived. To let clients pay an
invoice online through the shop's own Stripe or PayPal account, build on **`invoice@2`** instead
(Invoices & Receipts 1.0.13 or later; see [Take payments](https://docs.adminium.dev/guides/take-payments/)). It is `invoice@1`
with a payments part ready for online payments:

| Column | What it holds |
|---|---|
| `payment_ref` | Text, unique, empty until Adminium records an online payment. Never typed: it is how a payment is never written twice. |
| `provider` | The service the payment came through. |
| `refunded_amount` | How much of this payment was refunded. Starts at 0. |
| `net_amount` | `amount` less `refunded_amount`. |
| `approval_code`, `card_last4` | A card paid on the shop's own terminal: up to 12 letters and digits, and exactly 4 digits. |

`method` gains `online`, and the document's `paid` sums `net_amount`, so a refund opens the balance
again. The invoice's email and its reminders carry `{{pay_url}}`, and the printed invoice can show
its pay link and a code to scan while something is owed.

Spell out the `@2` parts from the add-on's manifest exactly as for `@1`. A table on `@2` is payable
as soon as the shop has set up payments: it needs no mapping in **Studio → Payments**.

An app already on `@1` moves to `@2` in an update of its own: the update adds the new columns, and
rows already there keep their payments. `@1` itself does not change.
