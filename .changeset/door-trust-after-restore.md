---
'@adminium/server': patch
'@adminium/meta': patch
---

A forms, live chat or landing pages add-on now keeps serving after a restore or a redeploy that empties the data folder. When its package is put back from the copy kept in your file storage, it is trusted as the original was, so its public pages are not left out. A copy of a package that was uploaded by hand is still never trusted, and a copy whose bytes changed is refused.
