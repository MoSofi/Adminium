<!-- produced from apps/docs/src/content/docs/guides/apps/quantity-prices.md § Delivery by weight; do not edit -->

# Prices by quantity, sheets and weight: Delivery by weight

A band works over a [total](https://docs.adminium.dev/reference/manifest/#totals-and-balances) of the order's lines too: the
order's weight picks its delivery band whenever a line is added, changed or removed.

```json
{ "ref": "weight", "type": "decimal", "scale": 3, "nullable": true,
  "rules": { "rollup": { "from": "order_lines", "via": "order_id", "sum": "weight" } } },
{ "ref": "delivery_band_id", "type": "fk", "references": "delivery_bands", "nullable": true,
  "rules": { "band": { "table": "delivery_bands", "min": "min_kg", "max": "max_kg",
                       "value": "weight", "over": "empty" } } },
{ "ref": "delivery_price", "type": "decimal", "scale": 2, "nullable": true,
  "rules": { "copy": { "via": "delivery_band_id", "from": "price", "mode": "always" } } }
```

A band with a `max` the number is past is **over** it. `"over": "empty"` leaves the link empty (the
shop quotes delivery by hand); `"over": "refuse"`, the default, refuses the write with
`out-of-range` on the number's column, which a guest is told on that column.
