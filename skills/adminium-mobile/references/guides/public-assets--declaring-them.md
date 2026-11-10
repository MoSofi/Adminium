<!-- produced from apps/docs/src/content/docs/guides/apps/public-assets.md § Declaring them; do not edit -->

# Models, fonts and SVG pieces on public pages: Declaring them

Each asset lives in a column with a [file rule](https://docs.adminium.dev/reference/manifest/#files-in-a-column) whose
`accept` names only these kinds. A `json` column holds a list, such as a book nook's pieces.

```json
{ "ref": "preview", "type": "text", "nullable": true, "rules": { "file": { "accept": ["glb"], "maxBytes": 26214400 } } },
{ "ref": "print", "type": "text", "nullable": true, "rules": { "file": { "accept": ["stl", "3mf"], "maxBytes": 26214400 } } },
{ "ref": "font", "type": "text", "nullable": true, "rules": { "file": { "accept": ["woff2"], "maxBytes": 2097152 } } },
{ "ref": "pieces", "type": "json", "nullable": true, "rules": { "file": { "accept": ["svg"], "maxBytes": 2097152, "maxCount": 12 } } }
```

A read-only entry of the guests' key names these columns in `assets`. Its filters say which rows
are published:

```json
{ "table": "products", "methods": ["GET"], "select": ["id", "name", "preview", "print", "font", "pieces"],
  "filters": [{ "column": "published", "op": "eq", "value": true }],
  "assets": ["preview", "print", "font", "pieces"] }
```

The validator refuses `assets` unless all of these hold:

| Field | Rule |
|---|---|
| `assets` | 1 to 8 columns of the entry's table, each named once. |
| The entry | Only reads rows: `methods` is `["GET"]`, and it is not an availability entry. |
| The entry | Is for every visitor: no `claim`, `claimedBy`, `visibleWith`, `unlockBy`, or a level read by a session alone. |
| `key` | The app's `customer` key. |
| Each column | Has a file rule whose `accept` names only `glb`, `stl`, `3mf`, `woff2` and `svg`. |
| Each column | In `select`, when the entry has one. |
| Each column | Not written by the entry, not in its `files` or its `pictures`. |
| Each column | Not kept from readers, and not personal data. |

See the [manifest reference](https://docs.adminium.dev/reference/manifest/#assets).
