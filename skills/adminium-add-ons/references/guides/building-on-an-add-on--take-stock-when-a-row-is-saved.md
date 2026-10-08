<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § Take stock when a row is saved; do not edit -->

# Building on an add-on: Take stock when a row is saved

A clinic records what each visit used. A line names an item of Inventory and a quantity; the
stock is taken when the visit is marked `seen` and put back if it goes back to `booked` or is
cancelled.

```json title="manifest/tables/visit_supplies.json"
{
  "ref": "visit_supplies",
  "label": { "en-US": "Supply used" }, "labelPlural": { "en-US": "Supplies used" },
  "columns": [
    { "ref": "id", "type": "int", "role": "pk" },
    { "ref": "visit_id", "type": "fk", "references": "visits" },
    { "ref": "item_id", "type": "int", "nullable": true,
      "rules": { "addOnLink": { "addOn": "inventory", "table": "items" } } },
    { "ref": "qty", "type": "decimal", "scale": 3 }
  ],
  "postings": [
    {
      "id": "stock",
      "into": { "addOn": "inventory", "ledger": "stock", "action": "use-item" },
      "via": "visit_id",
      "post": { "on": { "column": "status", "in": ["seen"] } },
      "reverse": { "on": { "column": "status", "from": ["seen"], "in": ["booked", "cancelled"] } },
      "map": { "item": "item_id", "quantity": "qty" }
    }
  ]
}
```

```json title="manifest/add-ons.json"
{ "requires": [{ "key": "inventory", "range": ">=1.0.8", "reason": { "en-US": "Inventory keeps the stock a visit uses." } }] }
```

```json title="manifest/roles.json (the role's part)"
"tables": [{ "addOn": "inventory", "table": "items", "actions": ["read"], "limit": { "readable": ["name", "sku"] } }]
```

- `via` makes the lines follow the visit: `status` is the visit's column, and when the visit
  becomes `seen` every line is handed over in one call.
- `use-item` takes `item` and `quantity`. It also takes `place`, `batch` and a few more, all
  optional: with no `place`, stock comes from the default place in Inventory's settings.
- The app's `minAdminiumVersion` is `0.3.18` or later.

**The other way: a row that has a Stock tab.** A treatment always uses the same supplies. Staff
list them once, on the treatment's **Stock** tab in the dashboard, and the action `use` takes all
of them:

```json
"map": { "what": "treatment_id", "quantity": "times" }
```

`what` is a row: the row the rule is on (`{ "row": true }`), or the row an `fk` column of it
points at, as here. No link column and no grant are needed: nobody picks an item when saving.
`hold` is the same with a `reserve` step and a `heldUntil` column; `return` gives stock back.

The rule's fields, the three phases and what a writer is told when stock is short are in
[Rows that post into a ledger](https://docs.adminium.dev/guides/apps/postings/).
