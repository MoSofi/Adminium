---
'@adminium/server': patch
---

An app update now adds new values to a list that held only one, on Postgres and MySQL. Those databases keep a one-value list as a plain "equals" check, so Adminium read no list there, widened nothing, and refused every new value: a till updated from Point of Sale 0.3.x could not queue a pickup, table reminder or text receipt. Adminium now reads such a check as a list of one value, so the update adds the new values with no question asked, and they are taken.

A till's own screens-only roles (a cashier) can now use texts from the app's screens: whether texts can go, a guest's standing, recording their yes or no, and sending a text. Each still needs the rights their app's role grants on that record (and its `texts:@:reply` to send). Their app's conversations open only to a role given `texts:@:read` or `texts:@:reply`. Everything else of texts stays the dashboard's.
