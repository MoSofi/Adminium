<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations — A summary for each person; do not edit -->

# Manifest spec: Automations — A summary for each person

### A summary for each person

```json
{ "kind": "digest", "templateKey": "crm-week", "to": { "roles": ["rep", "sales-manager"] },
  "sections": [
    { "key": "open", "table": "deals", "owner": "owner_id",
      "where": [{ "left": { "field": "state" }, "op": "is", "right": "open" }],
      "orderBy": { "column": "expected_close" }, "limit": 20 }
  ] }
```

The step runs in a rule by the clock with no `forEach`. For each person who holds one of the
roles it queues one email, sent at the day and time that person chose (at once for a person who
chose none). When it is sent, each section is read **as that person**: the rows of `table` whose
`owner` staff column names them, that meet `where`, among the rows their roles reach and with the
columns their roles show. A manager who reads every deal still gets a summary of their own; a
person who lost the role between the run and the send gets none; a person with nothing in any
section gets no email unless `"sendEmpty": true`. A summary that is waiting for its hour is not sent
once its rule is switched off or deleted, or its part is off. `{{count.<section>}}` is how many rows
there are, also when the section lists fewer.

The template draws each section with a rows block that names it, `{ "block": "email.rows",
"data": { "section": "open", "row": { "title": "{{row.name}}" }, "empty": "…" } }`, and may read
`{{name}}`, `{{appName}}`, `{{ruleName}}` and `{{count.<section>}}`. Up to 6 sections of up to 50
rows. The validator refuses a section whose `owner` is not a staff column, a section no rows
block draws, and a rows block that names no section.
