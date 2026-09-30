---
'@adminium/dashboard': patch
'@adminium/widgets': patch
'@adminium/engine': patch
'@adminium/server': patch
---

An app's records page can open already filtered: `config.defaultFilters` lists up to six conditions (a column, an op and a value), used when nobody has chosen filters yet — a saved view, or the filters someone left the page in, still win. Online Ordering's Messages page can now hide the skipped rows every phone order without an email writes. An install refuses default filters it cannot read or that name a column the page's table does not have.
