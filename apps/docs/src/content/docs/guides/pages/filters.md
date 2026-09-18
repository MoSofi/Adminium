---
title: Filters
description: The filter buttons over a table — the ones a page gets on its own, the six kinds, what each one asks the database, and how they ride into a saved view.
---

A page bound to a table shows filter buttons beside its search box. Each one
opens a small menu; choosing a value narrows the table and adds a chip saying
what is being asked.

## The ones a page gets on its own

A page nobody has configured still has filters. Adminium offers **at most two**,
picked from the columns themselves: a status-like column first, then the shortest
question left. Two, because a row of six buttons over a table nobody asked to
filter is furniture.

A masked column is never offered. Its values are redacted for the reader, so the
menu would either leak what the mask exists to hide or list dots nobody can
choose between.

## Choosing them yourself

**Studio → Pages → (a page) → Filters.** Add a filter from the table's columns,
name it, choose its control, reorder, remove. Up to six.

**Back to the suggested filters** does not store a copy of today's suggestion —
it removes your list, so the toolbar goes back to following your table. For the
same reason, a list that still says what the suggestion says is not stored at
all.

## The six kinds

| Kind | Offered for | What it asks |
|---|---|---|
| **One of** | A column with allowed values | equals the value |
| **Any of** | A column with allowed values | is one of the values |
| **Yes or no** | `boolean` | equals true or false |
| **A record** | A foreign key | equals that row's key |
| **Date range** | Dates and timestamps | between two dates, or after one, or before one |
| **Number range** | Numbers | between two numbers, or at least one, or at most one |

**One of** clears itself when you click the chosen value again. **Any of** keeps
its menu open while you tick, because choosing three values should not be three
journeys. A range with only one end filled in is a real filter — *everything over
100* is what somebody means by filling one box.

The date menu offers the last 7, 30 and 90 days, and **Custom** for two dates.

A text column is deliberately not offered. Filtering on its distinct values means
reading the table to build the menu, and an open "contains" box is a query builder
— the search box already answers *find the row that says this*.

## A page can be filtered by a column it does not show

A grid shows eight columns; a filter is not bound by that. A page listing
customers by name can perfectly well be filtered by country without printing
country in a column.

## Clearing

Each chip has its own ×, and **Clear filters** removes them all. It also appears
in the middle of an emptied table — the one place somebody needs it and the
toolbar is easiest to overlook.

## Saved views

Filters are part of a **saved view**, with the search, the sort and the page
size. Applying the view asks the whole question again.

A reload does **not** re-apply a view — a saved view is a question you ask again,
not one the page keeps asking. Only a view you marked as the default is applied
when the page opens.
