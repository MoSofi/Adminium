---
title: References
description: Picking a related record, adding several links at once, what a reference field writes, and what happens when the reader cannot read the other table.
---

A **reference** is a field that points at a row in another table. Adminium builds
one from a foreign key without being asked.

## Picking one record

A foreign key becomes a search over the table it points at. Type, and the menu
narrows; each row shows the other table's own display column, with a second line
of detail where the table has one. Choosing a row stores its key.

Two smaller variants exist for short tables:

- **Choice cards** — every candidate as a card, for the handful of rows nobody
  needs to search.
- **Select** — a plain menu.

Both read the whole table, so Adminium offers them only where that is
reasonable.

## Linking several records

Some relationships are not a column. A product is in many categories; an order
is served by several people. Adminium calls these **links**, and a form can carry
a field of them: a box of chips with a search underneath.

Add a relation field in the [form designer](/guides/forms/designing-a-form/) —
**Add field** lists the table's relations under its columns.

What a link field writes is rows in the joining table, not a value in yours:

- Creating a record writes the record and its links **together**. If the links
  cannot be written, the record is not created either.
- Editing changes only what you changed — the links you added are added, the ones
  you removed are removed, and the ones you left alone are not rewritten.
- **Undo** puts the links back as they were, not just the record.

## When somebody cannot read the other table

A reference over a table the reader has no grant on is shown **disabled**, saying
so. It is not hidden and it is not a search that returns nothing: a field that
silently finds no rows looks like an empty table, and somebody will spend an
afternoon on it.

An existing value stays visible as the key it holds. Adminium will not resolve it
through a permission the reader does not have.

## Before the record exists

In the **New** dialog there is no record yet, so links are collected and written
with it in one step. Anything that cannot work that way — file attachments on a
source Adminium cannot alter, for instance — appears on the record's page after
it exists, and says so.
