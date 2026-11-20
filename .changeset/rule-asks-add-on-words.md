---
'@adminium/manifest': minor
'@adminium/meta': minor
'@adminium/server': minor
'@adminium/dashboard': patch
---

An app's rule may now ask an add-on's stock words about the row a link of its record names, in an "Only continue if" or "If / else" step: `{ "left": { "words": "inventory:stock", "of": "variant_id" }, "op": "is", "right": "in" }`, with `in`, `low` or `out`. `in` holds when the add-on counts the row and at least one whole unit is left. The condition is false, `is not` too, while the add-on is off for the app or cannot answer, when the link is empty, and when the add-on does not count the row: a rule never mails someone because an add-on was off. The words are asked as the staff's and the public pages' are, with nothing written and no step of the add-on run. A trigger's conditions and a schedule's "For each record" cannot ask them. The rule builder shows such a condition as a sentence. Needs 0.3.68.
