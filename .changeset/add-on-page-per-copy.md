---
'@adminium/server': patch
'@adminium/dashboard': patch
---

When two apps each hold their own copy of an add-on (a maker's shop and a print shop, each with its Customiser), the add-on's page now opens: the menu lists it once per copy you reach, named by its database, and the page asks its own copy. Asked with no copy named, the refusal counts every copy and names only yours. A page that loads and then stops says what failed instead of blaming the add-on's fingerprint.
