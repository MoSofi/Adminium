<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § Installing an app — Check the tables; do not edit -->

# Installing apps: Installing an app — Check the tables

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
