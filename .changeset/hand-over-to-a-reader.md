---
'@adminium/server': patch
---

A record's hand-over button no longer gives a row to somebody whose roles do not read its table (the row would then answer to nobody but an admin). It is refused with `cannot-open`, as handing over everything a person holds already was.
