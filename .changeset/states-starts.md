---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
---

A table's states may name other states a new row may be made in besides `initial`: `"starts": ["paying"]` lets a checkout make an order already waiting for its payment, while an order paid at pickup is still made `placed`. Whoever makes the row says which by the value it writes; a public entry says it by its `defaults`. Each state named needs a move out of it. Any other first state is refused as before. `requireSetting` on a public entry may also name a choice in the settings row with `"in"`: the entry is open only while the setting holds one of those values (a hotel's booking entry that takes no payment is open while its payment setting is "nothing" or "optional"). Without `"in"` the setting is a yes/no, as before.
