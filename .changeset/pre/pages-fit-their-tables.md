---
'@adminium/server': patch
---

A page tells you when its table cannot back it, and offers the fix.

Choosing a calendar, board or scheduler for a table that lacks what the template
needs used to create a page that showed nothing. Studio now checks the table
first and names what is missing, then offers the ways out: a table that already
fits, a column you already have, the columns added for you (you see the exact
statement before anything runs), or a new table built for the page. A page that
still has nothing to show says why and links to its settings.

An installed app now gets the pages its manifest declares, bound to its own
tables, and an app update that needs new columns offers to add them.

Built-in roles start with access to pages and records: Viewer reads, Editor also
creates and edits, Admin can do everything. Team → Roles shows this as a
**Pages & records** section, and revoking it sticks. Only a Super Admin can
change a Super Admin's account. Studio offers only the actions your role
holds, and a failed delete now says so.

Also fixed: renaming a column no longer renames it to the wrong name, keeps its
labels and rules, and survives a SQLite table rebuild. Date columns created on
SQLite now read back as dates. A record you save shows up in widgets
straight away. And the connection wizard handles a database with no tables.
