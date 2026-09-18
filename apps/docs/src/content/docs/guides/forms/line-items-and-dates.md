---
title: Line items, dates and invitations
description: The three fields that write more than one value — a table of child rows with live totals, a calendar bound to what is already booked, and a chips field that makes one record per entry.
---

Most fields put one value in one column. Three do not, and each of them exists
because the alternative is a person doing the same thing five times.

## A table of line items

An invoice has lines; an order has items. Add a **line items** field in the
[form designer](/guides/forms/designing-a-form/) — *Add field* lists the tables
that point at this one, under *… as lines* — and the dialog draws a small table:
one row per record, a control per column, **Add line**, and a bin.

What it writes is rows of the other table, in the **same transaction** as the
parent:

- The foreign key is the parent's business. The field never shows it and never
  sends it.
- Saving an edit is a **difference**, not a rewrite: a line you changed is
  updated, a line you removed is deleted, and a line you left alone is not
  touched — so it keeps its id, its defaults and its history.
- **Undo** takes the lines with the record.
- Every line goes through the same [column rules](/guides/schema/column-rules/)
  a row written on its own would.

You need permission on the **other** table. A grant that lets you write invoices
does not let you write their lines, and a save that would need one says so
instead of silently skipping them.

### Totals

A line-items field can compute. Give it a **row total** — usually quantity times
price — and a block of totals underneath: a subtotal, any number of rates
(a tax, a levy) and a total. They add up as you type, over values nothing has
saved yet.

Two rules worth knowing, because they are the two places money goes wrong:

- A **rate is taken off the subtotal**, never off the running total. A tax on a
  tax is a different number and nobody asked for one.
- **Rounding happens once**, at the end. Rounding each line first and adding the
  results gives a different answer, and it is the wrong one.

Nothing computed is stored unless a column holds it: name a column in the field
and mark it read-only, and each line's own total is written there. The block
under the table is never stored — it is a reading of the lines.

## A calendar, and the times of a day

A date or timestamp column can be shown as a **calendar** instead of a text box:
a month grid, and — when the field defines opening times — a grid of slots
beside it. The day and the time are one value in one column, so a form can never
hold half a booking.

Set it in the field's settings: **Times from / until / every**. Leave the times
empty for a day picker with nothing beside it.

### What "already taken" means

Nothing is crossed out until you say what taken means. **Already taken when**
offers two answers:

| Choice | What it checks |
|---|---|
| Any row holds that time | Another record already holds the same instant |
| A column | …and agrees on that column — the same room, the same person, the same machine |

With a rule, Adminium asks once per visible month which instants are held, and
crosses those out. A day is **fully booked** only when every one of its slots is
taken.

Three things it deliberately does **not** do:

- It never crosses out the record **you are editing**. Its own slot is its own,
  or there would be no way to save it without moving it.
- A month with more bookings than it can check crosses out **nothing**, and says
  so. Half an answer drawn as a whole one marks free what it never looked at.
- It counts one row per slot. There is no capacity above one.

## One record per entry

A chips field can be marked **one record each**: instead of a list in a column,
every chip becomes its own row, sharing the rest of the form. Three email
addresses in an invitations dialog are three invitations.

They are written in one transaction under one **Undo**: three rows or none. A
list half sent, with no way back, is worse than one refused.

## A summary box

A form can carry a **recap**: a sentence about what has been filled in, and one
computed number, in the accent-tinted box the comps draw. It writes nothing and
stores nothing — it reads the screen, which is why it can total a form nobody
has saved yet.
