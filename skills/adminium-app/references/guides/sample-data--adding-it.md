<!-- produced from apps/docs/src/content/docs/guides/apps/sample-data.md § Adding it; do not edit -->

# Sample data: Adding it

There are two ways in:

- **At install.** The **Sample data** box on the table check reads **Add sample data** and is
  **not** ticked. When you tick it, the records are added after the install has finished. If that
  part fails, the app stays installed and you can add the data later.
- **Later.** On the app's settings page (**Studio → Hosted apps**, then the app's name), the
  **Sample data** card shows **Not loaded** and an **Add sample data** button.

The dialog says how many records go into each table, how many images go to **Files**, and the
total, before anything is written. Nothing else in the database is touched.

What happens when you confirm:

- **All or nothing.** Every record is written in one transaction. If one is refused, nothing is
  written and the dialog says which table refused it.
- **Beside your records, never over them.** Sample records are added as new rows; they never
  replace or change a record you already have.
- **Your codes and numbers stay yours.** When a sample record carries a code or a running number
  that a row in the table already has, the sample's value is dropped and the column's own rule
  fills in a fresh one, exactly as for a record a person creates. A sample record that leaves a
  code empty gets one too, so a sample handover link opens. The code a shared link opens a record
  by is always made fresh: one printed in the app's package would open the same sample page on every
  install. See
  [Column rules](https://docs.adminium.dev/guides/schema/column-rules/#filled-in-by-adminium).
- **Your settings stay yours.** A sample row meant for a table that holds one row, such as the
  app's own settings, is added only when that table is empty. When you already have a row there,
  the sample leaves it alone and uses it.
- **One of a kind stays one of a kind.** Any other column that must be unique (a weekday's opening
  hours, a day already closed) is never worked around: if a sample record would repeat a value
  one of your records holds, nothing is added, and the dialog names the table, the column and the
  value. Sample data is meant for tables that hold none of your own records of that kind yet.
- **Rules apply, automations do not.** The records go through the same column rules as a person's
  write, but no hooks or automations run, so a sample booking sends no email.
- **Images go to Files.** A picture the sample uses is stored in the **Files** library under the
  app's connection, like any other upload. See [Attaching files to records](https://docs.adminium.dev/guides/files/).
- **Two apps' samples do not double a shared table.** When another installed app's sample already
  put the same row in a table the two apps share (the same `@label`, the same values, still as that
  sample wrote it), the row is taken as this app's sample row too and not written again: a copy of
  an app beside its original shows one menu, and the copy's sample orders are of the dishes already
  there. Removing one app's sample leaves such a row in place for the other; it goes when the last
  app that lists it removes its sample. A row that differs (a dish at another price), or that you
  changed since, is left alone and the app writes its own beside it.
- **A shared menu keeps its real dishes.** An app that shares a table with another app can leave
  its sample rows out once that table holds real ones. See
  [A menu two apps share](https://docs.adminium.dev/guides/apps/shared-menu/#sample-data-on-a-shared-menu).

The card then reads **Loaded**, with the number of records and the date. An app's sample data can
be loaded once at a time: remove it before adding it again.
