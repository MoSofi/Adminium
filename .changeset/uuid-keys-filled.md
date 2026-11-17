---
'@adminium/server': patch
---

An app's key declared as a uuid is filled with a new uuid on every create that sends none, on SQLite and MySQL as on Postgres: the install records a fill rule for it, since SQLite keeps the key as text and MySQL as char(36), where nothing filled it. Before, a payment Adminium wrote into such a table (and a refund row, a mail in its outbox) was refused on MySQL and written with no key on SQLite. An app installed earlier gains the rule with its next update. Save as app reads the rule back as a uuid key.
