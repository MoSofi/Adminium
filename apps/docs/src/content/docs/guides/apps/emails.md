---
title: An app's emails
description: How an app's emails are queued, sent and logged in its own outbox table, what never sends one, the templates it ships and you may edit, and every variable a template can read.
---

An app that sends email, such as booking confirmations or visit reminders, keeps them in a table
of its own: the **outbox**. Every email is a row there. Adminium adds rows when something happens,
sends the queued ones, and writes the outcome back on each row. The outbox is the log a person
reads to see what went out, to whom, and why something did not.

The app declares its outbox and its templates; the fields are in the
[manifest reference](/reference/manifest/#emails).

Email has to be set up on the server: an SMTP relay and a sender under
**Studio → Settings → Email** (see [Senders](/guides/email/#senders)). Without it, the install's
table check warns "Email is not set up", and every queued row fails with "Email is not set up on
this server".

## The outbox table

It is one of the app's tables, so you read it like any other: in the app's own screens, or in a
page of the dashboard. Each row holds:

| Column | What it holds |
|---|---|
| Kind | Which email it is, such as a confirmation or a reminder. Each kind is sent with one template. |
| Status | `queued`, `sent`, `failed` or `skipped`, and `held` for a message that waits for a person ([below](#held-messages)). |
| To | The address, copied when the row is queued. |
| Language | The recipient's language, copied when the row is queued. |
| Links | The row it is about: a visit, a person. |
| Due | For a reminder, the moment it leads. |
| Sent at | When it was handed to the mail queue. |
| Error | Why it was skipped or failed, as a sentence. |

The address and the language are copied onto the row when it is queued. A person who changes
their address afterwards changes where the next email goes, not this one.

## What queues a row

Rows are queued by the app's own screens, by you, or by the app's **producers**, which queue them
by themselves:

- **A row created,** such as a confirmation when a visit is booked, whoever booked it.
- **A column changed to a value,** such as a notice when a visit is cancelled. It needs a real
  change against the stored row. Saving the same status again queues nothing.
- **A reminder before a moment,** a number of hours before a visit starts. The hours come from
  the person's own choice, or else from the default in the app's settings row, and never more
  than the most the app allows. Adminium looks for reminders that have come due once a minute,
  and only while the moment is still ahead.

A producer can be conditional, for example only for a visit whose status is `booked`. It can
wait some days after a date (a reminder a week after an invoice's due date), gather what happens
over a few minutes into one message (five versions posted in ten minutes make one email), or
write to the business's own address from a setting rather than to the person.

Each kind is queued **once** per source row. A visit cancelled, restored and cancelled again is
told once. A reminder is once per moment: move the visit and it gets a fresh reminder.

When the person has no usable address, the row is still written, as `skipped` with "No email on
file", so you can see that an email was due.

### Opting out and pausing

- **A person who opted out** gets nothing from a producer that respects the choice, typically
  reminders. Confirmations can still go.
- **The app's email switch.** An app can have a yes/no in its settings row that pauses its
  producers. While it is off, those producers queue nothing. Rows already queued still go. A
  missing settings row counts as off, as the public switches do.

### What never queues an email

- **Sample data.** Loading it queues nothing, and a sample record changed later still queues
  nothing. See [Sample data](/guides/apps/sample-data/).
- **An import** or **an undo.** They restore what happened, and send nothing about it when they
  are written. An imported row is a real one, though: a reminder before its moment is still
  queued when the moment comes, and an imported sent invoice still gets its
  [held](#held-messages) reminders.
- **A disabled app.** Nothing is queued while it is off. See
  [Disable and enable](/guides/apps/settings/#disable-and-enable).

## Sending

Queued rows go right after they are queued, and a pass every minute picks up any left behind, for
example after a restart or when you queue one yourself. Each row is sent:

- **to the row's address.** A row with none, such as one the desk queued with the patient linked
  but not their email, goes to the address the producers would have used: the person the row
  links, else what the linked visit carries for a first visit. The address, and the language
  found with it, are written into the row once it is sent. The person's reminder opt-out is not
  asked here: it only stops the producers;
- **in the row's language,** when it is one Adminium speaks, else the workspace's. A template
  with no version in that language is sent in US English. Another language picks the nearest one
  Adminium speaks (`en-GB` gets the US English email), and its dates, times and money are still
  written the recipient's way (`en-GB` reads "09:30", not "9:30 AM");
- **on the venue's clock:** the time zone of the app's connection, or UTC when none is set;
- **in the connection's currency** for money.

Then the row's status changes, with a sentence in its error column:

| Status | Sentence | What it means |
|---|---|---|
| `sent` | none | Handed to the mail queue. **Sent at** is filled in. |
| `skipped` | No email on file | There is no usable address, on the row or on the person it links. |
| `skipped` | A reserved address (for examples and tests) | The address is on `example.com` or another name kept for examples: `example.*`, `.example`, `.test`, `.invalid`, `.localhost`. Sample records use these. |
| `failed` | No email is set for "*kind*" | The kind has no template. |
| `failed` | The email is switched off, or has no text | The template, in that language, is a draft or archived. |
| `failed` | The email has an HTML block, which cannot carry what a person typed | Someone added a **custom HTML** section to the template. See [below](#editing-the-templates). |
| `failed` | Email is not set up on this server | Set up email, then queue the row again. |
| `failed` | The email could not be prepared | Something else went wrong; the server log says what. |
| `failed` | Not delivered: *reason* | The mail server refused it for good, after its retries. |

**To send a row again,** set its status back to `queued`. It goes within a minute. A late
report about the earlier message does not touch the new one.

A disabled app's queued rows wait, and go once it is enabled again.

## Held messages

Some emails should not go by themselves: a reminder that an invoice is overdue is read first. An
app can make such a message **held**. It is written with the day it comes due, and nothing is
sent until a person approves it.

- **Approve** a held message and it becomes `queued`. You may reword it first, its subject and its
  text, which is then sent as plain paragraphs in place of the template's. Who approved it is
  recorded. One approved before its day goes at once.
- **Skip** a held or queued message: it becomes `skipped`, with the reason "by hand".
- **Queue again** a failed one.

Once a minute Adminium looks over the waiting messages. It moves a message's day when what it is
counted from moves (a new due date), skips the ones no longer needed (the invoice paid or voided),
and skips an earlier reminder once a later one of the same series has come due, so an invoice
never has two reminders ready at once. It asks all of this again just before a message goes. A
held message is written even with no address on file: the address is looked up when it is
approved and again when it is sent.

A message can also change a row once it has gone, such as marking a project paused. That change
is an ordinary write, held to the row's rules; if it is refused, the message records why.

## Attachments

A template can carry a document, such as the invoice with the invoice email or a receipt with a
payment's. It is drawn for the row the message is about when the message is sent. A message
whose document cannot be drawn fails, with the reason, rather than going without it.

## The templates

The app ships a template for each kind, in each language it supports. The install writes them
into **Email templates**, marked as the app's, with keys that start with the app's key (for
example `clinic-reminder`). They are edited like any other template; see
[Email templates](/guides/email/).

- **Your edit is kept.** Once you have changed a template, an update of the app leaves it as you
  left it. The languages you did not touch are brought up to date.
- **Uninstall leaves it too.** The app's unedited templates are removed; the ones you edited stay.
- **A template the new version no longer ships** is removed, unless you edited it.
- **A template of your own** with the same key and language as one the app ships is never
  overwritten. The install skips it and says so.

### Editing the templates

Values in an app's emails come from what people typed, sometimes a stranger booking online. The
standard sections escape them. A **custom HTML** section does not, so a template holding one is
refused: every row sent with it fails. The install refuses one in the app's own templates for the
same reason.

## Variables

A template reads variables as `{{name}}`. A column that holds nothing reads as empty: a
paragraph, list item or quote holding only it is left out of the email, so an optional value
(a visit's reason) sits best in a block of its own. A name that no row has is printed as written,
so a mistake in a template shows rather than vanishing. A column marked secret is never offered.

| Variable | What it holds |
|---|---|
| *link*`.`*column* | A column of each row the outbox links to, by the link's name: `appointment.starts_at`, `patient.name`. |
| *link*`.`*key*`.`*column* | One step further: a row the linked row points at, named after its foreign key without `_id`. `appointment.clinician.name` reads through `clinician_id`. |
| *key*`.`*column* | The same row on its own, when no link has that name: `clinician.name`, `visit_type.name`. |
| `recipient.name`, `recipient.first_name` | The person's name, and its first word. For a first visit by someone not yet on file, the name typed on the booking. |
| `practice.`*column* | A column of the app's settings row: `practice.phone`, `practice.address`. |
| `appName` | The name the app's emails are signed with, from its settings row, else the workspace's name. |
| `manage_url`, `booking_url` | Links to the app's customer pages ([below](#links)). |

A column's value is shown by its type:

| Form | Example | For |
|---|---|---|
| *x* | Tuesday, 6 October 2026 at 09:30 | A time: the full date and time. |
| *x*`.date` | Tuesday, 6 October 2026 | A time's date. |
| *x*`.time` | 09:30 | A time's clock time. |
| *x*`.day_month` | 6 October | A time's day and month. |
| *x*`.relative_day` | tomorrow | Today, tomorrow or yesterday by the venue's day; a weekday within the next week; else the day and month. |
| *link*`.time_range` | 09:30–10:00 | A row with `starts_at`, and `ends_at` or `minutes`: from the start to the end. |
| a date | Tuesday, 6 October 2026 | A date column, with *x*`.day_month` too. A date is never moved by a time zone. |
| money | £40.00 | A money column, in the connection's currency. |

Every form is written in the email's language: `morgen` rather than `tomorrow` in German.

## Links

`manage_url` and `booking_url` lead to the app's customer pages: the page for managing a booking
and the booking page, as the app names them. Adminium builds them from:

1. the domain attached to the app's customer side, when there is one
   (see [Addresses and domains](/guides/apps/settings/#addresses-and-domains));
2. else **Address in email links** under **Studio → Settings → Email**, followed by
   `/apps/<key>/customer` (see [Links in emails](/guides/email/#links-in-emails));
3. else nothing. The link is left empty rather than guessed, because a send has no request to
   take an address from.

If your emails arrive without their links, set one of the first two.
