<!-- produced from apps/docs/src/content/docs/reference/offers-shapes.md § `voucher-sale@1` — a line that sells a voucher or a pack; do not edit -->

# Offers shapes: `voucher-sale@1` — a line that sells a voucher or a pack

| Column | What it is |
|---|---|
| link to the order | the order whose payment makes the voucher usable |
| `voucher_id` | the voucher or pack the line sells (made waiting for its sale) |
| `amount` | what it was sold for: a pack's uses each carry their share of it |
| `tax_later` | yes where tax is charged when the voucher is used, not when it is sold |

One posting with the action `sell`, when the order is paid; undone when it is cancelled, unless the
voucher has been used since.
