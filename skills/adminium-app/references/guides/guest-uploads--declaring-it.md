<!-- produced from apps/docs/src/content/docs/guides/apps/guest-uploads.md § Declaring it; do not edit -->

# Guests' uploads: Declaring it

Two things say a guest may upload into a column. The column's
[file rule](https://docs.adminium.dev/reference/manifest/#files-in-a-column) says what a guest may send, in `upload`:

```json
{ "ref": "artwork", "type": "text", "maxLength": 64, "nullable": true,
  "rules": { "file": { "accept": ["pdf", "jpeg", "png", "tiff"], "maxBytes": 104857600,
    "upload": { "kinds": ["pdf", "jpg", "png", "tiff"], "maxBytes": 104857600 } } } }
```

- **`kinds`** is 1 to 6 of `jpg`, `png`, `pdf`, `text`, `tiff` and `svg`, each one the column's
  `accept` names (`jpg` is `jpeg` there). A file is judged by its bytes, never by its name.
- **`maxBytes`** is the most one file may be, up to the column's own `maxBytes`. A column takes at
  most 100 MiB (104857600) a file.
- **`maxCount`**, on a `json` column that holds a list, is how many files one write may name, up to
  the column's own `maxCount`. Without it, one.

And a public entry that writes the column lists it in `uploads`. On an order with its lines, that
is the level of the lines:

```json
{ "table": "orders", "methods": ["POST"], "writable": ["email"], "humanCheck": true,
  "children": { "order_lines": { "via": "order_id", "writable": ["product_id", "artwork"],
                                 "uploads": ["artwork"], "max": 20 } } }
```

`uploads` takes 1 to 8 columns, each also in `writable`. A column in both `uploads` and `files` is
one the guest uploads and, once signed in, downloads again.

The full rules are in the [manifest reference](https://docs.adminium.dev/reference/manifest/#guests-uploads).
