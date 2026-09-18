---
title: Designing a form
description: The form designer in Studio — layouts, sections, field settings, what "reset to generated" really does, and why a design that matches the generated form is not stored.
---

**Studio → Pages → (a page) → Create form.** The card opens on the form your
dialog shows today, so you start from what people already see rather than from
an empty canvas.

## Layouts

A layout changes the arrangement, never the fields, the controls or the values.
Turning one off gives back the plain form with nothing lost.

| Layout | Good for |
|---|---|
| **Sectioned** | A long record split into labelled groups. The default. |
| **Quick create** | One title field and a row of small pills. Few fields, filled fast. |
| **Wizard** | A long form nobody can face at once. One section per step, with Back and Continue. |
| **Choice cards** | A record whose first question is "which kind?" |
| **Segmented and files** | A short choice, a long description and attachments. |
| **Multi-entry** | Adding several of something at once — addresses, invitations. |
| **Upload and chips** | A picture, some tags and a toggle. |

The wizard checks each step's own fields as you press **Continue**, rather than
walking somebody to the end and only then saying the second step was wrong. If
your database refuses something, the dialog jumps back to the step holding it.

## Sections

A section is a heading and a number of columns (1, 2 or 3). Each field takes one
of them, or spans two or three. In a wizard, **a section is a step**.

A section can also name one of its own fields as its **aside**: an image or a
file field stood beside the rest, the way a product photo sits next to a product.

## A field's settings

| Setting | What it changes |
|---|---|
| **Shown as** | The control. Only the ones the column's type can actually answer are offered. |
| **Label**, **Placeholder**, **Help text** | The words. The column keeps its own name. |
| **Width** | How many of the section's columns the field takes. |
| **Required** | Marks it required *in this form*. It cannot make a required column optional — your database has the last word. |
| **Starting value** | What a **new** record starts with: nothing, today, the current time, the signed-in user, or a fixed value. Editing a record never applies it. |
| **Prefix / unit** | The `$` or the `kg` printed inside the box. |

The column's own [rules](/guides/schema/column-rules/) are shown here read-only,
with a link to Schema. They are the table's business, not this page's: a rule
changed here would silently change every other page that shows the column.

## Fields your table has no column for

**Add field** offers the table's columns and its **references** — the links to
other tables. A reference field writes the link rows, not a column.
See [References](/guides/forms/references/).

## Missing columns

If your design leaves out a column that must be filled in and has no default,
Studio says so by name. Such a form cannot create a row, and the notice is the
only warning you get before somebody tries.

## Reset to generated

**Reset to generated** does not store a copy of today's form — it **removes** your
design. That matters: a stored design is frozen, and a removed one keeps
following your table, so a column added next month appears on its own.

For the same reason, a design that still says exactly what the generated form
says is not saved at all. Looking around the designer costs nothing.

## One Save

The designer reports its draft to the page editor and saves nothing itself. The
page editor's single **Save changes** writes the columns, the labels, the form
and the filters together.
