---
title: Attaching files to records
description: The two ways a file can belong to a record — a value in your own column, or an attachment kept on Adminium's side — what each one writes, and how to turn them on.
---

A PDF belongs to an invoice. A photo belongs to a product. Adminium has **two**
ways to say so, and they differ in one thing: whether your own table gains a
value or not.

| | **A file column** | **Record attachments** |
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

Pick **record attachments** when you want the shortest route: one switch, and
Adminium adds the column for you and wires the page to it. It is the same
mechanism underneath — the difference is who names the column.

They are not exclusive. A table can have a file column *and* attachments.

:::note[On a source Adminium cannot alter, attachments change shape]
A [read-only connection](/guides/connect/read-only-and-meta/), a schema-file
connection, or a role without `ALTER` cannot gain a column. Attachments still
work there, with the link kept on Adminium's side instead — but the files then
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

**Studio → Pages → open a page → Columns.** Each column row has a **File**
switch. It appears on `text` and `varchar` columns that hold a real value — not
on a lookup, a reverse relation or a derived column, which have nothing to
write to.

Switch it on and the column gets a small block of settings:

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

Save the page. The record form's field for that column becomes a **Choose a
file** control with a progress bar, **Replace** and **Remove**; the grid cell
becomes a chip that downloads the file.

The upload happens **before** you save the record — that is what makes the value
available to submit. If you abandon the form instead of saving, the file is
never attached to anything, and the daily sweep moves it to the trash after
`files.unattachedHours` (24 hours by default).

## Record attachments

### Turning them on

**Studio → Pages → open a page → Attachments.** The card appears on a records
page that is bound to a table Adminium can resolve.

Switch **Allow attachments on this table's records** on and Adminium asks for
one thing: the name of the column to keep the files in (`attachments` by
default). Then:

1. It shows you the **exact statement** it proposes to run —
   `alter table … add column "attachments" text` in your database's own
   spelling — along with what that costs on your engine.
2. Nothing runs until you confirm.
3. Save the page, and the column is wired up.

If a column of that name already exists and can hold a reference, nothing is
created: Adminium uses the one that is there.

The other settings are the same as a column's — destination, accepted types,
largest file, most files per record.

Every record then gets the field in its **New** and **Edit** dialogs and a
**Files** tab on its record page (`/p/<page>/r/<id>`) with the list, download
and delete.

#### Turning attachments off does not drop the column

The page stops using it; the column and every file in it are left exactly as
they are. Dropping a column is the one change Adminium cannot undo for you, so
it stays a deliberate act in **Studio → Remap → Design**.

#### If your connection cannot be altered

The card says so, in the server's own words, and falls back to keeping the link
on Adminium's side. Nothing is written to your table, which is why this works on
a read-only connection — and the files appear on each record's page rather than
in the New dialog.

:::note[The link is by record id, not a foreign key]
If a row is deleted **outside** Adminium, its attachments stay in Adminium's
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
record trashes both its attachments and its column files, and undoing the delete
within the undo window restores them.

A value Adminium does not recognise as one of its own files — a link some other
application wrote into that column — is never attached and never trashed. It is
left exactly as it is.

## Uploading a file that belongs to no record

Not every file is a row's. A price list, a logo, a template you will attach to
something later — these belong to the workspace.

**Files** in the sidebar lists everything this workspace has stored, and its
**Upload** button puts a file straight into it:

1. Choose which **connection** the files belong to. With one connection
   configured there is nothing to ask and the question does not appear.
2. Drop files in, or browse for them. Nothing is sent yet — you see the queue
   first.
3. **Upload N files.** Each file goes on its own, with its own progress bar and
   its own Cancel, so one refusal does not end the batch.

The files then appear under **All files** and under that connection, marked
*Not attached to a record*. Attaching one to a row is the record page's job.

:::caution[A file always belongs to a connection]
That is what makes it findable afterwards, and it is why the Upload button does
not appear until at least one connection is configured. It is not a folder —
Adminium's files are organised by what they belong to, not by a tree you have
to maintain.
:::

### The page itself

- **All files · Recent · Not attached · Trash** — each one is a real query, not
  a filter over what happens to be on screen, so it finds files this page has
  never loaded.
- **By connection · By table · Destinations** — the same, narrower.
- **Storage** — how much each destination holds. This server's own disk also
  shows how much of it is in use; a bucket has no size to measure against, so
  it reports only what it holds.
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
  `files.manage`, which is the same permission that reaches that page. Holding
  `create` on a table does not authorise it, and the refusal says so.

Adding the column behind **Attachments** is a schema change, so it needs
`schema.ddl` as well. If you do not hold it, the card shows the server's refusal
where the statement would have been and saves nothing.

A refusal to upload or attach names the exact permission you are missing. A file
you may not read is reported as **not found** rather than as forbidden — that
"this exists but you cannot see it" is itself a disclosure.

## Next

- [Where your files are stored](/guides/files/storage-destinations/) — this
  server's disk, a bucket, or your own server.
