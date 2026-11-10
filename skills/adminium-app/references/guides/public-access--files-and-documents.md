<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § Files and documents; do not edit -->

# An app's public access: Files and documents

An entry names the file columns it serves or takes in four lists, each for a different job:

| List | What it does | Guide |
|---|---|---|
| `files` | A signed-in person downloads the file a row of theirs names. | below |
| `uploads` | A guest uploads a file into the column, then names it in a create or a change (a print job's artwork). | [Guests' uploads](https://docs.adminium.dev/guides/apps/guest-uploads/) |
| `pictures` | Every visitor's `<img>` shows the column's picture (a show's poster), with no key. | [Pictures on public pages](https://docs.adminium.dev/guides/apps/public-pictures/) |
| `assets` | Every visitor's browser loads the column's 3D model, font or SVG piece, with no key. | [Models, fonts and SVG pieces](https://docs.adminium.dev/guides/apps/public-assets/) |

`pictures` and `assets` are for a read-only entry anyone may call. `files` and `uploads` keep a
file to the rows a person reaches.

- **Files.** An entry can offer the file a column names for download. It is served only through
  the row, read as the entry would read it, from the app's own database; a row the session cannot
  reach, or a file of anyone else's, is `404`. Apart from `pictures` and `assets`, no other public
  route serves a file.
- **Documents.** An entry can let a signed-in person list and open the printed documents of the
  rows it reaches, such as their invoices and statements, and email one to their own address. A
  document prints what its profile maps, so one that prints a column masked as personal data
  opens only to a session that reads that column on its row: a person found by what they know
  confirms the emailed code first (`403` `PUBLIC_CLAIM_LEVEL` on a draw; such a document is not
  listed to them until then).
