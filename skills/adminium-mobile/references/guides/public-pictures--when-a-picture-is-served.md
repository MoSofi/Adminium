<!-- produced from apps/docs/src/content/docs/guides/apps/public-pictures.md § When a picture is served; do not edit -->

# Pictures on public pages: When a picture is served

The file id alone is never enough: ids are handed out in order, so a neighbour's is easy to guess.
A picture is served only when all of these hold at the time it is asked for:

- **The key** is live, is the app's customer key, and is not bound to a staff screen.
- **The entry** is one of the key's reads that shows this column as a picture to every visitor.
- **The row** is read through the entry's own filters: a show not yet published or a dish off
  the menu is no row at all. Its column names exactly this file, so the address of a picture
  since replaced answers nothing.
- **The file** is live, on the key's own database, and attached to this very row. Adminium
  attaches a file to the row whose column is saved with it, through the staff screens or the data
  API. A file id another row's column was made to name is nothing.
- **The bytes** are a picture, within the sizes [below](https://docs.adminium.dev/guides/apps/public-pictures/#sizes-and-types).

Every refusal is the same `404` `PUBLIC_REF_NOT_FOUND`: which rule said no is nobody's business.

While the public API, the app or its customer side is off, the answer is `503`
(`PUBLIC_API_DISABLED`, `APP_DISABLED`, `SURFACE_OFF`), and `PUBLIC_KEY_OFF` while the key's switch
in the settings row is off.
