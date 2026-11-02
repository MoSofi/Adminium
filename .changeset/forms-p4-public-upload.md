---
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

A form's file question takes files. Each file is sent the moment a stranger picks it (`POST /x/forms/api/<slug>/files`, the body the file, with a human check of its own) and kept unattached for two hours: its size capped by the question (the body is cut off past it), its content sniffed (never its name or type: images, PDF and plain text only, HEIC and SVG never), a picture kept without what the camera wrote beside it. The answer that names it attaches it, only for the same form and from the same network address. Staff who read the forms add-on's answers open it as a download (`GET /api/v1/forms/files/<id>`); nobody else, and no stranger. It goes with its answer, its form, or, unattached, two hours after it came.
Two settings bound strangers' files: `publicUploads.quotaBytes` (2 GB of files kept) and `publicUploads.perAddressDaily` (30 files a day from one network address); past either an upload is refused and every Super Admin is told, once an hour. The files are kept in a new table, `adminium_public_uploads`, and as files of a new kind, `stranger`, which the files routes never serve.
