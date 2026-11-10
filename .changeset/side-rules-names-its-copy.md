---
'@adminium/server': patch
---

An app's own staff screens now say which copy of the app they are when they call Adminium, so reading the app's automation rules (`staff.rules()`) works when the app is installed on more than one database, instead of being refused as "installed on 2 databases".
