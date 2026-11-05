<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

| Field | Rule |
|---|---|
| `from` | The nullable `text` column of this row the code is typed into, up to 64 characters, with no rule of its own that decides it. |
| `table`, `column` | The codes table, and its `text` column the code is found by. The rule's own column is a nullable foreign key to `table`. `column` finds one row: it is `unique`, a [`code`](https://docs.adminium.dev/reference/manifest/#column-rules) column, or unique together with the `scope` columns in one of the table's [sets](https://docs.adminium.dev/reference/manifest/#columns-unique-together). It is compared as a code, so it has `normalize: "code"` unless it is a `code` column. Never the code a shared link opens its row with. |
| `where` | Up to 4 conditions on the codes row: `{ "column", "eq" }`; `{ "column", "notBefore": "now" or "today", "orEmpty"? }`, a date or time not yet past (`valid_until`); `{ "column", "notAfter": "now" or "today", "orEmpty"? }`, one already reached (`valid_from`). `orEmpty` lets an empty column pass. |
| `scope` | 1–2 `{ "column", "equals", "orEmpty"? }`: the codes row's `column` equals this row's `equals` column (this show's codes). With `orEmpty`, a codes row whose `column` is empty matches any (a code good for every show). |

A typed code is read the way codes are kept: upper case, spaces and dashes left out. A column
Adminium [makes codes in](https://docs.adminium.dev/reference/manifest/#column-rules) reads it as a claim does, its prefix put back, `O` as `0`,
`I` and `L` as `1`. Two stored codes that fold alike are told apart by the exact spelling.

Every miss is one answer: no such code, a code switched off, expired, another show's, or two that
fold alike are all refused `422` `VALIDATION_FAILED` on the typed column with the code `unknown`
(through the public API, `PUBLIC_WRITE_REFUSED` with `reason: "unknown"`), so a guesser learns no
more from one miss than from another. A code whose uses are all taken, counted by a
[parent limit](https://docs.adminium.dev/reference/manifest/#parent-limits) through the link, is refused on the typed column as `used-up`.
Emptying the typed column empties the link, and every copy made through it: a code taken off
takes its discount with it. A bulk edit, a form's child rows and an import find each row's code
the same way, and an unknown code refuses just that row. A table resolves at most two typed codes.

A code typed to **read** rows rather than write one (a presale code that shows its ticket type) is
a public entry's [`unlockBy`](https://docs.adminium.dev/reference/manifest/#codes-that-unlock-rows).

#### Bands

A `band` fills a foreign key with the row of a band table a number of this row falls in: a line's
quantity picks its product's price break, an order's weight its delivery band. A `copy` then takes
the band's multiplier or price through the link, and the formulas do the rest. The browser never
names the band row; Adminium picks it.

```json
{ "ref": "break_id", "type": "fk", "references": "price_breaks", "nullable": true,
  "rules": { "band": { "table": "price_breaks", "min": "min_qty", "value": "qty",
                       "scope": [{ "column": "product_id", "equals": "product_id" }] } } },
{ "ref": "multiplier", "type": "decimal", "scale": 4, "nullable": true,
  "rules": { "copy": { "via": "break_id", "from": "multiplier", "mode": "always" } } },
{ "ref": "line_total", "type": "decimal", "scale": 2, "nullable": true,
  "rules": { "formula": { "round": [{ "mul": ["unit_price", "qty", { "coalesce": ["multiplier", 1] }] }, 2] } } }
```

| Field | Rule |
|---|---|
| `table` | The band table. The rule's own column is a nullable foreign key to it. |
| `min` | The band table's number column holding each band's lower bound, inclusive. |
| `max` | Optional: the band table's number column holding its upper bound, inclusive. An empty `max` is a band open above. |
| `value` | This row's number column placed among the bands: one a write sets (typed, defaulted, copied), a [formula](https://docs.adminium.dev/reference/manifest/#formulas), or a [total](https://docs.adminium.dev/reference/manifest/#totals-and-balances) of child rows. |
| `scope` | 1–2 `{ "column", "equals" }`: only band rows whose `column` holds what this row's `equals` column holds (this product's breaks). The two columns hold the same thing (the same type, the same table linked). |
| `over` | What happens to a number past the `max` of its band: `"refuse"` (the default) refuses the write, `"empty"` leaves the link empty. |

**The pick.** Of the band rows within the scope whose `min` is at most the number, the one with the
greatest `min`. Coasters with breaks at 1, 4, 8 and 12: a quantity of 3 picks the 1-row, 4 the
4-row, 11 the 8-row, 12 the 12-row. No row at or below the number (a product with no breaks, a
line with no product yet, an empty number) leaves the link empty, and what is copied through it
is emptied too: `coalesce` in the formula says what that means ("multiplier 1"). The number is
compared exactly, as a formula counts, on every engine.

**Past the top.** A picked band with a `max` the number is past is over it. With `"over": "refuse"`
the write is refused `422` `VALIDATION_FAILED` with the code `out-of-range` on the number's column
(through the public API, `PUBLIC_WRITE_REFUSED` with `reason: "out-of-range"` and the column). With
`"over": "empty"` the link is left empty: an order over the top delivery band goes through with no
delivery price, for the shop to quote by hand.

```json
{ "ref": "weight", "type": "decimal", "scale": 3, "nullable": true,
  "rules": { "rollup": { "from": "order_lines", "via": "order_id", "sum": "weight" } } },
{ "ref": "delivery_band_id", "type": "fk", "references": "delivery_bands", "nullable": true,
  "rules": { "band": { "table": "delivery_bands", "min": "min_kg", "max": "max_kg",
                       "value": "weight", "over": "empty" } } },
{ "ref": "delivery_price", "type": "decimal", "scale": 2, "nullable": true,
  "rules": { "copy": { "via": "delivery_band_id", "from": "price", "mode": "always" } } }
```

**When it is picked.** A band whose number the write sets is picked with the copies, before every
copy that reads through it, so the copied price and the formulas after it see the band in the same
write. One over a formula of the row is picked once the row's formulas are worked out, and the
formulas over what it copies are worked out again. One over a total of child rows (or a formula
over one) is picked whenever the total settles: a guest's order created with its lines, a line
added, changed or removed by staff, an import. A quote (`dryRun`) picks it the same way, so it
gives the figures the save stores.

**Nobody else writes the link.** A value any writer sends for it, staff included, is dropped and the
band picks it; an import and an undo keep the link they bring, as history. A public entry may not
list it as writable. A band is the column's one filler (no `copy`, `default`, `lookup` or other rule
beside it), and its number may not read, through formulas, totals or copies, what is copied through
its own link: the band would decide itself.

#### Codes that renew

A ticket's code is the door's proof. When the ticket goes to somebody else, the old code must
stop working at once, and the new holder gets one the old holder never saw. `code.renew` says
what makes a new code:

```json
{ "ref": "code", "type": "text", "nullable": true,
  "rules": { "code": { "length": 8, "renew": { "on": { "column": "holder_customer_id", "changed": true } } } } }
```
