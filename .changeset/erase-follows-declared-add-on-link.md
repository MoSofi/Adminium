---
'@adminium/server': patch
---

Finding, downloading and erasing a person now follows an app's link into an add-on's table as the app's manifest declares it (`rules.addOnLink`), not only a database foreign key. On a database where that link has none and the schema holds no guess at it (a SQLite shop), a customer's design versions and their files were missed: their words survived the erasure, their proof and production files stayed and were still served, and the preview counted too few files. The search, the preview and the erasure now reach them alike.
