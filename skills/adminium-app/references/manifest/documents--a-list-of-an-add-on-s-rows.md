<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Documents — A list of an add-on's rows; do not edit -->

# Manifest spec: Documents — A list of an add-on's rows

### A list of an add-on's rows

A `collection` may list rows of an add-on's table that belong to the document's row. The add-on's
table has no foreign key into the app, so the rows are found by the pair the add-on keeps: the
stored name of a table and a row's key. A manifest that uses it sets
`compatibility.minAdminiumVersion` to `0.3.18` or later.

```json
"applied": { "collection": { "addOn": "offers", "table": "applications",
                             "match": { "table": "source_table", "row": "source_row" },
                             "orderBy": "id", "columns": { "label": "label", "amount": "amount" } } }
```

`addOn` is an add-on the manifest names in [`addOns`](https://docs.adminium.dev/reference/manifest/#add-ons). `table`, `match`, `orderBy`, `where`,
`unless` and the columns are the add-on's own short names; `match.table` is a column that carries
`"rules": { "tableRef": true }` and `match.row` a text column. Only plain columns are listed, none
read through a link. While the add-on is absent, detached or switched off the list is empty and
the document is drawn without it. The rows are the row's own, so whoever may draw the document
needs no grant on the add-on's table. Keep a [money code](https://docs.adminium.dev/reference/manifest/#documents-that-print-a-money-code) out
of a table listed this way.
