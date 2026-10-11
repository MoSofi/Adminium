<!-- produced from apps/docs/src/content/docs/guides/apps/identity-and-own-links.md § A row's own link; do not edit -->

# Guests, their details and their own links: A row's own link

A row's **own link** is the link its owner uses to open it: the order's confirmation link, a
ticket's link. It works like [a link that opens one row](https://docs.adminium.dev/guides/apps/public-access/#a-link-that-opens-one-row),
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
[Codes that renew](https://docs.adminium.dev/reference/manifest/#codes-that-renew) and the
[manifest reference](https://docs.adminium.dev/reference/manifest/#a-rows-own-link).
