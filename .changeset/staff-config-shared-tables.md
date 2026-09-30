---
'@adminium/server': patch
---

An app's staff screens are now told which of their tables another installed app uses too: the staff `surface-config.json` carries `sharedTables`, each of the app's own table names with the other apps' keys. Online Ordering's menu screen can then say, only when its menu is Point of Sale's too, that switching a dish off hides it at the till as well.
