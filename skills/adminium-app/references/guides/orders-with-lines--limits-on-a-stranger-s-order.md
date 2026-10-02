<!-- produced from apps/docs/src/content/docs/guides/apps/orders-with-lines.md § Limits on a stranger's order; do not edit -->

# An order with its lines: Limits on a stranger's order

### Capacity counts every row

The order's rows are judged against the app's limits once, over every row the write makes. A line
of three burgers takes three from the day's burgers, a pickup slot takes the order, a ticket takes
its place in its ticket type. A limit on a child table counts the child rows exactly as it counts
rows made one at a time. See [booking rules](https://docs.adminium.dev/guides/apps/booking-rules/) and the manifest's
[capacity](https://docs.adminium.dev/reference/manifest/#capacity) for how limits are declared.

### Caps on a stranger

`anonymous` caps an order that nobody signed in for, as on any
[stranger's create](https://docs.adminium.dev/guides/apps/public-access/#limits-on-a-strangers-create):

- **`perValue`**: at most so many a day for one value of the named columns (one address).
- **`perKeyHour`**: at most so many an hour through the key, from everyone.
- **`perIpHour`**: at most so many an hour from one visitor through this entry, 1 to 60. A visitor
  is one address, or an IPv6 subscriber's whole /64. Every visitor is also held to 60 an hour on
  the key, so this only ever lowers it.
- **`plainText`**: the order's own columns that hold plain text only, judged as a line's
  `plainText` is: no link, handle or web address.

Every cap is charged just before the rows are written. An order
refused for a guest's own value (a note too long, an address that is not one) gives the charge
back. Any other refusal of the whole order keeps it: a sold-out line, a busy slot, a moved price,
an option of the wrong dish. A quote is never charged, and a replay is not either.

### The human check

A create with its child rows asks for one proof for the whole write, not one per row. See
[the human check](https://docs.adminium.dev/guides/apps/public-access/#the-human-check).
