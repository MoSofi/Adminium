<!-- produced from apps/docs/src/content/docs/guides/apps/identity-and-own-links.md § Delete my details; do not edit -->

# Guests, their details and their own links: Delete my details

A guest can delete their details: `DELETE /api/v1/public/account`, with `forgetMe()` in the client.
The identity entry names what is emptied:

```json
{
  "table": "customers",
  "methods": ["GET", "PATCH"],
  "select": ["name", "email"],
  "writable": ["name"],
  "claim": { "verify": "email-link", "email": "email" },
  "humanCheck": true,
  "forget": { "columns": ["email", "name", "phone"], "stamp": "forgotten_at" }
}
```

- **Only a mailbox proved moments ago.** The session must be verified, and must have pressed a
  sign-in link or typed a code in the last 10 minutes. Otherwise `403` `PUBLIC_CODE_STEP_UP`, and
  the page asks for a new sign-in link first.
- **The person's row keeps its key.** Every column in `forget.columns` is emptied (a yes/no that
  cannot be empty is set to no), the address first, so no link or code can sign them in again.
  `stamp` gets the time. The rows that point at the person stay theirs: a ticket still opens at
  the door, the desk still finds the order.
- **Every session ends**, and every open sign-in link is taken back.
- **One last email** goes to the old address: the built-in **Details deleted** email, in the
  visitor's language, signed with the app's name. It greets them by name: by the column the app's
  outbox names its recipients by, or else a column the schema reads as a person's name, never
  another column.
- It is audited, without the values.

| Field | Rule |
|---|---|
| `forget` | On the identity entry, which signs people in by email (a link, or an emailed code). |
| `forget.columns` | 1 to 16. Nullable columns or yes/no columns, never the key and never a column Adminium fills. It includes the column the person signs in by. |
| `forget.stamp` | A nullable `timestamptz`, not in `columns`. |
| `forget.links` | `true` to stop the person's own links too ([below](https://docs.adminium.dev/guides/apps/identity-and-own-links/#stopping-own-links-too)). |
| `forget.copies` | `true` to also empty the person's copies on the rows linked to them ([below](https://docs.adminium.dev/guides/apps/identity-and-own-links/#emptying-their-copies-too)). Needs Adminium 0.3.71. |

See the [manifest reference](https://docs.adminium.dev/reference/manifest/#delete-my-details).

### Stopping own links too

A ticket's link in an old email still opens the ticket after its holder deleted their details.
With `forget.links: true`, the delete first gives every own link of the person's rows a new code:
every order and ticket that points at them, through any entry that claims it or finds them by
address. Every session those links opened ends, told `forgotten`. If one cannot be stopped, the
answer is `409` `PUBLIC_WRITE_REFUSED` and nothing is forgotten, so the guest can try again.

It is the app's choice. Without it, the rows' own links keep working.

### Emptying their copies too

An order or a booking often keeps its own copy of the name and address it was made with. Without
`forget.copies` those copies stay after the person deletes their details. With it, the delete also
empties each copy the app declares in `people[].copies` with a `via` link:

- **Only rows linked to the person.** A row is found by that link to their own row, never by an
  address or a name. A row that holds the same typed address with no link is left alone.
- **In one transaction** with their own row: all of it happens or none does.
- **Tables the law keeps stay whole** (`keep`): invoices, payments and the like keep what they hold.
- **Nothing else runs.** No state moves, no booking is judged again, no mail or rule fires. The key,
  the links and the row's other columns stay.

### What stops being sent

A message about a person who deleted their details is not sent, even one queued with its address
before they did (a reminder due later, a batch waiting for its window). As each message goes, the
person is read as they are now:

- a message to the outbox's recipient who is forgotten is marked skipped, whatever address it
  names;
- a message to an address a row holds (a ticket's holder) is skipped when that address is a copy
  of a forgotten person's.

A person counts as forgotten when the forget's `stamp` is filled or, with no stamp, when the
address the outbox reads is emptied.
