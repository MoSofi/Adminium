---
'@adminium/server': patch
---

The Designer no longer tells a customer screen to remove a search, sort or filter that works. It now reads each one against what that list declares in `access.json`, and when one is missing it names the exact field to add. It also points out `filter`, `search` and `sort`, which the public client ignores without an error. A screen whose only read is a typed call, such as `client.list<Product>(…)`, is no longer told it reads nothing, and a typed call is now checked for a short table name or a claimed endpoint written out.
