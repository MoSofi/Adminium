---
'@adminium/server': patch
---

A link into an add-on's table (`addOnLink`) is no longer refused as "a foreign key already" because the server guessed a link from the column's name: a shop's `order_lines.design_id` beside the add-on's `customiser_designs`. Only a foreign key the database keeps, or one a person or an app declared, stops a column linking into an add-on's table.
