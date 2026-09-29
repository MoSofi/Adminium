---
title: Guests, their details and their own links
description: How a guest's order finds or makes the person it belongs to, a row's own link, keeping a session, signing out everywhere, deleting one's details, making a new link, withheld columns, and the limits on a guest's change.
---

[An app's public access](/guides/apps/public-access/) covers the basics of a guest's session: a
claim by details, the emailed code, the emailed sign-in link, and a link that opens one row. This
page covers what an app builds on them when guests buy things without an account: a box office
selling tickets that the buyer can send on to a friend.

The running example is a box office with four tables: `customers` (the people who sign in),
`orders`, `tickets` (the rows of an order) and `messages` (its [outbox](/guides/apps/emails/)). It
has three browser keys: the guests' key `customer`, and two keys that open one row by its own
link, declared in `publicKeys`:

```json
"publicKeys": { "link": {}, "ticket": {} }
```

`link` opens an order, and `ticket` opens one ticket offered to a friend. Neither names a staff
role, because nobody signs in on them: the link is the credential. The fields are listed in the
[manifest reference](/reference/manifest/#public-access).

## A person found by address

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
| `methods` | `["POST"]` alone, or a change through a row's own link ([below](#found-on-the-accept-move)). |
| `identity.table` | Signs people in by an emailed link: an entry on the same key claims it with `verify: "email-link"`. Its address column is `unique`, `nullable`, has `normalize: "email"`, and holds at least as many characters as the typed column. |
| `identity.email` | A text column with `validation.format: "email"`, writable, and listed in `requires`. |
| `identity.link` | A nullable foreign key to the person table. Never in `select`, never writable. |
| `identity.fill` | At most four columns. Each target is a text column of the person table that is not its key, its address, a secret, unique, or a column Adminium fills. Each source is writable. |
| `claimedBy` | `{ "table": <person table>, "column": <link>, "optional": true }`. |
| `humanCheck` | `true`. |
| `anonymous.perValue` | Counts the address column. |
| The person table | No column it must have is left unfilled. It numbers no rows, carries no limit, and sends no message when a row is made: each would behave differently for a new person. |
| The order's table | Nothing on it reads through the link (a formula, a copy), and no child row shows a copy of the person. |

The fields are listed in the [manifest reference](/reference/manifest/#a-person-found-by-address).

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

## A row's own link

A row's **own link** is the link its owner uses to open it: the order's confirmation link, a
ticket's link. It works like [a link that opens one row](/guides/apps/public-access/#a-link-that-opens-one-row),
with three differences:

- It goes only to the row's own people: emailed to an address the row holds, or handed once to
  the page that made the row.
- It opens a **verified** session, 30 minutes long.
- It may change its row, within what the key's entries allow.

The claim says `own: true`, and `address` names the one or two text columns of the row its link may
be emailed to:

```json
{
  "table": "orders",
  "key": "link",
  "methods": ["GET", "PATCH"],
  "select": ["id", "total", "ticket_count"],
  "writable": ["note"],
  "claim": { "by": "token", "column": "link_token", "stopped": "link_stopped", "own": true, "address": "email" }
}
```

A page opens it with the code from the link's fragment, `POST /api/v1/public/claim/token` with
`{"token": …}`. The answer is `{ session, expiresAt, level: "verified" }`. An unknown code is `404`
`PUBLIC_REF_NOT_FOUND`; a link stopped or past its end is `410` `LINK_EXPIRED`. With
`@adminiumjs/public-client`, `openShared(token)` answers `opened`, `unknown` or `closed`. The
customer screens find the link key's token in their `surface-config.json`, under `publicKeys`.

### Handed once to whoever made the row

The create entry names the code column in `shareLink`. The create's `201` then carries the new
row's own link, this once:

```json
{ "data": { "id": 812, "total": "90.00", "ticket_count": 2 },
  "link": { "key": "link", "token": "7K2M9QXW4R8TB3NV", "session": "…", "expiresAt": 1790000000000 } }
```

`key` is the key that opens it, `token` the code the page keeps in its address after `#`, and
`session` a session already open on the row through that key, so the confirmation page needs no
claim. Hand it to a client of that key with `adoptSession`. A retry of the same create (the same
retry key) answers the rows again, never the link: the email carries it.

A `shareLink` column needs a token claim on the same table that opens by it with `own: true`.

### What it may change

On a key whose identity is a row's own link:

- A `PATCH` entry names what it may write. An enum it writes lists its values in
  `writableValues`.
- A `POST` entry makes only child rows of the row the link opens (`visibleWith`), such as an
  extra added to a stay.
- Every entry reached through the row (`visibleWith`) is read at `level: "verified"`.
- No entry, on any key, writes the link's code, its end date or its off switch.
- No entry on the same key writes an address column the link is emailed to. Otherwise whoever
  holds the link could send it on to an address of their choosing.

A link that opens a row but is not the row's own (no `own`) only reads.

### Bound to its address

A session opened by an own link keeps a keyed hash of the addresses the row held when it was
opened. On every request the row must still hold one of them. When the address changes, every
session the old link opened stops, at once.

That matters when another key's entry writes the address. The buyer offers a ticket to one friend,
the offer lapses, and they offer it to another: the first friend's session must not still open it.
So the link code must change whenever that address does. The validator asks for it: when any
entry's `PATCH` writes one of the claim's `address` columns, the code column declares a renewal on
that column:

```json
{ "ref": "link_token", "type": "text", "maxLength": 16, "nullable": true,
  "rules": { "code": { "length": 16, "renew": { "on": [
    { "column": "status", "values": ["offered"] },
    { "column": "pending_email", "changed": true } ] } } } }
```

The rule is `rules.code.renew.on` with `{ "column": <address>, "changed": true }`. See
[Codes that renew](/reference/manifest/#codes-that-renew) and the
[manifest reference](/reference/manifest/#a-rows-own-link).

## Keeping a session

### Reads for a signed-in guest alone

Some rows are for anyone who has signed in, but belong to nobody: the box office's settings,
payment instructions. An entry with a `level` and no `claim`, `claimedBy` or `visibleWith` is such
a read:

```json
{ "table": "settings", "methods": ["GET"], "level": "verified", "select": ["offer_hours"] }
```

- It answers `404` `PUBLIC_REF_NOT_FOUND` with no session, and `403` `PUBLIC_CLAIM_LEVEL` to a
  session below its level.
- It is not listed in `/public/config`, so a visitor who has not signed in does not learn it
  exists.
- It only reads, lists what it shows in `select`, and needs a key that signs people in. On a key
  whose sessions are all verified (an emailed link, or a row's own link) it says `verified`.

### Across a reload

A page that reloads loses its client, and with it the session. `@adminiumjs/public-client` lets
the page keep it:

```ts
const kept = sessionStorage.getItem('session');
const client = createPublicClient({
  baseUrl,
  publishableKey,
  session: kept === null ? undefined : JSON.parse(kept),
  onSessionChange: (session) =>
    session === null ? sessionStorage.removeItem('session') : sessionStorage.setItem('session', JSON.stringify(session)),
  onSessionEnded: (reason) => showSignedOut(reason),
});
```

- `session()` answers `{ token, level, expiresAt }`, or null.
- `onSessionChange` is called whenever the session is opened, adopted, raised, ended or dropped
  (then with null).
- A `session` option already past its `expiresAt`, or with no token, is not held.
- `signOut()` ends a kept session on the server too, and drops it locally whatever the server
  answered.

### The server's clock

A guest's phone can be hours out. `/public/config` carries `now`, the server's clock when it
answered, and is never cached (`cache-control: no-store`). `client.now()` answers the device's
clock set right by the difference the config showed, so a page asks for the venue's today, not
the phone's. The staff and customer `surface-config.json` carry `now` too.

## Sign out everywhere

A guest who thinks someone else read their mailbox presses **Sign out everywhere**:
`POST /api/v1/public/session/revoke-all`, with `signOutEverywhere()` in the client.

- Every session of the person ends, this one too.
- Every sign-in link still open to their address is taken back.
- The other devices are told why on their next request ([below](#when-a-session-was-ended)).
- A row's own link is not a session of the person's, and keeps working. To stop one, use
  [Make a new link](#make-a-new-link).

It needs a verified session of the person, signed in by email: a lookup session is refused `403`
`PUBLIC_CLAIM_LEVEL`, and a row's own link `403` `PUBLIC_CLAIM_UNAVAILABLE`.

## Delete my details

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
| `forget.links` | `true` to stop the person's own links too ([below](#stopping-own-links-too)). |

See the [manifest reference](/reference/manifest/#delete-my-details).

### Stopping own links too

A ticket's link in an old email still opens the ticket after its holder deleted their details.
With `forget.links: true`, the delete first gives every own link of the person's rows a new code:
every order and ticket that points at them, through any entry that claims it or finds them by
address. Every session those links opened ends, told `forgotten`. If one cannot be stopped, the
answer is `409` `PUBLIC_WRITE_REFUSED` and nothing is forgotten, so the guest can try again.

It is the app's choice. Without it, the rows' own links keep working.

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

## When a session was ended

A session ended by **Sign out everywhere** or by **Delete my details** answers its next request as
no session, with the header `x-adminium-session-ended` set to `elsewhere` or `forgotten`. It is
said once, only to the holder of that session's token: after that the token is simply unknown,
as a lapsed one is. The client drops the session, calls `onSessionEnded(reason)`, and
`sessionEnded()` answers the reason, so the page can say "You were signed out on another device"
rather than seem to forget them.

A session found by details a person typed (a phone, an address) lasts only while their record
still holds what they typed, and a session raised by an emailed code only while the record still
holds the address the code went to. The record is asked again on every request, whatever changed
it: when the desk changes one of those details, the session answers as no session (without the
header), and the person finds themselves again.

## Make a new link

A guest forwarded their confirmation to the wrong person. Signed in, they press **Make a new
link** on the order. The order's own link gets a new code, the old link and every session it
opened stop at once, and the new link is emailed to the guest.

The signed-in read of the order names the code column and the outbox message that carries the new
link:

```json
{
  "table": "orders",
  "methods": ["GET"],
  "level": "verified",
  "claimedBy": { "table": "customers", "column": "customer_id" },
  "select": ["id", "total", "ticket_count"],
  "newLink": { "column": "link_token", "kind": "order-link" }
}
```

The page asks with `POST /api/v1/public/records/{ref}/{id}/new-link`, or `newLink(ref, id)` in the
client. It answers `202` with `{ "data": {} }`: the new link is never in the answer.

- **Only the signed-in person.** The session must be a verified sign-in by email. A row's own
  link, a lookup session, or a row that is someone else's all answer the same `404`
  `PUBLIC_REF_NOT_FOUND`.
- **Mailed as the app's own message.** The new link goes out as the outbox message `kind`, to the
  session's own person, never to someone the row points at. The app writes the wording in its
  eight languages and its link, such as `{{manage_url}}#{{order.link_token}}`. It is sent once per
  code.
- **Checked before anything stops.** When mail is not set up, the outbox has no such message, or
  the person has no address on file, the answer is `503` `PUBLIC_CODE_UNAVAILABLE` and the old
  link keeps working. In the rare case the address empties between that check and the email, the
  new link is made, the answer is the same `503`, and the desk can send the link.
- **5 a day per row.** The sixth is `409` `PUBLIC_LIMIT_REACHED`, and the page offers the phone.
- **One at a time.** A second press, or a retry, within 60 seconds of a new link answers `202`
  and makes no other; that link's email is on its way.
- **Only while it applies.** With `when`, the row must hold every condition, or the answer is a bare
  `409` `PUBLIC_WRITE_REFUSED`: nothing is made, sent or counted.

### Send it again, through the row's own link

A buyer who paid by bank transfer gets a **Confirm your order** email, with a link of its own (a
second own link of the order, opened by its own key). The email never came, so on the checkout's
**One more step** screen they press **Send it again**. That screen has the order's own link, not a
sign-in, so the order's own-link entry names the confirm link and when it may be sent again:

```json
{
  "table": "orders",
  "key": "link",
  "methods": ["GET", "PATCH"],
  "claim": { "by": "token", "column": "link_token", "own": true, "address": "email" },
  "select": ["id", "status", "total"],
  "writable": ["status"],
  "newLink": {
    "column": "confirm_token",
    "kind": "transfer-confirm",
    "when": { "where": [{ "column": "status", "eq": "confirming" }] }
  }
}
```

The page asks with the same `POST /api/v1/public/records/{ref}/{id}/new-link` (or `newLink(ref, id)`),
with the session its own link opened. The confirm link gets a new code, so the first email's link
stops opening anything, and the new one is emailed as the outbox message `kind`.

- **To the row's own address.** It goes where the kind's own producer sends it (its
  `recipient` column of the row, else the person the row links, else the outbox's fallback through
  the row), never to an address in the request. No entry may let a guest change that address.
- **The asking link stays open.** Only the confirm link changes; the order's own link and its
  session keep working.
- **Only while `when` holds.** `when` is required here. Asked when the order is not confirming
  (not yet, or confirmed already), or while the confirm link is stopped, the answer is a bare `409`
  `PUBLIC_WRITE_REFUSED`, and nothing is made, sent or counted. The condition is checked again in
  the same statement that makes the new code, so a confirm that lands meanwhile wins.
- **The new code and its email are kept together.** The email is queued in the same transaction
  that makes the new code: when it cannot be queued, nothing is made, the old link keeps working,
  and nothing is counted (`503` `PUBLIC_CODE_UNAVAILABLE`, or `409` `PUBLIC_SLOT_BUSY` while the
  outbox is busy).
- **Limits.** 5 a day per row (whichever session asks), and 5 a day per mailbox over every row of
  the table (an address counted as the other public limits count it: lower case, without a `+tag`),
  and a second ask within 60 seconds for one row answers `202` and makes no other. Over either
  daily limit, `409` `PUBLIC_LIMIT_REACHED`, counting nothing.
- **The kind's own rules.** It is judged by the `gate` of the kind's own producer: while that
  switch or feature is off, the answer is `503` `PUBLIC_CODE_UNAVAILABLE`, and nothing is made or
  counted. A kind held for a person's approval (`hold: true`), or one whose producer repeats by
  another column than the renewed link (`repeatBy`), is refused by the validator.

| Field | Rule |
|---|---|
| `newLink` | On a `GET` entry with a `claimedBy` that is not optional, on a key that signs people in by email; or on a row's own-link entry (a token claim with `own: true`) that reads the row. |
| `newLink.column` | Signed in: the code of a row's own link, a token claim with `own: true` on this table, by this column. Through the row's own link: another key's own link on this table, never the code the entry opens the row by. |
| `newLink.kind` | One of the outbox's `kinds`. The outbox has a `repeatKey` column (text that holds at least 43 characters, a digest) and a link to this table. Signed in, its recipient table is the `claimedBy` table. Through the row's own link, the kind's own producer addresses it from the row (a `recipient.column` of the row; with none, the person the row links or the outbox's fallback through this table), and no entry that changes rows may write the column that address is read from. |
| `newLink.when` | `{ "where": [conditions] }`, 1 to 8 conditions on columns the entry shows (`eq`, `in`, `isNull`, `gt`, `gte`, `lt`, `lte`), all of which must hold; a text is compared exactly. Required through the row's own link, optional signed in. |

## Withheld columns

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

See the [manifest reference](/reference/manifest/#withheld-columns).

## Limits on a guest's change

Sending a ticket to a friend is an email to an address the buyer chose, with a name they typed.
Without a limit, the box office's mail becomes anyone's relay. `limits` holds a change to what a
stranger's create is held to:

```json
"limits": { "perValue": { "columns": ["pending_email"], "n": 5 }, "plainText": ["pending_name"] }
```

- **`perValue`**: at most `n` changes a day that write one value, counted across every table of
  the connection: five tickets a day to one friend, however they are sent. An address counts as
  its mailbox, in lower case, with a `+tag` dropped and, for Gmail, its dots too. Over the limit,
  the change is refused `409` `PUBLIC_LIMIT_REACHED`. A change that does not go through hands its
  count back, and a [dry run](/reference/manifest/#dry-runs-price-checks-and-retries) is never
  counted.
- **`plainText`**: the columns hold plain text. A value that is not is refused `400`
  `PUBLIC_WRITE_REFUSED`, with `params.column` naming the column.

`limits` goes on an entry with `PATCH`. Each column is a writable text column. A create uses
`anonymous` instead ([Limits on a stranger's create](/guides/apps/public-access/#limits-on-a-strangers-create)).

### Plain text

Plain text is letters (of any alphabet), spaces and `. , ' ’ ( ) & -`, up to 80 characters: no
digits, no `://` and no `www.`. Every `plainText` list (`anonymous.plainText`, `limits.plainText`
and a child row's `plainText`) also refuses:

- an `@`, so no handle;
- a `/`, so no path;
- a dotted word whose last part is a known web ending, such as `evil.com`, `claim.refund.net`,
  `shop.co.uk` or `refund-desk.cafe`. The ending is read as a reader sees it: fullwidth letters,
  an accent or an invisible mark on it, and a hyphen after it change nothing.

"Mary.Ann", "J.R.R. Tolkien" and "St. John" are names, and pass; so is "x dot com", which names no
address. Initials before a surname pass too ("W.Hu", "K.Y.Ng", "M.De Vries"), unless the surname is
an ending an address is always read in (`X.Com`, `J.Co`). A name like `refund-desk.com Smith` is
refused. The rule refuses web and email addresses in their common forms; the endings it knows are
a list, so an address ending in one it does not know still passes.

A column a create lists under `anonymous.plainText` is judged on every write of it: the create
itself, signed in or not (a name the person's account fills in too), and every change of the row
that writes it, through its own link, a signed-in person's rows or a batch. A person's own column
that `identity.fill` fills such a column from (the account's `name` into an order's `buyer_name`)
is judged the same way on the account's change. The refusal says `params.column`; its message
names the rule.

### A visitor's hour

A create through an entry with `anonymous` limits also holds each visitor to 60 an hour through
the key. A visitor is an IP address, or an IPv6 subscriber's whole /64. `anonymous.perIpHour`
lowers that for one entry, from 1 to 60; it is counted before the whole key's hour, so one visitor
cannot spend it for everyone. Over it, the create is refused `409` `PUBLIC_LIMIT_REACHED`. See the
[manifest reference](/reference/manifest/#limits-on-a-guests-change).

## Personal columns on an entry anyone may call

An entry anyone may call (no claim, no parent, no session asked, or a create a session is optional
on) never shows personal data. The validator refuses one that selects a column marked
`personal: true`, or one the install would read as personal by its name: an email address, a phone
number, a street address, a birth date, an ID or account number, and a first, last or full name on
a table of people. An entry with no `select` is read as the install reads it: every column but
codes and secrets.

A column whose name only looks personal says so with `personal: false`:

```json
{ "ref": "venue_phone", "type": "text", "maxLength": 32, "nullable": true, "rules": { "personal": false } }
```

## Refusals

| Code | Status | When |
|---|---|---|
| `PUBLIC_WRITE_REFUSED` | 400 | An address that is not one (`params.reason` `format`); a value that is not plain text (`params.column`); a change through an own link naming an address it was not opened for. |
| `PUBLIC_QUERY_REFUSED` | 400 | A filter or sort by a withheld column. |
| `PUBLIC_CLAIM_LEVEL` | 403 | A lookup session on a verified read, sign-out everywhere or delete. |
| `PUBLIC_CLAIM_UNAVAILABLE` | 403 | Sign-out everywhere or delete from a row's own link, or on a key with no `forget`. |
| `PUBLIC_CODE_STEP_UP` | 403 | Delete my details without a mailbox proved in the last 10 minutes. |
| `PUBLIC_REF_NOT_FOUND` | 404 | A session-only read with no session; a new link asked for a row that is not the person's, or by a session that may not. |
| `LINK_EXPIRED` | 410 | An own link stopped or past its end. |
| `PUBLIC_LIMIT_REACHED` | 409 | Over `perValue`, `perIpHour`, 5 new links a day for one row, or 5 resent links a day to one mailbox. |
| `PUBLIC_WRITE_REFUSED` | 409 | A delete whose own links could not all be stopped; a new link for a row with no code, or one that does not hold the entry's `newLink.when`. |
| `PUBLIC_CODE_UNAVAILABLE` | 503 | A new link that cannot be emailed. It is checked first, so the old link is kept. |

Every code is in the [errors reference](/reference/errors/), and every route in the
[REST API reference](/reference/rest-api/).

## Upgrading

A session opened by a row's own link before the upgrade, on a claim with `address`, carries no
addresses. It closes once, and the guest opens the link again.
