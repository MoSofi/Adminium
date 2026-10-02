<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § 4. Keep the part's states; do not edit -->

# Building on an add-on: 4. Keep the part's states

The `document` part declares the invoice's life: a draft is sent once it has a line and a total
above zero, a sent invoice with nothing paid may be voided, and a sent or void invoice is locked
except for a few columns. The lines are locked with it, and payments are recorded only against a
sent invoice. See [States](https://docs.adminium.dev/reference/manifest/#states).

Your table spells out the same states, and may add to them in five ways: more columns that stay
writable in `lock.except` (its own), `roles` on a move, more child tables in `children`, more
of its own columns in a child's `clearOnCreate`, and, on a child, a `release` and `lockLinked`
over columns you added to it (a line's link to the time it bills, emptied once the invoice is void;
see [states](https://docs.adminium.dev/reference/manifest/#states)). The studio keeps voiding a sent invoice for its
managers, and a recorded payment clears the client's "I've paid":

```json
"states": {
  "column": "status", "initial": "draft",
  "moves": {
    "draft": [{ "to": "sent", "requires": { "children": { "invoice_lines": 1 },
                                            "where": [{ "column": "total", "gt": 0 }] } }, "void"],
    "sent":  [{ "to": "void", "requires": { "where": [{ "column": "paid", "eq": 0 }] },
                "roles": ["manager"] }]
  },
  "lock": { "when": ["sent", "void"], "except": ["due_on", "ladder", "void_reason", "client_paid_at"] },
  "children": {
    "invoice_lines": { "via": "document_id", "lock": true },
    "payments": { "via": "document_id", "parentIn": ["sent"], "clearOnCreate": ["client_paid_at"] }
  },
  "noDelete": { "when": "numbered" }
}
```
