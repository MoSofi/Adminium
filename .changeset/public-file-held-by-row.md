---
'@adminium/server': patch
---

A signed-in visitor's file download (`GET /public/files/:ref/:rowId/:column`) now serves a file only when that very row holds it. Before, a row whose column named another row's file, or a Files-library file, of the same connection served it to anyone who could read the row.
