---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/public-client': patch
'@adminium/i18n': patch
---

A guest may upload a file into an app's file column: the column's file rule says what a guest may send (`upload: { kinds, maxBytes, maxCount }`, kinds from `jpg`, `png`, `pdf`, `text`, `tiff`) and a public entry that writes the column lists it in `uploads`, on the entry or on a level of its child rows. The page sends the file to `POST /api/v1/public/uploads?ref&column&name` (the body the file; one proof of work a file unless the guest is signed in to the entry), and the guest's next create or signed-in change names the upload's id in the column. Once that write is saved the file is the row's own, as a staff upload is: staff open it, the guest reads it through `GET /public/files`, it goes to the bin with the row and an erasure removes it. A write that does not stand lets the file wait again (a day for a column's file, two hours for a form's), and a write stopped between its save and the file's adoption is mended by the uploads sweep. File columns take files up to 100 MiB (`files.maxBytes` still holds every upload) and `tiff`, kept and handed back only as a download: only PNG, JPEG, WebP, GIF and PDF open inline on the public side. Strangers' uploads count only files waiting to be attached, in two pools (`publicUploads.columnsShare`, half each by default), with a daily bytes cap per network address (`publicUploads.perAddressDailyBytes`, 500 MB); the owner's notice names the full pool. The public client sends one with `upload(ref, column, file)`.
