<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

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

`on` is one trigger or a list of 2–3: `{ "column", "changed": true }`, any change of another
column of the row, or `{ "column", "values" }`, that column moving to one of 1–16 values (a
transfer accepted). The watched column is not a code itself, not `json` or `blob`, and a `changed`
trigger watches a column a person changes or a stamp writes (a holder stamped in as an offer is
taken renews too).

The new code is written in the same statement as the change: the old one stops as the write
commits, and every session a [token link](https://docs.adminium.dev/reference/manifest/#a-persons-own-rows) on that column opened stops with
it. What never renews: a create (it makes a code anyway), an import or other history, a change that
sends back the value the row already holds, and a server action that writes the code itself (a
[new link](https://docs.adminium.dev/reference/manifest/#a-rows-own-link)). A [timed move's](https://docs.adminium.dev/reference/manifest/#timed-moves) `set` renews like any other change.
Undoing a change of hands renews once more, so neither the old code nor the one handed on works
after it; see [Undo of a move](https://docs.adminium.dev/reference/manifest/#undo-of-a-move). A renewed code is never shown to a public caller
in the change's reply, and only to staff who may read the table.

#### Stamps

A stamp writes a value when a row is created, or when another column changes to one of a list of
values: the time a patient checked in, who took a payment.

```json
{ "ref": "checked_in_at", "type": "timestamptz", "nullable": true,
  "rules": { "stamp": { "set": "now", "on": { "column": "status", "values": ["checked_in"] } } } }
```
