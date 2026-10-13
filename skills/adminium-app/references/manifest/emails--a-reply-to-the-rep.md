<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Emails — A reply to the rep; do not edit -->

# Manifest spec: Emails — A reply to the rep

### A reply to the rep

A message about a quote is sent by the business, and the customer's reply should reach the person
who owns the quote. A producer says so with `replyTo`:

```json
{ "kind": "quote-sent", "link": "quote_id", "replyTo": { "staff": "deal_id.owner_id" },
  "onChange": { "table": "quotes", "column": "status", "to": "sent" } }
```

`staff` is a [staff column](https://docs.adminium.dev/reference/manifest/#whose-a-row-is) of the row the message is about, the one the
producer's `link` names: `"owner_id"`. One link further is allowed: `"deal_id.owner_id"` on a
quote is the owner of the quote's deal. The validator refuses any other column: a text column that
holds an address is not one, and there is no way to type an address here.

When the message goes, Adminium reads who the column names and looks up the address that person
signs in with. The address is read then, not when the message was queued, and it is kept nowhere
in the app's tables. The message carries it as its Reply-To.

Sometimes there is nobody to reply to: the column or the link is empty, the person has been
removed or suspended, has not accepted their invitation yet, or is a sample person. Then the
message carries the house's own address (`settings.replyTo`) if the outbox has one, and no
Reply-To otherwise. It is sent either way: a missing rep never holds a message back.

The customer sees the rep's sign-in address in the reply field of their mail program. Use
`replyTo` only where that is what you want.
