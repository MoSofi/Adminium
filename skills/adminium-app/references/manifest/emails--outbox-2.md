<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Emails — outbox; do not edit -->

# Manifest spec: Emails — outbox

| Field | Rule |
|---|---|
| `hold` | `true`: its rows are written `held` and sent only once a person approves one. See [Held messages](https://docs.adminium.dev/reference/manifest/#held-messages). |
| `due` | `{ "date", "days", "at"? }`: when the message comes due, `days` after `date` (a `date` or `timestamptz` of the row it is about), at `at` (`"HH:MM"`, 09:00 by default) on the venue's clock. Not on a `before` producer, which is due by its lead. |
| `supersede` | A group name (kebab-case, up to 40 characters). When a message of the group comes due for a row, the earlier ones not yet sent are skipped as overtaken, so an invoice never has two reminders ready at once. Needs `due`. |
| `dropWhen` | 1–4 conditions on the row the message is about: `{ "column", <one test>, "reason" }`, the test being `eq`, `in`, `isNull`, `lte` or `gte`. While one holds, its waiting messages are skipped with the `reason`: `paid`, `void` or `no-longer-needed`. Only a message that waits (`hold`, or `due`) can be dropped. |
| `recipient` | `{ "setting" }`: send to the address a setting holds (a studio's own `reply_to`), never to the person the row links. The setting is `{ "table", "column" }` of the settings row, or `{ "addOn", "setting" }` of a required add-on. Or `{ "column", "name"?, "language"? }`: send to the address a `text` column of the producing row holds (the friend a ticket is offered to), with that row's `name` column as the name and its `language` column as the message's language. |
| `holdSeconds` | 1–3600: the message waits this many seconds before it may go, so a move taken back at once (an order marked ready by mistake) drops it by `dropWhen` before anyone is told. A message dropped so does not stop the next one of its kind. Needs the outbox's `due` column; not on a `before` producer, nor with `hold`, `due` or `batchMinutes`. |
| `repeatBy` | A column of the row the message is about: one message for each value it holds, not one for the row for ever (a ticket offered again, its link made afresh, is emailed again). A message for an earlier value not yet sent is skipped as overtaken. Needs the outbox's `repeatKey` column; not on a `before` producer, nor with `batchMinutes`. |
| `repeat` | `true`: one message for each change it hears of, not one for the row for ever ("Resend tickets" twice is two messages). Only on an `onChange` producer, and not with `repeatBy` or `batchMinutes`. |
| `was` | 1–8 columns of the changed row kept as they were before the change (a stay's old dates, its old total), read by the template as `{{was.<column>}}` in every form the column has. Only on an `onChange` producer; needs the outbox's `was` column. Never a secret, personal, code, share-code, withheld or typed-code column. |
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

`where` is one condition on the source row: `{ "column", "eq" }`, `{ "column", "in": [values] }`
or `{ "column", "isNull": true|false }`, exactly one of the three. `before.lead` is
`{ "via", "table", "column", "fallback"?, "max" }`: the number of hours before, read from `column`
(an `int`) of the row that `via` points at, else from the settings `fallback`, and never more
than `max` hours (1–336). `max` is also how far ahead Adminium looks. A reminder is queued with
its moment in `columns.due`.

A source row produces each kind once, unless its producer says `repeat` or `repeatBy`. A reminder
is produced again only when its moment moves; a batched message, once its window has closed. An
undo of a change is heard by the producers of `"changed": true` alone, so the dates it puts back are
mailed; a `{ "column", "to" }` producer never fires on an undo. Sample data and imports fire no
producer when they are written. A sample row never has a message at all. An imported row is a real one, so the
minute's look-over still makes its `before` reminder when the moment comes, and a held producer's
messages for it (an imported sent invoice gets its reminders).

A message row an import or an undo brings back never goes by itself: nothing here made it and
nobody approved it. One that arrives `queued` comes in `held` for a person to approve, or `failed`
with a sentence saying why where the outbox has no `held` (queue it again to send it); one that
says it went, with a sent time and no error, comes in `sent`.
