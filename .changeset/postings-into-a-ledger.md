---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/i18n': patch
'@adminium/add-on-contracts': patch
'@adminium/public-client': patch
---

A table's rows can post into a ledger an add-on keeps — stock, the money on a gift card — in the same save. A rule on the table (`postings`) says when a row is held, taken and given back; when a save reaches one of those moments Adminium asks the add-on's own code which rows to write, checks the answer and writes them with the row, or saves nothing. An order's lines post with their order. While something of a row is held, what the rule read of it cannot change and the row cannot be deleted until it is put back. A hold ends at the time its row says, by the minute job. Ways of writing many rows at once (a bulk edit, an undo, an import of changes) are refused by name when a row would post, and a list's bulk change is then sent row by row through `POST /data/:connection/:table/one-by-one`. A dry run answers what each ledger would say, without writing. When the add-on cannot be asked, a give-back always goes through, and a take only where the add-on says its rows may be taken unasked; what went through that way is recorded later. A workspace owner can draw rules of their own on any table, switch any rule off, and see how many rows hold something under each (`/ledgers/:addOn/:ledger/…`, `/connections/:id/tables/:table/postings/:posting`); those rules travel in the project's schema file. A capped balance can be let below zero by a yes/no on its own row (`capUnless`). A guest is told `PUBLIC_OUT_OF_STOCK` or `PUBLIC_CARD_REFUSED`; staff are told the reason in their own language. An add-on's deciding code is one script with no clock and no network, stopped at 250 ms, and runs only from a package the server can vouch for.
