---
'@adminium/server': patch
'@adminium/engine': patch
---

Removing an index in Studio drops that index by its own name on every database. It used to guess a name, so the drop failed on any index Adminium had not named itself.
