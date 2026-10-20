---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/widgets': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

A column can now hold a **Picture**. In the page editor each column says what it holds — Text, Picture or File — in one choice, and a Picture column's field in the New and Edit dialogs shows the picture with Upload, Choose existing… and Remove. **Choose existing…** picks a picture another record of the table shows or, for someone who can open the Files page, one uploaded there; the record always gets its own copy (`POST /api/v1/files/{id}/copy`), so deleting either never touches the other. The switch that drew initials beside a value now shows the row's picture where the page has a Picture column (still initials on a link column). A record's Files tab counts and lists every file the record holds that the reader may read, and a file one of its columns names has no Delete there. On the Files page, "Not attached" is now "Not used yet", and a new "Uploaded here" shortcut lists the page's own uploads.

Saving a record through a page's file column now names only a file the person uploaded (or copied) that no record holds yet; another person's pending upload, or a file another record or the Files page holds, is refused. A save made from a form whose page settings changed meanwhile is refused with a message, so a picture uploaded into a column that no longer holds files is not lost. An app manifest's picture column is an image column with a file rule that takes pictures only: its sample rows may give it one of the bundle's pictures.
