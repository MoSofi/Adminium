<!-- produced from apps/docs/src/content/docs/guides/apps/quantity-prices.md § Sheets, boxes and rolls: rounding up; do not edit -->

# Prices by quantity, sheets and weight: Sheets, boxes and rolls: rounding up

A job printed 24 to a sheet needs the quantity over 24, rounded up. `ceil` rounds up and `floor`
rounds down, on the exact value, so a quantity already a whole number of sheets stays as it is:

```json
{ "ref": "sheets", "type": "int", "nullable": true,
  "rules": { "formula": { "ceil": { "div": ["qty", "per_sheet"] } } } }
```

250 cards at 24 a sheet are 11 sheets; 240 are 10. Price the paper on `sheets`, not on `qty`.
`floor` gives the whole boxes a quantity fills, with the rest sold loose. Both take places as a
second part (`{ "ceil": [a, 2] }`) to round up to the cent.
