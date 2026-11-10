---
title: Guests' uploads
description: How a customer uploads a file into an app's file column from its public pages, such as a print job's artwork or a logo for a sign, what the column and the entry declare, how the page sends the file, and the limits the owner sets.
---

A print shop takes the customer's artwork with the order. A sign maker takes the logo to cut. The
customer is a guest on the app's public pages, with no account in the dashboard, so the file goes
through the [public API](/guides/public-api/endpoints-and-keys/): the page uploads it first, then
names it in the order it sends. Once the order is saved, the file is the order's, as a file staff
upload is.

Needs Adminium 0.3.43.

## Declaring it

Two things say a guest may upload into a column. The column's
[file rule](/reference/manifest/#files-in-a-column) says what a guest may send, in `upload`:

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

The full rules are in the [manifest reference](/reference/manifest/#guests-uploads).

## Sending the file

1. **Upload it.** The page sends the file on its own, before the order:
   `POST /api/v1/public/uploads?ref=<entry>&column=<column>&name=<file name>`, the body the file
   itself. A child row's column is written `<child>.<column>` (`order_lines.artwork`). The answer's
   `id` is what the order names.
2. **Name it.** The page puts the `id` in the column, in the create (and its child rows) or in a
   change of a row the guest is signed in to. In a `json` column it is one item of the list.
3. **It is the row's.** Once the write is saved, staff open the file on the record, the guest reads
   it through the entry's `files` where the entry offers it, it goes to the bin when the row lets
   go of it, and erasing the person removes it.

`@adminiumjs/public-client` sends it with `upload(ref, column, file)`:

```ts
const input = document.querySelector<HTMLInputElement>('#artwork')!;
const file = input.files![0]!;

const uploaded = await client.upload('shop_orders', 'order_lines.artwork', file);
// uploaded.id, uploaded.name, uploaded.size, uploaded.kind ('pdf', 'png', …)

await client.createTree('shop_orders', {
  values: { email },
  children: { order_lines: [{ product_id: productId, artwork: uploaded.id }] },
});
```

A guest with no session sends one proof of work for each file
([The human check](/guides/apps/public-access/#the-human-check)), asked with
`GET /api/v1/public/challenge?purpose=upload`. The client solves it for you. A guest signed in to
the entry sends none.

An upload waits a day for the write that names it, and is then thrown away. Only the column it was
uploaded for takes it, so a phone that moves from Wi-Fi to mobile data in between still names it.
A write that does not stand (a refused order, a price that moved) lets its uploads wait again, so
the guest fixes the order and sends it once more without uploading the file twice.

On iPhones a photo is HEIC, which no column takes. Give the file input an `accept` that names
`image/jpeg` and `image/png` (not `image/*`), and iOS converts the photo as it is chosen.

## When a file is refused

The upload is refused `PUBLIC_UPLOAD_REFUSED`, with `params.reason`:

| Reason | Status | What it means |
|---|---|---|
| `too-big` | 413 | Larger than the column's `upload.maxBytes`. |
| `kind` | 415 | Its bytes are not one of the column's `kinds`. |
| `cap` | 429 | This network address sent its day's files or bytes. |
| `quota` | 507 | The space kept for guests' files is full. |
| `column` | 400 | The entry takes no upload into that column. |

The write that names an upload is refused `400` `PUBLIC_WRITE_REFUSED`, with the column, when the
upload is not there for it: another column's, past its day, or already taken
(`reason: "file-not-here"`). It is also refused for a file of a kind the rule does not take
(`file-type`), one too large (`file-too-large`), or more files than `maxCount` (`too-many-files`).
See [the error codes](/reference/errors/).

## TIFF and SVG

A TIFF is kept and handed back only as a download, never drawn on a page. A guest's SVG (a logo)
is kept only as Adminium writes it again from its own reading of the file, and refused (`kind`,
saying what it holds) when it is more than a drawing: see
[Cleaned SVG](/guides/apps/public-assets/#cleaned-svg). It stays private, handed back only as a
download. A column guests upload into is never an entry's `assets`, and models and fonts are no
guest's to upload.

## The owner's limits

The owner sets how much room guests' files take, in the server settings:

| Setting | Default |
|---|---|
| `publicUploads.quotaBytes` | 2 GB of guests' files waiting to be attached |
| `publicUploads.columnsShare` | 50: the percent of it kept for files for an app's columns; the rest is for forms' files |
| `publicUploads.perAddressDaily` | 30 files from one network address in a day |
| `publicUploads.perAddressDailyBytes` | 500 MB from one network address in a day |

Only files still waiting count against the space: a file an order took is the order's. Past a
limit, uploads are refused and every Super Admin is told once an hour, naming the space that is
full. The server's own `files.maxBytes` still holds every upload.

A 100 MB file has to get through the proxy in front of Adminium too: see
[Behind a reverse proxy](/self-hosting/reverse-proxy/#large-uploads).

## Related

- [An app's public access](/guides/apps/public-access/): the entries, the keys and the human check
- [Attaching files to records](/guides/files/): file columns and the staff side
- [The REST API](/reference/rest-api/#a-guests-file-for-a-column): `POST /public/uploads`
