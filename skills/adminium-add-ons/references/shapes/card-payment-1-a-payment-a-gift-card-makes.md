<!-- produced from apps/docs/src/content/docs/reference/offers-shapes.md § `card-payment@1` — a payment a gift card makes; do not edit -->

# Offers shapes: `card-payment@1` — a payment a gift card makes

Two tables: the **order** (its `due`: what is still to pay) and its **payments**.

| Column | What it is |
|---|---|
| link to the order | which order the payment is for |
| `card_code` | what was typed or scanned |
| `card_id` | the gift card found by that code (a `lookup` over Offers' cards). Adminium writes it |
| `card_last4` | the card's last four characters, kept beside the payment for a receipt |
| `amount` | what the card paid: never more than is due, never more than the card holds. Adminium writes it |
| `card_balance_after` | what the card holds afterwards. Adminium writes it |
| `voided_at` | set when the payment is taken back: the card gets what it paid, less anything already refunded |

One posting with the action `spend`, when the payment row is created, undone when `voided_at` is
set. A table that holds cash payments beside card payments names which rows are the card's with
`only` — otherwise every rule of the posting is applied to the cash rows too.

A refund to the card is a posting of its own with the action `refund`, on the app's refunds table:
it names the payment row and the amount, and is refused above what that payment took.
