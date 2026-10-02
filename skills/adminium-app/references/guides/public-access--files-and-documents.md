<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § Files and documents; do not edit -->

# An app's public access: Files and documents

- **Files.** An entry can offer the file a column names for download. It is served only through
  the row, read as the entry would read it, from the app's own database; a row the session cannot
  reach, or a file of anyone else's, is `404`. No other public route serves a file.
- **Documents.** An entry can let a signed-in person list and open the printed documents of the
  rows it reaches, such as their invoices and statements, and email one to their own address. A
  document prints what its profile maps, so one that prints a column masked as personal data
  opens only to a session that reads that column on its row: a person found by what they know
  confirms the emailed code first (`403` `PUBLIC_CLAIM_LEVEL` on a draw; such a document is not
  listed to them until then).
