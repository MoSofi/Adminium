---
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
---

`adminium dev` now watches the apps in your project. Save a file anywhere under `apps/` and the apps are checked and rebuilt, the running server installs a new app or applies the changed manifest in place, and an open screen of the app reloads. Nothing restarts. A screen built by `adminium dev` asks the server once a second whether its app was rebuilt (`@adminiumjs/adminium/side` does it for you; `onAppChanged` takes your own listener), which works on the customer side too, where nobody is signed in. A packed app makes no such request.

Fixed: in a project, an installed app's own column rules were written into `schema/<database>.json`, which then refused to load ("origin: must be user or llm"), and applying a project's schema file deleted every installed app's rules on that database. An app's rules now stay out of the file and are left alone when it is applied.
