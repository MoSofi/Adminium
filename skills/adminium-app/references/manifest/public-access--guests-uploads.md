<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — Guests' uploads; do not edit -->

# Manifest spec: Public access — Guests' uploads

### Guests' uploads

A guest may upload a file into a file column (a customer's logo, a print job's artwork) when the
column's [`file`](https://docs.adminium.dev/reference/manifest/#files-in-a-column) rule says what a guest may send, and a public entry that writes the
column lists it in `uploads`. Needs Adminium 0.3.43.

```json
{ "ref": "artwork", "type": "text", "maxLength": 64, "nullable": true,
  "rules": { "file": { "accept": ["pdf", "jpeg", "png", "tiff"], "maxBytes": 104857600,
    "upload": { "kinds": ["pdf", "jpg", "png", "tiff"], "maxBytes": 104857600 } } } }
```

```json
{ "table": "orders", "methods": ["POST"], "writable": ["email"], "humanCheck": true,
  "children": { "order_lines": { "via": "order_id", "writable": ["product_id", "artwork"], "uploads": ["artwork"], "max": 20 } } }
```

| `file.upload` field | Rule |
|---|---|
| `kinds` | 1–6 of `jpg`, `png`, `pdf`, `text`, `tiff`, `svg`, each a kind the column's `accept` names (`jpg` is `jpeg`). Judged by the file's bytes. |
| `maxBytes` | The most bytes of one file, 1024 up to the column's `maxBytes`. |
| `maxCount` | A `json` column only: how many files one write may name, up to the column's `maxCount` (absent: one). |

1. The page sends the file: `POST /api/v1/public/uploads?ref=<entry>&column=<column>&name=<name>`,
   the body the file itself. A child row's column is `<child>.<column>` (`order_lines.artwork`). A
   guest with no session sends one proof of work for each file; a guest signed in to the entry needs
   none. The reply's `data.id` is the upload's id. See [the REST API](https://docs.adminium.dev/reference/rest-api/#a-guests-file-for-a-column).
2. The page writes the id into the column: in the create (and its child rows) or in a change of a
   row the guest is signed in to. In a `json` column it is one item of the list.
3. Once the write is saved, the file is the row's own, as a staff upload is: staff open it on the
   record, a guest reads it through [`files`](https://docs.adminium.dev/reference/manifest/#public-access) where the entry offers it, it goes to
   the bin when the row lets go of it, and an erasure of the person removes it.

An upload waits a day for the write that names it, and is then thrown away. Only the column it was
uploaded for takes it, through any address, so a phone that moves from Wi-Fi to mobile data still
names it. A write that names another column's upload, an upload past its day or one already taken
is refused `400 PUBLIC_WRITE_REFUSED` with the column and `reason: "file-not-here"`; one of a kind
the rule does not take is `file-type`, one too large `file-too-large`, more than `maxCount`
`too-many-files`. A refused write lets its uploads wait again.

The owner sets how much room guests' files take, in Settings: `publicUploads.quotaBytes` (2 GB of
files waiting to be attached), shared with forms' files by `publicUploads.columnsShare` (half each by
default), and from one network address a day `publicUploads.perAddressDaily` files (30) and
`publicUploads.perAddressDailyBytes` bytes (500 MB). Past one, an upload is refused and every Super
Admin is told once an hour, naming which space is full. Pages for 100 MB files need the proxy to let
them through: see [Behind a reverse proxy](https://docs.adminium.dev/self-hosting/reverse-proxy/#large-uploads).

A guest's SVG (a customer's logo) is kept only as Adminium writes it again from its own reading of
the file, and refused (`kind`, saying what it holds) when it is more than a drawing: see
[Cleaned SVG](https://docs.adminium.dev/guides/apps/public-assets/#cleaned-svg). It stays private: handed back only as a
download, never drawn on a page, and a column guests upload into is never an entry's
[`assets`](https://docs.adminium.dev/reference/manifest/#assets). Models and fonts (`glb`, `stl`, `3mf`, `woff2`) are no guest's to upload.

On iPhones a picture is HEIC, which is not taken: give the file input an `accept` naming
`image/jpeg` and `image/png` (not `image/*`), and iOS converts it as it is chosen.
