---
'@adminium/server': patch
'@adminium/dashboard': patch
---

**Projects: `adminium eject`.**

- **`adminium eject <address>`** turns a page file into a page written in React: it writes
  `pages/<address>.tsx`, which holds the page file's settings as a constant and draws them with the
  UI kit's `GeneratedPage`, and deletes `pages/<address>.json`. It needs no database, and refuses a
  missing, invalid or turned-off page file, and a page that is already code.
- **The page keeps its row.** When a page file is deleted and a page of code took its address,
  `adminium dev` (and a server at its next start, or when a conflict is settled for the project's
  copy) turns the page's row into the code's row instead of deleting it: same id, grants, saved
  views, database and data source. Whichever of the file sync and the page build sees the change
  first, the result is the same. Regeneration leaves the page alone.
- **`GeneratedPage`** gives a config for its page's own table that page's record route and the
  person's add, change and delete permissions, as the generated page had. It uses the id of the page
  it is drawn in.
