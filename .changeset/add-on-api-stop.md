---
'@adminium/dashboard': patch
'@adminium/add-on-contracts': patch
---

An add-on page's calls can now be stopped for real. The `api` a page is handed takes a last `{ signal }` argument on every verb; aborting it cancels the request itself, so the server sees it go and stops its own work (a look-up at a register, say), instead of the page only ignoring the answer when it comes.
