<!-- produced from apps/docs/src/content/docs/guides/apps/identity-and-own-links.md § Make a new link; do not edit -->

# Guests, their details and their own links: Make a new link

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
