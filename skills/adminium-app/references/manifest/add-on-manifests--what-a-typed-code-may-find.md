<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — What a typed code may find; do not edit -->

# Manifest spec: Add-on manifests — What a typed code may find

### What a typed code may find

`addOn.lookUp` says which of the add-on's tables a typed or scanned code is looked for in, and
what the answer may carry. Adminium reads the row; the add-on's code does not. A manifest that
uses it sets `compatibility.minAdminiumVersion` to `0.3.18` or later.

```json
"lookUp": {
  "kinds": [
    { "id": "gift-card", "table": "gift_cards", "code": "code", "prefix": "GC-",
      "show": ["label", "status", "balance"],
      "rows": { "table": "card_ledger", "via": "card_id", "columns": ["at", "kind", "amount"] } },
    { "id": "pack", "table": "vouchers", "code": "code", "prefix": "PK-",
      "where": [{ "column": "worth", "eq": "pack" }], "show": ["status", "uses_left"] }
  ],
  "address": { "table": "gift_cards", "column": "owner_email", "show": ["status", "balance"] }
}
```

| Field | Rule |
|---|---|
| `kinds` | 1–6, tried in order. `table` is one of the add-on's own; `code` is a text column with a `code` rule, or a unique one. |
| `prefix` | Two capitals and a dash. A typed value that starts with it is that kind's and no other's; no two kinds share one. |
| `where` | Up to 2 conditions `{ "column", "eq" }` or `{ "column", "in" }` on the row. Two kinds that read one table differ by it. |
| `show` | 1–16 columns of the found row the answer carries. |
| `rows` | One table of history, newest first: `via` is its foreign key to `table`, `columns` 1–8 of its columns. |
| `address` | Rows found by a customer's address instead of a code. `column` carries `normalize: "email"`. |

An answer never carries the code column, a `secret` column or a code kept from staff: a page shows
what was typed. A document kind may also be drawn on `a6`, a card of 105 × 148 mm, beside `a4`,
`letter` and `receipt-80mm`.
