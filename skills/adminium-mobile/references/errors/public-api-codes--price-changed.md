<!-- produced from apps/docs/src/content/docs/reference/errors.md § Public API codes — Price changed; do not edit -->

# Error codes: Public API codes — Price changed

### Price changed

A page that shows a price and sends it back as `expect: { "total": "84.00" }` is held to it,
where the entry [checks a price](https://docs.adminium.dev/reference/manifest/#dry-runs-price-checks-and-retries). If the
write works out another figure, nothing is written and the answer is `409`
`PUBLIC_PRICE_CHANGED`:

- `total` is the figure the write would have saved, as text with the column's places, or `null`;
- `lines`, on a create with child rows, is those rows as the reply would have shown them, so the
  page can redraw the basket.

A change answers `total` alone. An `expect` sent to an entry that checks no price is a bare
`PUBLIC_WRITE_REFUSED`, and so is one sent with any quote: a quote shows the figures and checks
none.
