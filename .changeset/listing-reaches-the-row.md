---
'@adminium/server': patch
---

A person listed on a row (somebody on a deal, somebody covering) must now be able to open that very row once listed, not just read its table. Someone who reads only won deals could be listed on an open deal and then show as helping on a deal they cannot open; that is now refused (`cannot-open`), unless their roles reach the rows they are listed on.
