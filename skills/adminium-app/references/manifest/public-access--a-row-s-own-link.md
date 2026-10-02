<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — A row's own link; do not edit -->

# Manifest spec: Public access — A row's own link

### A row's own link

A row's **own link** opens that one row to its owner: an order's confirmation link, a ticket sent
to a friend. It is a [token claim](https://docs.adminium.dev/reference/manifest/#a-persons-own-rows) with `"own": true`, served on a key of its
own:

```json
"publicKeys": { "ticket": {} },
"publicAccess": [
  { "table": "tickets", "key": "ticket", "methods": ["GET", "PATCH"],
    "claim": { "by": "token", "column": "link_token", "own": true, "address": ["pending_email", "holder_email"] },
    "select": ["id", "status", "code", "pending_name", "offer_until"],
    "withhold": { "columns": ["code"], "when": { "where": [{ "column": "holder_customer_id", "isNull": true }] } },
    "writable": ["status"], "writableValues": { "status": ["valid"] },
    "writableWhen": { "status": ["offered"] },
    "identity": { "table": "customers", "email": "pending_email", "link": "holder_customer_id", "on": { "to": "valid" } } }
]
```

- **Handed once.** A create entry's `shareLink` names the row's own-link column: the create answers
  the new row's link, once, to whoever made it. Otherwise the link is only ever emailed, to the
  row's own address: `address` names the 1–2 `text` columns it may go to (the holder's, and the
  friend it is offered to).
- **Verified.** The link opens a `verified` session, and the key's entries may change the row
  within their `writable` list; every entry on the key is read at `level: "verified"`. A link that
  opens nothing (stopped, expired, renewed) answers `410` `LINK_EXPIRED`.
- **Bound to its address.** When the address it was sent to changes, the sessions it opened stop.
  An entry whose change writes one of the `address` columns must [renew](https://docs.adminium.dev/reference/manifest/#codes-that-renew) the
  link's code on that change: `rules.code.renew.on` `{ "column": "<address>", "changed": true }`.
  No browser writes the link's own column, its `expires` or its `stopped`.

`newLink: { "column", "kind" }` on an entry that reads a signed-in person's rows (`claimedBy`) lets
the person ask for a fresh link: `POST /api/v1/public/records/<ref>/<id>/new-link`. The row's own
link gets a new code, which stops every session the old one opened, and the new link is emailed as
the app's outbox message `kind`, sent once per code. The outbox needs a `repeatKey` column, a link
to the table, and its recipient table must be the `claimedBy` table. Only a verified sign-in may
ask, five times a day per row; a second ask within a minute changes nothing; when the email cannot
go, the answer is `503` `PUBLIC_CODE_UNAVAILABLE`. See
[Guests, their details and their own links](https://docs.adminium.dev/guides/apps/identity-and-own-links/).

On a row's own-link entry, `newLink` makes another own link of the row again ("Send it again" for a
confirmation email): `column` is a code another key opens this table by with `own: true`, never the
entry's own. The email goes to the row's own address, as the outbox's other messages about the row,
and the asking session stays open. The address is the one the kind's own producer uses, read from
the row, and no entry may let a guest change it. Here `when: { "where": [conditions] }` is required
(it is optional on a signed-in entry): the ask goes only while the row holds every condition, and
never while that link is stopped; otherwise it is refused `409` `PUBLIC_WRITE_REFUSED`, with nothing
made, sent or counted. Besides 5 a day per row, it is 5 a day per mailbox over the whole table.
