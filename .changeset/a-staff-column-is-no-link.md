---
'@adminium/server': patch
---

A staff column is no longer read as a link to another table because of its name. A site visit's `rep_id` (a person's id) beside a `reps` table was followed into the rep profiles: on Postgres a message about the visit could not be prepared at all (a text compared with a whole number), and on SQLite and MySQL a person's id was compared with a profile's number in silence. Adminium now drops a link it guessed from a column that holds a staff member, everywhere it reads links (messages, rules, mentions, row limits, the data routes); a foreign key the database keeps, or one an app or a person declared, stays.
