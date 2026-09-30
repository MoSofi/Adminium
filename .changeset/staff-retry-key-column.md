---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
---

A table no guest creates rows of can now keep a desk's retry key: mark a unique, nullable text column `retryKey: true`. A payment or a refund saved again after a reply that never came answers the one the first save made (`clientKey`, `replayed`), instead of recording the money twice. Before, a staff retry key needed a public create entry on the table.
