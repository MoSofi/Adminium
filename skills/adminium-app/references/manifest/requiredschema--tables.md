<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Tables; do not edit -->

# Manifest spec: requiredSchema — Tables

### Tables

| Field | Required | Rule |
|---|---|---|
| `ref` | yes | snake_case. The table's short name. |
| `columns` | yes | At least one. Column refs must be unique within the table. |
| `label` | no | A [label](https://docs.adminium.dev/reference/manifest/#conventions) for one row ("Category"): form titles, buttons, empty states, link fields. Without it Adminium names the table from its real name. |
| `labelPlural` | no | A label for the table ("Categories"). Needs `label`. |
| `keyField` | no | The column that names a row wherever another table links to it (a category's `name`). Must be one of the table's columns. |
| `shape` | no | `<name>@<version>`, such as `menu@1`. Two apps that declare the same shape on a table can use one table between them. See [Shared tables](https://docs.adminium.dev/reference/manifest/#shared-tables). |
| `builtOn` | no | `<add-on key>/<shape name>@<version>`, such as `invoices/invoice@1`: the table is built on a shape an add-on defines. Needs `part`. See [Tables built on an add-on's shape](https://docs.adminium.dev/reference/manifest/#tables-built-on-an-add-ons-shape). A table has `shape` or `builtOn`, not both. |
| `part` | with `builtOn` | snake_case: which part of the shape the table is (`document`, `lines`, `payments`). Only a table with `builtOn` has one. |
| `capacity` | no | A limit on how much of a pool the table's rows may take (a time slot, a ticket type, a room type's nights), or a list of up to three; see [Capacity](https://docs.adminium.dev/reference/manifest/#capacity). |
| `booking` | no | Rows that book a person's time, never overlapping; see [Booking](https://docs.adminium.dev/reference/manifest/#booking). A table has `capacity` or `booking`, not both. |
| `states` | no | The states a row moves through, what is locked in each, and the child tables tied to them; see [States](https://docs.adminium.dev/reference/manifest/#states). |
| `unique` | no | 1–8 sets of 2–4 columns no two rows may hold the same values in together; see [Columns unique together](https://docs.adminium.dev/reference/manifest/#columns-unique-together). |

`label`, `labelPlural`, `keyField` and every column `label` are installed as the operator's own
labels would be. The operator can rename anything; a name they changed is theirs, and a later
version of the app does not overwrite it.
