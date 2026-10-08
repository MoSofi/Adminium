---
'@adminium/engine': patch
'@adminium/manifest': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

An app update gives a column its foreign key when the app now declares it `fk` and the table kept it as a plain number (a column first written `"type": "int"` and later made a link, as Adminium Designer does when it adds an add-on's rule to it). Before, the update changed nothing in the database, so nothing that follows the link found the row's parent: a rule that posts a ticket's lines to an add-on never fired, and said nothing. The check lists the change and refuses it, by name, while rows point at a row that does not exist (`LINK_ORPHANS`). A line whose rule still has no link behind it is now refused when it is saved, instead of being saved and never posted.
