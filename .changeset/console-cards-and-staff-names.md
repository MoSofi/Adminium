---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/widgets': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
---

An app's console and its e-mails say more, in the reader's language and money:

- An app's e-mail may name the person a staff column names: `{{visit.rep_id.name}}`, `{{was.rep_id.name}}` and `{{row.rep_id.name}}` are that person's name as the people list gives it, and nothing else of them. Somebody suspended, only invited or removed reads empty.
- A dashboard card may belong to a part of its app (`"module"` on its layout entry): it is not drawn while that part is off, and a layout saved meanwhile keeps it. An install that leaves a part out leaves out its cards, and any card over one of its tables, so the page stays whole.
- A table card's column headings may come in other languages (`columns[].labels`).
- A page link may open one screen of the app's own staff side: `"@staff/approvals"`. The path stays inside the side.
- A column an app declares as money (`"semantic": "money"`, a `money` column or `"scale": "currency"`) is money on a board's headings and cards and in a chart's "Show data" table, whatever it is called; a chart's table writes a sum of any money column in the card's currency.
- Several changes of one row within one second (MySQL keeps whole seconds) are each their own run of a rule, as on the other engines; the oldest of three quick stage moves is no longer lost.
