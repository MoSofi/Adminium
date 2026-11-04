---
'@adminium/server': patch
---

Installing a prefixed app with an add-on it requires, on a database that already holds tables of the plain names the app declares (a shop's own `products`, `orders`, `customers`), keeps the app's prefix when its plan is read again after the add-on goes in: the app makes its own tables beside them and leaves theirs alone, where it stopped at the add-ons step before.
