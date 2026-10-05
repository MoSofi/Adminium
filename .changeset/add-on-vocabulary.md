---
'@adminium/manifest': patch
'@adminium/add-on-contracts': patch
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/widgets': patch
---

The manifest learns the words an add-on with its own tables needs: an add-on may declare pages, roles, emails, documents and sample data like an app; ledgers and the rows that post into them; a price an add-on lowers; rules an app ships; buttons on a record; a role's grant on an add-on's table; what a typed code may find. This release reads and checks them. A manifest that uses one is refused at install until the release that runs it.
