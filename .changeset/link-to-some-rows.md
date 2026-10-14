---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/dashboard': patch
---

A foreign key may now name only a row that meets some conditions: `"rules": { "linkable": { "where": [{ "column": "active", "eq": true }] } }` keeps a quote line to price-list lines still offered. A new row, or a change that moves the link, naming a row that does not meet them is refused `422` with the field's code `not-allowed`, for everybody and on every door (a form, a bulk edit, an action, an automation, an import, the public API); a row already naming one retired since keeps it while its other columns change. An operator can set the same rule in Studio. Studio's save also keeps the staff, mention, place and area rules an app installs with their own column again: before, a save on a connection holding them was refused.
