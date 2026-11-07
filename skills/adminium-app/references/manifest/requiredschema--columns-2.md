<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Columns; do not edit -->

# Manifest spec: requiredSchema — Columns

| Type | Created as |
|---|---|
| `id` | A string key (`varchar`). |
| `int`, `bigint` | Integer. With `role: "pk"`, the key numbers itself (an identity or auto-increment column); an explicit value is still accepted. |
| `text` | `text`, or `varchar(maxLength)`. A column with a `code` rule is exactly as wide as its codes. |
| `decimal`, `money` | Decimal. |
| `float` | Floating point. |
| `bool` | Boolean. |
| `enum` | A `varchar(32)` (or `varchar(64)` when a value is longer than 32 characters) with a check that limits it to the `enum` values. |
| `json` | JSON. |
| `date` | Date. |
| `time` | A time of day: `time` on Postgres and MySQL, text on SQLite. Needs Adminium 0.3.49. |
| `timestamptz` | Timestamp with time zone. |
| `uuid` | UUID. |
| `fk` | A foreign key, typed like its target's primary key. |
| `blob` | Binary. |

#### Defaults

A default must mean the same thing on Postgres, MySQL and SQLite, so only these are accepted:

- `timestamptz`: only the string `"now"`.
- `text`: a string, and the column needs `maxLength` (MySQL gives unbounded text no default). The
  default must fit in it.
- `enum`: one of its values.
- `int`, `bigint`: a whole number. `decimal`, `money`, `float`: a number.
- `bool`: `true` or `false`.
- `json`, `blob`, `date`, `id`, `uuid`, `fk` and primary keys take no default.

A value that comes from somewhere else when the row is made (the connection's currency, a
setting) is not a database default: use the [`default` rule](https://docs.adminium.dev/reference/manifest/#column-rules).

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
