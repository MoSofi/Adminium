---
title: What a field refuses
description: The checks that run in the browser, the ones only your database can run, where a refusal appears, and how to set limits without writing SQL.
---

A value is checked twice: once in the browser, so a mistake is caught while the
dialog is still open, and once by your database, which is the only thing that can
say yes.

## What the browser checks

| Check | Comes from |
|---|---|
| Required | `NOT NULL` with no default, or a rule |
| One of the listed values | The column's allowed values, or its [option list](/guides/forms/option-lists/) |
| A number, a whole number | The column's type |
| Length | The column's own width, or a rule |
| Smallest / largest | A rule |
| A valid email, link or phone number | The column's kind |
| Already added | A chips field — the same value twice |

Every one of these is also checked on the server. The browser's copy exists to
answer quickly, never to be the only answer.

## Where a refusal appears

On the field that caused it, in words. A refusal from your database is mapped
back to the column it names, so a unique-key violation marks the field that is
not unique rather than posting a banner over the dialog. Only a refusal that
belongs to no single field is shown at the top, and then it says so: *some values
were refused, check the marked fields.*

In a wizard, a refusal jumps to the step holding it.

## Setting limits

**Studio → Schema → a column → Rules → Limits.** Numbers take a smallest and a
largest; text takes a shortest and a longest, and a pattern where the shape
matters more than the length.

Limits are **rules**, so they apply everywhere the column appears — every page,
the REST API, imports — not only in one form. That is the point of putting them
on the column rather than in the dialog. See
[Column rules](/guides/schema/column-rules/).

A limit your database does not know about is checked by Adminium on every write
it handles. A limit you want the database itself to enforce belongs in the
schema, as a `CHECK` — [Editing your schema](/guides/schema/editing-your-schema/)
writes those.

## Unique columns

A unique column's field checks itself as you type, against the rows that already
exist, and says how many it looked at. It is a courtesy, not a guarantee: two
people typing the same value at the same moment are separated by the database,
and the loser sees the refusal on the field.
