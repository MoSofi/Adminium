<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — Filters; do not edit -->

# Manifest spec: Public access — Filters

### Filters

A filter limits every read and every write of the entry.

| Filter | Rows it keeps |
|---|---|
| `{ "column", "op", "value" }` | `op` is `eq`, `neq`, `in`, `gte` or `lte`. |
| `{ "column", "op": "today" }` | Rows whose date or time falls on today. |
| `{ "column", "op": "from-today", "days"? }` | Rows from today onwards; `days` (1–366) limits how far, today included. |

`today` and `from-today` need a `date` or `timestamptz` column, and are worked out on every
request in the venue's time zone. A filtered column can be `writable` only when both
`writableWhen` and `writableValues` pin it; otherwise a write could move the row out of the
endpoint half-way.
