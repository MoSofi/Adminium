<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Emails — outbox; do not edit -->

# Manifest spec: Emails — outbox

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
| `payments` | `on` or `off`: queued only while the app takes payments online for the row the message is about, or only while it does not. See [Mail that follows payments](https://docs.adminium.dev/reference/manifest/#mail-that-follows-payments). Needs Adminium 0.3.62. |

#### Mail that follows payments

A producer with `payments: "on"` is queued only while the app takes payments online for the row the
message is about — what [`GET /public/payments/available`](https://docs.adminium.dev/reference/manifest/#paying-from-the-apps-own-customer-screens)
answers its customer, for that row's table: the app's payable switched on, a payment service live,
the pay address reachable, payments not paused or switched off by the operator. `payments: "off"`
is queued only while it does not. It is judged when the message is queued, beside `gate`, `module`
and `optIn`; a message already waiting (`holdSeconds`, `due`) is not judged again, and its pay
blocks follow `{{pay_url}}` when it goes.

Two producers of one event, one `on` and one `off`, each with its own template, send one mail
whichever way the shop is set, each with its own subject and preheader:

```json
"producers": [
  { "kind": "order-unpaid",   "link": "order_id", "onCreate": { "table": "orders" }, "payments": "on", "holdSeconds": 3600,
    "dropWhen": [{ "column": "status", "eq": "paid", "reason": "paid" }] },
  { "kind": "order-received", "link": "order_id", "onCreate": { "table": "orders" }, "payments": "off" }
]
```

- A mail that only makes sense with payments on ("Your delivery quote is accepted — pay online")
  is `on` alone: with payments off nothing is sent.
- A preheader that follows payments ("You owe {balance}" with them on, "{balance} still to settle"
  with them off) is two kinds, each with its template.
- The row is one of the app's payable tables, or a child row whose `via` points at one. Never on an
  `onDelete` producer.
- A row someone who manages payments is [rehearsing](https://docs.adminium.dev/guides/take-payments/) counts as on: its mail
  goes to them, marked TEST.

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
