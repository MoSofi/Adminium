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

**A link to the app's own staff side.** A toolbar link, or a card's `href`, may name `"@staff"`:
the app's staff screens, wherever the app placed them (inside the dashboard, or on their own
address in a new tab), as the sidebar's "Open the staff screens" opens them. `"@staff/<path>"`
opens one screen of them: `"@staff/approvals"` is `/a/<app key>/approvals` inside the dashboard,
or `approvals` under the side's own address. The path is a path under the side, as a
[`navLinks`](https://docs.adminium.dev/reference/manifest/#navlinks) entry's is: plain segments of letters, digits, `.`, `_`, `~` and `-`,
with no query, no `#` and no `..`; the manifest is refused otherwise, and when the app has no
`staff` frontend. A link is drawn only when the side can be opened. `@staff/<path>` needs
Adminium 0.3.28 (an older release draws no such link).

```json
"layout": { "version": 1, "toolbar": { "links": [
  { "label": "Approvals", "labels": { "de-DE": "Freigaben" }, "href": "@staff/approvals", "icon": "clipboard-check", "tone": "primary" }
] }, "items": [] }
```

**A dashboard card of a part, and its column headings.** A card of an app's `page-dashboard`
(an entry of `layout.items`) may say which [part](https://docs.adminium.dev/reference/manifest/#parts) of the app it belongs to with
`"module": "<id>"`: while that part is off the card is not drawn, for everybody, and the page
stays whole. A table card's columns (`config.columns`, as a `data-grid` heads them and a
`detail-key-value` names its rows) may give their heading in other languages with `labels`, keyed by tag as a page's `titles`
are: each reader sees the heading in their language, else `label`. Both need Adminium 0.3.28.

```json
{ "i": "unclaimed", "widget": "kpi-stat-card", "x": 3, "y": 3, "w": 3, "h": 3, "module": "inbox",
  "config": { "title": "Unclaimed enquiries", "binding": { "kind": "table-query", "source": { "name": "enquiries", "type": "table" }, "shape": "metric+delta", "aggregations": [{ "fn": "count", "alias": "n" }] } } }
```

```json
"columns": [{ "name": "name", "label": "Rep", "labels": { "de-DE": "Verkäufer", "ar-EG": "المندوب" } }]
```
