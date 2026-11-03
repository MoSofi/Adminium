---
'@adminium/manifest': patch
'@adminium/server': patch
'@adminium/dashboard': patch
---

An app binds an add-on from its own side: a table with a link column into one of the add-on's tables (`addOnLink`) is one of the add-on's hosts, listed to its pages (`via: "link"`) and shown its record tabs. An add-on at `minAdminiumVersion` 0.3.43 or later names only its own tables in a foreign key's `references`; an older one keeps pointing at the database's tables. An add-on installed with plain table names before its tables were recorded is refused an update to a version under its own prefix (`409` `ADD_ON_BARE_TABLES`, naming the tables), so no rows are left behind beside new empty tables.
