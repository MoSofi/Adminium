<!-- produced from apps/docs/src/content/docs/guides/apps/identity-and-own-links.md § Withheld columns; do not edit -->

# Guests, their details and their own links: Withheld columns

The buyer's **My tickets** page reads their order's tickets. Once they send a ticket to a friend,
that ticket's code is the friend's: the buyer must see "sent to Kai", never what gets Kai in. And
while an order is not paid, none of its tickets should show a code at all.

`withhold` leaves columns out of rows:

```json
{
  "table": "tickets",
  "methods": ["GET", "PATCH"],
  "level": "verified",
  "visibleWith": { "table": "orders", "via": "order_id" },
  "select": ["id", "status", "code", "holder_name", "holder_email", "pending_name", "pending_email", "offer_until"],
  "withhold": {
    "columns": ["code", "holder_email"],
    "unlessHolder": "holder_customer_id",
    "when": { "linked": [{ "via": "order_id", "where": [{ "column": "status", "eq": "pending" }] }] }
  }
}
```

The columns come back empty when either holds:

- **`unlessHolder`**: the row has a holder who is not the reader. The reader is the holder only
  when the session is a signed-in person's and the column names that person; a row's own link
  names nobody. A row with no holder is its parent's reader's, as before.
- **`when`**: the row holds these values (`where`), or a row one of its links points at does
  (`linked`). Every condition must hold. A condition that cannot be read, such as an empty link
  or a linked row that is gone, counts as holding: a column is never shown on nothing.

On a row's own link, `when` is the only rule, since the link names nobody. The ticket's own link
keeps the code back until the friend accepts:

```json
"withhold": { "columns": ["code"], "when": { "where": [{ "column": "holder_customer_id", "isNull": true }] } }
```

### Who a `when` is for

A holder rule is every reader's. A `when` is for the readers it was written for:

- readers through the key the declaring entry is served on;
- mail and documents drawn for a person (the outbox's recipient) read as the `customer` key;
- a message to an address column reads through the row's own link whose claim `address` names
  that column (an order's `email` as the `link` key, a ticket's `pending_email` as the `ticket`
  key);
- any other reader of no key (an address in the settings row, a document mailed out for nobody)
  meets every `when` about the row's state, such as an unpaid order, but none declared through a
  row's own link, which is about whoever holds that link. A paid buyer's own codes stay theirs in
  the mail.

### Where it holds

Every public read of the table keeps the withheld columns, whichever entry declared the rule: a
list, one row, the row a change or a create answers with, a retry of the order, an email (a
value, a list of rows, a QR code), and a document of the order.

- Filtering or sorting by a withheld column is refused `400` `PUBLIC_QUERY_REFUSED`, since the
  answer would tell what it holds. A search leaves those columns out.
- A file in a withheld column is served only to a reader the column is shown to.
- Email joins and document lists one level down leave withheld, secret and masked columns empty.
  A document staff drew of a withheld table is not listed to a guest.

| Field | Rule |
|---|---|
| `withhold.columns` | 1 to 8, each once, each in `select`. |
| `withhold.unlessHolder` | A foreign key to the person the key signs in. Not the entry's `claimedBy` column (every row there is the reader's already). Not on a row's own link. |
| `withhold.when` | `where`, `linked`, or both. The conditions name columns of the row, or of the row `via` points at. |
| The entry | Read through a parent (`visibleWith` or `claimedBy`), or a row's own link. |
| Writes | No entry lets a browser write the holder column, a condition's column, or a `linked` link (a child's create may name the parent it is made under). |

See the [manifest reference](https://docs.adminium.dev/reference/manifest/#withheld-columns).
