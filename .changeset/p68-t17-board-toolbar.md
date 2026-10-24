---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/engine': patch
'@adminium/widgets': patch
'@adminium/dashboard': patch
'@adminium/ui': patch
'@adminium/llm': patch
'@adminium/i18n': patch
---

A board page can draw a toolbar (`config.board.toolbar`): the server's count and totals of every card the reader reaches, and a filter by the person a staff column names that narrows the cards, the columns' figures and the total alike; a card can show a second money line (`card.secondAmount`) and say what its days are (`card.daysSince.label`).
A role's `readable` list now hides a link column it does not list, as any column, on every read: rows, records, exports, history, live frames, widget data, search and the assistant's schema; a count by such a link answers masked, and a document that lists rows by it is refused.
The console's delete dialogs, for one row and in bulk, ask why a row is removed where its table takes a reason (`table.removal.reason`), and the assistant's delete proposal carries the person's reason.
