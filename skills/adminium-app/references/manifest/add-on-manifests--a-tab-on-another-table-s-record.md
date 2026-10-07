<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — A tab on another table's record; do not edit -->

# Manifest spec: Add-on manifests — A tab on another table's record

### A tab on another table's record

`addOn.recordTabs` adds a tab of the add-on's rows to the record page of another table: the stock
a dish uses, on the dish. The tab is declared, not coded. Adminium draws it with the page's own
parts and the reader's own grants. A manifest that uses it sets
`compatibility.minAdminiumVersion` to `0.3.18` or later.

```json
"recordTabs": [{
  "id": "stock", "label": { "key": "kit.tab.stock", "fallback": "Stock" },
  "table": "links", "match": { "table": "source_table", "row": "source_row" },
  "on": "linked",
  "columns": ["item_id", "qty", "note"], "edit": ["qty"],
  "add": { "pick": { "table": "items", "label": "name" } }, "remove": true,
  "empty": { "key": "kit.tab.empty", "fallback": "Nothing is linked yet." },
  "summary": { "words": "units-left" },
  "actions": [{ "id": "use", "label": { "key": "kit.tab.use", "fallback": "Use stock" },
                "child": { "table": "uses", "form": ["qty"] } }]
}]
```

| Field | Rule |
|---|---|
| `table`, `match` | The add-on's own table whose rows the tab lists, and its two columns that say which record a row belongs to: `match.table` holds a table's stored name (`"rules": { "tableRef": true }`), `match.row` the row's key as text. |
| `on` | `"linked"`: every table a [posting rule](https://docs.adminium.dev/reference/manifest/#postings) hands in to this add-on as the row asked about. Or up to 24 tables by their stored names. |
| `columns` | 1–8 columns shown. `edit` lists those a reader who may change the rows edits in place. |
| `add` | `{ "pick" }`: a row is added by picking a row of another of the add-on's tables, shown by its `label` column. One pick, or two (an item or a kit). |
| `remove` | `true`: a row may be removed from the tab. |
| `form` | 1–8 columns: one row edited as a form, in place of a list. |
| `summary` | `{ "words" }`: one of the add-on's [stock words](https://docs.adminium.dev/reference/manifest/#stock-words), whose answer heads the tab. |
| `actions` | 1–2 buttons that add a row of another own table for the same record. |

An app's table has the tab only while the add-on is connected to that app and switched on. A
reader who cannot read the add-on's table has no tab; one who can is offered only what their role
allows. The add-on ships the tab's `label` and `empty` in its own strings; the rest of the tab's
words are Adminium's.
