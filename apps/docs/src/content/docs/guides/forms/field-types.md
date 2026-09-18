---
title: Field types
description: Which control a column gets by default, which ones you may switch it to, and why the list of alternatives is short.
---

Adminium picks a control from the column: its type, whether it is a foreign key,
whether it holds a file, and whether anything has fixed the values it accepts.
You can change it — but only to a control the column can actually answer. A
slider over a name has no scale; a toggle over a date has nothing to toggle.

## What a column gets by default

| Your column | Default control |
|---|---|
| Foreign key | **Reference** — a search over the other table |
| A file column | **Attachments** |
| A list (a `json` array, a PostgreSQL array) | **Chips** |
| Allowed values, up to four, required | **Segmented** — the answers as buttons |
| Allowed values, otherwise | **Select** |
| `boolean` | **Toggle row** |
| A money column | **Currency** — the symbol inside the box |
| An email / phone / link column | **Email**, **Phone**, **Link** |
| Any other number | **Number** |
| `date` · `time` · `timestamp` | **Date** · **Time** · **Date and time** |
| `json` | **JSON** |
| Long text with no length limit | **Long text** |
| Anything else textual | **Text** |

A read-only column is shown as **read-only**, whatever its type.

## What you may switch it to

| Your column | Also available |
|---|---|
| Foreign key | Choice cards, Select |
| A file column | Image, Avatar |
| A list | Check rows |
| Allowed values | Segmented (up to 5), Pill switch (up to 3), Choice cards (up to 6) |
| `boolean` | Check row |
| A number | Currency; **Stepper** for whole numbers |
| Text | Title, Long text, Code, Email, Link, Phone, Password |
| A date, a time, JSON | Nothing else — the control *is* the type |

The limits on the choice controls are about legibility, not capability: seven
segmented buttons in a 440px dialog are unreadable, and a pill switch with four
states is a menu wearing the wrong clothes.

## Controls worth knowing about

**Title** is the one large field at the top of a quick-create form. It has no
label — the dialog's own heading says what it is.

**Stepper** puts − and + beside a whole number, for quantities people nudge.

**Password** hides what is typed, with a **Show** control. Adminium never
displays a stored value in it: an existing password is left blank, and typing
replaces it.

**Chips** and **check rows** both edit a list of values. Chips are for a list
that is open — tags somebody invents — and check rows for one that is closed.

**Choice cards** give each answer a line of detail under its name. They are the
right control when the choice needs explaining and the wrong one when it does
not.

## Where the *values* come from

A control that offers choices needs a list of them. That list is your column's
own allowed values, or an [option list](/guides/forms/option-lists/) attached to
it by a rule. It is never invented from the rows already in the table.
