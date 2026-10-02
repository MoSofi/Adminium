<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § 6. Print invoices and statements; do not edit -->

# Building on an add-on: 6. Print invoices and statements

The shape's document profiles (an invoice, a receipt) are made for your tables when the app is
installed, with their real names, and removed when it is uninstalled. A printed invoice also wants
the client's company and address, which are your columns, not the part's. A `documents` entry of
the same kind on the same table adds them to the shape's profile:

```json
"documents": [
  { "kind": "invoice", "addOn": "invoices", "table": "invoices", "name": { "en-US": "Invoice" },
    "mapping": { "customerName": { "via": "client_id", "column": "company" },
                 "customerLines": { "via": "client_id", "column": "address" } } },
  { "kind": "statement", "addOn": "invoices", "table": "clients", "name": { "en-US": "Statement" },
    "mapping": { "customerName": { "column": "company" } },
    "statement": {
      "documents": { "table": "invoices", "via": "client_id", "date": "issued_on", "amount": "total",
                     "number": "number", "where": { "column": "status", "in": ["sent", "void"] } },
      "payments":  { "table": "payments", "via": "client_id", "date": "paid_on", "amount": "amount",
                     "unless": "voided" } } }
]
```

A slot the add-on gives a default is filled when nothing else fills it, even when its column is
mapped but empty on the row: where the issue date's default is `now`, a draft with no issue date
yet is dated the day it is drawn, on the venue's clock, rather than refused as unmapped. See the
slot defaults under [Documents](https://docs.adminium.dev/reference/manifest/#documents).

The studio's own screens print a document with `POST /api/v1/apps/studio/documents/render`,
naming the kind, the table's ref and the row: `{ "kind": "invoice", "ref": "invoices", "pk": { "id": 42 } }`.

The statement lists a client's sent invoices and payments over a period (everything, this year or
the last twelve months), with an opening balance and a running balance. It is issued on the day
it is drawn. Each source's `via` points at the client, so the app adds a `client_id` to its `payments` table,
copied from the invoice the payment is for:

```json
{ "ref": "client_id", "type": "fk", "references": "clients", "nullable": true,
  "rules": { "copy": { "via": "document_id", "from": "client_id", "mode": "always" } } }
```

See [Documents](https://docs.adminium.dev/reference/manifest/#documents).
