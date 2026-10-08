<!-- produced from apps/docs/src/content/docs/reference/offers-shapes.md § `card-sale@1` — a line that sells or tops up a gift card; do not edit -->

# Offers shapes: `card-sale@1` — a line that sells or tops up a gift card

| Column | What it is |
|---|---|
| link to the order | the order whose payment makes the card active |
| `gift_card_id` | the card the line loads (an inactive card made for the sale, or a card being topped up) |
| `load_amount` | how much goes on it |

One posting with the action `issue`, when the order is paid; undone when it is cancelled, taking
back no more than the card still holds. A gift card cannot pay for a gift card: a table that
carries `card-payment@1` refuses a card payment on an order with such a line.
