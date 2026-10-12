<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

Every name a rule uses is checked against the manifest: `copy.via` must be a foreign key of the
table, `rollup.via` must point back at this table, and so on. `normalize` is for `text` columns
only.

The rules are kept on every door a row is written through: a form, a bulk edit, an import, an
automation, the public API and an outbox's `onSent` change. `normalize`, `formula` and the
rounding to a `scale` apply on each of them. History keeps what it brings: an import and sample
data are not [stamped](https://docs.adminium.dev/reference/manifest/#stamps), not [capped](https://docs.adminium.dev/reference/manifest/#totals-and-balances), and not held to `notAfter` or
`notBefore`; an undo puts a row back exactly as it was, with no rule at all. A date refused by
`notAfter` or `notBefore` answers `422` `VALIDATION_FAILED`, the field's code `out-of-range`.
A bound is judged when the date is written, and when its `via` link or a column its conditions read changes. `required` and
`requiredWhen` hold on an import and on sample data too; a value they refuse answers `422`
`VALIDATION_FAILED`, the field's code `required`. On every table, with a rule or without one, text
holding the character U+0000 (anywhere in a JSON value too) is refused the same way, the field's
code `invalid-character`: Postgres cannot store it, and MySQL and SQLite would keep what Postgres
refuses.

The public API answers a refused value with its one `400` `PUBLIC_WRITE_REFUSED`. When the value
was refused for itself, in a column the entry lets the caller write, `params` names the column and
why: `{ "column": "name", "reason": "too-long" }`, the reason `too-long`, `format`,
`invalid-character`, or on a create `required`. A batch adds the row's `index`. Anything else
names no column: a value already taken or pointing at a row that is not there, a value outside
`options`, a date out of bounds, and a column only a change leaves empty, since whether it may be
empty can turn on what the stored row holds.

#### Required for some values

`requiredWhen` asks for a column only while another column of the same row holds one of some
values:

```json
{ "ref": "person_id", "type": "fk", "references": "people", "nullable": true,
  "rules": { "requiredWhen": { "column": "kind", "in": ["away", "sick"] } } }
```

The row is judged as the write leaves it, whenever the write changes either column: a create or an
update that leaves `person_id` empty while `kind` is `away` or `sick` is refused, and so is moving
an event whose `person_id` is empty to `away`. A write that changes neither column is not judged —
a column sent back as it is stored, as the record form sends every field, is no change — so a row
stored before the rule can still be edited. Empty means no value, or only spaces. On a create that
leaves `kind` out, `kind` is its database default: a trip that is away unless it says otherwise
asks for a person. The record form marks the field required as soon as the other column holds one
of the values, and asks nothing of an edit that changes neither.

- **As the database compares.** A `bool` column's yes is a yes in any spelling (`true`, `on`, `y`,
  `1`, ` TRUE`), and it is stored as the answer it names on every engine; a word that is no yes and
  no no is refused. On MySQL a plain text column is compared as MySQL compares it, so `AWAY ` is
  `away` there, and asks for a person; Postgres and SQLite keep `Away` apart from `away`.
- **Two writers at once.** An update that moves `kind` to `away` over a person it did not send, or
  empties `person_id` over a `kind` it did not send, asks the database, in the same statement, that
  what it read is still so. Two people changing one event at the same moment cannot together leave
  it away with nobody named: the second is refused as the first would have been.

`column` is another column of the same table, and every value in `in` must fit it (a value of an
enum, a number for a number column, `true` or `false` for a `bool`). The rule's own column must be
`nullable`: one that is never empty is simply `required`. A column cannot take both `required` and
`requiredWhen`, and a column Adminium fills (`copy`, `default`, `sequence`, `format`, `code`,
`rollup`, `formula`, `stamp`) takes no `requiredWhen`, because nobody is asked for it. The one
exception is a `copy` that only fills what a write leaves out (`mode: "default"`, without
`follow`): the copy runs first, and the column is asked for only when there was nothing to copy
either (an order sent by email needs an address: its supplier's, or one typed on the order).

```json
{ "ref": "subtotal", "type": "money", "default": 0,
  "rules": { "rollup": { "from": "ticket_items", "via": "ticket_id", "sum": "unit_price",
                         "times": "qty", "unlessSet": "voided_at" } } }
```

#### Totals and balances

A rollup can also filter its child rows, keep a balance beside the total, and refuse a change
that would take the balance below zero: what a visit's fee, its payments and its write-offs need.

| Field | Rule |
|---|---|
| `where` | `{ "column", "eq" }`: only child rows whose column equals the value are added up (`voided` is `false`). The value must fit the column, and the column must not be nullable: a row left empty would drop out of the total unseen. |
| `balance` | `{ "column", "of", "minus"? }`: a second column of this row, kept as `of − minus… − total` (`balance = fee − waived − paid`). `minus` lists up to 4 columns. Every column named is a number column of this table, and the balance is a column of its own, with no rules of its own. |
| `cap` | `true`: a child write that would take the balance below zero is refused. It needs a `balance` on the same rollup, or a balance elsewhere on the row whose `minus` lists this total (a write-off is capped by the balance it lowers). |
| `capUnless` | `{ "column" }`, with `cap`: a yes/no column of the same row that lifts the cap while it is on (a stock level a shop sells from whether or not the count is right). The column is never empty. A balance guarded by two capped totals is lifted only when both name the same column. |
| `latest` | `{ "of", "by", "row"? }`, in place of `sum` and `count`: the column holds the value of `of` in the newest child row, the one whose `by` (a date, a time or a number) is the greatest (a deal's amount is the total of its last sent quote: `{ "from": "quotes", "via": "deal_id", "latest": { "of": "total", "by": "sent_at", "row": "quote_id" } }`). A row whose `by` is empty is left out; of two rows with the same `by`, the one with the greater key is taken; `where` and `unlessSet` leave rows out as they do of a total. The column is nullable (it is empty while no row qualifies) and of the type of `of`. `row` names a nullable column of this table that Adminium fills with the key of the row it took: a plain column of the key's type, not a link (a link would stop that row being deleted), with no rules of its own. No `times`, `balance` or `cap`. Kept in the statement that writes the child row, like a total, and it climbs like one: a line added to the quote that counts moves the deal. Needs Adminium 0.3.27. |

```json
{ "ref": "paid", "type": "money", "default": 0,
  "rules": { "rollup": { "from": "payments", "via": "visit_id", "sum": "amount",
                         "where": { "column": "voided", "eq": false },
                         "balance": { "column": "balance", "of": "fee", "minus": ["waived"] },
                         "cap": true } } }
```
