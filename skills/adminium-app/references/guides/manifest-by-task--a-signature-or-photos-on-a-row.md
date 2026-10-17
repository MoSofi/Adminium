<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § A signature or photos on a row; do not edit -->

# A manifest, task by task: A signature or photos on a row

A column that holds files a person uploads says so with `file`: one in a `text` column, a list in a
`json` column.

```json
{ "ref": "signature", "type": "text", "maxLength": 64, "nullable": true,
  "rules": { "file": { "accept": ["png"], "maxBytes": 524288 } } },
{ "ref": "photos", "type": "json", "nullable": true,
  "rules": { "file": { "accept": ["jpeg", "png", "webp"], "maxBytes": 8388608, "maxCount": 6 } } }
```

The column holds Adminium's own file ids. A screen uploads first, for the column, and then saves the
row naming the ids: the [kit's signature pad and photo field](https://docs.adminium.dev/guides/apps/kit-parts/#a-signature-and-photos)
do the uploading. The server takes only the kinds and the size the rule says, keeps a picture
without the place it was taken, and lets a save name only a file its writer uploaded and no record
holds yet. A row that is signed once and never changed again (a sign-off) also leaves the columns
out of every role's `writable`.

Reference: [Files in a column](https://docs.adminium.dev/reference/manifest/#files-in-a-column).
