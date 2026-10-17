<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

A `{ "table", "column" }` setting, wherever a rule reads one (a default, a limit's size, a move's
condition, a moment's time), names a table that holds **one row**: the outbox's
[`settings.table`](https://docs.adminium.dev/reference/manifest/#outbox), or a table that stands alone, with no foreign key of its own, none
pointing at it, and no states, limits or booking. Adminium reads that row when the rule runs. A
moment, a state condition or a stamp's amount that finds two rows there reads nothing rather than
guess which one is meant.

#### Copies that follow

A plain `copy` is taken when the row is written. With `"follow": true` it keeps in step: when the
row it copies from changes, every row that copies it takes the new value in the same write. A
hotel stay's extras copy the stay's nights and guests, so breakfast for two over three nights
becomes breakfast for three over four the moment the stay changes.

```json
{ "ref": "nights", "type": "int", "nullable": true,
  "rules": { "copy": { "via": "stay_id", "from": "nights", "mode": "always", "follow": true } } }
```

The copy is written, then every formula over it, then the totals it moves are settled into the
row it follows (the stay's total, tax and balance), before the change commits; if any of that is
refused, nothing is kept. A paid stay whose balance would fall below zero is refused
`409` `BALANCE_EXCEEDED`.

The rules that keep a follow sound:

- it always wins (`mode: "always"`), and follows one level: the column it copies does not itself
  follow another row;
- it never follows a total, a balance or a stamp, nor a formula over one: those change without a
  change of the row, so the copy would keep an old value;
- the row it follows is not worked out from this table's own totals (a loop);
- a total another table keeps of these rows reads none of what the follow writes, including the
  link it groups by: a follow that moved rows between another table's totals would leave those
  totals behind.

More than 500 rows following one changed row refuse the whole write, `409` `FOLLOW_TOO_MANY`
(`details.table`, `details.count`), rather than leave some behind. A bulk edit, an import or a
public batch that would move a paid balance below zero through its followers, or could not write
them under the caller's role, or would move more than 500, is refused before anything is written:
`409` `BALANCE_ONE_AT_A_TIME`. Make such changes one row at a time.

#### Prices by the night

`perNight` works a price out night by night: for each night from `from` up to the day before `to`,
the base rate read from the row `rate.via` points at, plus every adjustment row that matches that
night (a weekend, a season). Each night is rounded to the column's [scale](https://docs.adminium.dev/reference/manifest/#decimal-places), and
the column holds their sum.

```json
{ "ref": "room_total", "type": "money", "scale": "currency", "nullable": true,
  "rules": { "perNight": {
    "from": "arrive", "to": "depart",
    "rate": { "via": "room_type_id", "column": "base_rate" },
    "adjust": { "table": "rate_rules",
                "match": { "via": "room_type_id", "weekdays": "weekdays", "from": "from_date", "to": "to_date" },
                "add": "amount", "name": "name", "where": { "column": "active", "eq": true } } } } }
```

| Field | Rule |
|---|---|
| `from`, `to` | Two different `date` columns of the row: the first night, and the day after the last. |
| `rate` | `{ "via", "column" }`: a foreign key of the row, and the number column of the row it points at that holds the base rate. Never a secret or personal column. |
| `adjust` | Optional. `table` holds the adjustments; `add` is the number added to a night (negative for a discount) and `name` the `text` a night's line is tagged with. |
| `of` | Optional. `{ "via", "column" }`: this row's nights are a part of another row's price by the night (a credit for the nights a stay did not use): `via` a foreign key of this row, `column` that row's priced column. While that row's rates are the ones it was priced at, the part is today's price exactly; after they changed, it is scaled to what the row was charged, and never more than it. That column may not itself be a part. |
| `adjust.match` | Which adjustments apply to a night. `via`: a foreign key to what `rate.via` points at (empty on a row: every type). `weekdays`: a `text` column of at least 27 characters listing nights like `fri,sat` (empty: every night). `from`, `to`: `date` columns, the first and last night it applies on, both included (empty: open). |
| `adjust.where` | `{ "column", "eq" }`: only adjustments whose column holds the value (`active` is `true`). The column may not be nullable. |

The column is a `decimal`, `money`, `int` or `bigint`, and a table has one such price. A create
always works it out. A change works it out again only when it writes the dates or the rate's link
to something new, so rates edited later never re-price a stay already booked, and a form that
sends the whole row back keeps the booked price. An import keeps a figure it brings and works out
one it leaves out. Formulas read the price (a subtotal, the tax, the total), so they run after it.

The nights themselves are worked out, never stored: a dry run answers them (`date`, `rate`,
`base`, `tags`), staff read them at `GET /api/v1/data/<connection>/<table>/<id>/nightly`, and a
[document](https://docs.adminium.dev/reference/manifest/#documents) can list them. When the rates changed after the stay was priced, the lines
come back as one line equal to the stored figure, so a folio never prints lines that disagree with
its total. A rate rule that cannot be read refuses the write `409` `NIGHTLY_RATE_UNREADABLE`.

#### Typed codes

A `lookup` fills a foreign key from a code a person types: a discount code on an order, a presale
code on a ticket. The browser never names the codes row itself; Adminium finds it.

```json
{ "ref": "promo_code", "type": "text", "maxLength": 32, "nullable": true },
{ "ref": "promo_id", "type": "fk", "references": "promo_codes", "nullable": true,
  "rules": { "lookup": { "from": "promo_code", "table": "promo_codes", "column": "code",
                         "where": [{ "column": "active", "eq": true },
                                   { "column": "valid_until", "notBefore": "today", "orEmpty": true }],
                         "scope": [{ "column": "event_id", "equals": "event_id", "orEmpty": true }] } } }
```
