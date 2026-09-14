---
'@adminium/server': patch
---

**Micro-SaaS apps install on Postgres and MySQL.** Reported against 0.2.7:
installing online-ordering, clinic-desk or hotel-reservations failed at the
database step with

    creating "menu_items" failed: error: foreign key constraint
    "fk_menu_items_category_id" cannot be implemented

The installer created every foreign-key column as `varchar(36)`, the type of an
`id` key. Every add-on keys its tables with `id`, so add-ons installed fine. The
apps key theirs with `int` (and hotel-reservations also with `text`), and
Postgres and MySQL both refuse a foreign key whose column type differs from the
key it references. SQLite does not check this, which is why the tests passed.
All five published apps failed on both server engines. Only three were tried.

A foreign-key column now takes its target's key type: the declared type when the
install creates that table, and the live database type when the table already
exists. On MySQL, a `text` primary key, and any foreign key that points at one,
is now `varchar(255)`. MySQL cannot index a `TEXT` column without a prefix length,
so hotel-reservations' `room_types` would otherwise fail on MySQL even with the
foreign keys fixed.

A failed install already leaves nothing to clean up. Tables it created before
the error are skipped on retry, so installing the app again completes it.
