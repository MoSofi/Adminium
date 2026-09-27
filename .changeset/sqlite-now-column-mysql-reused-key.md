---
'@adminium/engine': patch
'@adminium/server': patch
---

Adding a column given "the current date and time" to a SQLite table that has rows works now. SQLite refuses to add such a column to a table with rows, whether it is required or not, so Studio's "add column" failed with "Cannot add a column with non-constant default". The table is now rebuilt with the new column instead: every row already there gets the current time as it is copied, and the review shows the rebuild. A table Adminium knows is empty still gets the column added in place. A SQLite rebuild that adds a time column is no longer reported as failed after it has already run: SQLite stores that column as a plain timestamp, and the check that compares the rebuilt table with the plan now accepts that.

Installing an app on MySQL no longer stops halfway when the app reuses one of your tables whose key has to start numbering itself, and one of the app's new tables links to that table. MySQL will not change a key that a link already points at ("Cannot change column … used in a foreign key constraint"), and the install made the app's tables and their links first. It now changes the reused tables first (making the key number itself, widening a column, adding choices), then makes the app's tables, then adds any missing columns to the reused tables. A new table's link takes the key's type as it is after that change.
