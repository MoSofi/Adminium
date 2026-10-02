<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Columns; do not edit -->

# Manifest spec: requiredSchema — Columns

Every value a write sends to the column is rounded to its scale, half away from zero, without ever
passing through a floating-point number. [Rollup](https://docs.adminium.dev/reference/manifest/#totals-and-balances) totals and
[formulas](https://docs.adminium.dev/reference/manifest/#formulas) round to it too. With `"currency"`, a document keeps the places of the
currency it was written in, even after the connection's currency changes. A decimal with no
`scale` is made with four places.
