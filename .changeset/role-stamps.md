---
'@adminium/server': patch
---

A column's `role` stamps it, whatever it is called. A `timestamptz` or `date` column whose role is `created_at` is filled with the moment its row is made, and one whose role is `updated_at` with the moment of every change too, through every door: the desk, a guest's create, a change through a link. Before, only the names `created_at` and `updated_at` were stamped, and an `updated_at` the database gave a default was not stamped on a change. In a table that gives a role, another column whose name alone says the same moment is left as written; a table with no roles is stamped by its columns' names, as before.
