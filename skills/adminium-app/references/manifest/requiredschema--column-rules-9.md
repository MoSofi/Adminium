<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

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

A join with a `normalize` rule is kept as the rule says, the way a typed value is. A sample
request's `address_key`, a join over the postcode and the first line kept as a code, is
`SL71BT12QUAYSTREET` however the address is typed, so a `unique` key on it refuses the same
address in another case:

```json
{ "ref": "address_key", "type": "text", "maxLength": 160, "nullable": true, "unique": true,
  "rules": { "formula": { "join": ["postcode", "address_line1"] }, "normalize": "code" } }
```

It is kept so wherever the join is worked out: a create, an edit of a column it reads, a total
that moves under it, and an update that fills it for the rows already there. A row written
before keeps its key until one of those works it out again. Needs Adminium 0.3.45; before it,
only a join over a running number was kept so, and any other kept as it was worked out.

An app that works its formulas out itself, in a demo with no server, keeps the same value by
passing the column's rules to the evaluator: `evaluateFormula(expr, row, scale, formulaKeepOf(column))`
from `@adminium/manifest` applies the `normalize` rule, then cuts a join to the column's length,
as the server does. Needs `@adminium/manifest` 0.3.45.

A join that reads personal data lands it only in a personal column. A guest's first and last
names beside their email read as personal by their names, so the joined name needs
`"personal": true` too; without it the check refuses the manifest. The same holds for a `copy`
and a stamp's copy.

A join may read a running number or the text written from one (`format`): an order's number as a
person types it, kept as a code so a lookup finds "br-2291".

```json
{ "ref": "number_code", "type": "text", "maxLength": 16, "nullable": true, "unique": true,
  "rules": { "formula": { "join": ["number", " "] }, "normalize": "code" } }
```

The number is taken after the row's other formulas are worked out (a gapless one at the row's
INSERT, a counted one when it is claimed), so the formulas that read it are worked out again on
the number taken, in the same statement, and kept as their column's `normalize` says
(`BR-2291` → `BR2291`). Needs Adminium 0.3.44; before it, such a column stays empty.

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
| `sample` | `true`: the app's [sample rows](https://docs.adminium.dev/reference/manifest/#sample-data) may take numbers in the series, and the next real row follows them. For a series of the app's own (a job's `J-01`); never on a table built on an add-on's document. Needs Adminium 0.3.28. |

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
stay off the real series, unless the series is marked `sample`; see [Sample data](https://docs.adminium.dev/reference/manifest/#sample-data).

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
