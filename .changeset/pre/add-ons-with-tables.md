---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/manifest': patch
'@adminium/engine': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

An add-on may keep tables of its own. It is installed the way an app is: its tables under its own prefix in one database, its pages in a section of the sidebar, its roles, lists, starting rows, emails and sample data, with a check that shows all of it first. It can be updated and removed from Studio, and removing it keeps its tables unless you ask otherwise. Its public entries are served through the key of an app that names it, only once someone who may manage API keys allows it, and leave that key the moment the add-on is switched off for the app. A row can be opened by its own code. `adminium app check` reads the same vocabulary.
