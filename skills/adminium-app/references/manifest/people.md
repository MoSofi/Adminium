<!-- produced from apps/docs/src/content/docs/reference/manifest.md § People; do not edit -->

# Manifest spec: People

`people` says which of the app's tables hold people (or companies), and where. E-mail to contacts
reads it for an audience, a person's data (find, export, erase) for where a person is, and the
consent log for the column it keeps in step. One entry per table, up to eight:

```json
"people": [
  { "table": "contacts", "kind": "people", "email": "email", "name": "name",
    "company": "company_id", "language": "language", "firstName": "firstWordOfName",
    "consent": { "column": "may_email", "purpose": "newsletter" },
    "customer": "won_deals", "optOutMark": "opt_out_offered_at",
    "copies": [
      { "table": "quotes", "column": "sent_to_email", "holds": "email", "via": "sent_to_contact_id" },
      { "table": "sign_offs", "column": "signer_name", "holds": "name" }
    ] },
  { "table": "companies", "kind": "companies", "name": "name" }
]
```
