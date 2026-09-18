---
title: The create dialog
description: What the New and Edit dialogs show, where every field in them comes from, and what happens between pressing the button and the row existing.
---

Every page bound to a table has a **New** button, and every row on it can be
opened for editing. Both open the same dialog. Nothing about it is written by
hand when a page is generated: the dialog is **derived from your table**, and it
keeps following your table until you decide otherwise.

## Where each field comes from

| What you see | Where it comes from |
|---|---|
| Which fields appear | Your columns — minus the ones nobody fills in |
| The order | Your columns' order, required ones first |
| The control | The column's type, and any [rules](/guides/schema/column-rules/) set on it |
| The label | The column's label, or its name made readable |
| Whether it is required | `NOT NULL` with no default, or a rule that says so |
| What it refuses | The column's type, its allowed values, and its [limits](/guides/forms/validation/) |

A column Adminium fills in for you — a key that counts up, a `created_at` with a
default, a column whose rule says "the signed-in user" — is **not** shown. Asking
somebody for a value that is about to be overwritten is a question with no right
answer.

## What the dialog does when you press the button

1. It checks the values it can check **in the browser** and marks the fields it
   cannot send. Nothing leaves the page.
2. It sends one request. Your database checks it again — it is the only thing
   that can — and anything it refuses comes back marked on the field that caused
   it, not as a banner over the whole dialog.
3. On success the row exists, the list behind the dialog updates, and a toast
   offers **Undo** for a few seconds.

:::note[Undo is a real delete, not a pretend one]
Undoing a create removes the row you just made. It is offered only while nothing
else has touched it.
:::

## When it is not enough

The derived dialog is deliberately plain. When a table wants something else —
sections, a different order, a wizard, a field the table does not have a column
for — [design the form](/guides/forms/designing-a-form/) in Studio. Until you
save one, the dialog follows your table; after you save one, it follows your
design, and Studio tells you which columns your design leaves out.

## Read next

- [Designing a form](/guides/forms/designing-a-form/)
- [Field types](/guides/forms/field-types/)
- [References](/guides/forms/references/)
- [What a field refuses](/guides/forms/validation/)
