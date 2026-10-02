<!-- produced from apps/docs/src/content/docs/guides/apps/orders-with-lines.md § Retries; do not edit -->

# An order with its lines: Retries

A guest presses **Pay**, the network drops, and the page never hears back. Did the order go in?
Pressing again must not make a second order.

The page mints a **retry key** for the cart and sends it in the column the entry names as
`clientKey`. A second save with the same key finds the order the first one made and answers it,
`200`, with `replayed: true`, instead of making another:

```json
{ "data": { … }, "children": { … }, "replayed": true }
```

- **Mint it in the browser, once per cart.** `newClientKey()` returns 32 random bytes as 43
  characters of base64url. The server takes 22 to 64 letters, digits, `-` or `_`, and refuses
  anything else `400` `PUBLIC_WRITE_REFUSED` with the column and `reason: "format"`. Never use a
  cart's id: whoever holds the key gets the order back.
- **Keep it until the order is made,** then mint a new one for the next order. A refused save made
  nothing, so its key can be sent again.
- **A replay shows the rows as they are now,** read as the person who made the order. It has no
  `link` and no `rank`: the confirmation email carries the link.
- **It still answers after online orders are switched off.** A retry of an order that went in
  before the switch is replayed; anything new is refused `403` `PUBLIC_SWITCHED_OFF`.
- **A replay is not charged** against the caps. It is still a request: it solves a new human
  check, which the client does for you.

The column is a text column, unique, with room for at least 43 characters: Adminium keeps a keyed
hash of the key, never the key itself, so staff, exports and emails that read the table learn
nothing a retry could be made with. It must be writable on the entry, and no entry of the app may
show it, filter by it or sort by it. Only a single create keeps one: a batch never does, nor a row
created through its parent.
