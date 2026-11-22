---
'@adminium/server': patch
---

The Designer reads each search, sort and filter on a customer screen, a filter through another list (`via`) included, against what that list declares in `access.json`, and when one is missing it names the exact field to add. It also points out `filter`, `search` and `sort`, which the public client ignores without an error. A typed call such as `client.list<Product>(…)` counts as a read, and is checked for a short table name or a claimed endpoint written out.
