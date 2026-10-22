---
"@adminium/add-on-contracts": patch
"@adminium/server": patch
"@adminium/dashboard": patch
"@adminium/i18n": patch
"@adminium/docs": patch
---

An add-on's document can show a picture the row keeps, such as a drawn signature: a `picture` slot mapped to a file column of the document's own row is filled by Adminium with the file as a PNG or JPEG data URL and its size, only when the file is the row's own, a picture, within the column's size limit and read as the reader may read that row and column, and the add-on never reads the file store.
An app's document of a kind its attached add-on does not draw yet no longer refuses the app's install or update: the document and its email attachment are left off, the install and update replies list it under `documents.waiting` (shown in the console), and it is made when the add-on is updated to a version that draws it.
