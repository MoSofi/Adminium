---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

An app can now shape its own section of the sidebar, and say where its records open. A page with `"offRail": true` in its `nav` is kept off the sidebar: it still opens by its address and is still found by search, the command palette and the assistant, for whoever may view it. `navLinks` adds entries that are not pages: a screen of the app's staff side, the dashboard's Automations or Emails showing only what the app brought (`/automations?app=<key>`, `/email-templates?app=<key>`), or the app's own settings. Each is listed only to somebody who can open it. And `records` on the staff side says where a table's record opens there (`{ "deals": "/deals/{id}" }`): a notice, the button of its email and a search hit then open the app's own screen for somebody whose role opens the staff side, and the dashboard's record page for everybody else. Somebody who is signed out is sent to sign in and brought back. A rule's notice email now carries a full address (the mapped staff host, else the server's public address) where it used to carry a bare path. The address sign-in hands back to is checked more strictly: a path of the same address only, and never `/\host`. All three words need Adminium 0.3.28.
