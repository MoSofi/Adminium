<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — Assets; do not edit -->

# Manifest spec: Public access — Assets

### Assets

`assets` lists 1–8 file columns whose files any visitor's browser may load through the rows an
entry reads: a product's preview model a 3D viewer fetches, its print model, the shop's font, the
SVG pieces a book nook is cut from.

```json
{ "table": "products", "methods": ["GET"], "select": ["id", "name", "preview", "pieces"],
  "filters": [{ "column": "published", "op": "eq", "value": true }], "assets": ["preview", "pieces"] }
```

Each is a column with a [`file` rule](https://docs.adminium.dev/reference/manifest/#files-in-a-column) whose `accept` names only `glb`, `stl`,
`3mf`, `woff2` and `svg` (a `json` column holds a list), in `select`, never writable, never
personal or kept from readers, and neither one of the entry's `files` nor its `pictures`. The entry
only reads rows, for every visitor, on the app's `customer` key. A file is served at
`GET /api/v1/public/assets/…` only for the row it is attached to, as it was kept (each was read whole
or cleaned as it was uploaded), and only up to its kind's size: a model 30 MiB, a font or an SVG
2 MiB. A column listed here takes no larger file of that kind, whatever its own `maxBytes` says.
A column a guest uploads into (an entry's `uploads`) is never one of them.
`/public/config` gives the base as `assets`, and each entry's asset columns. Needs Adminium 0.3.43.
See [Models, fonts and SVG pieces on public pages](https://docs.adminium.dev/guides/apps/public-assets/).
