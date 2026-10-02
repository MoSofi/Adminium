<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § Installing an app; do not edit -->

# Installing apps: Installing an app

Choose an app on the shelf, or **Install an app** to upload one. The wizard has four steps:
**Bundle**, **Database**, **Schema plan** and **Done**.

1. **Bundle.** For an upload, the `.tgz` and, optionally, its `sha512-` fingerprint. For an app
   from the shelf, the app you picked.
2. **Database.** The connection the app's tables go into, and the one it reads afterwards. Only a
   writable connection can be chosen.
3. **Schema plan.** The table check, the app's public access and the sample data box, described
   below. Nothing has been written yet.
4. **Done.** Which tables were created, which were used as they were, and which pages were made.

### Check the tables

The **Check the tables** screen lists every table the app needs, under its real name in that
database, with one badge each:

| Badge | What it means | What happens |
|---|---|---|
| **New** | No table has that name | It is created. **Create preview** shows the statement |
| **Yours from an earlier install** | Adminium recorded it for this app before, for example before an uninstall that kept the tables | It is used as it is, with its rows |
| **Shared with** *another app* | Another installed app uses a table of the same declared shape | Both apps read and write the same rows |
| **Name taken** | A table with that name exists and no app recorded it | You choose what to do with it, below |

When the app uses an existing table, the check also lists the changes it needs before the app can
write to it. Only changes that lose nothing are offered: adding a missing column, making a column
wider (a longer text column, text instead of a short one, a bigger integer), letting the key number
new rows by itself, and adding allowed values. **No column is removed and no data is lost.** Any
other difference is refused, with the table and column named.

### A table whose name is taken

Adminium never takes over a table it did not make without asking. **Install** waits until each
taken table has an answer:

- **Use it and keep its data.** The app reads and writes the rows already there. This is offered
  only when it is safe. A table with a required column the app never fills is refused, because the
  database would reject every row the app saves; the screen names those columns and says so.
- **Rename the existing table out of the way.** Your table gets a new name (by default the old one
  plus `_old`), and a fresh table is created for the app. Adminium updates its own pages, grants,
  column rules and public endpoints that pointed at the old name, as a
  [schema rename](https://docs.adminium.dev/guides/schema/editing-your-schema/#what-follows-a-change-and-what-does-not)
  does. Not offered when another app records that table.
- **Use a different prefix for this app.** Every table of the app gets the prefix you type, lower
  case and ending in `_`, and the whole check runs again. **Use the usual prefix** goes back.

Picking an answer checks the tables again at once. After typing a new name or a prefix, press
**Check again**; **Install** waits until the check on screen matches your answers.

### Apps whose tables are prefixed

Most apps name their tables with a prefix made from the app's key: an app with the key `pos` makes
`pos_menu_items`, not `menu_items`, so its tables cannot collide with yours or with another app's.
The app reads its tables under whatever real names the install gave them. An app whose tables are
not prefixed uses the names it declares.

A name longer than the database allows (63 bytes on PostgreSQL and SQLite, 64 on MySQL) is refused
at the check, and a shorter prefix fixes it.

### Public access and sample data

Two boxes can sit under the table check:

- **Public access**, when the app has customer screens. It lists what they will be able to do
  through the public API, and **Allow this public access** is ticked. See
  [An app's public access](https://docs.adminium.dev/guides/apps/public-access/).
- **Sample data**, when the app ships some. **Add sample data** is **not** ticked. When ticked,
  the records are added after the install finishes, and a failure there does not undo the install.
  See [Sample data](https://docs.adminium.dev/guides/apps/sample-data/).

### If the database changed in the meantime

**Install** sends the check you looked at. If a table was created, dropped or changed after the
check was made, the install is refused with `SCHEMA_DRIFT`: "The database changed since this
install was checked." The wizard runs the check again and shows the new one. Nothing was written.

### An install that stops part way

MySQL cannot undo a table it has created, so no engine rolls an app install back. Adminium records
each step instead. If one fails, the install answers `409` with the code `APP_INSTALL_INCOMPLETE`
and names the step it stopped at: the tables, reading them back, the pages, or finishing. The
screen shows **The install stopped part way**, what was already made, and what the database said.

**Nothing is removed.** **Try again** runs the same install again and finishes from where it
stopped: tables that were made are recognised as this install's own, and nothing is created twice.
**Back to Schema plan** checks the tables again first. An install that stopped part way is not
served until it finishes.

### An app already installed on another connection

An app runs on one connection. Once it is installed (or stopped part way) on one, the plan for any
other connection says it cannot be installed there and names the connection it is on, and an
install sent anyway answers `409` with the code `APP_INSTALLED_ELSEWHERE`. Nothing is written.
Update it where it is, or uninstall it there first and then install it on the other connection.
