---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

**Apps send their own emails, and the log is a table you can read.**

An app declares an outbox: its own table where every email is a row, the templates it ships (in
every language it speaks), and what queues one — a row created, a column changed to a value, or a
reminder a number of hours before a moment, at each person's chosen lead. Adminium sends them in
the person's language, on the venue's clock and in its currency, and writes `sent`, `failed` or
`skipped` with the reason on each row; a message that cannot be delivered after every try turns
the row `failed`, and the desk can queue it again. Sample data, imports and undo never send mail,
example addresses are never mailed, and a template given an HTML block is not sent. Templates are
installed as the app's; an operator's edit is kept across updates. A column that holds nothing
reads as empty, so a paragraph holding only an optional value is left out instead of printing its
placeholder.
