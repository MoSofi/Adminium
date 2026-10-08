---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/manifest': patch
'@adminium/i18n': patch
---

Adminium Designer builds on an add-on that keeps its own tables. Asked for an app that tracks stock or supplies, it looks at the add-ons first, asks for Inventory when the server does not have it, and makes a table of the app take stock when a row is saved, with a new tool that writes the link column, the rule, the requirement and the role's read access together from the add-on's own manifest. Its check holds such a rule to the add-on, the add-on's card says how many tables it adds, and the Architecture tab joins a table to the add-on it posts into. `adminium app check` checks a rule's inputs against an add-on in sight. The skills and the docs gain "Stock from the Inventory add-on", "An add-on that keeps its own tables" and "Take stock when a row is saved".
