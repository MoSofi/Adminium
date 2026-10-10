<!-- produced from apps/docs/src/content/docs/guides/apps/emails.md § Variables; do not edit -->

# An app's emails: Variables

A template reads variables as `{{name}}`. A column that holds nothing reads as empty: a
paragraph, list item or quote holding only it is left out of the email, so an optional value
(a visit's reason) sits best in a block of its own. A column marked secret is never offered, and
a personal column of a linked row neither. An email that names something nothing fills (one of
those, a link the message does not have, a misspelt name) is never sent with `{{…}}` in it: the
message is **failed**, and its error names the variable, so the template or the row gets fixed.
`recipient.name` and `recipient.first_name` are always there, empty when the client has no name on
file.

A variable may say its own backup after a bar: `Dear {{recipient.first_name|guest}}` writes
"guest" when the value is empty or nothing fills the name, and `{{…|}}` writes nothing. A name
that carries a backup everywhere it is written is asked of nobody, so a message that reads only
such names is never failed for them. A whole block can be tied to a value instead: beside
`block` and `data` it takes `"showWhen": { "var": "stay.note" }`, and is sent only when that
variable holds something; a text or heading block may add `"otherwise": "…"`, the words sent in
its place. A value held back from this reader counts as missing for both.

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
| `was.`*column* | For a message about a change, the column as it was before it ([above](https://docs.adminium.dev/guides/apps/emails/#messages-about-changes)). |
| `row.`*column* | Inside a block that lists rows, a column of each row ([below](https://docs.adminium.dev/guides/apps/emails/#emails-that-list-rows)). |
| `appName` | The name the app's emails are signed with, from its settings row, else the workspace's name. |
| `manage_url`, `booking_url` | Links to the app's customer pages ([below](https://docs.adminium.dev/guides/apps/emails/#links)). |

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
| *x*`.qr` | (an image) | A code column, drawn as a QR code: only as the whole value of an image. See [QR codes](https://docs.adminium.dev/guides/apps/emails/#qr-codes). |

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
