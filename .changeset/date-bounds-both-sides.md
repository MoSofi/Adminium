---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
---

A date column can now be kept on either side of another date. `notAfter` takes `{ "column", "via"? }` as `notBefore` does, besides `"today"`: a hotel's credit for nights not stayed ends by its stay's departure. Either side may say `when` it holds (conditions on the row, as the write leaves it) and whether the same day is `strict`ly out, always or under conditions: a guest who left early is credited from the day after the arrival, a guest who never came from the arrival itself. A bound is judged again when a column its conditions read changes.
