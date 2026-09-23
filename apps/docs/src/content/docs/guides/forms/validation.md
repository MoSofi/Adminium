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

## Values Adminium decides

An installed app can hand a column to Adminium, so no writer picks its value — not
a form, not an import, not a visitor through the public API:

| Rule | What is written |
|---|---|
| Copied | The value of a column in the linked row, such as an item's price on an order line. A value the writer gives still wins, unless the app says always. |
| Running number | The next number in the column's own counter, starting past the largest number already there. A refused write uses no number; a write that fails later can leave a gap. |
| Code | A short random code after an optional prefix, such as `MR-7Q2K`, in letters that cannot be misread. The column is unique, and a code that is already taken is replaced by a fresh one. |
| Total | The sum over the rows that link to this one — an order's subtotal from its lines, each price times its quantity — kept in step whenever a line is added, changed, moved or removed. |

### A time on the venue's clock

A date-and-time column can be marked as the venue's: a time written to it with no
zone — "2026-09-25 19:00" from a till, a form or a guest — is seven in the evening
where the venue is, not where the server is. The venue's zone is its database's time
zone, or for the public API the zone of the key's scope. Columns without the mark
are untouched.

### A limit per time slot

A bookings table can hold each time slot to a limit: twelve guests at half past
seven, only on the half hour, only between the venue's opening and closing times,
never in the past and not further ahead than its booking window. The limit and the
hours can come from the app's own settings, so a venue changes them without a new
release. Only bookings in a status that holds a place count — a cancelled one frees
its seats — and changing a booking never counts its own party twice. The times are
the venue's, in its own time zone.

Two guests asking for the last places at the same moment cannot both have them:
the slot is held while one booking is counted and written. A time with no room is
refused; the public API answers `PUBLIC_SLOT_FULL`. Rows written together — an
import, a batch — are not counted this way: an import brings in past bookings as
they were, and a batch through the public API is refused.

These show under **Rules → Decided by Adminium**, where each can be removed. A
public endpoint can never list one of these columns as writable.
