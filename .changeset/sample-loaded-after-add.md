---
'@adminium/server': patch
---

`GET /api/v1/apps/<key>/sample-data` (and an add-on's) answers `loaded: true` only once the add has finished. While the add is queued or running it answers `loaded: false`, however many rows are in: an app's add writes its own rows first and the samples of the add-ons added with it after, so a reader that took the first rows for the whole went on before the add-ons' rows were in.
