<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

| Rule | Shape | What it does |
|---|---|---|
| `file` | `{ "accept", "maxBytes", "maxCount"? }` | Files a signed-in person uploads for the column: one in a `text` column, a list of up to `maxCount` (1–20) in a `json` column. It holds Adminium's own file ids, never a link. `accept` names the kinds the column takes, judged by the file's bytes; `maxBytes` (1 KiB–25 MiB) the size of each. A picture loses what a camera writes beside it as it is uploaded. A write may name only a file its writer uploaded and no record holds yet. See [Files in a column](https://docs.adminium.dev/reference/manifest/#files-in-a-column). Needs Adminium 0.3.28. |
| `changes` | `[{ "to"?, "from"?, "while"?, "by"?, "notBy"? }]` | When, and by whom, the column may change: to some values only from others, only while another column holds a value, only by the person a staff column of the row (or of a linked row) names, never by the people others name. Judged by the server on every way a row is written but history. See [Who may change a column](https://docs.adminium.dev/reference/manifest/#who-may-change-a-column). Needs Adminium 0.3.35. |
| `retryKey` | `true` | The column a staff create keeps its retry key in, as a 43-letter hash, on a table no public entry creates rows of: a desk's payment sent again after a lost reply answers the payment the first one made (see the REST API's `clientKey`). A `text` column, `unique`, nullable, at least 43 long; one a table. |
| `history` | `"audit"` | The column's earlier values are kept for the audit log only, which the install's owner reads (a removed message's text). A row's history (`GET …/{record}/history`), a [removed row's](https://docs.adminium.dev/reference/manifest/#removed-rows) history and row, a rule's `{{was.<column>}}` and the row a removal's live frame carries leave the column out, for every reader, the owner included; the audit page keeps it. The value a row holds now is read as any other column is. A rule or a template of the manifest that reads `{{was.<column>}}` of such a column is refused. Not on the key. Needs Adminium 0.3.35. |
| `rollup` | `{ "from", "via", "sum" or "count", "times"?, "unlessSet"?, "where"?, "balance"?, "cap"? }` | A total over child rows, kept up to date as they change. `from` is the child table, `via` its foreign key back to this table, `sum` the column to add up, or `"count": true` to count the rows instead; see [Totals that count and climb](https://docs.adminium.dev/reference/manifest/#totals-that-count-and-climb). `times` multiplies each row (a quantity); a child row with a value in `unlessSet` is left out (a voided line). See [Totals and balances](https://docs.adminium.dev/reference/manifest/#totals-and-balances) for `where`, `balance` and `cap`. |
| `stamp` | `{ "set", "on", "clearOnBack"?, "strict"? }` | A value Adminium writes when something happens: the moment, who did it, or a deadline. See [Stamps](https://docs.adminium.dev/reference/manifest/#stamps). |
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
