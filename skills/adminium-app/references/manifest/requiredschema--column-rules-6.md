<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

- **On every door.** The server judges it where it writes the row: a change on a page, a record's
  button (a `set` or a move is saved as a change), a bulk edit, a file brought in, the public API,
  a rule's step. History is not judged: an undo puts back what was, and an app's sample and seed
  rows say what happened then. A Super Admin is held to it like anybody.
- **Who is judged.** `by` and `notBy` judge the signed-in person who writes; an API key or a
  visitor is somebody no column names (never the `by`, never a `notBy`). A write Adminium makes by
  itself (a rule's step, a move when a moment passes) has nobody to judge: it is held to `from`
  and `while` only. A person read through a link the database no longer has holds `by` for nobody
  and `notBy` for everybody.
- **The refusal.** `403` `COLUMN_FORBIDDEN`, with the column and the reason: `change-from`,
  `change-while`, `change-by` or `change-not-by`; a file's line is refused by the same code, naming
  the column. What an update was judged on in the stored row is asked again by its statement: a
  row changed meanwhile is not written.
- **On the record page.** A button whose change a guard leaves to others is not shown to the person
  the row names in a `notBy` staff column of its own, and is shown only to the person a `by` names
  there (`stateActions[].notBy`, `.by`); one read through a link is left to the save. That is
  presentation only: the save refuses the change whatever a page shows.
- The validator refuses a value the column cannot hold, a change from the very values it goes to,
  a `while` on the column itself or on a column the table has not, a person who is not a staff
  column (`rules.staff`) of the row or of the table a foreign key of it names, a person named
  twice or both `by` and `notBy`, and a guard on a column Adminium decides (`copy`, `sequence`,
  `code`, `rollup`, `stamp`, `formula`, `format`, `lookup`, `perNight`), which no writer changes.
  Studio checks that each column and link is there. An app may add it to a column of a part of an
  add-on's [shape](https://docs.adminium.dev/reference/manifest/#tables-built-on-an-add-ons-shape).

#### Files in a column

`file` makes a column hold files a signed-in person uploads for it: a crew's sign-off keeps the
customer's signature and the job's photos.

```json
{ "ref": "signature", "type": "text", "maxLength": 64, "nullable": true,
  "rules": { "file": { "accept": ["png"], "maxBytes": 524288 } } },
{ "ref": "photos", "type": "json", "nullable": true,
  "rules": { "file": { "accept": ["jpeg", "png", "webp"], "maxBytes": 8388608, "maxCount": 6 } } }
```

A `text` column holds one file's id (`file_…`, 31 characters, so a `maxLength` is at least 31); a
`json` column holds a list of ids, of at most `maxCount`, read back as a list on every database.
`accept` takes `png`, `jpeg`, `webp`, `gif`, `pdf`, `office`, `zip`, `csv`, `text`, `markdown`,
`json`, `mp4`, `webm`, `mp3`, `wav` and `ogg`: never `svg`, a document that can carry script, and
never `heic`, a picture whose camera notes cannot be taken out of it.

- **The upload.** `POST /api/v1/files?connectionId=…&table=…&column=…&filename=…`, the body the file
  itself, from a person who may create or change rows of the table. The column's kinds and size
  narrow the workspace's own (`files.allowedTypes`, `files.maxBytes`), never widen them: a file of
  another kind is refused `415`, a larger one `413`. A PNG, JPEG, WebP or GIF is kept without what a
  camera writes beside it: the place it was taken, the device, comments, XMP. A picture that cannot be
  read as one is refused `415`. The reply's `data.id` is what the column holds. Until a record names
  it, the file is its uploader's alone: nobody else reads it, and the uploader may throw it away
  (`DELETE /api/v1/files/{id}`). One no record names is thrown away after `files.unattachedHours`.
- **The write.** A create or a change may name, beside what the column already held, only a file
  **its writer uploaded and no record holds yet** (or one uploaded for this very record and in none of
  its other columns), of this database, of a kind the column takes, no larger than it allows, and, a
  picture, one cleaned as it was uploaded for a file column. A file named twice in one row is refused,
  and so is a list longer than `maxCount`. Only a person names a new file, through a form, a bulk edit
  or a record's button: an import, a rule, project code, sample data and the public API name none (they
  may keep or empty what the column holds), but for a picture column's sample pictures (below). An undo puts back what was. A refusal is `422`
  `VALIDATION_FAILED`, the field's code `file-not-here`, `file-type`, `file-too-large` or
  `too-many-files`; whose a file is, whether it exists and which record holds it are all said alike, as
  `file-not-here`.
- **A picture column.** A `text` column with `"semantic": "image"` and a `file` rule whose `accept`
  names only `png`, `jpeg`, `webp` and `gif` holds one picture: a public entry may show it to every
  visitor ([`pictures`](https://docs.adminium.dev/reference/manifest/#pictures)), and a sample row may give it one of the bundle's pictures,
  `{ "@asset": "<label>" }`, which the sample adds as that row's own file. An image column whose file
  rule takes any other kind is refused. An image column with no `file` rule holds links, as before.

  ```json
  { "ref": "photo", "type": "text", "nullable": true, "semantic": "image",
    "rules": { "file": { "accept": ["png", "jpeg", "webp", "gif"], "maxBytes": 5242880 } } }
  ```
- **The record holds it.** Once named, the file is read with its record, by whoever reads the record
  and reaches its row, through every column their role shows. It is changed only through the record:
  taking it off, renaming it, throwing it away or hanging it on another record by the file routes is
  refused `409` `FILE_HELD`, for its uploader and the owner alike. A change that names another file
  throws the old one away; removing the record throws away its files (an undo brings them back).
- **What a manifest cannot do with one.** A public entry neither writes nor defaults a file column, a
  sample row leaves it empty, and a file column takes no `default`, no `unique` and no rule that
  decides its value (`personal`, `required` and `requiredWhen` are fine). The kit's
  [signature pad and photo field](https://docs.adminium.dev/guides/apps/kit-parts/#a-signature-and-photos) upload for such a
  column from an app's own screen.

#### Totals and balances

A rollup can also filter its child rows, keep a balance beside the total, and refuse a change
that would take the balance below zero: what a visit's fee, its payments and its write-offs need.
