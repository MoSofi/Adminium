<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Add a table; do not edit -->

# A manifest, task by task: Add a table

One file per table, in `manifest/tables/`.

```json title="manifest/tables/customers.json"
{
  "ref": "customers",
  "label": { "en-US": "Customer" }, "labelPlural": { "en-US": "Customers" }, "keyField": "name",
  "columns": [
    { "ref": "id", "type": "int", "role": "pk" },
    { "ref": "name", "type": "text", "maxLength": 120, "default": "", "label": { "en-US": "Name" } },
    { "ref": "email", "type": "text", "maxLength": 200, "nullable": true },
    { "ref": "vip", "type": "bool", "default": false },
    { "ref": "created_at", "type": "timestamptz", "role": "created_at", "default": "now" }
  ]
}
```

- **Types.** `type` is one of `id`, `text`, `int`, `bigint`, `decimal`, `money`, `float`, `bool`,
  `enum`, `json`, `date`, `timestamptz`, `uuid`, `fk`, `blob`.
- **The key.** One column has `"role": "pk"`. An `int` key numbers itself and takes no `default`.
- **Empty or filled.** A column is `NOT NULL` unless it says `"nullable": true`. A column with
  neither `nullable` nor a `default` makes the check warn that it "has no default and is not
  nullable": every new row must then give it a value, and a form that does not show the column
  cannot save. Give it one of the two, unless a [rule](https://docs.adminium.dev/guides/apps/manifest-by-task/#values-adminium-fills-in) fills it.
- **Defaults.** A `text` default needs `maxLength`. A `timestamptz` default is `"now"` and nothing
  else. An `enum` default is one of its values. `date`, `json`, `blob`, `id`, `uuid` and `fk` take
  none.
- **`maxLength`** is for `text` only, from 1 to 1000. Without it the column is unbounded text,
  which can take neither a default nor `"unique": true`.
- **Names for people.** `label` is one row ("Customer"), `labelPlural` the table, and it needs
  `label`. `keyField` is the column that names a row where another table links to it; it must be
  one of the table's columns.

`"prefixed": true` in `app.json` names every table `<key>_<ref>` in the database
(`repairs_customers`), so two apps never collide. The manifest always uses the short ref.

Reference: [Tables](https://docs.adminium.dev/reference/manifest/#tables), [Columns](https://docs.adminium.dev/reference/manifest/#columns),
[Defaults](https://docs.adminium.dev/reference/manifest/#defaults), [Table names and `prefixed`](https://docs.adminium.dev/reference/manifest/#table-names-and-prefixed).
