---
'@adminium/server': patch
---

Adminium's marks on an app's own refund row (asked, on its way, done, not sent) are announced as a change of the row, as the paid move is: the audit row, the app's rules and its mail follow them, so a "Refund sent" mail on the mark turning `done` goes out once, however often the mark is written again. A refund row Adminium writes for an automatic refund is announced as it is made. Adminium's own writes of a refund row no longer queue it to be asked a second time.
