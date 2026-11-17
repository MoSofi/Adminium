---
'@adminium/server': patch
---

Sample data now gives a row a key in a table keyed by text Adminium makes (an add-on's `id` or `uuid` key) when the sample names none. Before, such a row was refused on Postgres and MySQL and written with no key on SQLite.
