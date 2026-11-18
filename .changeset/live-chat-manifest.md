---
'@adminium/manifest': patch
'@adminium/server': patch
---

Add-ons can now carry a website live chat. An add-on declares `addOn.chat`, naming its four tables (conversations, messages, answers and the automatic answerer's choices), each with the columns the engine reads and writes, and keeps its hours, words and answerer in its one settings table (`addOn.settingsTable`). An app opens a table to a question a visitor leaves outside hours with a `publicAccess` entry under the reserved key `chat`, which the public API never serves; a table may carry both a `forms` and a `chat` entry. Both words need `compatibility.minAdminiumVersion` 0.3.64. The key name `chat` is reserved only for a manifest whose floor is 0.3.64 or later: an app written for an older Adminium that named one of its own keys `chat` validates, installs and serves its entries as before. The built-in mail `chat-reply` (a staff reply mailed to a visitor who left the page) joins the system emails an instance file may edit.
