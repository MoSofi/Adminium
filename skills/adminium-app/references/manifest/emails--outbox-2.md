<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Emails — outbox; do not edit -->

# Manifest spec: Emails — outbox

With `via`, the source is a **child** row and the message is about the row its foreign key `via`
points at: a version posted to a deliverable makes a message linked to the deliverable, and
addressed through it. `link` then points at that parent's table.

#### A row that is removed

`onDelete` writes a message when a row of `table` is removed: from the dashboard, by a bulk
removal (one message a row), from an app's own screen, or through a public entry that may delete.
`where` is judged on the row as it was. The row is gone when the message is written, so:

- the message's `link` (the outbox's link to that table) is **empty**, and nothing is read from the
  row again. What the template says of it comes from `was`: `{{was.starts_at.date}}`. The outbox's
  other links are filled from the removed row as on any message (the contact and the deal a visit
  named), so `{{contact.name}}` and `{{deal.name}}` read as usual;
- it goes to the outbox's recipient, found through those links, or to `recipient.column`, an
  address the removed row held. That address is read once, as the row goes, and kept in the
  message's own address column and nowhere else; the name beside it is not kept, so
  `{{recipient.first_name}}` is empty for such a message;
- it takes none of `hold`, `due`, `batchMinutes`, `holdSeconds`, `dropWhen`, `supersede`,
  `repeatBy`, `onSent` and `replyTo`: each reads the row again after the message is written. A
  reply goes to the outbox's own `settings.replyTo`, when it has one;
- each removal is its own message. A sample row, a row taken back by an undo of its creation, and
  a child row removed inside its parent's own save write none.

Naming a table in `onDelete` also means **its rows are never held by their messages**. Without it,
a row that any message links (sent last year, or still waiting) cannot be removed: the database
refuses it (`409`). With it, as a row of that table goes, every message that named it through the
producer's `link` loses that link and stays in the log with what it kept, and one that had not
gone yet (queued, or held) is skipped with the reason `no-longer-needed`. A `skipReason` column
that is an enum therefore offers `no-longer-needed`. This holds for every removal made through
Adminium, also while the app is switched off; a row removed by SQL of your own is still refused by
the database while a message names it. Nothing is altered in the database for it, so an install
made before this word gets it with the update that adds the producer.

```json
{ "kind": "visit-cancelled", "link": "visit_id",
  "onDelete": { "table": "visits" },
  "was": ["starts_at", "place"] }
```

A producer may also say:

| Field | Rule |
|---|---|
| `hold` | `true`: its rows are written `held` and sent only once a person approves one. See [Held messages](https://docs.adminium.dev/reference/manifest/#held-messages). |
| `due` | `{ "date", "days", "at"? }`: when the message comes due, `days` after `date` (a `date` or `timestamptz` of the row it is about), at `at` (`"HH:MM"`, 09:00 by default) on the venue's clock. Not on a `before` producer, which is due by its lead. |
| `supersede` | A group name (kebab-case, up to 40 characters). When a message of the group comes due for a row, the earlier ones not yet sent are skipped as overtaken, so an invoice never has two reminders ready at once. Needs `due`. |
| `dropWhen` | 1–4 conditions on the row the message is about: `{ "column", <one test>, "reason" }`, the test being `eq`, `in`, `isNull`, `lte` or `gte`. While one holds, its waiting messages are skipped with the `reason`: `paid`, `void` or `no-longer-needed`. Only a message that waits (`hold`, or `due`) can be dropped. |
| `recipient` | `{ "setting" }`: send to the address a setting holds (a studio's own `reply_to`), never to the person the row links. The setting is `{ "table", "column" }` of the settings row, or `{ "addOn", "setting" }` of a required add-on. Or `{ "column", "name"?, "language"? }`: send to the address a `text` column of the producing row holds (the friend a ticket is offered to), with that row's `name` column as the name and its `language` column as the message's language. |
| `replyTo` | `{ "staff": column }`: a reply to the message goes to the person a [staff column](https://docs.adminium.dev/reference/manifest/#whose-a-row-is) names, at the address they sign in with. The column is one of the row the message is about (`owner_id`), or of the row one of its links names (`deal_id.owner_id`: the owner of a quote's deal). See [A reply to the rep](https://docs.adminium.dev/reference/manifest/#a-reply-to-the-rep). Needs Adminium 0.3.28. |
| `holdSeconds` | 1–3600: the message waits this many seconds before it may go, so a move taken back at once (an order marked ready by mistake) drops it by `dropWhen` before anyone is told. A message dropped so does not stop the next one of its kind. Needs the outbox's `due` column; not on a `before` producer, nor with `hold`, `due` or `batchMinutes`. |
| `repeatBy` | A column of the row the message is about: one message for each value it holds, not one for the row for ever (a ticket offered again, its link made afresh, is emailed again). A message for an earlier value not yet sent is skipped as overtaken. Needs the outbox's `repeatKey` column; not on a `before` producer, nor with `batchMinutes`. |
| `repeat` | `true`: one message for each change it hears of, not one for the row for ever ("Resend tickets" twice is two messages). Only on an `onChange` producer, and not with `repeatBy` or `batchMinutes`. |
| `was` | 1–8 columns of the changed row kept as they were before the change (a stay's old dates, its old total), read by the template as `{{was.<column>}}` in every form the column has. On an `onChange` producer, and on an `onDelete` producer, where they are the removed row's own values; needs the outbox's `was` column. Never a secret, personal, code, share-code, withheld or typed-code column. |
| `batchMinutes` | 1–240: one message per linked row in each window of this many minutes. The first event opens a message due at the window's end; every event while it still waits is taken in by it (five versions posted in ten minutes make one email). The window's end is its due, so it takes no `due`; it may still be dropped (`dropWhen`) or overtaken (`supersede`) while it waits. Not on a `before` producer. |
| `onSent` | `{ "table", "via"?, "set" }`: a change made once the message has gone. Without `via`, `table` is the row the message is about; with it, `via` is that row's foreign key to `table`. `set` maps columns to values (`null` empties a nullable column). |

`due.days` is one of:

| `days` | Days after the date |
|---|---|
| a number, 0–3650 | That many. |
| `{ "byColumn", "values" }` | One number per value of a column of the row (`ladder`: gentle 7, firm 1). Every value of the column needs its days. |
| `{ "setting", "byColumn"?, "index"? }` | Read from a setting when the message is made, and again whenever its inputs move: a number, a list (`index`, 0–9, picks one), or, with `byColumn`, lists per value of that column (`{ "gentle": [7, 21, 45], … }`). |

A due that cannot be worked out (no date yet, a value with no days, a setting that is not there)
is left empty. A held message with no due waits for a person: it is never ready and overtakes
nothing. A queued message with no due goes at once, so give a producer that queues for later a
date it always has.
