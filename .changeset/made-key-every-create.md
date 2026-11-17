---
'@adminium/server': patch
---

A table keyed by text Adminium makes now gets a key on every create that sends none: an app's or an add-on's primary key declared `id` (on every engine), and a `uuid` key on SQLite and MySQL as before. A person's create, a mail in the outbox and every other row Adminium writes itself get a new uuid, the same kind a forms answer and sample data get. Before, an `id` key was left empty: the row was refused on Postgres and MySQL and written with no key on SQLite. Installing or updating an app or an add-on writes the fill (a `column.default` rule), an update gives it to an install made before this release, and an uninstall takes it back. A key the owner fills with a rule of their own, or one the database fills, is left as it is.
