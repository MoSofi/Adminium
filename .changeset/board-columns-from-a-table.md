---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/engine': patch
'@adminium/widgets': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

A board page can take its columns from a table. `config.board` on a `page-board` names the column a card is placed by and, with `columnsFrom`, the table whose rows are the board's columns: every row of it in its own order, a row with no card too, so a team adds, renames and reorders its stages with no update of the app. Without `columnsFrom` the column is an enum of the app's choosing, whatever its values. Each column's header shows the count the server made of its cards, and up to two `totals` (a sum or an average of a number or money column, money in the install's currency), over the rows the person may read; the count is no longer the number of cards listed, which stops at 200. A drop that is refused puts the card back and now says why, on the board and aloud, in the server's words: on every board, an enum board included. A link that holds a number places its card (it landed on no column before). The kit's `Board` takes a `count` and a `total` for a column and shows a rejected move's message, and `useRecords` takes `measures` to read such counts and sums with the rows. A board may be of some of its table's rows: `config.board.only` names one to three columns and the value, or the values, each must hold (`"only": { "state": "open" }` is a pipeline of the open deals), and the cards listed and each column's count and totals are of those rows alike. For that a read-time measure (`compute`) takes a `where`, up to three `{ column, in: [values] }` on the table it folds, all of which must hold; a measure whose `where` names a column the reader may not read answers `null` with the `_masked` marker, as a measure over a table they may not read does. The kit's `useRecords` measures take the same `where`. Needs Adminium 0.3.28.
