---
'@adminium/server': patch
---

A column set to Picture (or another kind of file) in Studio keeps that choice again, and Studio offers the hint for a column whose name says it holds pictures. 0.3.54 and 0.3.55 replaced the page's own choice with the engine's guess on every read; that change is undone, so a page made before an app said a column holds a file draws the stored file's id until the page is edited.
