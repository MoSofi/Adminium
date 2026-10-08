<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — An add-on with tables of its own; do not edit -->

# Manifest spec: Add-on manifests — An add-on with tables of its own

### An add-on with tables of its own

| Field | Rule |
|---|---|
| `requiredSchema.prefixed` | `true`. Every table is created as `<key with _ for ->_<ref>`: `stock-kit` and `items` make `stock_kit_items`. A name that is taken is a problem on the check, never a rename. |
| `requiredSchema.tables[].indexes` | Up to six sets of one to five columns, each made as an index. A set equal to a unique set is refused. |
| `seeds` | `[{ "table", "rows" }]` or `[{ "table", "file" }]`: rows written once, at install, into a table that is empty. A value is a plain value, `{ "@t": { "en-US": "…", "de-DE": "…" } }` (written in the installing person's language) or `{ "@ref": "<label>" }` (the key of an earlier row that carries `"@label"`). Never for a ledger or a receipt table. The add-on's sample data may point at a labelled row written in `rows` (not one in a `file`) with the same `{ "@ref" }`: the row is found again by its one-of-a-kind column (`"unique": true`), else by its table's `keyField`. If the owner deleted it, the sample row that names it is left out. |
| `addOn.settingsTable` | A table that holds exactly one row. It is made at install from the columns' defaults, so every required column has one. |
| `roles` | As an app's. A role grants the add-on's own tables (`table:@items:read`), its own pages (`page:@stock-kit-items:view`) and its settings (`addOn:<key>:settings`). Never `screensOnly`. |
| `sampleData` | As an app's, for its own tables. |
| `publicAccess` | Entries as an app's. One with no `key` is served through the `customer` key of an app that names the add-on, once that is allowed. One with `key` set to the add-on's link key is served through that key. |
| `publicKeys` | At most one key, under a name that is not `customer`, with no `requiresStaff`, `enabledBy` or `peak`. It opens one row by its link and only reads: every entry on it has `"methods": ["GET"]` and either claims by token (`"claim": { "by": "token", "column": "…" }`, on a column with `rules.code { "length": 16, "hiddenFromStaff": true }`) or is read with the row a link opened (`visibleWith`, `claimedBy`). |

A column may keep the name of a table (`"rules": { "tableRef": true }`): Adminium stores it so
that renaming the table it names keeps the rows pointing at it.
