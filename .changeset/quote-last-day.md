---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
---

A move may have a last day: `requires.notPast` names a date column of the row, and the move is refused for every writer once that day has passed where the business is (`409` `STATE_DATE_PASSED`, told to a customer as `PUBLIC_TOO_LATE`). An app may add it to a move of a table built on an add-on's shape, so a quote is accepted or declined no later than its `valid_until`, by staff as much as by the customer. A public entry may ask for a column only with some values of another (`requiresWhen`): the name typed with an Accept, and never with a Decline. A share link's key every entry of which belongs to a part is left out, and made, with that part.
