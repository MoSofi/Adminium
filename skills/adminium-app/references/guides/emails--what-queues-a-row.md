<!-- produced from apps/docs/src/content/docs/guides/apps/emails.md § What queues a row; do not edit -->

# An app's emails: What queues a row

Rows are queued by the app's own screens, by you, or by the app's **producers**, which queue them
by themselves:

- **A row created,** such as a confirmation when a visit is booked, whoever booked it.
- **A column changed to a value,** such as a notice when a visit is cancelled. It needs a real
  change against the stored row. Saving the same status again queues nothing.
- **Some columns changed, whatever they became,** such as a notice when a stay's dates move. See
  [Messages about changes](https://docs.adminium.dev/guides/apps/emails/#messages-about-changes).
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
[each change it hears of](https://docs.adminium.dev/guides/apps/emails/#messages-about-changes), and one that sends
[once per value of a column](https://docs.adminium.dev/guides/apps/emails/#one-message-per-value).

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
- **Both at once.** A receipt that goes only while Invoices & Receipts is attached AND the
  manager's own switch is on is written
  `"gate": { "feature": "receipts", "setting": { "table": "settings", "column": "receipt_email_on" } }`.
  Both must hold: a feature that is off, or a switch that is off (or no settings row), queues
  nothing. Each half is checked as it is alone.
- **When a gate is judged.** Every gate is judged when the message is queued, not when it is sent.
  A message already waiting (held, or due later) still goes if the feature or the switch is turned
  off after it was queued. Only its producer's `dropWhen` drops a waiting message.

### What never queues an email

- **Sample data.** Loading it queues nothing, and a sample record changed later still queues
  nothing. See [Sample data](https://docs.adminium.dev/guides/apps/sample-data/).
- **An import** or **an undo.** They restore what happened, and send nothing about it when they
  are written. The one exception is an undo of a change a producer listens for column by column
  (a stay's dates): putting the dates back is a change too, and is told
  ([below](https://docs.adminium.dev/guides/apps/emails/#messages-about-changes)). An imported row is a real one, though: a reminder before its
  moment is still queued when the moment comes, and an imported sent invoice still gets its
  [held](https://docs.adminium.dev/guides/apps/emails/#held-messages) reminders. A message row they bring back never goes by itself: one that
  was waiting to go comes back held for a person to approve (or failed, to queue again, where
  the app has no held messages).
- **A disabled app.** Nothing is queued while it is off. See
  [Disable and enable](https://docs.adminium.dev/guides/apps/settings/#disable-and-enable).
