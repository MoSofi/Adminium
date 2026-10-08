<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Stock from the Inventory add-on; do not edit -->

# A manifest, task by task: Stock from the Inventory add-on

Stock is kept by the Inventory add-on (`inventory`). The app builds no stock table: a table of
its own links to an item and posts into the add-on's ledger. Three part files change.

```json title="manifest/tables/job_parts.json"
{
  "ref": "job_parts",
  "label": { "en-US": "Part used" }, "labelPlural": { "en-US": "Parts used" },
  "columns": [
    { "ref": "id", "type": "int", "role": "pk" },
    { "ref": "job_id", "type": "fk", "references": "jobs" },
    { "ref": "item_id", "type": "int", "nullable": true,
      "rules": { "addOnLink": { "addOn": "inventory", "table": "items" } } },
    { "ref": "qty", "type": "decimal", "scale": 3 }
  ],
  "postings": [
    { "id": "stock",
      "into": { "addOn": "inventory", "ledger": "stock", "action": "use-item" },
      "via": "job_id",
      "post": { "on": { "column": "status", "in": ["done"] } },
      "reverse": { "on": { "column": "status", "from": ["done"], "in": ["open", "waiting"] } },
      "map": { "item": "item_id", "quantity": "qty" } }
  ]
}
```

```json title="manifest/add-ons.json"
{ "requires": [{ "key": "inventory", "range": ">=1.0.8", "reason": { "en-US": "Parts come out of stock." } }] }
```

- `manifest/roles.json`: the role that picks a part gets
  `"tables": [{ "addOn": "inventory", "table": "items", "actions": ["read"] }]`.
- `manifest/app.json`: `minAdminiumVersion` is `0.3.18` or later.
- `via` is the link to the job; `status` in `post` and `reverse` is then the job's column.

**Check** refuses: an add-on in `into` that `add-ons.json` does not name; a `map` or `via` column
the table lacks; a rule with neither `post` nor `reserve`. With the add-on in sight it also
refuses an input the action has not, and a needed input left unmapped.

In Adminium Designer the tool `post_to_ledger` writes all of this. By hand, copy the action's
input names from the add-on's manifest:
[An add-on that keeps its own tables](https://docs.adminium.dev/guides/building-on-an-add-on/#an-add-on-that-keeps-its-own-tables).
