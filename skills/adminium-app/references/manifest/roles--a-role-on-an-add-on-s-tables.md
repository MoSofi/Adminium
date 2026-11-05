<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Roles — A role on an add-on's tables; do not edit -->

# Manifest spec: Roles — A role on an add-on's tables

### A role on an add-on's tables

An app's role may reach tables of an add-on the app names in [`addOns`](https://docs.adminium.dev/reference/manifest/#add-ons), with `tables`.
A manifest that uses it sets `compatibility.minAdminiumVersion` to `0.3.18` or later.

```json
"tables": [
  { "addOn": "inventory", "table": "transfers", "actions": ["read", "create", "update"],
    "limit": { "creatable": ["from_place_id", "to_place_id", "note"], "writable": ["status"] } },
  { "addOn": "inventory", "table": "stock_points", "actions": ["read"],
    "limit": { "readable": ["id", "item_id", "place_id", "on_hand"] } }
]
```

Up to 24 entries, one per table (more than 12 needs `minAdminiumVersion` `0.3.47`): enough for a shop's owner who reads a designer's tables, a stock add-on's, a carrier's and a calendar's together. `addOn` is the
add-on's key and `table` its own name for the table. `actions` are `read`, `read_pii`, `create`,
`update` and `delete`, never an export or an import. `read_pii` shows the table's personal columns
in clear (a design's words), and needs `read` in the same entry; `delete` removes rows (a version's
files, made again). Either needs `minAdminiumVersion` `0.3.47`. Neither is given on a ledger's
receipt table, and `delete` never on a table a ledger's code writes; `create` and `update` there
only where the add-on's `appGrants` allows them.

```json
{ "addOn": "customiser", "table": "design_versions", "actions": ["read", "read_pii", "create", "update"],
  "limit": { "creatable": ["app", "design_id", "version", "values"], "writable": ["proof_file"] } },
{ "addOn": "customiser", "table": "version_files", "actions": ["read", "create", "update", "delete"] }
```

`limit` is the object a role's [`limits`](https://docs.adminium.dev/reference/manifest/#roles) hold for one table, and narrows only an action
the entry gives: `readable` needs `read`, `writable` needs `update`, `creatable` needs `create`.
The grant is live while the add-on is connected to the app; the add-on's table and column names
are checked then. An add-on's own roles grant its tables through `permissions`, not `tables`.

The add-on may say how far an app's role goes on each of its tables
([`appGrants`](https://docs.adminium.dev/reference/manifest/#what-an-apps-role-may-hold-of-an-add-ons-table)). An entry is then cut to it: an
action or a column past it is left out, and an entry that asks for every column is given the
add-on's columns, never all of them. Nothing past it is ever written. The install check lists each
role's hold with its columns, and says what was asked for and not given. An update whose roles
would hold more than the running version's (a new action, a new column, a column list that becomes
every column) is refused with `ROLE_TABLES_WIDER` until the update is sent with
`"roleTables": true`. The update's check in Studio shows what is new, and pressing Update sends it.
