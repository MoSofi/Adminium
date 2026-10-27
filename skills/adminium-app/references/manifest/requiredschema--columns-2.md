<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Columns; do not edit -->

# Manifest spec: requiredSchema — Columns

`"now"` is filled by Adminium on every create, through every door, so what the create works out can
read it (a visit's [hours](https://docs.adminium.dev/reference/manifest/#hours-between-two-moments) are there from the start). On MySQL the
database is given no default for it at all: an app's `timestamptz` is a `DATETIME` there, kept on
the Adminium server's clock, and the database — whose sessions Adminium keeps in UTC — could only
fill UTC's. A row written to that table outside Adminium, leaving the column out, gets nothing: it
stays empty, or is refused when the column may not be empty. Adminium also fills a MySQL `DATETIME`
whose database default is `CURRENT_TIMESTAMP` (a table made before, or one of your own) on its own
creates, with the server's own time: before, the database filled it with UTC's time, so on a server
not in UTC a row Adminium makes now differs from one another program stamps. On Postgres and SQLite
the database's own default is kept as well.

#### Decimal places

`scale` says how many places a `decimal` or `money` column keeps after the point:

| Value | Places |
|---|---|
| `0`–`4` | That many. |
| `"currency"` | The decimals of the row's own currency: 0 for JPY, 2 for EUR, 3 for KWD. The currency is read from the table's own column named `currency` when the table has one and the row fills it, else from the connection's currency, else 2 places. A value that is not a currency code Adminium knows counts as 2 places. |

```json
{ "ref": "total", "type": "decimal", "scale": "currency", "nullable": true }
```

Every value a write sends to the column is rounded to its scale, half away from zero, without ever
passing through a floating-point number. [Rollup](https://docs.adminium.dev/reference/manifest/#totals-and-balances) totals and
[formulas](https://docs.adminium.dev/reference/manifest/#formulas) round to it too. With `"currency"`, a document keeps the places of the
currency it was written in, even after the connection's currency changes. A decimal with no
`scale` is made with four places.
