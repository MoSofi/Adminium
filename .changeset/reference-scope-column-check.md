---
'@adminium/server': patch
---

An app whose form narrows a reference picker by a column the picked table does not have (`reference.scope.column`) is now refused when it is checked or installed, naming the table and the column, instead of installing a picker that offers nothing.
