<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § The people the app keeps; do not edit -->

# A manifest, task by task: The people the app keeps

`people.json` says which tables hold people (or companies), so e-mail to contacts and a person's
data (find, export, erase) can find them.

```json title="manifest/people.json"
[
  { "table": "customers", "kind": "people", "email": "email", "name": "name",
    "consent": { "column": "news_ok", "purpose": "newsletter" },
    "copies": [{ "table": "jobs", "column": "contact_name", "holds": "name", "via": "customer_id" }] }
]
```

- `email` must be the column the outbox writes to (`recipient.email`) when the outbox's
  `recipient.table` is this table.
- `consent` is a yes/no column. Leave it out if the app has none: the consent log holds it.
- List under `copies` every column on another table that holds the person's address or name, so
  an erasure blanks it too.
- `optOutMark` is a moment column with a strict stamp, set where your screen shows "you can say no
  to our mail": the screen's save sends `"optOut": { "shown": true }` beside its values. Leave it
  out unless your screens show that line.
- A name kept in parts is named by a formula column that joins them; never by the address.
- Moving off an old "unsubscribed" column or a tick kept on orders? `carry` brings it over once on
  the update. Keep the old column declared for that release.
- A tick a customer gives on your public pages is `consent` on that `access.json` entry, with the
  sentence shown and its version ([A consent tick](https://docs.adminium.dev/reference/manifest/#a-consent-tick)).

Reference: [People](https://docs.adminium.dev/reference/manifest/#people).
