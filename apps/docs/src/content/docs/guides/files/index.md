---
title: Attaching files to records
description: The two ways a file can belong to a record — a value in your own column, or a list of files kept with each record — what each one writes, and how to turn them on.
---

A PDF belongs to an invoice. A photo belongs to a product. Adminium has **two**
ways to say so, and they differ in one thing: whether your own table gains a
value or not.

| | **A file column** | **Files on each record** |
|---|---|---|
| Where the link lives | In a column of **your** table | In a column Adminium adds to your table — or, on a source it cannot alter, on Adminium's side |
| Your schema | Needs a `text` / `varchar` column you already have | Adminium adds one `text` column, after showing you the statement |
| Read-only connection | No — the value is a write | **Yes** — it falls back to keeping the link on Adminium's side |
| Files per record | One per column, or many with **Hold more than one file** | Many |
| Where it appears | The New and Edit dialogs, and the grid | The New and Edit dialogs *and* each record's page |
| Your other code can read it | **Yes** — it is a value in your row | **Yes**, unless the fallback is in force |
| Turned on | Per column | Per page |

Pick the **file column** when something outside Adminium has to find the file:
your billing job emails the invoice PDF, your storefront renders the product
photo, a report joins on it. The column is the contract.

Pick **Files on each record** when you want the shortest route: one switch, and
Adminium adds the column for you and wires the page to it. It is the same
mechanism underneath — the difference is who names the column.

They are not exclusive. A table can have a file column *and* files on each record.

:::note[On a source Adminium cannot alter, files on each record change shape]
A [read-only connection](/guides/connect/read-only-and-meta/), a schema-file
connection, or a role without `ALTER` cannot gain a column. Files on each record
still work there, with the link kept on Adminium's side instead — but the files then
appear only on each record's **page**, never in the New dialog, because there is
no record to attach to before you press Save. The card tells you which mode you
are in and why.
:::

## A file column

### What ends up in the column

You choose the shape per column. All three are read back correctly, so a column
that already holds links written by another application keeps working — Adminium
only ever *writes* the shape you picked.

| Shape | What is written | Good for | What breaks it |
|---|---|---|---|
| **A link to the file** (`url`, the default) | `https://admin.example.com/api/v1/files/file_01JB…/content`, or, when the destination publishes a public base URL, `https://cdn.example.com/upload/2026/09/file_01JB…-invoice-1042.pdf` | a person reading the table; anything that can open a link | the instance changing origin; moving a destination whose public base URL is in the value |
| **Adminium's file id** (`id`) | `file_01JB…` | code that calls Adminium's API; survives every move | an outside application that never talks to Adminium |
| **The key in the destination** (`key`) | `upload/2026/09/file_01JB…-invoice-1042.pdf` | code holding its own bucket credentials, signing its own URLs | moving the file to another destination |

