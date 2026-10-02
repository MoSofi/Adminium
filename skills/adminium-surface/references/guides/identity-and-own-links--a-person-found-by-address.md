<!-- produced from apps/docs/src/content/docs/guides/apps/identity-and-own-links.md § A person found by address; do not edit -->

# Guests, their details and their own links: A person found by address

A guest buys two tickets and types their address. They have no account and never make one. The
order still belongs to a person: the `customers` row with that address, found if there is one and
made if there is not. Later the guest signs in with an emailed link to that address and sees every
order they placed, from any device.

The create entry names the person table, the column the guest types the address into, and the
column that links the order to the person:

```json
{
  "table": "orders",
  "methods": ["POST"],
  "humanCheck": true,
  "level": "verified",
  "select": ["id", "total", "ticket_count"],
  "writable": ["event_id", "email", "name", "client_key"],
  "requires": ["email", "name"],
  "claimedBy": { "table": "customers", "column": "customer_id", "optional": true },
  "identity": { "table": "customers", "email": "email", "link": "customer_id" },
  "shareLink": "link_token",
  "anonymous": { "perValue": { "columns": ["email"], "n": 10 } }
}
```

What happens on the create:

- **Found by the address as sign-in finds it.** The address is trimmed and put in lower case, and
  the person is looked for the same way. A person kept as `Ada@Example.com` is never made again
  as `ada@example.com`, because sign-in would then find two people and let neither in.
- **Linked only to an exact match.** Only a person whose stored address is exactly the trimmed,
  lower-case address is linked. A row that keeps it in another case, with spaces, or as a
  database collation's look-alike links nobody: the order is saved with no person, and the desk
  can link it.
- **Made when nobody has it.** A new person row gets the address, plus the columns `fill` names,
  such as `"fill": { "name": "name" }` to copy the name typed on the order. It is made inside the
  order's own transaction, so a refused order leaves no person behind. Two orders placed at once
  with the same new address make one person.
- **Found, never changed.** A found person is linked and left as they are. A stranger typing
  someone's address never renames them.
- **The guest is never told which happened.** The reply, the refusals and the limits are the
  same whether the address was on file or not. The link column is never shown.
- **A guest already signed in** is their own person, linked by their session as always. The
  order carries the address their account keeps, and each detail `fill` names that the guest
  left empty is taken from their account.

An address that is not one is refused `400` `PUBLIC_WRITE_REFUSED`, with `params.column` naming
the column and `params.reason` `format`.

### What the manifest needs

The validator refuses a find-by-address entry unless all of these hold. Each rule closes a way to
tell a known address from an unknown one, or to reach someone else's person.

| Field | Rule |
|---|---|
| `methods` | `["POST"]` alone, or a change through a row's own link ([below](https://docs.adminium.dev/guides/apps/identity-and-own-links/#found-on-the-accept-move)). |
| `identity.table` | Signs people in by an emailed link: an entry on the same key claims it with `verify: "email-link"`. Its address column is `unique`, `nullable`, has `normalize: "email"`, and holds at least as many characters as the typed column. |
| `identity.email` | A text column with `validation.format: "email"`, writable, and listed in `requires`. |
| `identity.link` | A nullable foreign key to the person table. Never in `select`, never writable. |
| `identity.fill` | At most four columns. Each target is a text column of the person table that is not its key, its address, a secret, unique, or a column Adminium fills. Each source is writable. |
| `claimedBy` | `{ "table": <person table>, "column": <link>, "optional": true }`. |
| `humanCheck` | `true`. |
| `anonymous.perValue` | Counts the address column. |
| The person table | No column it must have is left unfilled. It numbers no rows, carries no limit, and sends no message when a row is made: each would behave differently for a new person. |
| The order's table | Nothing on it reads through the link (a formula, a copy), and no child row shows a copy of the person. |

The fields are listed in the [manifest reference](https://docs.adminium.dev/reference/manifest/#a-person-found-by-address).

### Found on the accept move

A ticket can find its person too. The buyer offers a ticket to a friend by typing the friend's
name and address. The friend receives the ticket's own link and presses **Accept**. The ticket
then belongs to the friend: to the `customers` row with the address the link was sent to, found or
made exactly as an order's is.

This is a change through the ticket's own link, on the `ticket` key:

```json
{
  "table": "tickets",
  "key": "ticket",
  "methods": ["GET", "PATCH"],
  "select": ["id", "status", "code", "pending_name", "offer_until"],
  "writable": ["status"],
  "writableValues": { "status": ["valid"] },
  "writableWhen": { "status": ["offered"] },
  "claim": { "by": "token", "column": "link_token", "own": true, "address": ["pending_email", "holder_email"] },
  "identity": { "table": "customers", "email": "pending_email", "link": "holder_customer_id", "on": { "to": "valid" } }
}
```

- The address is the one the link was emailed to, so the entry need not let the friend write it:
  holding the link proves it.
- `on: { "to": "valid" }` finds the person only on the save that moves the ticket to `valid`, the
  accept. Any other save while the ticket has no holder finds and makes nobody. `to` must be a
  state of the table, and one the entry can write.
- A session whose ticket has since gone to another address (an offer that lapsed and was sent to
  someone else) makes and links nobody: `400` `PUBLIC_WRITE_REFUSED`.
