<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Emails — outbox; do not edit -->

# Manifest spec: Emails — outbox

| Producer | Shape | Queues a row |
|---|---|---|
| `onCreate` | `{ "table", "via"?, "where"? }` | When a row of the table is created. |
| `onChange` | `{ "table", "via"?, "column", "to", "where"? }` | When the column changes to `to`, a value or a list of 1–16 values. |
| `onChange` | `{ "table", "via"?, "columns", "changed": true, "where"? }` | When any of 1–8 columns changes, compared with the row as it was stored (a stay's dates, whatever they became). Numbers compare as numbers and dates by day. |
| `onDelete` | `{ "table", "where"? }` | When a row of the table is removed, by anyone: one message for each removal, written once the row is gone. See [A row that is removed](https://docs.adminium.dev/reference/manifest/#a-row-that-is-removed). Needs Adminium 0.3.28. |
| `before` | `{ "table", "at", "lead", "where"? }` | A lead time before `at`, a `timestamptz` of the row: a reminder. `lead.at` (`"HH:MM"`) sends it at that wall time on the venue's day the lead reaches: 24 hours before a 20:00 show, at 09:00, is 09:00 the day before. |

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
