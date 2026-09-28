---
title: Sample data
description: Load an app's example records to try it out, and take them out again later without touching the records you made or changed.
---

Some apps ship **sample data**: a few example records in the app's own tables, so a new install
has something to click through. Adding it is always your choice, and taking it out again removes
only what it added.

Adding and removing sample data needs the **Install and manage apps and add-ons** permission.

## Adding it

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
  [Column rules](/guides/schema/column-rules/#filled-in-by-adminium).
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
  app's connection, like any other upload. See [Attaching files to records](/guides/files/).
- **A shared menu keeps its real dishes.** An app that shares a table with another app can leave
  its sample rows out once that table holds real ones. See
  [A menu two apps share](/guides/apps/shared-menu/#sample-data-on-a-shared-menu).

The card then reads **Loaded**, with the number of records and the date. An app's sample data can
be loaded once at a time: remove it before adding it again.

## Sample times that follow the calendar

Sample times are written relative to the moment the data is added, on the venue's clock, so a
sample never looks stale. Three forms keep it believable whatever day and hour that is. The
fields are in the [manifest reference](/reference/manifest/#sample-data).

- **Days that keep their weekday.** A hotel's sample has a weekend stay. With
  `{"@day": 3, "@week": true}` its days count from the bundle's `weekAnchor` (a weekday such as
  `"tue"`) in the week nearest the adding day, at most three days either way. Added on a Tuesday
  or a Thursday, the stay still arrives on a Friday. A `@week` day needs the bundle to name its
  anchor.
- **A status that matches the clock.** `@byStay` sets some of a row's columns by where the adding
  moment falls against its two times: before the stay, during it, or after it.

  ```json
  {
    "arrive": { "@day": 3, "@week": true },
    "depart": { "@day": 5, "@week": true },
    "@byStay": {
      "from": "arrive",
      "to": "depart",
      "times": { "from": "15:00", "to": "11:00" },
      "before": { "status": "booked" },
      "during": { "status": "in_house" },
      "after": { "status": "departed" }
    }
  }
  ```

  `from` and `to` are columns of the row, or times written in place. A date is read at the
  `times` given (arriving from 15:00, leaving by 11:00), else at its midnight. A set with
  `"@skip": true` leaves the row out. A row takes `@byStay` or `@byClock`, not both.
- **A time the venue is open.** A pickup order 20 minutes from now is no use at 21:10 when the
  kitchen closed at 21:00. `{"@in": "PT20M", "@slot": "orders"}` is the first open time of that
  table's slot limit at least that far ahead: its hours, closures and pauses, on its grid. It counts
  the rows already there and the sample rows placed so far, so a time that is full is passed over.
  When today has no open time left, it is the next day the venue opens. It looks about two weeks
  ahead, and a limit with no open time in reach keeps the plain time. The table must keep a slot
  limit, and `@slot` takes no `@grid` of its own.

Sample rows are real rows to the app's rules. A sample pickup order takes its place in the slot it
lands on, and a sample stay takes its room for its nights, so guests see that much less on the
customer pages. Remove the sample data before you open for real.

## While it is loaded

The app's own pages in the dashboard show **Sample data is loaded** at the top, with **Remove it**.
Only people who can manage apps see this line.

Adminium keeps a list of every record and image it added, in a table of its own in the app's
database, named after the app's key with `_sample_data` at the end (for example
`pos_sample_data`). The **Data** card lists it as "Adminium's list of sample records". It is made the
first time you add sample data, and it is left out of the app's pages and of the public API.

## Removing it

**Remove sample data** on the card, or **Remove it** on the banner, opens a preview first:

- **Removes** — how many sample records go, per table.
- **Kept** — the sample records you have made your own:
  - a sample record one of your own records uses is **always** kept, with the records it points at
    in turn. Removing it would break your record;
  - a sample record you edited since it was added is kept while **Keep the ones I changed** is
    ticked, which it is by default. The preview names them. Untick the box to remove them too.

**Remove** then deletes the rest in one transaction. If the database refuses a delete because
something still points at a sample record, **nothing** is removed and the message names the table.

When it is done:

- **Kept records are yours.** They leave Adminium's list and are never treated as sample data
  again.
- **The list ends empty,** so the card reads **Not loaded** and **Add sample data** is offered
  again. Adding it again starts afresh.
- **Images follow their records.** An image goes to the trash in **Files** unless a kept record
  still uses it, and is deleted for good like any other
  [trashed file](/guides/files/#deleting-is-not-deleting).

A message on the card says how many sample records stayed, if any.

## On uninstall

Uninstalling an app does not remove its sample data on its own: the records are rows in the app's
tables, and those tables are kept unless you choose to delete them. See
[Uninstalling](/self-hosting/installing-apps/#uninstalling). To start clean, remove the sample
data before you uninstall.
