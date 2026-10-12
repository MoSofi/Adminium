---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
---

An app can be made of parts its owner switches on and off (`modules`, with `"module"` on a table, a page, a rule, a document, an email producer and a public entry, and `"modules"` on a role). A part that is off has no pages, starts no rule, draws no document, queues no email, closes its public entries, and its roles hold nothing on its tables; its records stay, and a role of another part that is granted them goes on reading them. The app's settings page has a **Parts** card whose switches ask first (off lists what is open in the part; on says nothing is caught up), and the install check has a tick per part. A part built on an add-on the app only suggests is left out of an install without that add-on and put in when the add-on is connected, so such a table no longer makes its add-on required. A role's name can be given in several languages (`names`). An app that shows maps (`"maps": true`) makes its install ask, once for the whole install, whether maps are shown.
