---
title: Bring in a file
description: Importing rows into a table — from a CSV file or rows pasted from a spreadsheet, matching them to rows already in the table, and reading the preview that says what will happen to each line before anything is written.
---

**Import** in the sidebar opens a wizard of four steps: the file, its columns,
a look at what will happen, and the run. Nothing is written to your table before
the last one.

Bringing rows in needs the **Import** permission on the table. Matching lines to
the rows already there (see [Matching](#matching)) also needs permission to
**read** the table, because it says which values the table holds. Changing the rows a
file matches ("Update them") also needs permission to **update** the table: bringing a
file in makes rows, and is no way round an update a role does not hold.

## A file, or a paste

Drop a CSV file of up to 32 MB. Its first row holds the column names.

Or copy rows in a spreadsheet and paste them into the box under the drop zone.
Rows copied from a spreadsheet are parted by tabs; a file saved where the comma
is the decimal mark is parted by semicolons. Adminium tells which from the first
line, so a paste, a semicolon file and a comma file all read the same.

If what you pasted has no row of names, untick **The first row holds the column
names**. Every row is then data, and the columns are called `Column 1`,
`Column 2` and so on.

## The columns

Each column of the file is given a column of the table, or **Don't import**.
Columns whose names already match are matched for you.

## Matching

**Match on** decides what happens to a line whose row is already in the table.

| Choice | What a line does |
|---|---|
| **Nothing: every line is new** | Every line is added as a new row. |
| A column, and **Leave them as they are** | A line whose value in that column is already in the table is left out. The row in the table is not touched. |
| A column, and **Update them** | A line whose value is already in the table updates that row with the line's values. |

Pick a column that tells rows apart: an email address, an order number, a key.
The column has to be one of those you are bringing in.

A line with nothing in the match column is refused: there is nothing to match it
by.

A column you see masked (personal data your role is not shown) cannot be the
match column, for the same reason you cannot filter by it.

## The preview

Before the run, each line carries one of three marks.

| Mark | Meaning |
|---|---|
| **New** | A row will be made of it. |
| **Already here** | It matches a row in the table. That row is left as it is, or updated, as you chose. |
| **Refused** | It will not be written. The reason is beside it: a value that is not a number or a date, a rule of the column, a row somebody else holds. |

Two lines of one file with the same match value: the first is new, and the second
is already here, because the first will have made its row. The preview judges
that second line against the first line as it was typed, not against the row the
first line will become once the table's rules and your code have filled it in.

A line that would be a new row, whose key is already a row's, is refused with
**A row with this value already exists.**, in the preview and in the run.

The preview looks at the first 2,000 lines, and says so when the file has more.
The rest are judged when the import runs, by the same rules.

The preview is a reading, not a promise. Two things are only known when the
import runs:

- **Your project's own code.** A table with hooks runs them for each row as it
  is written, never for a preview, and a hook can still refuse a line. The
  preview says when a table has them. On a table with its own update code, the
  preview judges an update without that code.
- **The database's own checks.** The preview matches on the one column you
  chose. A line that is new by that column and repeats a value in another unique
  column, or points at a row that is not there, is refused by the database when
  it runs. So is a line whose key of several columns is already taken (a key of
  one column is looked for by the preview).

After the run, the lines that were refused are in a report you can download,
each with its reason. Lines that were already here and left alone are counted,
and are not in the report: nothing was wrong with them.

## For somebody who sees only some rows

A role can be held to some rows of a table: a rep's own deals, a team's. An
import by that person is judged as that person, as their roles stand when it
runs.

- A line matches only a row they can reach.
- A line whose value belongs to a row they cannot reach is refused with **A row
  with this value already exists.** and nothing else about that row.
- A new row is made in their own name, or in the name of somebody the table lets
  them name. One made in a colleague's name is refused.
- They match on the table's key or a column marked unique, and no other. On any
  other column the whole import is refused, before a line is read.

Only the person who made an import can see its preview.

## In a page of your own

The project UI kit's `ImportWizard` is this wizard for one table. Its `matchOn`
names the match column for people, so a file brought in twice adds nothing the
second time. See [Pages and widgets](/projects/pages-and-widgets/).

## Through the API

| Call | What it does |
|---|---|
| `POST /api/v1/imports/upload` | Takes the text as a `text/csv` body. `header=none` says no row holds the names. Answers the columns and the first rows. |
| `POST /api/v1/imports` | Makes the import: the file, the table, the mapping, and `options.mode` (`insert`, `skip` or `upsert`) with `options.matchColumn`. |
| `GET /api/v1/imports/:id/preview` | The marks, a page of lines at a time (`offset`, `limit` up to 200). Writes nothing. |
| `POST /api/v1/imports/:id/run` | Runs it. |

The full shapes are in the [REST API reference](/reference/rest-api/).
