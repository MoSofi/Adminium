---
title: An app's emails
description: How an app's emails are queued, sent and logged in its own outbox table, who they go to and in which language, messages about changes, emails that list rows with QR codes, the templates an app ships, and every variable a template can read.
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
| Was | For a message about a change, the values the row held before it ([below](#messages-about-changes)). |
| Repeat key | For a message sent once per value of a column, a digest of that value, never the value itself ([below](#one-message-per-value)). |

The address and the language are copied onto the row when it is queued. A person who changes
their address afterwards changes where the next email goes, not this one.

## What queues a row

Rows are queued by the app's own screens, by you, or by the app's **producers**, which queue them
by themselves:

- **A row created,** such as a confirmation when a visit is booked, whoever booked it.
- **A column changed to a value,** such as a notice when a visit is cancelled. It needs a real
  change against the stored row. Saving the same status again queues nothing.
- **Some columns changed, whatever they became,** such as a notice when a stay's dates move. See
  [Messages about changes](#messages-about-changes).
- **A reminder before a moment,** a number of hours before a visit starts. The hours come from
  the person's own choice, or else from the default in the app's settings row, and never more
  than the most the app allows. Adminium looks for reminders that have come due once a minute,
  and only while the moment is still ahead.

A producer can be conditional, for example only for a visit whose status is `booked`. It can
wait some days after a date (a reminder a week after an invoice's due date), gather what happens
over a few minutes into one message (five versions posted in ten minutes make one email), or
write to the business's own address from a setting rather than to the person.

Each kind is queued **once** per source row. A visit cancelled, restored and cancelled again is
told once. A reminder is once per moment: move the visit and it gets a fresh reminder. Two kinds
of producer repeat on purpose: one that sends a message for
[each change it hears of](#messages-about-changes), and one that sends
[once per value of a column](#one-message-per-value).

When the person has no usable address, the row is still written, as `skipped` with "No email on
file", so you can see that an email was due.

### Who it goes to

A message goes to the person the outbox's recipient link names: the patient of a visit, the
customer of an order. A producer can send elsewhere:

- **To an address a setting holds,** the business's own, for a notice about a booking. No
  person's name is used.
- **To an address the row holds.** A ticket offered to a friend goes to the address it was offered
  to, not to the buyer:

  ```json
  {
    "kind": "ticket-offered",
    "link": "ticket_id",
    "onChange": { "table": "tickets", "column": "status", "to": "offered" },
    "recipient": { "column": "pending_email", "name": "pending_name", "language": "language" },
    "repeatBy": "link_token"
  }
  ```

  `column` is a text column of the row the message links, `name` greets (`{{recipient.name}}`),
  and `language` is the language the message is written in. The address is read again when the
  message goes, so an offer corrected before it went goes to the corrected address. The message
  may carry that row's own codes, and only while it goes to that very address; every other row's
  code stays out of it.

**The language.** A message is written in the recipient's language, read from their own row. An
app can read it from the row the message is about instead, so an order placed in German is
answered in German whatever the customer's own row says:

```json
"recipient": { "via": "customer_id", "table": "customers", "email": "email", "name": "name", "language": { "column": "language" } }
```

The language is written into the outbox's language column when the message is queued, so the
outbox must name one, and every producer's row must have the column. A producer that sends to an
address its row holds reads its own `recipient.language` instead. The row's language is used only
when it is one usable tag (`de`, `pt-BR`, `zh_TW`, never a list such as `de, en`), of a language
Adminium can write in, that fits the outbox's language column. Anything else leaves the person's
own language in place, and then the workspace's.

### Opting out and pausing

- **A person who opted out** gets nothing from a producer that respects the choice, typically
  reminders. Confirmations can still go.
- **The app's email switch.** An app can have a yes/no in its settings row that pauses its
  producers. While it is off, those producers queue nothing. Rows already queued still go. A
  missing settings row counts as off, as the public switches do.
- **A feature that is off.** A producer can send only while one of the app's features is on:
  receipts, with **Invoices & Receipts**. It is written `"gate": { "feature": "receipts" }`, naming
  one of the app's `addOns.features`. The feature is on while every add-on it needs is attached to
  the app and switched on. While it is off, the producer queues nothing.

### What never queues an email

- **Sample data.** Loading it queues nothing, and a sample record changed later still queues
  nothing. See [Sample data](/guides/apps/sample-data/).
- **An import** or **an undo.** They restore what happened, and send nothing about it when they
  are written. The one exception is an undo of a change a producer listens for column by column
  (a stay's dates): putting the dates back is a change too, and is told
  ([below](#messages-about-changes)). An imported row is a real one, though: a reminder before its
  moment is still queued when the moment comes, and an imported sent invoice still gets its
  [held](#held-messages) reminders. A message row they bring back never goes by itself: one that
  was waiting to go comes back held for a person to approve (or failed, to queue again, where
  the app has no held messages).
- **A disabled app.** Nothing is queued while it is off. See
  [Disable and enable](/guides/apps/settings/#disable-and-enable).

## Messages about changes

A hotel tells a guest when their stay's dates move, whatever the new dates are. A producer that
listens for **some columns changing** does this:

```json
{
  "kind": "stay-moved",
  "link": "stay_id",
  "onChange": {
    "table": "stays",
    "columns": ["arrives_on", "leaves_on"],
    "changed": true,
    "where": { "column": "status", "in": ["booked", "paid"] }
  },
  "repeat": true,
  "was": ["arrives_on", "leaves_on", "total"]
}
```

- **`columns`** (one to eight) are compared with the row as it was stored, each read as its type:
  a number by its value (`8.250` is `8.25`), a date by its day, a time by its moment. A save that
  gives the same dates, or changes another column, queues nothing. `where` narrows it to rows in
  some state.
- **`repeat: true`** sends a message for each change it hears of. Dates moved twice are two
  notices, and a "Resend booking" pressed twice is two emails. Without it, the producer sends
  once per row, as any other.
- **`was`** keeps the columns as they were before the change on the message itself, in the
  outbox's `was` column (a text column, unbounded or at least 1000 characters). The template
  reads them as `{{was.<column>}}`, in every form the column has:

  ```text
  Your stay was {{was.arrives_on}} to {{was.leaves_on}} ({{was.total}}).
  It is now {{stay.arrives_on}} to {{stay.leaves_on}} ({{stay.total}}).
  ```

  A column that is secret, personal, a code or withheld from all but its holder is never kept:
  the manifest check refuses it in `was`. One marked secret or personal after the message was
  queued prints empty. When the values are more than a bounded `was` column holds, the message
  fails with "Not sent: the values before the change are more than the outbox keeps".

Every door counts: the desk, a bulk edit, a guest's own change on the customer pages, and a rule's
change. An **undo** of a change of dates is a change too: the guest is told the dates put back,
and `{{was.*}}` holds the dates the undo replaced. An undo never sets off a message of a value
reached ("changed to cancelled") or of a row created. An **import** is history and sends nothing.

`repeat` and `was` are for a producer that listens for changes (`onChange`), and `repeat` does not
combine with `repeatBy` or `batchMinutes`.

### One message per value

A ticket offered to Lee, taken back, and offered to Zoe is two offers, each with a link made
afresh, and each must be emailed. `"repeatBy": "link_token"` sends one message for each value
that column of the row holds, rather than one for the row for ever. The outbox keeps a digest of
the value in its `repeatKey` column (a text column of at least 43 characters): the value itself may
be a link's code, and never lands in the log.

A message for an earlier value that has not gone yet is skipped as overtaken, so Lee is never sent
a link that no longer opens anything. `repeatBy` does not combine with `before` or `batchMinutes`.

### A short wait

`"holdSeconds": 30` (1 to 3600) makes a message wait before it may go, in the outbox's due column.
With `dropWhen`, a move taken back at once, such as an order marked ready by mistake, drops the
message before anyone is told, and a message dropped so does not stop the next one. Waiting
messages are picked up by the pass that runs once a minute, so one goes up to about a minute after
its wait ends. `holdSeconds` does not combine with `hold`, `due`, `batchMinutes` or `before`.

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
- **in the connection's currency** for money, or the row's own when it has a `currency` column
  holding a three-letter code;
- **with a Reply-To** when the app names one ([below](#replies)).

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
| `failed` | Not sent: the email lists rows from a table or link that is not there | A list's table, link or column is gone, for example renamed. See [Emails that list rows](#emails-that-list-rows). |
| `failed` | Not sent: {{…}} holds more than a QR code carries (64 bytes) | A code drawn as a QR code is longer than one carries. See [QR codes](#qr-codes). |
| `failed` | Not sent: the values before the change are more than the outbox keeps | See [Messages about changes](#messages-about-changes). |
| `failed` | The email could not be prepared | Something else went wrong; the server log says what. |
| `failed` | Not delivered: *reason* | The mail server refused it for good, after its retries. |

**To send a row again,** set its status back to `queued`. It goes within a minute. A late
report about the earlier message does not touch the new one.

A disabled app's queued rows wait, and go once it is enabled again.

### Replies

A guest who answers a booking email should reach the house, not the server's sender address. An
app names a text column of its settings row as the reply address:

```json
"settings": { "table": "settings", "name": "name", "replyTo": "reply_to" }
```

Every message of the app then carries a `Reply-To` with that address, read when the message goes.
It must be one plain address, of at most 254 characters: an empty column, a list of addresses, a
display name (`Wren House <desk@…>`) or anything else that is not one address means no
`Reply-To` at all, never a message refused.

## Held messages

Some emails should not go by themselves: a reminder that an invoice is overdue is read first. An
app can make such a message **held**. It is written with the day it comes due, and nothing is
sent until a person approves it.

- **Approve** a held message and it becomes `queued`. You may reword it first, its subject and its
  text, which is then sent as plain paragraphs in place of the template's. Who approved it is
  recorded. One approved before its day, or with no day worked out, goes at once.
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

### A document the email may go without

A hotel's payment email can carry a receipt when the hotel uses **Invoices & Receipts**, and still
thank the guest when it does not. The template says the document is optional, and marks the
paragraphs that only make sense beside it:

```json
{
  "key": "wren-stay-paid",
  "name": "Payment received",
  "attach": { "kind": "receipt", "link": "stay", "optional": true },
  "locales": {
    "en-US": {
      "subject": "Payment received",
      "blocks": [
        { "block": "email.text", "data": { "text": "Thank you. We have received {{stay.total}}." } },
        { "block": "email.text", "data": { "text": "Your receipt is attached.", "withAttachment": true } }
      ]
    }
  }
}
```

The message goes without the document, and without every block marked
`"withAttachment": true`, only while no add-on that draws receipts is attached to the app and
switched on. Every other reason the document is missing (its profile switched off, a drawing that
failed, a file too large to send, an add-on that is there but draws nothing for this row) still
fails the message, with the reason: an attached add-on that is late or failing never turns into a
quiet email without its receipt. `withAttachment` is allowed only on a template whose `attach` is
optional.

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
(a visit's reason) sits best in a block of its own. A column marked secret is never offered, and
a personal column of a linked row neither. An email that names something nothing fills (one of
those, a link the message does not have, a misspelt name) is never sent with `{{…}}` in it: the
message is **failed**, and its error names the variable, so the template or the row gets fixed.
`recipient.name` and `recipient.first_name` are always there, empty when the client has no name on
file.

The code a shared link opens a row with, such as a handover link's, goes only to the person it
belongs to: the message goes to the address their own row keeps (looked up, or typed exactly as it
is stored), and the row with the code is theirs or links to them by the link that names them (a
project's client, not the client who referred them). Addressed by hand to anyone else, or linking
one client and another client's project, the message is **failed**: "Not sent:
{{project.share_token}} is a code, and goes only to the address on file of the person it belongs
to". A notice sent to one of your settings' addresses never carries such a code. A code no link
opens anything with, such as a booking's reference, is printed wherever the message goes. The desk,
or the person whose import makes a message, may link it only to rows they can read.

| Variable | What it holds |
|---|---|
| *link*`.`*column* | A column of each row the outbox links to, by the link's name: `appointment.starts_at`, `patient.name`. |
| *link*`.`*key*`.`*column* | One step further: a row the linked row points at, named after its foreign key without `_id`. `appointment.clinician.name` reads through `clinician_id`. |
| *key*`.`*column* | The same row on its own, when no link has that name: `clinician.name`, `visit_type.name`. |
| `recipient.name`, `recipient.first_name` | The person's name, and its first word. For a first visit by someone not yet on file, the name typed on the booking. |
| `practice.`*column* | A column of the app's settings row: `practice.phone`, `practice.address`. |
| `was.`*column* | For a message about a change, the column as it was before it ([above](#messages-about-changes)). |
| `row.`*column* | Inside a block that lists rows, a column of each row ([below](#emails-that-list-rows)). |
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
| *x*`.days_since` | 47 | A date column: the whole days from it to today, by the venue's day ("47 days past due"). |
| money | £40.00 | A money column, in the connection's currency. |
| *x*`.number` | 1,234.5 | A number or money column: the number as the language writes it, exactly as stored and no longer ("8.25", never "8.250"). |
| *x*`.percent` | 8.25% | A number column holding a percentage: `8.25` reads "8.25%", and "8,25 %" in German. |
| *x*`.money` | £1,234.50 | A number or money column, as an amount in the connection's currency. |
| *x*`.label` | Card | A choice column: the label the app gave the value, in the email's language ("Karte" in German), else the value itself. |
| *x*`.time` | 3:00 PM | A text column of at most 8 characters that holds a time of day (`15:00`, `09:30:00`): the time on the reader's clock, "15:00" in Britain. |
| *x*`.grouped` | K7QX-M2PD | A code column: the code in groups of four, the way a person reads it out. |
| *x*`.qr` | (an image) | A code column, drawn as a QR code: only as the whole value of an image. See [QR codes](#qr-codes). |

Every form is written in the email's language: `morgen` rather than `tomorrow` in German, and
Arabic-Indic digits in Arabic (`٤٧`), for the days as for the amounts. A column's own value, with no
form, is written as it is stored, digits included, so a template can put an id in a link
(`{{manage_url}}#{{invoice.id}}`). Every form of an empty column reads empty.

A form belongs to its column's type:

| Column | Its forms |
|---|---|
| A time (`timestamptz`) | `.date`, `.time`, `.day_month`, `.relative_day` |
| A date | `.day_month`, `.days_since` |
| A number or money column | `.number`, `.percent`, `.money` |
| A choice (`enum`) | `.label` |
| A text column of at most 8 characters | `.time` |
| A code (a text column with a `code` rule) | `.grouped`, and `.qr` in an image |

So a date column (`due_on`) has no clock, and reads as `{{invoice.due_on}}`, `.day_month` or
`.days_since`, never `.date`, `.time` or `.relative_day`; and a longer text column (a note, a name)
never holds a time of day, so it has no `.time`. A short text column whose value is not a time of
day (`soon`) leaves `.time` unfilled, and the message fails, naming it. The install and every
update check the app's own
templates for this: a template that asks a column for a form it does not have
(`{{invoice.due_on.date}}`) is refused with `EMAIL_TEMPLATE_INVALID`, naming the template, its
language and the variable, before anything is written. A name the manifest does not declare is
left to the send.

## Emails that list rows

An order confirmation lists the order's tickets, one line each, with a QR code for the door. An
`email.rows` block does this: it lists the child rows of a row the message links. The fields are in
the [manifest reference](/reference/manifest/#emails-that-list-rows).

```json
{
  "block": "email.rows",
  "data": {
    "from": {
      "link": "order",
      "table": "tickets",
      "via": "order_id",
      "orderBy": "position",
      "where": { "column": "status", "in": ["valid"] },
      "unless": "handed_on",
      "limit": 50
    },
    "joins": {
      "extras": { "table": "ticket_extras", "via": "ticket_id", "column": "name", "separator": ", " }
    },
    "row": {
      "title": "{{row.ticket_type.name}}",
      "meta": "{{row.code.grouped}} · {{row.extras}}",
      "amount": "{{row.price.money}}",
      "image": "{{row.code.qr}}"
    },
    "empty": "Your tickets are on their way in a separate email."
  }
}
```

**Which rows.** `from` names one of the outbox's links (`order`), the child table (`tickets`) and
its foreign key back to the linked row (`order_id`). The rest narrows and orders them:

| Field | Rule |
|---|---|
| `orderBy` | A column of the child table; rows then follow their key. |
| `where` | A column and the values a row must hold (`in`, up to 32). |
| `unless` | A yes/no column: a row where it is yes is left out (a ticket handed on). Empty counts as no. |
| `limit` | 1 to 50 rows. Without it, 50. |

**A list inside each row.** `joins` gathers one or two lists of each row's own children into one
text: a dish's options, a ticket's extras. Each names the table, its foreign key back to the listed
rows, a text column to show, an optional `orderBy`, and a `separator` of up to 8 characters
(`, ` when none is given). A row shows at most 20 names, and empty ones are skipped. A join never
lists a column that is secret, personal, a code, the code a shared link opens a row with, or
withheld from all but its holder: the manifest check refuses it.

**Each line.** `row` has up to five parts: `title` and `meta` (the line below it), `amount` at the far
side, `note` under them, and `image`. Each part reads:

- `{{row.<column>}}`, in any [form](#variables) the column's type has (`{{row.price.money}}`);
- `{{row.<link>.<column>}}`, one step through the row's own foreign key, named without `_id`
  (`{{row.ticket_type.name}}` through `ticket_type_id`);
- `{{row.<join>}}`, a join by its name;
- any of the message's own variables (`{{order.event.name}}`).

`{{row.*}}` is read only inside an `email.rows` block. `image` is a QR code of a code column and
nothing else; a list without it has no image cell at all, so its text starts at the edge. A part
that reads empty is left out of its line.

**Every language lists the same rows.** A translation changes the words, never which rows are
listed: `from` and `joins` must be the same in every language of the template, and the install
refuses a template whose languages differ there.

**Never without its list.** A message is not sent without the rows it lists. When the list cannot
be read (the outbox no longer has the link, the table was renamed or removed, a column the block
names is gone), the message fails with "Not sent: the email lists rows from a table or link that
is not there". A list that can be read and holds no rows is fine: the message goes, and the block
says its `empty` text, or is left out when it has none. The same happens when the message links no
row to list from, and in a preview or a test send, which read no rows.

Each row is judged as the message's own values are: a code a shared link opens a row with prints
only for the person it belongs to, and a column withheld from all but a ticket's holder prints
empty to anyone else.

### QR codes

A QR code is drawn from a **code column**, a text column with a `code` rule, and only as the whole
value of an image:

- `{{<link>.<column>.qr}}` as the `qr` of an `email.image` block, for the one row a link names:

  ```json
  { "block": "email.image", "data": { "qr": "{{ticket.code.qr}}", "size": 140, "alt": "Your ticket" } }
  ```

  `size` is its width in pixels, 80 to 200 (116 when none is given);
- `{{row.<column>.qr}}` as a row's `image` in a list, drawn at 116 pixels.

Anywhere else, in a paragraph, a subject, or beside other text, `.qr` is refused when the app is
installed, as is a QR code of a column that is not a code. The code travels as an image inside
the email, on white so a dark-mode mail client keeps it scannable, with the code itself as its
alternative text. The same code shown twice is one image.

A QR code carries at most **64 bytes** of text. Every code Adminium makes fits. A longer value, one
stored by hand, is never handed to the mail queue: the message fails, naming the variable, with
"Not sent: {{row.code.qr}} holds more than a QR code carries (64 bytes)". A code column that is
empty draws no image.

A code is a door credential. Its text stays inside the sealed message while it waits in the mail
queue, never in the job's plain payload, and the rules for [codes](#variables) hold for a QR code as
for any other value: one that opens a shared link goes only to the person it belongs to.

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

## Upgrading

What a running install sees when it moves to a release with the features on this page:

- **No way back without the backup.** The upgrade runs two meta migrations:
  `0045_app_table_shapes`, which records the shape each app table is declared with (and fills it
  in for apps installed before), and `0046_public_sessions_ended`, which keeps a guest's ended
  session with the reason it ended. Once they have run, the earlier release refuses to start on
  that meta store (see [`unknown to this version`](/self-hosting/upgrades/#unknown-to-this-version)).
  Going back means restoring the backup taken before the upgrade, so take one.
- **QR mail during a rolling deploy.** A message with a QR code is queued in a newer form than the
  earlier release reads. An instance of the earlier release that is still running and picks it up
  refuses it, and once its retries are spent the message is dead-lettered. Every other message is
  queued in the form the earlier release reads, and either release delivers it. Replace every
  instance before an app that draws QR codes starts sending.
- **Reply-To on an older instance.** A message handed to the mail queue with a Reply-To, and
  delivered by an instance of the earlier release, goes without the header. It is never refused
  for it.
- **`{{was.*}}` on an older instance.** The earlier release does not know what a message keeps of
  its row before a change. A template reading `{{was.*}}`, sent by an instance of that release,
  fails with "Not sent: nothing fills {{was.…}}". Once every instance is upgraded, set the message
  back to `queued` to send it.
