<!-- produced from apps/docs/src/content/docs/guides/apps/emails.md § Messages about a row that is removed; do not edit -->

# An app's emails: Messages about a row that is removed

A sales app cancels a site visit by removing it, and the customer is told. A producer that listens
for **a removal** does this:

```json
{
  "kind": "visit-cancelled",
  "link": "visit_id",
  "onDelete": { "table": "visits" },
  "was": ["starts_at", "place"]
}
```

```text
Hello {{recipient.first_name}}, the visit on {{was.starts_at.date}} at {{was.starts_at.time}}
at {{was.place}} about {{deal.name}} is cancelled.
```

The message is written once the row is gone, whoever removed it: a person in the dashboard or on
the app's own screen, a bulk removal (one message for each row, up to the 1,000 rows one bulk
removal takes), or a public entry that may delete. Because there is no row left:

- **The link to the row is empty**, and `{{visit.*}}` has nothing to read. The template reads the
  row from **`was`**: up to eight columns, kept on the message as they were. The same rule bounds
  it as for a change: never a column that is secret, personal, a code or withheld, and one marked
  so later prints empty. Keep only what the mail says.
- **The other links still work.** They are filled from the removed row, so `{{contact.name}}` and
  `{{deal.name}}` read the contact and the deal the visit named, as they are when the mail goes.
- **Who it goes to** is the outbox's recipient (the contact the visit named), with their address
  as it is on file then. A producer may send to an address the removed row itself held
  (`"recipient": { "column": "email" }`): that address is read as the row goes and written to
  the message's own address column. The name the row held with it is not kept, so greet such a
  reader without `{{recipient.first_name}}`.
- **It goes at once.** A removal message takes no `hold`, `due`, `holdSeconds`, `batchMinutes`,
  `dropWhen`, `supersede`, `repeatBy`, `onSent` or `replyTo`: each would read the row again. A
  reply goes to the house's own address (`settings.replyTo`).

### A row with messages can now be removed

An outbox row links the row it is about, and the database refuses to remove a row that anything
links: a visit with one confirmation in the log could never be cancelled. Naming the table in an
`onDelete` producer changes that for the link the producer names. As a row of the table goes:

- every message that named it **loses the link** and stays in the log, with its kind, its address,
  when it went and what it kept in `was`;
- a message about it that **had not gone yet** (queued, or held for approval) is **skipped** with
  the reason `no-longer-needed`, so nobody is told a visit moved after it was called off.

Both are done with the removal, or not at all: a removal the table's states refuse, or one another
table's rows hold, changes nothing. This applies to every removal made through Adminium, also
while the app is switched off. A row removed by SQL of your own is still refused while a message
names it. A table with no `onDelete` producer keeps the old rule: its messages hold its rows.

### What a removal does not do

- **No message** for a sample row; for a row taken back by the Undo of its creation (nobody is
  told about a row made by mistake, though its confirmation, if it already went, stands); for a
  child row removed as part of its parent's own save; or while the producer's part or switch is off.
- **An Undo of the removal** puts the row back and does not take the message back: the customer
  has been told. The row comes back with no message linked to it. Where that matters, ask before
  removing (the app's own screen can confirm), or keep a `cancelled` state instead of removing.
- **Who reads what was kept.** Whoever may read the outbox table reads its `was` column, as they
  read the rest of the log, and nobody else does. Somebody who could not read the removed table
  and cannot read the outbox learns nothing of the row. The address stays on the message as on
  every message. When a person deletes their own details ([`forget`](https://docs.adminium.dev/guides/apps/public-access/)),
  a message to them that has not gone is skipped as for any message; what `was` kept is never
  personal data, so it stays.
