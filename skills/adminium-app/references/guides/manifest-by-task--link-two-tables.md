<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Link two tables; do not edit -->

# A manifest, task by task: Link two tables

A link is an `fk` column whose `references` is the other table's `ref`.

```json title="manifest/tables/jobs.json"
{
  "ref": "jobs",
  "label": { "en-US": "Job" }, "labelPlural": { "en-US": "Jobs" }, "keyField": "title",
  "columns": [
    { "ref": "id", "type": "int", "role": "pk" },
    { "ref": "number", "type": "int", "rules": { "sequence": { "start": 1000 } } },
    { "ref": "title", "type": "text", "maxLength": 120, "default": "Untitled" },
    { "ref": "customer_id", "type": "fk", "references": "customers", "nullable": true },
    { "ref": "status", "type": "enum", "enum": ["open", "waiting", "done"], "default": "open",
      "rules": { "enumLabels": { "labels": { "open": "Open", "waiting": "Waiting for parts", "done": "Done" },
                                 "tones": { "done": "pos" } } } },
    { "ref": "priority", "type": "text", "maxLength": 40, "nullable": true,
      "rules": { "options": { "list": "priorities" } } },
    { "ref": "due_on", "type": "date", "nullable": true },
    { "ref": "done_at", "type": "timestamptz", "nullable": true,
      "rules": { "stamp": { "set": "now", "on": { "column": "status", "values": ["done"] } } } },
    { "ref": "created_at", "type": "timestamptz", "role": "created_at", "default": "now" }
  ]
}
```

- `references` is a table **ref** (`customers`), never the real name (`repairs_customers`) and
  never a column.
- A ref the manifest lacks links to a table the database already has under that name (a loyalty
  app on a shop's own `customers`). The check warns that the app then installs only on a database
  with that table, and the install refuses it anywhere else. When the warning names a table you
  meant to be the app's own, fix the spelling.
- The target must have exactly one `pk` column; the link takes its type.
- An `fk` takes no `default`. Make it `nullable` unless every row must have one.
- Forms and lists show the linked row by its table's `keyField`, so give the target one.

A link that may name only some rows says so with `linkable`: a quote line names a price-list
line that is still offered.

```json
{ "ref": "price_id", "type": "fk", "references": "price_list", "nullable": true,
  "rules": { "linkable": { "where": [{ "column": "active", "eq": true }] } } }
```

The conditions read the row the link names. A new row, or a change that moves the link, is refused
when that row does not meet them, by whoever writes and on every door; a row already naming a line
retired since keeps it while its other columns change. Hiding retired lines on a screen is not
enough on its own: a direct call, an import or a rule could still name one.

To compare the named row with the row being written, say `same`: a site visit names only a
contact of the company of the visit's deal.

```json
{ "ref": "contact_id", "type": "fk", "references": "contacts", "nullable": true,
  "rules": { "linkable": { "same": [{ "column": "company_id", "as": "deal_id.company_id" }] } } }
```

A change that moves the visit to another deal is judged too.

Reference: [Columns](https://docs.adminium.dev/reference/manifest/#columns), [Links to some rows](https://docs.adminium.dev/reference/manifest/#links-to-some-rows), [A row that must match the row written](https://docs.adminium.dev/reference/manifest/#a-row-that-must-match-the-row-written).
