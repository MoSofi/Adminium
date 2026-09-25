---
'@adminium/manifest': patch
---

An app's email template can list every variable Adminium fills in its `vars`: `appName`, an add-on's public setting (`addOn.<key>.<setting>`), and columns with a number in their name. Before, the list refused them even though the template could use them.
