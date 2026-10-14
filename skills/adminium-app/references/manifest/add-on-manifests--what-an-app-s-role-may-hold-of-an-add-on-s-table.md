<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — What an app's role may hold of an add-on's table; do not edit -->

# Manifest spec: Add-on manifests — What an app's role may hold of an add-on's table

### What an app's role may hold of an add-on's table

An app gives its roles a hold on an add-on's tables with [`roles[].tables`](https://docs.adminium.dev/reference/manifest/#a-role-on-an-add-ons-tables).
The table is the add-on's, so the add-on says how far that may go, on the table itself:

```json
{ "ref": "suppliers", "columns": [ … ],
  "appGrants": { "actions": ["read"], "readable": ["id", "name", "lead_days", "active"] } }
```

| Field | Rule |
|---|---|
| `actions` | The most an app's role is given here: `read`, `create`, `update`. |
| `readable` | The only columns an app's read shows. Absent: every column but those in `never`, and never a secret. |
| `writable` | The only columns an app's update may change. Required when `actions` has `update`. |
| `creatable` | The only columns a new row an app's role adds may be given. Required when `actions` has `create`. |
| `never` | Columns no app's grant reaches, whatever else is listed. Not the key or a link: every read shows those. |

Once an add-on sets `appGrants` on one table, a table without it is given to no app's role. An
add-on that sets it on none is held only by its own shape: no hold on a ledger's receipt table,
read only on a table a ledger's code writes. A ledger's receipt table takes no `appGrants`, and a
table a ledger's code writes allows only `read`. Each column named must be one of the table's.

An app's entry is cut to it when it is written, and again whenever the add-on is installed,
updated, connected or switched back on. Whatever is cut is named: in the install check, and in the
reply as `narrowed` with `skipped: "ceiling"`, or `skipped: "not-offered"` for a table given to no
app. A grant on such a table always carries its column lists. The key and the links to other rows
are read with any read, as with every read limit.

A manifest that uses `appGrants` sets `compatibility.minAdminiumVersion` to `0.3.28` or later.
