<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

| Rule | Shape | What it does |
|---|---|---|
| `venueLocal` | `true` | A wall time given with no zone is read in the venue's time zone. |
| `personal` | `true` or `false` | Whether the column is personal data, overriding the guess Adminium makes from the column's name. |
| `secret` | `true` or `false` | Whether the column is a secret no response carries, to anyone, overriding the guess Adminium makes from the column's name (`api_token`, `password_hash`). An entry in [public access](https://docs.adminium.dev/reference/manifest/#public-access) that names no `select` leaves a `secret` column out, and a `code` column too. `false` is written only on a table the app's install made: on a table it reuses, a rule that would show a secret or take a personal column's mask off is skipped, the check step says so, and only an operator can show the column, in Studio, as Super Admin. A `secret` the operator set in Studio wins over the app's. On a column of an add-on's shape, only `true`. |

Tones are the dashboard's badge colours: `neutral`, `accent`, `info`, `pos`, `warn` and `danger`.

`copy`, `default`, `sequence`, `format`, `code`, `rollup`, `formula`, `stamp`, `lookup` and
`perNight` are values **Adminium decides**: they are filled on the server, so a browser never
picks a price, a number, a code or a time. So are a rollup's `balance` column, a booking's
late-cancellation [`flag`](https://docs.adminium.dev/reference/manifest/#booking) and a [late move's](https://docs.adminium.dev/reference/manifest/#late-moves) flag. None of them can be listed as `writable` in [public access](https://docs.adminium.dev/reference/manifest/#public-access), and
a primary key cannot take `sequence` or `code`.

One rule decides a column. The one pair allowed is a `copy` with a `default` behind it: the copy
comes first, and the default fills the column when the copy comes back empty (a client's own tax
rate, else the business's). A stamped column takes none of the others.

The [outbox's](https://docs.adminium.dev/reference/manifest/#outbox) own columns that Adminium writes (`status`, `sentAt`, `error`,
`skipReason`, `approvedBy`, `effectAt` and `effectError`) take none of these rules, nor `options`,
`validation`, `required`, `requiredWhen`, `notAfter` or `notBefore`: a stamp of who approved a
message would race Adminium for the column, and a rule that refuses a value would refuse what
Adminium writes, so every message the desk makes would be refused, or stuck. Its `to` and
`language`, which Adminium writes when it looks the address up, take none that decide a value, nor
`options`, `required` or `requiredWhen` (a desk leaves `to` empty to have it looked up); a
`validation` of the address a person types is fine. Nor may another column's rule read one of them
where the read could refuse Adminium's write: a note `requiredWhen` the status is `sent`, a `formula`
worked out from `effectAt`, a `notBefore` bound on `sentAt`. The install names the column, and a
Studio save refuses the same rules on an installed outbox's columns.

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
`rollup`, `formula`, `stamp`) takes no `requiredWhen`, because nobody is asked for it.

```json
{ "ref": "subtotal", "type": "money", "default": 0,
  "rules": { "rollup": { "from": "ticket_items", "via": "ticket_id", "sum": "unit_price",
                         "times": "qty", "unlessSet": "voided_at" } } }
```

#### Totals and balances
