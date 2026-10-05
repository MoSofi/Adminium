<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Pages — Tab words, filters and bulk actions; do not edit -->

# Manifest spec: Pages — Tab words, filters and bulk actions

### Tab words, filters and bulk actions

A `page-crud` page bound to a table may say three more things in its `config`. A manifest that
uses `tabs` or `bulk` sets `compatibility.minAdminiumVersion` to `0.3.18` or later.

```json
"config": {
  "tabs": { "receipts": { "empty": "Nothing received yet", "emptyBody": "A receipt shows here.", "noNew": true } },
  "filters": [{ "column": "status", "control": "any-of" }, { "column": "ordered_on" }],
  "bulk": [{
    "id": "reorder", "label": "Reorder",
    "child": { "table": "reorder_requests", "via": "point_id", "form": ["note"] },
    "set": { "source": "list" },
    "where": { "column": "state", "eq": "low" },
    "confirm": { "title": "Reorder {count} items?", "body": "One request is made for each.", "columns": ["name", "on_hand"] },
    "done": "{count} requested"
  }]
}
```

| Key | Rule |
|---|---|
| `tabs` | Keyed by a child table: one with a foreign key to the page's table. `empty` and `emptyBody` are what the tab says while it holds no row; `noNew: true` takes its "New" away, for rows made elsewhere. It words a tab the page already has: it adds none and renames none. |
| `filters` | Up to 6 columns of the page's table, each once. `control` is `one-of` or `any-of` for a choice, `yes-no`, `record` for a link, `date-range` or `number-range`; left out, the column's type decides. A free text column and the key cannot be filtered. |
| `bulk` | Up to 2 actions on the rows ticked in the list. Each adds one row of `child.table` per ticked row, linked through `via`, with `form` (up to 4 columns) typed once for all of them and `set` written on each. `where` keeps only the ticked rows that hold a value. `confirm.columns` (up to 8) are shown for each row before anything is made. |

A bulk action's `confirm.title`, `confirm.body` and `done` may name `{count}`, the number of rows,
and nothing else. Its `where` and `confirm.columns` never name a secret column or a code kept from
staff. A dashboard page's toolbar takes `layout.toolbar.links` in place of `link`: one or two
links of the same shape, at most one of them with `"tone": "primary"`.
