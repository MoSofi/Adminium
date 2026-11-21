---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/add-on-contracts': patch
---

An add-on can now show a signed-in customer the rows it holds for them (`heldBy`), let them spend one without its code reaching the browser (`held:<key>`), and run an outside script in a sandboxed page of its own (`addOn.framedPage`).
