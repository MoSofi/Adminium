<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — Rows visible with their parent; do not edit -->

# Manifest spec: Public access — Rows visible with their parent

### Rows visible with their parent

An invoice's lines and payments are not the person's own rows by a column of their own: they are
the invoice's. `visibleWith` reaches them through the entry that reaches the invoice, so a draft's
lines stay as hidden as the draft.

```json
{ "table": "invoices", "methods": ["GET", "PATCH"], "level": "verified",
  "claimedBy": { "table": "clients", "column": "client_id" },
  "filters": [{ "column": "status", "op": "in", "value": ["sent", "void"] }],
  "select": ["number", "total", "balance", "client_paid_at"],
  "writable": ["client_paid_at"], "writableWhen": { "client_paid_at": [null] },
  "documents": ["invoice"] },
{ "table": "invoice_lines", "methods": ["GET"], "level": "verified",
  "visibleWith": { "table": "invoices", "via": "document_id" },
  "select": ["description", "qty", "rate", "amount"] },
{ "table": "payments", "methods": ["GET"], "level": "verified",
  "visibleWith": { "table": "invoices", "via": "document_id" },
  "select": ["number", "amount", "paid_on"], "documents": ["receipt"] }
```

| Field | Rule |
|---|---|
| `table` | The parent's table. Exactly one other entry on the same key reads it with `GET`: that entry is the parent. |
| `via` | This table's foreign key to the parent, or the parent's foreign key to this table. |

A row is reached only where the parent entry reaches the row it belongs to, with the parent's
filters and claim. An entry may be at most two steps from the entry its person claims (a
project's versions, through the project), and the chain must lead to a claimed person. An entry
with `visibleWith` takes no `claim` or `claimedBy`. It may `PATCH` the rows it reaches, naming
what it may write in `writable`, but not when a parent on its way up is on its own table: one
statement cannot change such a row on every database. On a key whose identity signs in by an
emailed link, it says `level: "verified"` like every other entry.

Where `via` is the parent's foreign key (a proposal naming its terms), that column is the link the
child's rows are read by. No entry on the key that creates or changes the parent's rows may write
it, choose its values or fill it by default (`writable`, `writableValues`, `defaults`): a browser
that could would re-point its own row at another person's child and read it. An entry that only
reads writes nothing, so it does not count.
