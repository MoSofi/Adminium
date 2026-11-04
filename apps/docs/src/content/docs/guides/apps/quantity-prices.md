---
title: Prices by quantity, sheets and weight
description: How an app prices a line by its quantity break, counts the sheets or boxes a job needs, picks a delivery price by weight, and never charges more for fewer, all worked out by Adminium on the server.
---

A print shop's flyers cost less each at 1000 than at 500. A sheet holds 24 business cards, so 250
cards need 11 sheets. Delivery is priced by weight band. When the browser works these out, the
price a customer sees can differ from the one the shop stores, and a customer can send any price
they like. An app can instead let Adminium work every figure out on the server, in the write, from
three rules: a **band** picks the row a number falls in, a **copy** takes a value through it, and a
**formula** does the arithmetic, rounding up or down where the job calls for it.

The full rules are in the manifest reference: [Bands](/reference/manifest/#bands),
[Formulas](/reference/manifest/#formulas) and [Values from elsewhere](/reference/manifest/#values-from-elsewhere).

## A price for each quantity break

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

## Never more for fewer

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

## Sheets, boxes and rolls: rounding up

A job printed 24 to a sheet needs the quantity over 24, rounded up. `ceil` rounds up and `floor`
rounds down, on the exact value, so a quantity already a whole number of sheets stays as it is:

```json
{ "ref": "sheets", "type": "int", "nullable": true,
  "rules": { "formula": { "ceil": { "div": ["qty", "per_sheet"] } } } }
```

250 cards at 24 a sheet are 11 sheets; 240 are 10. Price the paper on `sheets`, not on `qty`.
`floor` gives the whole boxes a quantity fills, with the rest sold loose. Both take places as a
second part (`{ "ceil": [a, 2] }`) to round up to the cent.

## Delivery by weight

A band works over a [total](/reference/manifest/#totals-and-balances) of the order's lines too: the
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

## What the customer sees

A quote (`dryRun`) picks the bands and works out the formulas exactly as the save does, so the price
a basket shows before checkout is the price the order stores. Ask for a quote whenever the customer
changes a quantity, and show what it returns; never work a price out in the browser.

Every figure is exact: values are read as exact fractions, never as floating-point numbers, so a
line is the same on PostgreSQL, MySQL and SQLite to the last cent.

## Limits

- A band is its column's only filler: no `copy`, `default` or `lookup` beside it.
- A band's number may not read what is copied through its own link (the band would decide itself).
- `scope` takes one or two columns; bound columns hold the same type and link the same table.
- The band rule has no editor in the Studio yet: write it in the manifest.
