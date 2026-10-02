<!-- produced from apps/docs/src/content/docs/guides/apps/orders-with-lines.md § The price first; do not edit -->

# An order with its lines: The price first

A guest should see what the order comes to before they pay. With `"dryRun": true` on the entry,
the page can send the same body to the quote route:

```bash
curl -X POST 'https://admin.example.com/api/v1/public/records/kitchen_orders/dry-run' \
  -H "Authorization: Bearer $ADMINIUM_KEY" \
  -H 'Content-Type: application/json' \
  -d '{ "values": { "pickup_at": "2026-10-02T12:30:00Z" }, "children": { "order_items": [ … ] } }'
```

```json
{
  "data": { "pickup_at": "2026-10-02T12:30:00Z", "subtotal": "31.50", "tax": "2.60", "total": "34.10" },
  "children": { "order_items": [ … ] },
  "capacity": [ { "pool": "…", "state": "available" } ],
  "exact": true
}
```

A quote runs the save's own steps in a transaction that is always rolled back:

- **Every figure.** Each line's price, the options, the tax, the total: whatever Adminium works out
  for the rows. A stay priced by the night also answers `nights`, one entry per night with its
  `date`, its `rate`, its `base` rate before anything was added, and the `tags` of what was added
  (a weekend rate).
- **No keys, no numbers.** A quote shows no row key, no running number (the next number would tell
  how many orders were made), no code and no retry key.
- **Before the details.** The name and address a guest has not typed yet are filled in for the
  quote alone and shown empty, so the cart can be priced first. Only a column the price does not
  read is filled in.
- **Nothing kept, nothing held.** A quote takes no lock, claims no number, makes no person, sends
  nothing and holds no place. It reads the rows it judges as they are.
- **Never charged.** A quote does not count against the entry's [caps](https://docs.adminium.dev/guides/apps/orders-with-lines/#limits-on-a-strangers-order),
  and needs no human check. It costs a read, not a write.
- **Refused as the save would be.** A dish not on the menu, a size left out, a sold-out line, a
  name with a link in it: the quote gets the refusal the save would get, so the page can say so
  before the guest pays.
- **Holds let go as the save would.** Where a checkout holds places for a while
  ([holds](https://docs.adminium.dev/reference/manifest/#holds)), a page that sends its old hold's session as `replaces`
  gets a quote that counts that hold as let go, as the save would. Nothing is let go by the quote.
- **`capacity`** lists each limit the order takes from and whether it is `available` or `full`.
- **`exact`** is `false` when the app runs its own code before a create on one of the tables. A
  quote runs none, so the save may come to another figure.

A quote refuses when online orders are switched off, like the save.
