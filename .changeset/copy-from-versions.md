---
'@adminium/manifest': patch
'@adminium/server': patch
---

A person's copy on an add-on's table may reach one or two links further into the add-on with `from`, so erasing a customer reaches their design's versions and each version's files: `{ "addOn": "customiser", "table": "design_versions", "column": "values", "holds": "details", "via": "order_lines.design_id", "from": ["design_id"] }`. The search finds and exports those rows, and the erasure blanks them. A copy column that holds files is emptied and the files it named are deleted with the person, and counted in the preview. Needs `minAdminiumVersion` 0.3.44.
