---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
---

A document's states hold on every write (moves, requirements, roles, locks, child rows, no-delete, dates that only move later); a payment's date may be bounded by today and by its invoice (`notAfter`, `notBefore`); an accepted document is sealed with a fingerprint; a hook may make its judgement part of the update (`expect`).
