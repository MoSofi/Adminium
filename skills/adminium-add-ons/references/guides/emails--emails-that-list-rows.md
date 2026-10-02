<!-- produced from apps/docs/src/content/docs/guides/apps/emails.md § Emails that list rows; do not edit -->

# An app's emails: Emails that list rows

An order confirmation lists the order's tickets, one line each, with a QR code for the door. An
`email.rows` block does this: it lists the child rows of a row the message links. The fields are in
the [manifest reference](https://docs.adminium.dev/reference/manifest/#emails-that-list-rows).

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

- `{{row.<column>}}`, in any [form](https://docs.adminium.dev/guides/apps/emails/#variables) the column's type has (`{{row.price.money}}`);
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
queue, never in the job's plain payload, and the rules for [codes](https://docs.adminium.dev/guides/apps/emails/#variables) hold for a QR code as
for any other value: one that opens a shared link goes only to the person it belongs to.
