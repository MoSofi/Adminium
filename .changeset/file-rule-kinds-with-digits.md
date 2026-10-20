---
'@adminium/meta': patch
---

An app whose file column accepts a kind with a digit in its name (`mp4`, `mp3`) now installs. The manifest check and the docs allowed such kinds, but the stored rule refused them, so the install failed on every database.
