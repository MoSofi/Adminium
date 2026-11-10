<!-- produced from apps/docs/src/content/docs/guides/apps/quantity-prices.md § A price for each quantity break; do not edit -->

# Prices by quantity, sheets and weight: A price for each quantity break

Keep the breaks in a table of the app, one row per product and lowest quantity:

```json
{ "id": "price_breaks", "columns": [
  { "ref": "id", "type": "int", "primaryKey": true },
  { "ref": "product_id", "type": "fk", "references": "products" },
  { "ref": "min_qty", "type": "int" },
  { "ref": "unit_price", "type": "decimal", "scale": 4 }
] }
```

On the order line, a `band` fills a link to the break the quantity falls in, a `copy` takes its unit
price, and a formula works out the line:

```json
{ "ref": "break_id", "type": "fk", "references": "price_breaks", "nullable": true,
  "rules": { "band": { "table": "price_breaks", "min": "min_qty", "value": "qty",
                       "scope": [{ "column": "product_id", "equals": "product_id" }] } } },
{ "ref": "unit_price", "type": "decimal", "scale": 4, "nullable": true,
  "rules": { "copy": { "via": "break_id", "from": "unit_price", "mode": "always" } } },
{ "ref": "line_total", "type": "decimal", "scale": 2, "nullable": true,
  "rules": { "formula": { "mul": ["qty", "unit_price"] } } }
```

- **The pick.** Of this product's breaks (`scope`), the one with the greatest `min_qty` at or below
  the quantity. With breaks at 100, 250, 500 and 1000, a quantity of 999 picks the 500 row.
- **No break below the quantity** (a product with none yet, a line with no product) leaves the link
  empty, and the copied price and the line total with it. Use `coalesce` in the formula when an
  empty break should mean something else.
- **Nobody sends the link.** A value any writer sends for `break_id`, staff included, is dropped and
  the band picks it. Use `"mode": "always"` on the copy, so a changed quantity takes the new break's
  price.
