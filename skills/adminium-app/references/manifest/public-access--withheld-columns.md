<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — Withheld columns; do not edit -->

# Manifest spec: Public access — Withheld columns

### Withheld columns

`withhold` leaves some columns out of a row for some readers: a ticket sent on to a friend keeps
its code from the buyer who sent it, and tickets of an order not yet paid show no code at all.

```json
"withhold": { "columns": ["code", "holder_email"], "unlessHolder": "holder_customer_id",
              "when": { "linked": [{ "via": "order_id",
                                     "where": [{ "column": "status", "in": ["held", "awaiting_transfer"] }] }] } }
```

| Field | Rule |
|---|---|
| `columns` | 1–8 columns of the entry's `select`, each once. |
| `unlessHolder` | On rows read through a parent (`visibleWith` or `claimedBy`): a foreign key to the person the key signs in. The columns are left out while it names someone other than the reader. |
| `when` | `{ "where"?, "linked"? }`: the columns are left out while the row, or a row one of its links points at, meets the conditions. |

A withhold names `unlessHolder`, `when`, or both; either one holding leaves the columns out. A
`when` holds for readers of the key the declaring entry is served through; mail and documents drawn
for a person read as the `customer` key, and a message to an address column as the row's own link
whose `address` names that column. A reader of no key at all (a document drawn for nobody) meets
every `when` about the row's state, and none declared through a row's own-link key. On a row's own
link, which names nobody, a withhold says `when` alone. No browser writes a column a withhold's
conditions read.

The columns are left out of every public read of the table, whichever entry declared the rule:
lists, one row, a change's reply, a replayed create, files, emails (values, rows and QR codes) and
documents. Filtering, searching or sorting by one is refused `400` `PUBLIC_QUERY_REFUSED`; a file
in one is served to its holder only; an email's `joins` and a document's lists never name one.
