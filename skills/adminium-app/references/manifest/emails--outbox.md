<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Emails — outbox; do not edit -->

# Manifest spec: Emails — outbox

### outbox

```json
"outbox": {
  "table": "messages",
  "columns": { "kind": "kind", "status": "status", "to": "to_address", "language": "language",
               "due": "due_at", "sentAt": "sent_at", "error": "error" },
  "links": { "appointment": "appointment_id", "patient": "patient_id" },
  "recipient": { "via": "patient_id", "table": "patients", "email": "email", "name": "name",
                 "language": "language", "optIn": "reminders",
                 "fallback": { "via": "appointment_id", "email": "new_email", "name": "new_name" } },
  "settings": { "table": "settings", "enabled": "emails_on", "name": "practice_name", "phone": "phone" },
  "pages": { "manage": "/my-visits", "booking": "/" },
  "kinds": { "confirmation": "clinic-confirmation", "reminder": "clinic-reminder" },
  "producers": [
    { "kind": "confirmation", "link": "appointment_id", "gate": "enabled",
      "onCreate": { "table": "appointments" } },
    { "kind": "reminder", "link": "appointment_id", "gate": "enabled", "optIn": true,
      "before": { "table": "appointments", "at": "starts_at",
                  "lead": { "via": "patient_id", "table": "patients", "column": "reminder_hours",
                            "fallback": { "table": "settings", "column": "reminder_hours" }, "max": 72 },
                  "where": { "column": "status", "eq": "booked" } } }
  ]
}
```

| Field | Required | Rule |
|---|---|---|
| `table` | yes | One of the app's tables: the outbox. |
| `columns` | yes | The outbox's columns. `kind` is an enum of the kinds. `status` is an enum holding at least `queued`, `sent`, `failed` and `skipped`, and `held` when a producer holds. `to` is `text`, the address. Optional: `language` (`text`), `due` (`timestamptz`, required by a `before` producer and by one with `hold` or `due`), `sentAt` (`timestamptz`) and `error` (`text`), and the columns of [held messages](https://docs.adminium.dev/reference/manifest/#held-messages): `skipReason` (`text` or `enum`), `subjectOverride`, `bodyOverride`, `approvedBy` and `effectError` (`text`), and `effectAt` (`timestamptz`). `repeatKey` (`text` of at least 43 characters) keeps which value a `repeatBy` producer sent for; `was` (`text`, unbounded or at least 1000 characters) keeps a `was` producer's values from before the change. |
| `links` | no | The outbox's foreign keys, by the name a template reads them under: `{ "appointment": "appointment_id" }` gives a template `appointment.*`. Names are snake_case. Every foreign key of the outbox table that the outbox names must be nullable: not every email is about one. |
| `recipient` | yes | Who the email goes to. See below. |
| `settings` | no | The app's one-row settings table: `{ "table", "enabled"?, "name"?, "phone"? }`. Templates read it as `practice.*`. `enabled` is a bool that pauses producers with `gate: "enabled"`. `name` is a `text` column the app's emails are signed with, the [emailed code](https://docs.adminium.dev/reference/manifest/#public-access) included; without it, the server's name is used. `phone` is a `text` column: when it holds a number, the notice sent to a person's old address after a change of email tells them to ring it; without one, the notice says to contact you. `replyTo` is a `text` column: when it holds one plain address, every message the app sends carries it as its Reply-To, so a guest's reply reaches the house rather than the no-reply sender; empty, or anything but one address, adds none. |
| `pages` | no | `{ "manage"?, "booking"? }`: paths on the app's customer side (`/my-visits`) that a template's `manage_url` and `booking_url` lead to. Up to 120 characters. Default: the side's front page. |
| `kinds` | yes | Each value of the kind column, and the key of the template it is sent with. Every value must be one of the enum's, and every template one of `emailTemplates`. |
| `classes` | from 0.3.38 | Each kind's class, `marketing` or `service`; see [Marketing or service](https://docs.adminium.dev/reference/manifest/#marketing-or-service). Needs Adminium 0.3.38, and from that floor every kind has one. |
| `purposes` | no | Each kind's consent purpose, `newsletter` or `surveys`; see [A kind's purpose](https://docs.adminium.dev/reference/manifest/#a-kinds-purpose). Needs Adminium 0.3.40. |
| `surveyLinks` | no | The kinds whose template prints `{{survey_link}}`: a forms add-on's survey invitations; see [A survey's link](https://docs.adminium.dev/reference/manifest/#a-surveys-link). Needs Adminium 0.3.40. |
| `reviewLinks` | no | `{ "kinds", "link", "page" }`: the kinds whose template prints `{{reviewLink}}`, a link that reviews one row; see [Bookings in a calendar](https://docs.adminium.dev/guides/apps/booking-calendars/). Needs Adminium 0.3.71. |
| `producers` | no | Up to 32 rules that queue rows by themselves (more than 24 needs Adminium 0.3.62). See below. |
| `channels` | no | `{ "<kind>": "sms" }`: the kinds sent as [texts](https://docs.adminium.dev/reference/manifest/#texts). A kind not named is email. Needs Adminium 0.3.76. |
| `waiting` | no | The text kinds a customer is waiting for right now, which may go outside the sending hours; see [Text kinds in the outbox](https://docs.adminium.dev/reference/manifest/#text-kinds-in-the-outbox). Needs Adminium 0.3.76. |

**`recipient`** is `{ "via", "table", "email", "name"?, "language"?, "optIn"?, "phone"?, "fallback"? }`.
`phone` is the mobile number a [text](https://docs.adminium.dev/reference/manifest/#texts) kind goes to (Adminium 0.3.76), and an outbox whose
every kind is a text may leave out `email`.
`via` is the outbox's foreign key to the person, `table` the person's table, and the rest are its
columns: `email`, `name` and `language` are `text`, and `optIn` is a bool the person sets (false
means nothing from a producer that asks `optIn`). `language` may instead be `{ "column" }`, a `text`
column of the row the message is about: an order placed in German is written to in German, whatever
the person's own row says. The row every producer's message is about must have that column. It is
used only when it holds one usable language tag that fits the outbox's `language` column (which
must be named); otherwise the person's language is. `fallback` is `{ "via", "email", "name"?, "language"? }`: where the address
comes from when `via` is empty. Its `via` is another foreign key of the outbox, and its columns
belong to the table that key points at; a first visit by someone not yet on file carries their
details on the visit itself.