The instance part of an Adminium link is the same address links in emails use
([Links in emails](/guides/email/#links-in-emails)), or the host the upload was
sent to while that is not known.

One line of advice: **choose `id` if you expect to move a destination that
publishes a public base URL, or to change this instance's origin.** An id and an
Adminium link both survive a move; a public-base link keeps pointing at the old
base, and moving files does not rewrite values already written into your table.

On this server's own disk the key is a flat opaque id, so `key` is only
interesting on a bucket or a WebDAV server, where keys are dated and carry the
original filename.

### Turning it on

**Studio → Pages → open a page → Columns.** Each column row says what the
column **Holds**: **Text**, **Picture** or **File**. The choice appears on
`text` and `varchar` columns that hold a real value — not on a lookup, a
reverse relation or a derived column, which have nothing to write to.

- **Picture** — the column holds a picture: PNG, JPEG, WebP or GIF, never SVG.
  Its **Accepted types** offer only those four, and the last one ticked cannot
  be unticked, so the column never turns into a File column by itself.
- **File** — the column holds any file the workspace accepts, or the kinds you
  tick.
- **Text** — no file at all. Setting a Picture or File column back to Text
  keeps every value already stored; the form shows them as text.

A column the classifier thinks holds links to pictures (`photo_url`, `logo`)
and that still holds Text says so under its row. A column an installed app's
own rule makes a file column shows what it holds, locked, with the app's name
and limit: the app decides it, not the page. A new page is generated with such
a column as a Picture; a page made before keeps what it had until you change it.

Choose Picture or File and the column gets a small block of settings:

- **Stored value** — the three shapes above. A shape the column is too narrow
  for is disabled and says how many characters it needs against how many the
  column holds (an id needs 31, a key 160, a link 200). Widen the column in the
  database if you want a shape it cannot hold.
- **Destination** — where the bytes go. Leave it on *The default destination*
  unless this one column belongs somewhere else. See
  [Where your files are stored](/guides/files/storage-destinations/).
- **Accepted types** — chips. Choosing none accepts whatever the workspace
  accepts; choosing some can only **narrow** that list, never widen it.
- **Largest file (MB)** — empty follows the workspace limit; a number here can
  only lower it.
- **Show it in the table** — draws images in the grid cell. Everything else
  stays a chip with its name and size however this is set.
- **Hold more than one file** — the column stores a **list** instead of one
  file. A value already in the column keeps working: it reads as a list of one,
  and nothing is rewritten.
- **Most files per record** — only for a list. Enforced when the record is
  saved, which is the first moment the count is knowable.

#### What a list column holds

A JSON array of references in the same shape you chose above:

```json
["file_01JB6R3S4T5V6W7X8Y9Z0ABCD", "file_01JB6R3S4T5V6W7X8Y9Z0ABCE"]
```

It is still a `text` column, so every reader you already have keeps working — a
`SELECT`, a report, another application. An empty list is written as `NULL`
rather than `[]`, so a record with no files looks exactly like one that never
had any. A value that is not an array is read as a single reference, which is
what makes turning the switch on safe on a column that already holds one.

Save the page. The record form's field for that column becomes an **Upload**
control (**Add files** on a list) with a progress bar, **Replace** and a
**Remove file** button; the grid cell becomes a chip that downloads the file. A Picture column's field shows the picture itself,
with **Upload**, **Choose existing…** and **Remove**, and says which kinds and
how large a picture it takes.

### Choosing a picture you already have

**Choose existing…** opens a picker with two tabs:

- **Used in {page}** — the pictures other records of this table already show
  in this column, each one you may read (a column your role does not read, or a
  row you do not reach, is left out), named by the record it is on.
- **From the Files page** — that page's own uploads. Only someone who can open
  the Files page (`files.manage`) sees this tab.

Choosing a picture never points the record at the file it came from: Adminium
makes the record **its own copy**, written to this column's destination under
this column's limits, exactly as an upload for it would be. Deleting the
original, or the record it came from, never touches the copy, and the other way
round. Nothing is kept until you save the record; a copy you abandon is swept
like an abandoned upload.

The API behind it is `POST /api/v1/files/{id}/copy` with
`{ connectionId, table, column }`. It answers what an upload answers — the new
file and the value to store, in the column's own shape — and refuses before it
reads a byte: `403` without `create` or `update` on the table, `404` for a file
you may not read (the same answer as one in the trash or one that does not
exist), `422` `TYPE_NOT_ACCEPTED` or `TOO_LARGE` for a kind or a size the column
refuses. A file of another connection is not copied across, and a file a record
keeps in a personal or secret column is not copied into another table.

### The picture beside a value

Every column row has a switch that draws a small picture beside the value. On
the table's own columns it is **Picture beside the name** (or **Picture beside
it**): it shows the row's picture from the page's Picture column, and the
record's initials when it has none or the picture does not load. With two
Picture columns, **Picture from** says which. On a link column it stays
**Initials**: a chip that names another record never shows this one's picture.

The upload happens **before** you save the record — that is what makes the value
available to submit. If you abandon the form instead of saving, the file is
never attached to anything, and the daily sweep moves it to the trash after
`files.unattachedHours` (24 hours by default).

## Files on each record

### Turning them on

**Studio → Pages → open a page → Files on each record.** The card appears on a
records page that is bound to a table Adminium can resolve. (For the item's own
picture, set a column to Picture under Columns instead.)

Switch **Let each record keep a list of files** on and Adminium asks for
one thing: the **Column that holds the files** (`attachments` by default). Then:

1. It shows you the **exact statement** it proposes to run —
   `alter table … add column "attachments" text` in your database's own
   spelling — along with what that costs on your engine.
2. Nothing runs until you confirm.
3. Save the page, and the column is wired up.

If a column of that name already exists and can hold a reference, nothing is
created: Adminium uses the one that is there.

The other settings are the same as a column's: **Where the files go**,
**Accepted file types**, **Largest file (MB)** and **Most files per record**.

Every record then gets the field in its **New** and **Edit** dialogs and a
**Files** tab on its record page (`/p/<page>/r/<id>`) with the list, download
and delete. The tab counts what the record holds and lists every file of it you
may read, whoever uploaded it: its own files and the ones its columns name. A
file a column names says so (**In Photo**) and has no Delete there — change it
in the record's own field. Someone who can open the Files page (`files.manage`)
also sees a link under the list: **All files are on the Files page**.

#### Turning it off does not drop the column

The page stops using it; the column and every file in it are left exactly as
they are. Dropping a column is the one change Adminium cannot undo for you, so
it stays a deliberate act in **Studio → Remap → Design**.

#### If your connection cannot be altered

The card says so, in the server's own words, and falls back to keeping the link
on Adminium's side. Nothing is written to your table, which is why this works on
a read-only connection — and the files appear on each record's page rather than
in the New dialog.

:::note[The link is by record id, not a foreign key]
If a row is deleted **outside** Adminium, its files stay in Adminium's
store rather than disappearing silently. Deleting the row **through** Adminium
moves them to the trash, and undoing the delete brings them back.
:::

## What you can upload

**The type is decided by reading the bytes, not by the file name.** Adminium
holds back the first 8 KiB of every upload and matches it against a closed list
of signatures: PDF; PNG, JPEG, GIF, WebP, HEIC/HEIF, SVG; ZIP, and Word/Excel/
PowerPoint documents; MP4/QuickTime, WebM, MP3, WAV, Ogg. The type stored on the
file — and served back on download — is always the sniffed one, never the one
the browser claimed.

Rename a PDF to `.png` and Adminium still knows it is a PDF: it is stored as
`application/pdf`, and if the column or the workspace does not accept PDFs it is
refused with *"Files of type application/pdf are not accepted here."* The
extension cannot talk it past the gate.

Four formats have no signature at all — CSV/TSV, plain text, Markdown and JSON —
so those are the one case where the extension counts, and they are additionally
required to be valid UTF-8 with no NUL bytes. A `.csv` whose bytes are not text
is refused.

The workspace settings behind all of this — a column or a page can narrow the
first two, never widen them:

| Setting | Default |
|---|---|
| `files.maxBytes` | 200 MB (209,715,200 bytes); the hard ceiling is 2 GiB |
| `files.allowedTypes` | every type above |
| `files.thumbnailMaxBytes` | 2 MB — larger images show the chip instead of a preview |

Anything not on the list — an executable, an HTML file — is refused whatever it
is named.

## Downloads

Every byte is served by Adminium itself, at
`/api/v1/files/<id>/content`, so the same permission check runs on a download as
on the row. Files download rather than render, except images, PDF, audio and
video, which can be previewed in place. **SVG always downloads**, even when a
preview is asked for: it is a document that can carry script.

## Deleting is not deleting

Deleting a file moves it to the trash. The Files panel offers **Undo** straight
away; after that, the file is kept for `retention.filesTrashDays` — **30 days**
by default — and the daily sweep then deletes the bytes and the row for good.

The same sweep trashes uploads nobody ever attached to anything, after
`files.unattachedHours` (24 hours).

Replacing the value in a file column trashes the file it replaced. Deleting a
record trashes both its list of files and its column files, and undoing the delete
within the undo window restores them.

A value Adminium does not recognise as one of its own files — a link some other
application wrote into that column — is never attached and never trashed. It is
left exactly as it is.

## Uploading a file that belongs to no record

Not every file is a row's. A price list, a logo, a template you will attach to
something later — these belong to the workspace.

**Files** in the sidebar lists every file in this workspace: the ones on
records, and the ones uploaded there. Its **Upload** button puts a file straight
into it:

1. Choose **Which connection these belong to**. With one connection
   configured there is nothing to ask and the question does not appear.
2. Drag files in, or **Browse your computer**. Nothing is sent yet — you see
   the queue first.
3. **Upload N files.** Each file goes on its own, with its own progress bar and
   its own Cancel, so one refusal does not end the batch.

The files then appear under **All files**, **Uploaded here** and under that
connection. To put one on a record, use **Choose existing…** in the record's
Picture field: the record gets its own copy, and the upload stays under
**Uploaded here**.

:::caution[A file always belongs to a connection]
That is what makes it findable afterwards, and it is why the Upload button does
not appear until at least one connection is configured. It is not a folder —
Adminium's files are organised by what they belong to, not by a tree you have
to maintain.
:::

**Files** shows in the sidebar for an Admin or a Super Admin. Anyone else who
opens the page is not refused: without `files.manage` it lists only the files
they uploaded themselves.

### The page itself

- **All files · Uploaded here · Recent · Not used yet · Trash** — each one is a
  real query, not a filter over what happens to be on screen, so it finds files
  this page has never loaded. **Uploaded here** is the uploads made on this
  page, which belong to no record: what a record's picture can be chosen from.
  **Not used yet**, as its help says, is "Uploads no record took. They go to the
  trash after {hours} hours." (`files.unattachedHours`, 24 by default): files
  uploaded in a record's form that was never saved.
- **On record** — the record a file is on, **Uploaded here**, or **Not used yet**.
- **By connection · By table · By destination** — the same, narrower.
- **Storage in use** — how much each destination holds. This server's own disk
  also shows **Disk in use**, how much of it is taken; a bucket has no size to
  measure against, so it reports only what it holds.
- **Grid or list** — the same rows, drawn two ways.

## Who can do what

Uploading and attaching are authorised by the **table**, not by a workspace-wide
"can upload":

- Uploading a file for a record that does not exist yet needs `create` **or**
  `update` on that table.
- Attaching to an existing record needs `update` on it.
- Downloading an attached file needs `read` on its table.
- A file nobody has attached yet is visible only to the person who uploaded it,
  and to anyone holding `files.manage`.
- Uploading a file that belongs to **no** table — from the Files page — needs
  `files.manage`, the same permission that lets that page list everyone's files. Holding
  `create` on a table does not authorise it, and the refusal says so.
- Copying a file for a column needs what an upload for that column needs, and
  that you may read the file: a record's file by its table, a Files page upload
  as its uploader or with `files.manage`, a file no record took yet as its
  uploader only.
- Saving a record, a person may name in a file column only a file they uploaded
  (or copied) that no record holds yet. A file another record or the Files page
  holds is refused (`file-not-here`): choose it, and the record gets its copy.

Adding the column behind **Files on each record** is a schema change, so it needs
`schema.ddl` as well. If you do not hold it, the card shows the server's refusal
where the statement would have been and saves nothing.

A refusal to upload or attach names the exact permission you are missing. A file
you may not read is reported as **not found** rather than as forbidden — that
"this exists but you cannot see it" is itself a disclosure.

## Next

- [Where your files are stored](/guides/files/storage-destinations/) — this
  server's disk, a bucket, or your own server.
