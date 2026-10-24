<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

The rules are kept on every door a row is written through: a form, a bulk edit, an import, an
automation, the public API and an outbox's `onSent` change. `normalize`, `formula` and the
rounding to a `scale` apply on each of them. History keeps what it brings: an import and sample
data are not [stamped](https://docs.adminium.dev/reference/manifest/#stamps), not [capped](https://docs.adminium.dev/reference/manifest/#totals-and-balances), and not held to a date's
`notAfter` or `notBefore` — today, another date, now (they are held to [`linkable`](https://docs.adminium.dev/reference/manifest/#links-to-some-rows)); an undo puts a row back exactly as it was, with no rule at all.
What is no history is judged on an import and on sample data too: a number against a number, a
time of day against another, and an end at most `days` after a start (a file cannot bring in warm
above stale, or a cover of two years). A value refused by `notAfter` or `notBefore` answers `422`
`VALIDATION_FAILED`, the field's code `out-of-range`, on the column and, when the other column is of
the same row, on that one too, so a form shows the pair. A bound is judged when the column is
written, and when the other column, its `via` link or a column its conditions read changes (warm
changed alone is judged against the stale the row holds). `required` and
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
`options` or a link its [`linkable`](https://docs.adminium.dev/reference/manifest/#links-to-some-rows) leaves out, a date out of bounds, and a column only a change leaves empty, since whether it may be
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
`rollup`, `formula`) takes no `requiredWhen`, because nobody is asked for it. One exception is a
`copy` that only fills what a write leaves out (`mode: "default"`, without `follow`): the copy runs
first, and the column is asked for only when there was nothing to copy either (an order sent by
email needs an address: its supplier's, or one typed on the order). The other is a `stamp`: it fills
a person's own save, and never a write that brings history. A line of a brought file is judged as it
was sent, before any stamp: a deal brought in as won with no `closed_at` (`closed_at` stamped when
`state` becomes won or lost, and `requiredWhen` `state` is won or lost) is named in the import's
preview, `closed_at` `required`, and not brought in, never dated by the day of the import; one that
brings its date keeps it. Sample data is never stamped, so a sample's won deal carries its date too.
A stamp beside `requiredWhen` needs Adminium 0.3.35.

```json
{ "ref": "subtotal", "type": "money", "default": 0,
  "rules": { "rollup": { "from": "ticket_items", "via": "ticket_id", "sum": "unit_price",
                         "times": "qty", "unlessSet": "voided_at" } } }
```

#### Links to some rows

`linkable` says that a foreign key names only a row meeting some conditions: a quote line names a
price-list line that is still offered, so a rep cannot price a quote from a retired line the list
no longer gives.

```json
{ "ref": "price_id", "type": "fk", "references": "price_list", "nullable": true,
  "rules": { "linkable": { "where": [{ "column": "active", "eq": true }] } } },
{ "ref": "list_rate", "type": "decimal", "scale": "currency", "nullable": true,
  "rules": { "copy": { "via": "price_id", "from": "list_rate", "mode": "always" } } }
```

`where` is 1–8 conditions on the row the link names, in the shape a move's
[`linked`](https://docs.adminium.dev/reference/manifest/#conditions-a-move-waits-for) takes: `{ "column", <one test> }`, the test `eq` or `in`
(values that fit the column), `isNull`, or `gt`, `gte`, `lt` or `lte` on a number column. Every
condition must hold. The rule's column is a foreign key, and each condition names a column of the
table it points at that is not a `secret`.
