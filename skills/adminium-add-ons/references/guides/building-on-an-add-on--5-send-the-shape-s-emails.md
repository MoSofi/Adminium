<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § 5. Send the shape's emails; do not edit -->

# Building on an add-on: 5. Send the shape's emails

A shape can send email: `invoice@1` sends the invoice when it is sent, three held reminders
after its due date, and a receipt for each payment. An app built on the shape sends them too, so
its [outbox](https://docs.adminium.dev/reference/manifest/#outbox) has a kind, a producer and a template for each kind the
shape's outbox sends, with the shape's producers as the starting point:

```json
"outbox": {
  "table": "messages",
  "columns": { "kind": "kind", "status": "status", "to": "to", "due": "due",
               "skipReason": "skip_reason", "bodyOverride": "body_override",
               "approvedBy": "approved_by", "sentAt": "sent_at", "error": "error" },
  "links": { "invoice": "invoice_id", "payment": "payment_id", "client": "client_id" },
  "recipient": { "via": "client_id", "table": "clients", "email": "email", "name": "contact_name" },
  "kinds": { "invoice-sent": "studio-invoice-sent", "invoice-rung-1": "studio-invoice-rung-1", … },
  "producers": [
    { "kind": "invoice-sent", "link": "invoice_id",
      "onChange": { "table": "invoices", "column": "status", "to": "sent" } },
    { "kind": "invoice-rung-1", "link": "invoice_id", "hold": true,
      "onChange": { "table": "invoices", "column": "status", "to": "sent" },
      "due": { "date": "due_on", "at": "09:00",
               "days": { "setting": { "addOn": "invoices", "setting": "ladders" }, "byColumn": "ladder", "index": 0 } },
      "supersede": "rungs",
      "dropWhen": [{ "column": "balance", "lte": 0, "reason": "paid" },
                   { "column": "status", "eq": "void", "reason": "void" }] },
    …
  ]
}
```

A reminder is written `held`: the studio reads it, may reword it, and approves it or skips it. A
later reminder that comes due overtakes an earlier one not yet sent, and paying or voiding the
invoice drops the ones still waiting. See [Held messages](https://docs.adminium.dev/reference/manifest/#held-messages).

Write the templates in the app's own words, with the variables listed under
[Variables](https://docs.adminium.dev/guides/apps/emails/#variables) in An app's emails. The add-on's own templates use other
variable names: do not copy them.

The outbox table's `kind` enum lists every kind, its `status` enum includes `held`, and its links
are nullable foreign keys. A template may carry the invoice as an attachment with
`"attach": { "kind": "invoice", "link": "invoice" }`.
