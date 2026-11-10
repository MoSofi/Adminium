<!-- produced from apps/docs/src/content/docs/guides/apps/quantity-prices.md § Never more for fewer; do not edit -->

# Prices by quantity, sheets and weight: Never more for fewer

Breaks apply "at or below", so 999 flyers at the 500 break can cost more than 1000 at the 1000 break.
Keep the next break's quantity and total on each break row (the shop fills them in with its prices;
a formula reads only its own row, so it cannot look up the next one), and let the line take the
lower of its own total and the next break's:

```json
{ "ref": "next_qty", "type": "int", "nullable": true },
{ "ref": "next_total", "type": "decimal", "scale": 2, "nullable": true }
```

On the line, copy both through the same link, and choose:

```json
{ "ref": "next_qty", "type": "int", "nullable": true,
  "rules": { "copy": { "via": "break_id", "from": "next_qty", "mode": "always" } } },
{ "ref": "next_total", "type": "decimal", "scale": 2, "nullable": true,
  "rules": { "copy": { "via": "break_id", "from": "next_total", "mode": "always" } } },
{ "ref": "line_total", "type": "decimal", "scale": 2, "nullable": true,
  "rules": { "formula": { "if": [{ "isNull": "next_total" },
                                 { "mul": ["qty", "unit_price"] },
                                 { "min": [{ "mul": ["qty", "unit_price"] }, "next_total"] }] } } }
```

The top break has no next one, so its line is its own total. Show the customer the hint ("1000 costs
less") from the same two columns: when `next_total` is the smaller, the next break is the better buy.
