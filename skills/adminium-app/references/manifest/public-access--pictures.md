<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — Pictures; do not edit -->

# Manifest spec: Public access — Pictures

### Pictures

`pictures` lists 1–4 image columns any visitor may see through the rows an entry reads: a dish's
photo on the menu, a room type's picture.

```json
{ "table": "menu_items", "methods": ["GET"], "select": ["id", "name", "price", "photo"], "pictures": ["photo"] }
```

Each is a `text` column with `semantic: "image"`, in `select`, never writable, never personal or
kept from readers, and not one of the entry's `files`. The entry only reads rows, on the app's
`customer` key. A picture is served at `GET /api/v1/public/pictures/…` only for the row it is
attached to, cleaned once and kept beside its file. See
[Pictures on public pages](https://docs.adminium.dev/guides/apps/public-pictures/).
