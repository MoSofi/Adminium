<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Documents — A picture in a document; do not edit -->

# Manifest spec: Documents — A picture in a document

### A picture in a document

An add-on's outline may have a `picture` slot (Adminium 0.3.35): the document then shows a picture
the row keeps, such as a customer's drawn signature on a signed copy. Map it to a column of the
document's own row that holds one file, a `text` column with
[`"rules": { "file" }`](https://docs.adminium.dev/reference/manifest/#column-rules) and no `maxCount`, whose `accept` lists `png` or `jpeg`:

```json
"mapping": { "signer": { "column": "signed_by" }, "signature": { "column": "signature" } }
```

The add-on never reads the file store: Adminium reads the file each time the document is drawn
and hands the add-on the picture, or nothing. It hands it only when the file is the row's own
(attached to that very record, alive, not a file of another row written into the column by hand),
a PNG or a JPEG by its own bytes, no larger than the column's `maxBytes` and 5 MiB, and at most
8192 pixels a side; what a camera writes beside a picture (the place, the device) is taken out. A
file that is none of that leaves the slot empty, and a required picture slot is then a slot left
empty ("unmapped or empty"). The picture is read as the column is: a staff member whose role does
not read the column, or the row, is drawn nothing at all, as for any column a document prints; a
column withheld from a guest is empty for them, and so is the picture. A secret column gives no
picture. A value typed into the profile, or sent by a request, never fills a picture slot.

A picture slot mapped through a link (`via`), to a column that holds no file, a list of files, or a
file column that takes no PNG or JPEG is refused when the app is installed, naming the slot. A
picture is never a column of a `collection`.

The add-on receives the slot's value in `subject.fields` as `{ "mediaType", "dataUrl", "width",
"height" }`: `mediaType` is `image/png` or `image/jpeg`, `dataUrl` is
`data:<mediaType>;base64,<bytes>` (an HTML page puts it in an `<img>`; a PDF writer decodes the
base64 after the comma and embeds the PNG or JPEG as it is), and `width` and `height` are the
picture's pixels. `@adminium/add-on-contracts` exports the slot type (`OUTLINE_SLOT_TYPES`), the
value's type and schema (`DocumentPictureValue`, `documentPictureValueSchema`) and, for an add-on's
own tests, `SAMPLE_DOCUMENT_PICTURE`. The documents register keeps what was printed without the
bytes: a picture is stored as `{ "mediaType", "width", "height", "sha256" }`, and the document's own
file holds it as drawn.
