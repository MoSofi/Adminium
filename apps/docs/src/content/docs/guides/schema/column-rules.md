---
title: Column rules
description: Four rules that travel with a column — what fills it, what it accepts, whether it is required and what its limits are — and why they belong to the table rather than to a form.
---

A **rule** is something Adminium knows about a column that your database does not
say by itself. There are four, they live on the column, and they apply to every
write Adminium handles: the New dialog, the Edit dialog, a CSV import, the REST
API, an automation.

**Studio → Schema → a connection → a column → Rules.**

That reach is the point. A limit typed into one form is a limit one form has; a
rule on the column is a limit the table has.

## Filled in by Adminium

What goes in the column when nobody fills it in.

| Choice | What Adminium writes |
|---|---|
| Nothing | Nothing. The column is left to the database. |
| The current date and time | The instant of the write, in the column's own type |
| A new unique id | A fresh UUID |
| A fixed value | The value you type |
| The signed-in user | Who made the write — their id, or their name |
| The database fills this | Nothing, and the field is hidden: you are telling Adminium a default or a trigger already handles it |

A rule that fills a column **hides its field**, because asking somebody for a
value that is about to be replaced is a question with no right answer.

The current-date rule can also apply **on every update**, which is how a
`updated_at` with no database trigger gets kept.

:::note[This is the rule that fixes the "500 on create" table]
A `NOT NULL` column with no database default could not take a row at all: the
form did not show it and nothing filled it, so the database refused the insert.
Either rule above — *the current date and time*, or *the database fills this* —
closes that.
:::

## Option list

The values the column accepts: a list you made, one of the built-in ones, or the
values typed in place. See [Option lists](/guides/forms/option-lists/).

A column whose own type already fixes its values does not take this rule.

## Required

Marks the column as one that must be filled in even though your database allows
`NULL`. It is a statement about your data, not about a page.

The opposite does not exist: a rule cannot make a `NOT NULL` column optional.

## Limits

Smallest and largest for numbers; shortest and longest for text; and a **kind** —
email, link or phone number — where the shape matters.

Adminium checks these before the write and names the column in the refusal. Your
database does not know about them, so anything writing to the table without going
through Adminium is unaffected. A limit you want enforced everywhere belongs in
the schema as a `CHECK` — see
[Editing your schema](/guides/schema/editing-your-schema/).

## Where rules are shown

- **Schema → Rules** — where they are set.
- **The form designer** — read-only, beside each field, with a link back here.
  A rule changed in a page would silently change every other page showing the
  column, so the designer does not let you.
- **A project folder** — rules are configuration and travel in `schema/`, so
  `adminium check` validates them with everything else.

## What a rule cannot do

It cannot loosen your database. A rule adds a promise Adminium keeps; it never
removes one the database makes. If the two disagree, the database wins and its
refusal is what you see.
