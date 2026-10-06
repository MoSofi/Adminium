<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — Codes that unlock rows; do not edit -->

# Manifest spec: Public access — Codes that unlock rows

### Codes that unlock rows

`unlockBy` makes an entry's rows readable only with a code that unlocks them: a presale code that
reveals its hidden ticket type.

```json
{ "table": "ticket_types", "methods": ["GET"], "select": ["id", "name", "price"],
  "unlockBy": { "table": "presale_codes", "column": "code", "link": "ticket_type_id",
                "where": [{ "column": "active", "eq": true }] } }
```

A row of `table` whose `column` holds the typed code, and whose `link` points at the entry's row,
unlocks it. `column` is compared as a [typed code](https://docs.adminium.dev/reference/manifest/#typed-codes) (`normalize: "code"`, or a `code`
column) and finds one row; `where` takes the same conditions as a lookup's. The entry only reads,
and is its own entry: no claim, no parent, not an availability entry. The code travels in the
`x-adminium-code` request header, never in the address: `?code=` is refused `400`
`PUBLIC_QUERY_REFUSED`.

A row may also open with **its own code** — a gift card's balance, read by whoever types the
card's code:

```json
{ "table": "cards", "methods": ["GET"], "select": ["balance"],
  "unlockBy": { "header": true, "column": "code", "self": true, "length": 12,
                "where": [{ "column": "status", "eq": "active" }] } }
```

`column` is a code column of the entry's own table, and the entry never shows it. With `length`,
a typed code of any other length — counted without the column's own prefix — opens nothing and is
never looked up. A wrong code here is counted apart from wrong discount codes: five a minute for a
visitor, sixty for the key. Needs Adminium 0.3.18.
