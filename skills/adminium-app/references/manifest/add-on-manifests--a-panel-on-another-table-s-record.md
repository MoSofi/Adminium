<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — A panel on another table's record; do not edit -->

# Manifest spec: Add-on manifests — A panel on another table's record

### A panel on another table's record

`addOn.panels` draws one of the add-on's own screens, from its own bundle, in a tab of the record
page of every table that links into one of its tables through a `rules.addOnLink` column: a
design editor on an order line. From Adminium 0.3.43.

```json
"panels": [{
  "id": "customiser-design", "on": "designs", "client": "dist/panels/design.js",
  "title": { "key": "customiser.panel.design", "fallback": "Design" },
  "titles": { "de-DE": "Entwurf" }, "order": 10
}]
```

| Field | Rule |
|---|---|
| `id` | kebab-case, under the add-on's key (`<key>-…`), apart from its pages' refs: the panel's address and its permission, `page:<id>:view`. A role of the add-on grants it as it grants one of its pages: `page:@<id>:view`. |
| `on` | One of the add-on's own tables. The panel shows on the record page of each table with a `rules.addOnLink` column into it. |
| `client` | The file its route serves; its default export is the panel. A file of its own: never a page's or a slot fill's. |
| `title`, `titles` | Its tab's name, and the name in the other languages, by tag: the tab is named before any of its code runs. |
| `order` | 0–999: where its tab stands among the record's panels, lowest first. |

A panel is shown, and its code served, only while the add-on is installed and — on an app's table
— connected to that app and switched on, and only to a reader who reads the row, holds a grant on
the `on` table, and holds the panel's permission. Its code is served by
`GET /api/v1/add-ons/<key>/panels/<id>/bundle?connection=&table=&row=`, which asks all three
again (the row with the reader's row limits: `404` for a row they do not reach, `403` for a
missing grant or permission), pinned to the fingerprint the add-ons list gives for it, and never
by the open bundle address. The add-ons list names a panel's file only to a reader who holds its
permission.

The panel's default export is handed `{ connectionId, table, row, linked }`: the record's table
and key, and the key of the add-on's row it links to (`null` when the link is empty). It runs with
the [data kit](https://docs.adminium.dev/guides/add-ons-with-tables/#the-data-kit) of the add-on's own tables: it reads the
tables that hand it rows as the kit's hosts, and writes only its own. A fill of the slot
`record.editor.panel` is drawn as nothing, whether or not its file is there.
