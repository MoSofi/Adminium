---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/widgets': patch
'@adminium/i18n': patch
---

A column may now hold files a signed-in person uploads for it: `"rules": { "file": { "accept": ["png"], "maxBytes": 524288 } }` on a text column keeps one (a customer's signature), and with `"maxCount": 6` on a json column a list (a job's photos). The upload takes only the column's kinds and size, judged by the file's bytes, and keeps a picture without the place it was taken or the device. A save may name only a file its writer uploaded and no record holds yet: another record's file, a colleague's upload, or a picture sent unclean through another door is refused `422` (`file-not-here`, `file-type`, `file-too-large`, `too-many-files`), and an import, a rule or the public API names none. A file a record keeps is read with the record and changed only through it (`409 FILE_HELD` on the file routes). The kit gains a signature pad (`signature`) and a photo field (`photos`) for an app's own screens, and somebody whose role opens only an app's screens may now upload, read back and throw away such files. A create sent again under its retry key is now answered with the row the first made before anything of it is judged or hooked again.
