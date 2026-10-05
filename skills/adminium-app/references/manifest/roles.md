<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Roles; do not edit -->

# Manifest spec: Roles

`roles` declares roles the app brings, such as a cashier and a manager. Each is installed as
`<key>-<role key>` (`pos-cashier`) and belongs to the app.

```json
{
  "key": "cashier",
  "name": "POS cashier",
  "screensOnly": true,
  "permissions": ["table:@tickets:read", "table:@tickets:create", "page:@pos-menu:view", "app:@:staff"]
}
```

| Field | Required | Rule |
|---|---|---|
| `key` | yes | kebab-case. The full `<key>-<role key>` must fit in 40 characters. |
| `name` | yes | 1–80 characters. |
| `permissions` | no | Grants, in the forms below. |
| `cloneFrom` | no | The key of another of this app's roles, whose grants this role also gets, and its `limits`. |
| `screensOnly` | no | `true`: people with this role open the app's own screens and never the dashboard. |
| `limits` | no | Per table ref, what the role's `update` there may change, and what its `read` there shows. See below. |

A manifest cannot know the real table names or page ids, so it grants through placeholders:

| Grant | Actions |
|---|---|
| `table:@<table ref>:<action>` | `read`, `create`, `update`, `delete`, `export`, `import`, `read_pii` |
| `page:@<page ref>:<action>` | `view`, `edit` |
| `app:@:staff` | Open the app's staff screens. |
| `addOn:<add-on key>:settings` | Edit that add-on's non-secret settings (the letterhead of an invoicing add-on). Only an add-on the app requires or suggests in [`addOns`](https://docs.adminium.dev/reference/manifest/#add-ons). |

`read_pii` shows the table's personal columns in clear. Without it they read as `null`, listed in
the row's `_masked`. A lookup into another table needs `read_pii` on that other table. See
[Personal data](https://docs.adminium.dev/guides/apps/roles-and-staff-access/#personal-data).

The plan refuses a `system:` grant, a wildcard, and a reference to a table or page the manifest
does not declare. Grants are given once: an update adds what a new version asks for, and an
operator's narrowing of an app role survives it.

`limits` narrows the role's `update` on a table to some columns and, for some of those, to some
values. The names are the ones [public access](https://docs.adminium.dev/reference/manifest/#public-access) uses:

```json
{
  "key": "clinician",
  "name": "Clinician",
  "permissions": ["table:@appointments:read", "table:@appointments:update", "app:@:staff"],
  "limits": {
    "appointments": {
      "writable": ["status"],
      "writableValues": { "status": ["roomed", "with_clinician", "ready"] }
    }
  }
}
```

| Field | Required | Rule |
|---|---|---|
| `writable` | no | The columns the update may change, at least one. |
| `writableValues` | no | For a column in `writable`, the only values it may set (1–32, each a value of the column). Needs `writable`. |
| `readable` | no | The only columns the role's read of the table shows, 1–200, each once. The key and the table's links to other rows are always read. Needs the role's `table:@<ref>:read`. |
| `creatable` | no | The only columns a new row the role creates may be given; the rest take their defaults or what Adminium decides. Needs the role's `table:@<ref>:create`. |
| `creatableValues` | no | For a column in `creatable`, the only values a new row may be given (1–32). Needs `creatable`. |

A limit names `writable`, `readable`, `creatable`, or any of them.

The table must be one the app declares, and the role must grant `table:@<ref>:update` itself or
through `cloneFrom`. Someone who also holds a role with an unlimited update on the table is not
limited. Creating rows is not limited by `writable`; `creatable` limits it the same way, on the
create itself, a row added from a parent's form, and an import (which may not bring in a column
outside `creatable`, nor one whose values are limited). A value left empty, and the state column at
its first state, are no choice and always pass. Every install and update writes the
manifest's current limits. See [Edits limited to some columns](https://docs.adminium.dev/guides/apps/roles-and-staff-access/#edits-limited-to-some-columns).

`readable` limits what the role **reads** the same way: housekeeping reads a stay's room and dates,
and none of its guest or its money.

```json
"limits": { "stays": { "readable": ["room_id", "arrive", "depart", "late_checkout", "status"] } }
```

Every staff read of the table holds to it: lists and records, links and lookups, search, exports,
imports, dashboard cards and their live updates, documents, the audit log, files kept in a hidden
column, and the page assistant. Selecting, filtering or sorting by a hidden column is refused `403`
`COLUMN_FORBIDDEN` with `details.reason: "read-limit"`; a lookup into one reads as masked. A
refusal never repeats a hidden value, and the desk's limit counts and nightly lines are refused
when the rule reads a hidden column. A hidden column is not written through the role either,
creates included, unless `writable` names it. Roles add up: two limited roles read the union of
their columns, one unlimited read of the table reads it all, and a Super Admin is never limited.

A role that signs in a staff-bound browser key (a check-in tablet; see [publicKeys](https://docs.adminium.dev/reference/manifest/#publickeys))
must be `screensOnly`, with no `cloneFrom` and no grant but `app:@:staff`.

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

Up to 12 entries, one per table. `addOn` is the add-on's key and `table` its own name for the
table. `actions` are `read`, `create` and `update`, never a delete, an export or an import.
`limit` is the object a role's [`limits`](https://docs.adminium.dev/reference/manifest/#roles) hold for one table, and narrows only an action
the entry gives: `readable` needs `read`, `writable` needs `update`, `creatable` needs `create`.
The grant is live while the add-on is connected to the app; the add-on's table and column names
are checked then. An add-on's own roles grant its tables through `permissions`, not `tables`.
