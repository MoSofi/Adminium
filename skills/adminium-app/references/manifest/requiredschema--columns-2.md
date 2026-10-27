<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Columns; do not edit -->

# Manifest spec: requiredSchema — Columns

`scale` says how many places a `decimal` or `money` column keeps after the point:

| Value | Places |
|---|---|
| `0`–`4` | That many. |
| `"currency"` | The decimals of the row's own currency: 0 for JPY, 2 for EUR, 3 for KWD. The currency is read from the table's own column named `currency` when the table has one and the row fills it, else from the connection's currency, else 2 places. A value that is not a currency code Adminium knows counts as 2 places. |

```json
{ "ref": "total", "type": "decimal", "scale": "currency", "nullable": true }
```

Every value a write sends to the column is rounded to its scale, half away from zero, without ever
passing through a floating-point number. [Rollup](https://docs.adminium.dev/reference/manifest/#totals-and-balances) totals and
[formulas](https://docs.adminium.dev/reference/manifest/#formulas) round to it too. With `"currency"`, a document keeps the places of the
currency it was written in, even after the connection's currency changes. A decimal with no
`scale` is made with four places.
