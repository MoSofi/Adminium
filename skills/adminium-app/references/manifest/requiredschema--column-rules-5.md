<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

- **The time that passed.** Hours are real elapsed time. A column that keeps a zone (Postgres
  `timestamptz`, MySQL `TIMESTAMP`) holds the moment itself. One that keeps none (MySQL `DATETIME`,
  which is what an app's `timestamptz` column becomes on MySQL, Postgres `timestamp`, and SQLite
  text) is read on the Adminium server's clock, the clock Adminium writes such times on. So on a
  server in Europe/London, 00:30 → 03:30 on the night the clocks go forward is `2.00`, and
  00:30 → 02:30 on the night they go back is `3.00`, on every engine. Run the server in the zone the
  times are kept in.
- **A time written without a zone.** Sent for a column that keeps a zone, `2026-09-25 11:45` is
  11:45 on the Adminium server's clock — the moment the hours are counted to and the moment that is
  stored, whatever zone the database's session is in. A stop stamped `now` is that moment too.
- **What SQLite keeps.** A start SQLite fills with `unixepoch()` (seconds since 1970) is read as
  that moment, and so is a text with its zone after a space (`2026-09-25 09:15:00 +02:00`).
- **Empty for a missing, impossible or backwards span.** An empty start or stop leaves the hours
  empty, and so does a day or an hour the calendar does not have (30 February stays no time, not 2
  March). So does a stop before its start: a negative number of hours would quietly take pay off a
  total, so the entry shows no hours until it is corrected. A stop equal to the start is `0.00`.
- **Too many to keep.** Hours the column cannot hold (centuries in a `numeric(6, 2)`) are refused,
  `422` `VALIDATION_FAILED` with the code `out-of-range` on the moments they are counted from, on
  every engine — never left for the database to refuse or, on SQLite, to keep. Any formula whose
  result its column cannot hold is refused the same way.

`daysBetween` counts calendar days the same way: two `date` columns of the row, the nights of a
stay from its arrival to its departure. A night the clocks change is still one night. An empty
date, or a `to` before its `from`, leaves the result empty.

#### Joined text

A `join` makes a `text` column from other columns and pieces of text: a guest's full name, a
line's description.

```json
{ "ref": "full_name", "type": "text", "maxLength": 160, "nullable": true,
  "rules": { "formula": { "join": ["first_name", " ", "last_name"] } } }
```

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
