<!-- produced from apps/docs/src/content/docs/guides/apps/public-pictures.md § Declaring them; do not edit -->

# Pictures on public pages: Declaring them

A picture lives in an **image column**: a text column with `"semantic": "image"`, which holds the
file Adminium keeps for it.

```json
{ "ref": "poster", "type": "text", "maxLength": 400, "nullable": true, "semantic": "image" }
```

A read-only entry of the guests' key names its image columns in `pictures`:

```json
{ "table": "events", "methods": ["GET"], "select": ["id", "name", "starts_at", "poster"], "pictures": ["poster"] }
```

The validator refuses `pictures` unless all of these hold:

| Field | Rule |
|---|---|
| `pictures` | 1 to 4 columns of the entry's table. |
| The entry | Only reads rows: `methods` is `["GET"]`, and it is not an availability entry. |
| The entry | Is for every visitor: no `claim`, `claimedBy` or `visibleWith`. A signed-in person's own files are `files` ([Files and documents](https://docs.adminium.dev/guides/apps/public-access/#files-and-documents)). |
| `key` | The app's `customer` key. |
| Each column | Text with `semantic: "image"`. |
| Each column | In `select`, when the entry has one. |
| Each column | Not written by the entry (`writable` or `defaults`). |
| Each column | Not in the entry's `files`. |
| Each column | Not kept from readers: not a secret, not a code, not a shared link's code. |
| Each column | Not personal data (`personal: true`). |

See the [manifest reference](https://docs.adminium.dev/reference/manifest/#pictures).
