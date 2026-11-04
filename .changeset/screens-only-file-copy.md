---
'@adminium/server': patch
---

Someone who opens only an app's own screens may copy a file they can read into a file column of a table their role creates or changes rows of (`POST /api/v1/files/<id>/copy`), judged by that table's own rights as it is for everyone else, where it was refused as a dashboard route before.
