---
'@adminium/manifest': patch
'@adminium/server': patch
---

The manifest check refuses a page form field whose control the form does not have (`"control": "file"`, which the install refused as an unreadable form), naming the field and the controls it may take. A file column names no control and gets its own.
