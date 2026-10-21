<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

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

| Field | Rule |
|---|---|
| `where` | `{ "column", "eq" }`: only child rows whose column equals the value are added up (`voided` is `false`). The value must fit the column, and the column must not be nullable: a row left empty would drop out of the total unseen. |
| `balance` | `{ "column", "of", "minus"? }`: a second column of this row, kept as `of − minus… − total` (`balance = fee − waived − paid`). `minus` lists up to 4 columns. Every column named is a number column of this table, and the balance is a column of its own, with no rules of its own. |
| `cap` | `true`: a child write that would take the balance below zero is refused. It needs a `balance` on the same rollup, or a balance elsewhere on the row whose `minus` lists this total (a write-off is capped by the balance it lowers). |
| `capUnless` | `{ "column" }`, with `cap`: a yes/no column of the same row that lifts the cap while it is on (a stock level a shop sells from whether or not the count is right). The column is never empty. A balance guarded by two capped totals is lifted only when both name the same column. |
| `latest` | `{ "of", "by", "row"? }`, in place of `sum` and `count`: the column holds the value of `of` in the newest child row, the one whose `by` (a date, a time or a number) is the greatest (a deal's amount is the total of its last sent quote: `{ "from": "quotes", "via": "deal_id", "latest": { "of": "total", "by": "sent_at", "row": "quote_id" } }`). A row whose `by` is empty is left out; of two rows with the same `by`, the one with the greater key is taken; `where` and `unlessSet` leave rows out as they do of a total. The column is nullable (it is empty while no row qualifies) and of the type of `of`. `row` names a nullable column of this table that Adminium fills with the key of the row it took: a plain column of the key's type, not a link (a link would stop that row being deleted), with no rules of its own. No `times`, `balance` or `cap`. Kept in the statement that writes the child row, like a total, and it climbs like one: a line added to the quote that counts moves the deal. Needs Adminium 0.3.28. |

```json
{ "ref": "paid", "type": "money", "default": 0,
  "rules": { "rollup": { "from": "payments", "via": "visit_id", "sum": "amount",
                         "where": { "column": "voided", "eq": false },
                         "balance": { "column": "balance", "of": "fee", "minus": ["waived"] },
                         "cap": true } } }
```

`of` may be another total of the row, so money given back is capped by money taken: two totals
over the same payments, `taken` (`where` `kind` `taken`) and `given_back` (`where` `kind`
`given_back`, `balance: { "column": "refundable", "of": "taken" }`, `cap: true`). A refund past what
was taken is refused, and so is lowering a payment taken below what already went back.

A capped write is refused with `BALANCE_EXCEEDED` and the balance it would have gone below. So is a
change to the parent that lowers `of` under what is already paid. Only a write that takes the
balance below zero, or further below it, is refused: a row already negative from older data can
still be edited or voided. Two payments at once are judged one after the other, so they cannot
both pass.

A write that touches several rows of a table feeding a capped total is refused with
`BALANCE_ONE_AT_A_TIME`, because it cannot be judged row by row. Imports and sample data are
settled but not capped: they record what already happened.

A total or a balance a writer sends is dropped, not refused, so a form that sends the whole row
still saves.

#### Totals that count and climb

A total may count its child rows instead of adding a column up: how many tickets an order holds,
how many lines a kitchen ticket has.

```json
{ "ref": "ticket_count", "type": "int", "default": 0,
  "rules": { "rollup": { "from": "tickets", "via": "order_id", "count": true,
                         "unlessSet": "refunded_at" } } }
```
