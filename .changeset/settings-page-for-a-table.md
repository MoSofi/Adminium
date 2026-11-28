---
'@adminium/engine': patch
'@adminium/widgets': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

The Settings template (`page-settings`) can be bound to a table, and then draws that table as one record: its row's form, with Save, and no list, search, New or Delete. It is meant for an app's one-row settings table. The form is the one a records page edits the row with (its sections, controls, files and pictures, and saves of changed fields only). With no row yet the form makes the first one; with more than one it edits the first and says the others are not read. A reader who may not change it sees the values. An app names it in its manifest as `"template": "page-settings"` with `bindings`, and Studio composes it from a table as it composes a records page. With no table, the template is the notification settings, as before.
