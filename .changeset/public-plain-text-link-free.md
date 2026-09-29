---
'@adminium/server': patch
'@adminium/docs': patch
---

Public API: a name or note sent to a public form may no longer hold a web address or email address. A column an entry lists under `anonymous.plainText` (a stranger's name on a booking, an order or an enquiry) is now judged by the same rule as a line's note and a change through a guest's own link: besides digits, `://` and `www.`, it refuses an `@`, a `/` and a dotted word ending in a known web ending, so `refund-desk.com Smith` is refused where it used to pass and be printed in the venue's own confirmation email. "Mary.Ann", "J.R.R. Tolkien", "Anna-Marie O'Brien" and "Zoë (table)" still pass. The refusal is the one such a value already met: `400` `PUBLIC_WRITE_REFUSED`, with `params.column` naming the column. A batch through a hand-made endpoint with `anonymous.plain_text` now judges each new row the same way, naming it with `params.index`; it used to take any text.
