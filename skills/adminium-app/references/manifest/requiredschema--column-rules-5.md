<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

A part that reads as a snake_case name is a column of the row; any other part (a space, `" · "`)
is text written as it is. A join reads `text`, `int` and `bigint` columns only: a decimal, a yes or
no, or a time would be spelled differently by each database. An empty column is left out, and so
is the text between it and its neighbour, so a guest with no last name is "Mia", not "Mia ". The
result is trimmed, and empty when every column is. A join is the whole formula of its column,
never a part of a sum.

A join that reads personal data lands it only in a personal column. A guest's first and last
names beside their email read as personal by their names, so the joined name needs
`"personal": true` too; without it the check refuses the manifest. The same holds for a `copy`
and a stamp's copy.

#### Numbers without gaps

A tax office expects an unbroken series of invoice numbers: none twice, none skipped. A
`sequence` with `"gapless": true` numbers rows that way.

```json
{ "ref": "number_seq", "type": "int", "nullable": true,
  "rules": { "sequence": { "gapless": true,
                           "startSetting": { "addOn": "invoices", "setting": "number_start_invoice" } } } },
{ "ref": "number", "type": "text", "maxLength": 24, "nullable": true, "unique": true,
  "rules": { "format": { "from": "number_seq",
                         "prefixSetting": { "addOn": "invoices", "setting": "prefix_invoice" }, "pad": 4 } } }
```

| Field | Rule |
|---|---|
| `gapless` | `true`. The column is an `int` or `bigint`, and nullable. |
| `start` | The first number, at least 1. |
| `startSetting` | The first number, read from a [setting](https://docs.adminium.dev/reference/manifest/#values-from-elsewhere) when the row is made. Not with `start`. |
| `scope` | A foreign key of the table: the series restarts for each row it points at (a deliverable's versions, v1, v2 …). |

`scope` and `startSetting` need `gapless`.

The number is the largest the table holds (for `scope`, the largest for that parent row) plus one,
and never less than the start. It is taken inside the transaction that inserts the row, so an
insert that fails takes its number back with it and the next create takes the same one. Two
creates at once never read the same largest number. When one is still taking the next number, the
other may be answered `409` `NUMBER_BUSY`, to try again. A number a writer sends is dropped, from
every writer but an import. A numbered row's create is never undone: undo is refused `409`, since a
number once taken stays taken; void the row instead.

`format` writes the number as text in the same statement:

| Field | Rule |
|---|---|
| `from` | The row's numbered column (one with a `gapless` sequence). |
| `prefix` | Up to 12 letters, digits and `- _ / .` (`INV-`). |
| `prefixSetting` | The prefix, read from a [setting](https://docs.adminium.dev/reference/manifest/#values-from-elsewhere) when the row is made. Not with `prefix`. A change applies to the next number. |
| `pad` | The digits are padded with zeros to this many (0–12). |

The `format` column is `text` and nullable, and its `maxLength` must hold the prefix and the
padding. Give the text a `unique` constraint, as the example does: a second guard against a
number twice, which MySQL's numbering also leans on.

An import brings its own history: it keeps the numbers its rows carry, and a row that carries only
the text, written as the table's prefix followed by digits, gets the number from those digits.
The series then carries on after the largest. Sample rows spell a gapless number `null`, so they
stay off the real series; see [Sample data](https://docs.adminium.dev/reference/manifest/#sample-data).

#### Values from elsewhere

A `default` rule fills a column on a create that leaves it empty, with a value read when the row is
made:

```json
{ "ref": "currency", "type": "text", "maxLength": 3, "nullable": true,
  "rules": { "default": { "from": "connection.currency" } } },
{ "ref": "tax_rate", "type": "decimal", "scale": 3, "nullable": true,
  "rules": { "default": { "from": { "addOn": "invoices", "setting": "default_tax_rate" } } } }
```

`from` is one of:

| `from` | Reads |
|---|---|
| `"connection.currency"` | The connection's currency, a three-letter code. The column is `text` of at least 3 characters. |
| `{ "table", "column" }` | A column of the app's one-row settings table. |
| `{ "addOn", "setting" }` | A setting of an add-on. The app must require that add-on in [`addOns.requires`](https://docs.adminium.dev/reference/manifest/#add-ons), so the setting is always there. |

The same three settings (the last two) are what `sequence.startSetting` and `format.prefixSetting`
read. A column with a `default` rule is nullable: when there is nothing to read, it stays empty
rather than taking a made-up value. An update never refills it.

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
