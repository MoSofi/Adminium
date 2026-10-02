<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § 7. Open a portal for clients; do not edit -->

# Building on an add-on: 7. Open a portal for clients

A client signs in with a link emailed to their address, sees their sent invoices with the lines
and payments of each, opens the printed invoice, and says "I've paid" once:

```json
"publicAccess": [
  { "table": "clients", "methods": ["GET"], "select": ["contact_name"],
    "claim": { "verify": "email-link", "email": "email" }, "humanCheck": true },
  { "table": "invoices", "methods": ["GET", "PATCH"], "level": "verified",
    "claimedBy": { "table": "clients", "column": "client_id" },
    "filters": [{ "column": "status", "op": "in", "value": ["sent", "void"] }],
    "select": ["number", "status", "total", "balance", "due_on", "client_paid_at"],
    "writable": ["client_paid_at"], "writableWhen": { "client_paid_at": [null] },
    "documents": ["invoice", "statement"] },
  { "table": "invoice_lines", "methods": ["GET"], "level": "verified",
    "visibleWith": { "table": "invoices", "via": "document_id" },
    "select": ["description", "qty", "rate", "amount"] },
  { "table": "payments", "methods": ["GET"], "level": "verified",
    "visibleWith": { "table": "invoices", "via": "document_id" },
    "select": ["number", "amount", "paid_on"], "documents": ["receipt"] }
]
```

The lines and payments are reached through the invoice entry, so a draft's lines are as hidden as
the draft. Nothing a client writes can touch a number, a total or a balance: those are values
Adminium decides. See [Public access](https://docs.adminium.dev/reference/manifest/#public-access) and
[Rows visible with their parent](https://docs.adminium.dev/reference/manifest/#rows-visible-with-their-parent).
