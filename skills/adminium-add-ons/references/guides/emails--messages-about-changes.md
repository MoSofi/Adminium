<!-- produced from apps/docs/src/content/docs/guides/apps/emails.md § Messages about changes; do not edit -->

# An app's emails: Messages about changes

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
